/**
 * MWT-21: Real Worker Execution Seam — zero-DB deterministic test.
 *
 * Runs with: npx tsx scripts/trst/mwt21-real-executor.test.mts
 *
 * Verifies the NEW `real` execution_mode in WorkerExecutionHarnessService:
 *   - When execution_mode === "real", the attempt invokes a REAL executor seam
 *     (default: TaskPlanner + ExecutionLoop) and records a hash-only output_hash.
 *   - The RAW final content is NEVER persisted to the attempt record (red line).
 *   - The default path (deterministic_local) is unchanged and still produces NO
 *     output_hash.
 *   - Contract gate (approved-only) still applies in real mode.
 *
 * Uses an in-memory fake ExecutionAttemptStore + a deterministic fake real
 * executor (no model calls), so it stays fully offline and repeatable.
 */

import { randomUUID, createHash } from "node:crypto";
import {
  WorkerExecutionHarnessService,
  type ExecutionAttemptStore,
  type WorkerExecutionAttemptRecord,
  type RealExecutorFn,
  type ContractLookupFn,
  type ContractGateSnapshot,
} from "../../src/services/manager/execution-attempt-service.ts";

// ── In-memory fake attempt store ──────────────────────────────────────────────
class InMemoryAttemptStore implements ExecutionAttemptStore {
  private attempts = new Map<string, WorkerExecutionAttemptRecord>();
  async create(rec: Omit<WorkerExecutionAttemptRecord, "created_at" | "updated_at" | "completed_at">): Promise<WorkerExecutionAttemptRecord> {
    const now = new Date().toISOString();
    const full: WorkerExecutionAttemptRecord = { ...rec, created_at: now, updated_at: now, completed_at: null } as WorkerExecutionAttemptRecord;
    this.attempts.set(rec.attempt_id, full);
    return full;
  }
  async listByConversation(_userId: string, conversationId: string): Promise<WorkerExecutionAttemptRecord[]> {
    return [...this.attempts.values()].filter((a) => a.conversation_id === conversationId);
  }
  async listByContract(_userId: string, contractId: string): Promise<WorkerExecutionAttemptRecord[]> {
    return [...this.attempts.values()].filter((a) => a.contract_id === contractId);
  }
  async get(_userId: string, attemptId: string): Promise<WorkerExecutionAttemptRecord | null> {
    return this.attempts.get(attemptId) ?? null;
  }
  async update(_userId: string, attemptId: string, patch: Partial<WorkerExecutionAttemptRecord>): Promise<WorkerExecutionAttemptRecord | null> {
    const cur = this.attempts.get(attemptId);
    if (!cur) return null;
    const next = { ...cur, ...patch, updated_at: new Date().toISOString() };
    this.attempts.set(attemptId, next);
    return next;
  }
  async cancel(_userId: string, attemptId: string): Promise<WorkerExecutionAttemptRecord | null> {
    const cur = this.attempts.get(attemptId);
    if (!cur) return null;
    cur.status = "cancelled";
    return cur;
  }
}

// ── Fake contract lookup (approved only) ──────────────────────────────────────
const approvedSnapshot: ContractGateSnapshot = {
  contract_id: "wdc-1",
  conversation_id: "conv-1",
  user_id: "u-1",
  title: "Summarize Q3 report",
  objective: "Produce a 3-paragraph summary of the Q3 report",
  status: "approved",
  intended_worker: "summary-worker",
  input_summary: "Q3 report doc",
  constraints: "no external calls",
};
const lookupContract: ContractLookupFn = async (userId, contractId) => {
  if (userId === approvedSnapshot.user_id && contractId === approvedSnapshot.contract_id) return approvedSnapshot;
  return null;
};

// Deterministic fake REAL executor: returns a fixed raw string, derives hash.
const RAW = "REAL-WORKER-OUTPUT-abc123";
const FAKE_HASH = createHash("sha256").update(RAW).digest("hex");
const fakeRealExecutor: RealExecutorFn = async () => ({
  status: "completed",
  final_content: RAW,
  output_hash: FAKE_HASH,
  error_summary: null,
  result_summary: "[real] executed",
});

// ── Tiny assert helper ────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? " — " + extra : ""}`); }
}

async function main() {
  console.log("MWT-21: Real Worker Execution Seam (zero-DB)");

  // 1) real mode → output_hash recorded, raw content NOT stored
  {
    const store = new InMemoryAttemptStore();
    const svc = new WorkerExecutionHarnessService(store, lookupContract, undefined as any, fakeRealExecutor);
    const rec = await svc.createAttemptFromContract("u-1", "wdc-1", { execution_mode: "real" });
    check("real mode sets execution_mode=real", rec.execution_mode === "real");
    check("real mode records output_hash", !!rec.output_hash, `got ${rec.output_hash}`);
    check("real mode output_hash matches raw hash", rec.output_hash === FAKE_HASH);
    check("real mode does NOT persist raw content", !JSON.stringify(rec).includes(RAW), "raw leaked into record");
    check("real mode status completed", rec.status === "completed");
  }

  // 2) default (deterministic_local) mode → still no output_hash (unchanged behavior)
  {
    const store = new InMemoryAttemptStore();
    const svc = new WorkerExecutionHarnessService(store, lookupContract, undefined as any, fakeRealExecutor);
    const rec = await svc.createAttemptFromContract("u-1", "wdc-1", {});
    check("default mode execution_mode=deterministic_local", rec.execution_mode === "deterministic_local");
    check("default mode has NO output_hash", rec.output_hash === null);
    check("default mode runs local executor (harness label)", !!rec.result_summary && rec.result_summary.includes("[deterministic_local]"), rec.result_summary ?? "null");
  }

  // 3) real mode still enforces contract gate (rejected contract → no attempt)
  {
    const store = new InMemoryAttemptStore();
    const rejectedLookup: ContractLookupFn = async () => ({ ...approvedSnapshot, status: "rejected" });
    const svc = new WorkerExecutionHarnessService(store, rejectedLookup, undefined as any, fakeRealExecutor);
    let threw = false;
    try { await svc.createAttemptFromContract("u-1", "wdc-1", { execution_mode: "real" }); }
    catch { threw = true; }
    check("real mode rejects non-approved contract", threw);
  }

  console.log(`\nMWT-21 zero-DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
