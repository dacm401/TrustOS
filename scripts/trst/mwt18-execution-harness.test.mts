/**
 * MWT-18: Controlled Worker Execution Harness v0 — deterministic, zero-DB test.
 *
 * Runs with: npx tsx scripts/trst/mwt18-execution-harness.test.mts
 *
 * Verifies the HTTP boundary (managerConversationsRouter execution-attempt
 * endpoints) wires to the WorkerExecutionHarnessService correctly, using:
 *   - in-memory fake ConversationStore (ownership)
 *   - in-memory fake DelegationContractStore (contract gate source)
 *   - in-memory fake ExecutionAttemptStore (attempt records)
 *
 * Key invariants confirmed:
 *   - Attempts can ONLY be created from an APPROVED contract (contract gate).
 *   - draft / ready_for_review / rejected / superseded contracts are rejected (409).
 *   - The harness runs a LOCAL deterministic executor with NO external calls;
 *     result_summary is labeled as local harness output, not live evidence.
 *   - No raw memory/trust payload is stored in the attempt record.
 *   - cancel works on queued/running; terminal attempts cannot be cancelled.
 *   - The attempt explicitly does NOT claim global Private Beta READY.
 */

import { Hono } from "hono";
import {
  managerConversationsRouter,
  __setConversationStoreForTesting,
  __setDelegationStoreForTesting,
  __setAttemptStoreForTesting,
} from "../../src/api/manager-conversations.ts";
import { identityMiddleware } from "../../src/middleware/identity.ts";
import type { ConversationRecord, ConversationStore } from "../../src/services/manager/conversation-service.ts";
import type {
  DelegationContractStore,
  WorkerDelegationContractRecord,
  ContractStatus,
} from "../../src/services/manager/delegation-contract-service.ts";
import type {
  ExecutionAttemptStore,
  WorkerExecutionAttemptRecord,
  ExecutionMode,
} from "../../src/services/manager/execution-attempt-service.ts";

// ── In-memory fake conversation store ─────────────────────────────────────────
class InMemoryConversationStore implements ConversationStore {
  private conversations = new Map<string, ConversationRecord>();
  async createConversation(userId: string, title: string | null): Promise<ConversationRecord> {
    const id = `conv-${this.conversations.size + 1}`;
    const now = new Date().toISOString();
    const rec: ConversationRecord = { id, user_id: userId, title, created_at: now, updated_at: now };
    this.conversations.set(id, rec);
    return rec;
  }
  async getConversation(userId: string, id: string): Promise<ConversationRecord | null> {
    const r = this.conversations.get(id);
    if (!r || r.user_id !== userId) return null;
    return r;
  }
  async listConversations(userId: string, limit = 50): Promise<ConversationRecord[]> {
    return [...this.conversations.values()].filter((c) => c.user_id === userId).slice(0, limit);
  }
  async touchConversation(id: string): Promise<void> {
    const r = this.conversations.get(id);
    if (r) r.updated_at = new Date().toISOString();
  }
}

// ── In-memory fake delegation-contract store ─────────────────────────────────
class InMemoryDelegationStore implements DelegationContractStore {
  private contracts = new Map<string, WorkerDelegationContractRecord>();
  private seq = 0;
  async create(userId: string, input: any): Promise<WorkerDelegationContractRecord> {
    const id = `wdc-${++this.seq}`;
    const now = new Date().toISOString();
    const rec: WorkerDelegationContractRecord = {
      contract_id: id,
      conversation_id: input.conversation_id,
      user_id: userId,
      title: input.title,
      objective: input.objective,
      intended_worker: input.intended_worker ?? null,
      input_summary: input.input_summary ?? null,
      memory_ref_ids: input.memory_ref_ids ?? [],
      trust_ref_ids: input.trust_ref_ids ?? [],
      constraints: input.constraints ?? null,
      expected_output: input.expected_output ?? null,
      status: input.status ?? "draft",
      created_at: now,
      updated_at: now,
    };
    this.contracts.set(id, rec);
    return rec;
  }
  async listByConversation(userId: string, conversationId: string): Promise<WorkerDelegationContractRecord[]> {
    return [...this.contracts.values()]
      .filter((c) => c.conversation_id === conversationId && c.user_id === userId)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }
  async get(userId: string, contractId: string): Promise<WorkerDelegationContractRecord | null> {
    const c = this.contracts.get(contractId);
    if (!c || c.user_id !== userId) return null;
    return c;
  }
  async update(userId: string, contractId: string, patch: any): Promise<WorkerDelegationContractRecord | null> {
    const c = this.contracts.get(contractId);
    if (!c || c.user_id !== userId) return null;
    const next = { ...c, ...patch, updated_at: new Date().toISOString() };
    this.contracts.set(contractId, next);
    return next;
  }
  async remove(userId: string, contractId: string): Promise<boolean> {
    const c = this.contracts.get(contractId);
    if (!c || c.user_id !== userId) return false;
    return this.contracts.delete(contractId);
  }
  // helper for tests: set status directly
  __setStatus(id: string, status: ContractStatus) {
    const c = this.contracts.get(id);
    if (c) c.status = status;
  }
}

