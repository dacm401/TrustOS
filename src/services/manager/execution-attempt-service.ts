/**
 * MWT-18: Controlled Worker Execution Harness v0
 *
 * WorkerExecutionHarnessService — minimal, controlled execution-attempt layer
 * created ONLY from an APPROVED Worker Delegation Contract.
 *
 * Responsibility (v0):
 *   - create a bounded execution attempt from an approved contract
 *   - list attempts (by conversation or contract), ownership-scoped
 *   - get a single attempt
 *   - cancel a queued/running attempt
 *
 * HARD BOUNDARIES (PM MWT-18):
 *   - Only APPROVED contracts may create attempts. draft / ready_for_review /
 *     rejected / superseded are rejected.
 *   - No real external tools, no live gateway, no network, no background
 *     scheduling, no autonomous loops, no production side effects.
 *   - execute() uses a LOCAL deterministic seam (default deterministic_local).
 *     It produces a summary string only — never real worker output.
 *   - result_summary / error_summary are harness output, NOT live evidence and
 *     NOT proof of real-world completion.
 *   - No Trust Spine / Memory mutation. No raw memory/trust payload copy.
 *
 * Design:
 *   - Injectable attempt store (in-memory fake for zero-DB tests).
 *   - Injectable contract lookup seam (verifies approved + ownership without a
 *     live JOIN; the API wires the real delegation service).
 *   - Injectable local executor seam (deterministic; no external calls).
 */

import { randomUUID } from "node:crypto";
import { query } from "../../db/connection.js";

export type AttemptStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type ExecutionMode = "deterministic_local" | "dry_run" | "manual_placeholder";

export const ATTEMPT_STATUSES: AttemptStatus[] = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
];
export const EXECUTION_MODES: ExecutionMode[] = [
  "deterministic_local",
  "dry_run",
  "manual_placeholder",
];

export interface WorkerExecutionAttemptRecord {
  attempt_id: string;
  conversation_id: string;
  contract_id: string;
  user_id: string;
  worker_label: string | null;
  input_summary: string | null;
  constraints: string | null;
  status: AttemptStatus;
  result_summary: string | null;
  error_summary: string | null;
  execution_mode: ExecutionMode;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

/** Minimal contract summary the harness needs to gate an attempt. */
export interface ContractGateSnapshot {
  contract_id: string;
  conversation_id: string;
  user_id: string;
  status: string;
  title: string;
  objective: string;
  intended_worker: string | null;
  input_summary: string | null;
  constraints: string | null;
}

export interface CreateAttemptInput {
  execution_mode?: ExecutionMode;
}

// ── Injectable data-access boundary ────────────────────────────────────────────
export interface ExecutionAttemptStore {
  create(rec: Omit<WorkerExecutionAttemptRecord, "created_at" | "updated_at" | "completed_at">): Promise<WorkerExecutionAttemptRecord>;
  listByConversation(userId: string, conversationId: string): Promise<WorkerExecutionAttemptRecord[]>;
  listByContract(userId: string, contractId: string): Promise<WorkerExecutionAttemptRecord[]>;
  get(userId: string, attemptId: string): Promise<WorkerExecutionAttemptRecord | null>;
  update(userId: string, attemptId: string, patch: Partial<WorkerExecutionAttemptRecord>): Promise<WorkerExecutionAttemptRecord | null>;
  remove(userId: string, attemptId: string): Promise<boolean>;
}

// ── Contract gate lookup seam (wired to delegation service in API) ──────────────
export type ContractLookupFn = (userId: string, contractId: string) => Promise<ContractGateSnapshot | null>;

// ── Local executor seam (never touches external world) ─────────────────────────
export interface LocalExecutorResult {
  status: AttemptStatus; // completed | failed
  result_summary: string | null;
  error_summary: string | null;
}
export type LocalExecutorFn = (
  snapshot: ContractGateSnapshot,
  mode: ExecutionMode
) => Promise<LocalExecutorResult> | LocalExecutorResult;

function clampStr(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (s.length === 0) return null;
  return s.slice(0, max);
}

// ── Default local deterministic executor (NO external calls) ───────────────────
export const defaultLocalExecutor: LocalExecutorFn = (snapshot, mode) => {
  // Explicitly NON-live: produces a harness placeholder summary only.
  const label = snapshot.intended_worker || "default-worker";
  if (mode === "dry_run") {
    return {
      status: "completed",
      result_summary: `[dry_run] No real execution. Would delegate "${snapshot.title}" to ${label}.`,
      error_summary: null,
    };
  }
  if (mode === "manual_placeholder") {
    return {
      status: "completed",
      result_summary: `[manual_placeholder] Awaiting manual execution for "${snapshot.title}". No automated work performed.`,
      error_summary: null,
    };
  }
  // deterministic_local: a stable, reproducible harness output line.
  return {
    status: "completed",
    result_summary: `[deterministic_local] Contract "${snapshot.title}" accepted by controlled harness. Worker=${label}. No external side effects. This is local harness output, not live evidence.`,
    error_summary: null,
  };
};

// ── Postgres-backed store ───────────────────────────────────────────────────────
export const PostgresExecutionAttemptStore: ExecutionAttemptStore = {
  async create(rec) {
    const result = await query(
      `INSERT INTO worker_execution_attempts
        (attempt_id, conversation_id, contract_id, user_id, worker_label, input_summary,
         constraints, status, result_summary, error_summary, execution_mode)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        rec.attempt_id,
        rec.conversation_id,
        rec.contract_id,
        rec.user_id,
        rec.worker_label,
        rec.input_summary,
        rec.constraints,
        rec.status,
        rec.result_summary,
        rec.error_summary,
        rec.execution_mode,
      ]
    );
    return rowToRecord(result.rows[0]);
  },
  async listByConversation(userId, conversationId) {
    const result = await query(
      `SELECT * FROM worker_execution_attempts WHERE conversation_id = $1 AND user_id = $2 ORDER BY created_at DESC`,
      [conversationId, userId]
    );
    return result.rows.map(rowToRecord);
  },
  async listByContract(userId, contractId) {
    const result = await query(
      `SELECT * FROM worker_execution_attempts WHERE contract_id = $1 AND user_id = $2 ORDER BY created_at DESC`,
      [contractId, userId]
    );
    return result.rows.map(rowToRecord);
  },
  async get(userId, attemptId) {
    const result = await query(
      `SELECT * FROM worker_execution_attempts WHERE attempt_id = $1 AND user_id = $2`,
      [attemptId, userId]
    );
    if (result.rows.length === 0) return null;
    return rowToRecord(result.rows[0]);
  },
  async update(userId, attemptId, patch) {
    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;
    const add = (col: string, val: any) => {
      sets.push(`${col} = $${i}`);
      params.push(val);
      i++;
    };
    if (patch.status !== undefined) add("status", patch.status);
    if (patch.result_summary !== undefined) add("result_summary", patch.result_summary);
    if (patch.error_summary !== undefined) add("error_summary", patch.error_summary);
    if (patch.worker_label !== undefined) add("worker_label", patch.worker_label);
    if (patch.completed_at !== undefined) add("completed_at", patch.completed_at);
    if (sets.length === 0) return this.get(userId, attemptId);
    add("updated_at", new Date());
    const result = await query(
      `UPDATE worker_execution_attempts SET ${sets.join(", ")} WHERE attempt_id = $${i} AND user_id = $${i + 1} RETURNING *`,
      [...params, attemptId, userId]
    );
    if (result.rows.length === 0) return null;
    return rowToRecord(result.rows[0]);
  },
  async remove(userId, attemptId) {
    const result = await query(
      `DELETE FROM worker_execution_attempts WHERE attempt_id = $1 AND user_id = $2`,
      [attemptId, userId]
    );
    return (result.rowCount ?? 0) > 0;
  },
};

function rowToRecord(r: any): WorkerExecutionAttemptRecord {
  return {
    attempt_id: r.attempt_id,
    conversation_id: r.conversation_id,
    contract_id: r.contract_id,
    user_id: r.user_id,
    worker_label: r.worker_label ?? null,
    input_summary: r.input_summary ?? null,
    constraints: r.constraints ?? null,
    status: r.status as AttemptStatus,
    result_summary: r.result_summary ?? null,
    error_summary: r.error_summary ?? null,
    execution_mode: r.execution_mode as ExecutionMode,
    created_at: new Date(r.created_at).toISOString(),
    updated_at: new Date(r.updated_at).toISOString(),
    completed_at: r.completed_at ? new Date(r.completed_at).toISOString() : null,
  };
}

function genId(prefix: string): string {
  // Deterministic-shaped id for local/non-DB use. Real store uses UUID default.
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class WorkerExecutionHarnessService {
  constructor(
    private store: ExecutionAttemptStore = PostgresExecutionAttemptStore,
    private lookupContract: ContractLookupFn = async () => null,
    private executor: LocalExecutorFn = defaultLocalExecutor
  ) {}

  /**
   * Create + run a controlled execution attempt from an APPROVED contract.
   * Runs the LOCAL deterministic executor only; never touches the external world.
   */
  async createAttemptFromContract(
    userId: string,
    contractId: string,
    input: CreateAttemptInput = {}
  ): Promise<WorkerExecutionAttemptRecord> {
    if (!userId?.trim()) throw new Error("userId is required (non-empty string)");
    if (!contractId?.trim()) throw new Error("contract_id is required (non-empty string)");

    const snapshot = await this.lookupContract(userId, contractId);
    if (!snapshot) throw new Error(`Contract not found or not owned: ${contractId}`);
    if (snapshot.status !== "approved") {
      throw new Error(
        `Contract gate: only 'approved' contracts may create execution attempts. Current status: '${snapshot.status}'.`
      );
    }

    const mode: ExecutionMode =
      input.execution_mode && EXECUTION_MODES.includes(input.execution_mode)
        ? input.execution_mode
        : "deterministic_local";

    // Record attempt as queued first (bounded, auditable).
    // Use a real UUID: worker_execution_attempts.attempt_id is UUID-typed in
    // Postgres (migration 030). The deterministic genId() shape is for
    // InMemory/local only and is rejected by the DB on the live path.
    const attemptId = crypto.randomUUID();
    const queued = await this.store.create({
      attempt_id: attemptId,
      conversation_id: snapshot.conversation_id,
      contract_id: snapshot.contract_id,
      user_id: userId,
      worker_label: snapshot.intended_worker,
      input_summary: snapshot.input_summary,
      constraints: snapshot.constraints,
      status: "queued",
      result_summary: null,
      error_summary: null,
      execution_mode: mode,
    });

    // Move to running (bounded lifecycle, no real execution).
    const running = await this.store.update(userId, attemptId, { status: "running" });
    if (!running) throw new Error(`Attempt disappeared after create: ${attemptId}`);

    // Local deterministic executor — NO external calls.
    const exec = await this.executor(snapshot, mode);
    const completed = await this.store.update(userId, attemptId, {
      status: exec.status,
      result_summary: clampStr(exec.result_summary, 4000),
      error_summary: clampStr(exec.error_summary, 2000),
      completed_at: new Date().toISOString(),
    });
    if (!completed) throw new Error(`Attempt disappeared after execution: ${attemptId}`);
    return completed;
  }

  async listAttempts(userId: string, conversationId: string): Promise<WorkerExecutionAttemptRecord[]> {
    if (!conversationId?.trim()) throw new Error("conversation_id is required (non-empty string)");
    return this.store.listByConversation(userId, conversationId);
  }

  async listAttemptsForContract(userId: string, contractId: string): Promise<WorkerExecutionAttemptRecord[]> {
    if (!contractId?.trim()) throw new Error("contract_id is required (non-empty string)");
    return this.store.listByContract(userId, contractId);
  }

  async getAttempt(userId: string, attemptId: string): Promise<WorkerExecutionAttemptRecord | null> {
    if (!attemptId?.trim()) throw new Error("attempt_id is required (non-empty string)");
    return this.store.get(userId, attemptId);
  }

  async cancelAttempt(userId: string, attemptId: string): Promise<WorkerExecutionAttemptRecord> {
    if (!attemptId?.trim()) throw new Error("attempt_id is required (non-empty string)");
    const existing = await this.store.get(userId, attemptId);
    if (!existing) throw new Error(`Attempt not found or not owned: ${attemptId}`);
    if (existing.status === "completed" || existing.status === "failed" || existing.status === "cancelled") {
      throw new Error(`Cannot cancel attempt in terminal status '${existing.status}'`);
    }
    const updated = await this.store.update(userId, attemptId, {
      status: "cancelled",
      completed_at: new Date().toISOString(),
    });
    if (!updated) throw new Error(`Attempt not found or not owned: ${attemptId}`);
    return updated;
  }
}

export const workerExecutionHarnessService = new WorkerExecutionHarnessService();