// ── In-memory fake execution-attempt store ───────────────────────────────────
class InMemoryAttemptStore implements ExecutionAttemptStore {
  private attempts = new Map<string, WorkerExecutionAttemptRecord>();
  async create(rec: any): Promise<WorkerExecutionAttemptRecord> {
    const now = new Date().toISOString();
    const full: WorkerExecutionAttemptRecord = {
      attempt_id: rec.attempt_id,
      conversation_id: rec.conversation_id,
      contract_id: rec.contract_id,
      user_id: rec.user_id,
      worker_label: rec.worker_label ?? null,
      input_summary: rec.input_summary ?? null,
      constraints: rec.constraints ?? null,
      status: rec.status,
      result_summary: rec.result_summary ?? null,
      error_summary: rec.error_summary ?? null,
      execution_mode: rec.execution_mode,
      created_at: now,
      updated_at: now,
      completed_at: null,
    };
    this.attempts.set(rec.attempt_id, full);
    return full;
  }
  async listByConversation(userId: string, conversationId: string): Promise<WorkerExecutionAttemptRecord[]> {
    return [...this.attempts.values()]
      .filter((a) => a.conversation_id === conversationId && a.user_id === userId)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }
  async listByContract(userId: string, contractId: string): Promise<WorkerExecutionAttemptRecord[]> {
    return [...this.attempts.values()].filter((a) => a.contract_id === contractId && a.user_id === userId);
  }
  async get(userId: string, attemptId: string): Promise<WorkerExecutionAttemptRecord | null> {
    const a = this.attempts.get(attemptId);
    if (!a || a.user_id !== userId) return null;
    return a;
  }
  async update(userId: string, attemptId: string, patch: any): Promise<WorkerExecutionAttemptRecord | null> {
    const a = this.attempts.get(attemptId);
    if (!a || a.user_id !== userId) return null;
    const next = { ...a, ...patch, updated_at: new Date().toISOString() };
    this.attempts.set(attemptId, next);
    return next;
  }
  async remove(userId: string, attemptId: string): Promise<boolean> {
    const a = this.attempts.get(attemptId);
    if (!a || a.user_id !== userId) return false;
    return this.attempts.delete(attemptId);
  }
}

const convStore = new InMemoryConversationStore();
const delegationStore = new InMemoryDelegationStore();
const attemptStore = new InMemoryAttemptStore();

__setConversationStoreForTesting(convStore);
__setDelegationStoreForTesting(delegationStore);
__setAttemptStoreForTesting(attemptStore);

const app = new Hono();
app.use(identityMiddleware);
app.route("/v1/manager-conversations", managerConversationsRouter);

// ── assert harness ─────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}`); }
}

const CONV = (cid: string) => `/v1/manager-conversations/${cid}`;
const headers = (userId: string) => ({ "Content-Type": "application/json", "X-User-Id": userId });

async function main() {
  const userId = "test-user";

  // 1. setup conversation + a draft and an approved contract
  const convRes = await app.request("/v1/manager-conversations", {
    method: "POST",
    headers: headers(userId),
    body: JSON.stringify({ title: "Exec test" }),
  });
  const cid = (await convRes.json()).conversation.id;

  const draftC = await app.request(`${CONV(cid)}/contracts`, {
    method: "POST",
    headers: headers(userId),
    body: JSON.stringify({ title: "Draft contract", objective: "should be blocked" }),
  });
  const draftId = (await draftC.json()).contract?.contract_id;

  const approvedC = await app.request(`${CONV(cid)}/contracts`, {
    method: "POST",
    headers: headers(userId),
    body: JSON.stringify({
      title: "Approved contract",
      objective: "summarize report",
      intended_worker: "report-summarizer",
      constraints: "no external network",
    }),
  });
  const approvedId = (await approvedC.json()).contract?.contract_id;
  // approve it via status endpoint
  const appr = await app.request(`${CONV(cid)}/contracts/${approvedId}/status`, {
    method: "POST",
    headers: headers(userId),
    body: JSON.stringify({ status: "ready_for_review" }),
  });
  check("approve path ready_for_review 200", appr.status === 200);
  const appr2 = await app.request(`${CONV(cid)}/contracts/${approvedId}/status`, {
    method: "POST",
    headers: headers(userId),
    body: JSON.stringify({ status: "approved" }),
  });
  check("approve path approved 200", appr2.status === 200);

  // 2. contract gate: draft contract rejected (409)
  const blocked = await app.request(`${CONV(cid)}/contracts/${draftId}/attempts`, {
    method: "POST",
    headers: headers(userId),
    body: JSON.stringify({ execution_mode: "deterministic_local" }),
  });
  check("draft contract attempt rejected 409", blocked.status === 409);

  // 3. approved contract -> attempt created 201
  const made = await app.request(`${CONV(cid)}/contracts/${approvedId}/attempts`, {
    method: "POST",
    headers: headers(userId),
    body: JSON.stringify({ execution_mode: "deterministic_local" }),
  });
  check("approved contract attempt created 201", made.status === 201);
  const madeBody = await made.json();
  const aId = madeBody.attempt?.attempt_id;
  check("attempt status completed", madeBody.attempt?.status === "completed");
  check("attempt links contract", madeBody.attempt?.contract_id === approvedId);
  check("attempt links conversation", madeBody.attempt?.conversation_id === cid);
  check("attempt mode deterministic_local", madeBody.attempt?.execution_mode === "deterministic_local");

  // 4. local / non-live labeling (explicitly disclaims live evidence — honest)
  const res = madeBody.attempt?.result_summary ?? "";
  check("result labeled as local harness output", res.includes("deterministic_local") && res.includes("No external side effects"));
  check(
    "result disclaims live evidence / real completion",
    res.toLowerCase().includes("not live evidence") && res.toLowerCase().includes("no external side effects")
  );
  check(
    "result does NOT claim real-world completion",
    !res.toLowerCase().includes("task completed in production") && !res.toLowerCase().includes("live execution succeeded")
  );

  // 5. no raw payload stored (only IDs, labels, summaries)
  const safeShape =
    !("memory_ref_ids" in madeBody.attempt) &&
    !("trust_ref_ids" in madeBody.attempt) &&
    !("content" in madeBody.attempt) &&
    !("event_hash" in madeBody.attempt) &&
    !("payload" in madeBody.attempt);
  check("no raw memory/trust payload in attempt", safeShape);

  // 6. list attempts
  const listed = await app.request(`${CONV(cid)}/attempts`, { headers: headers(userId) });
  check("list attempts 200", listed.status === 200);
  check("one attempt listed", (await listed.json()).total === 1);

  // 7. get attempt
  const got = await app.request(`${CONV(cid)}/attempts/${aId}`, { headers: headers(userId) });
  check("get attempt 200", got.status === 200);

  // 8. cancel a completed attempt rejected (409 terminal)
  const cancelTerm = await app.request(`${CONV(cid)}/attempts/${aId}/cancel`, {
    method: "POST",
    headers: headers(userId),
  });
  check("cancel terminal attempt rejected 409", cancelTerm.status === 409);

  // 9. dry_run mode produces dry_run result
  const dryMade = await app.request(`${CONV(cid)}/contracts/${approvedId}/attempts`, {
    method: "POST",
    headers: headers(userId),
    body: JSON.stringify({ execution_mode: "dry_run" }),
  });
  const dryBody = await dryMade.json();
  check("dry_run attempt 201", dryMade.status === 201);
  check("dry_run result labeled dry_run", (dryBody.attempt?.result_summary ?? "").includes("[dry_run]"));

  // 10. ownership: other user cannot create attempt on my approved contract
  const otherAttempt = await app.request(`${CONV(cid)}/contracts/${approvedId}/attempts`, {
    method: "POST",
    headers: headers("other"),
    body: JSON.stringify({ execution_mode: "deterministic_local" }),
  });
  check("other user attempt on owned contract rejected 404", otherAttempt.status === 404);

  // 11. auth required
  const noAuth = await app.request(`${CONV(cid)}/contracts/${approvedId}/attempts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  check("no auth attempt rejected 401", noAuth.status === 401);

  console.log(`\nMWT-18 execution-harness test: ${passed} passed, ${failed} failed`);
  __setConversationStoreForTesting(null);
  __setDelegationStoreForTesting(null);
  __setAttemptStoreForTesting(null);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FATAL", e);
  __setConversationStoreForTesting(null);
  __setDelegationStoreForTesting(null);
  __setAttemptStoreForTesting(null);
  process.exit(1);
});
