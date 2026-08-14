/**
 * MWT-17: Worker Delegation Contract v0
 *
 * WorkerDelegationContractService — minimal, explicit Worker Delegation
 * Contract layer for ManagerConversation.
 *
 * Responsibility (v0):
 *   - create a worker delegation contract for a conversation
 *   - list contracts for a conversation (ownership-scoped)
 *   - get a single contract (ownership-scoped)
 *   - update contract status (draft -> ready_for_review -> approved/rejected)
 *   - replace a draft contract's fields
 *   - delete (soft semantics: supersede or hard-delete a draft)
 *
 * Hard boundaries (PM MWT-17):
 *   - Does NOT execute worker tasks. No autonomous loops. No external tool calls.
 *   - Does NOT implement scheduling/background execution.
 *   - Does NOT mutate Trust Spine evidence or Memory.
 *   - Stores only IDs (memory_ref_ids, trust_ref_ids), summaries, constraints,
 *     and safe metadata. No raw payload/content/event_hash.
 *   - A delegation contract is NOT completed work and NOT proof of execution.
 *
 * Design:
 *   - Injectable store so tests use an in-memory fake (no live DB required).
 *   - Mirrors MWT-15/16 reference services for consistency.
 */

import { query } from "../../db/connection.js";

export type ContractStatus =
  | "draft"
  | "ready_for_review"
  | "approved"
  | "rejected"
  | "superseded";

export const CONTRACT_STATUSES: ContractStatus[] = [
  "draft",
  "ready_for_review",
  "approved",
  "rejected",
  "superseded",
];

export interface WorkerDelegationContractRecord {
  contract_id: string;
  conversation_id: string;
  user_id: string;
  title: string;
  objective: string;
  intended_worker: string | null;
  input_summary: string | null;
  memory_ref_ids: string[];
  trust_ref_ids: string[];
  constraints: string | null;
  expected_output: string | null;
  status: ContractStatus;
  created_at: string;
  updated_at: string;
}

export interface CreateContractInput {
  conversation_id: string;
  title: string;
  objective: string;
  intended_worker?: string | null;
  input_summary?: string | null;
  memory_ref_ids?: string[];
  trust_ref_ids?: string[];
  constraints?: string | null;
  expected_output?: string | null;
  status?: ContractStatus;
}

export interface UpdateContractInput {
  title?: string;
  objective?: string;
  intended_worker?: string | null;
  input_summary?: string | null;
  memory_ref_ids?: string[];
  trust_ref_ids?: string[];
  constraints?: string | null;
  expected_output?: string | null;
  status?: ContractStatus;
}

/** Minimal data-access boundary so the service can be tested with an in-memory fake. */
export interface DelegationContractStore {
  create(userId: string, input: CreateContractInput): Promise<WorkerDelegationContractRecord>;
  listByConversation(userId: string, conversationId: string): Promise<WorkerDelegationContractRecord[]>;
  get(userId: string, contractId: string): Promise<WorkerDelegationContractRecord | null>;
  update(userId: string, contractId: string, patch: UpdateContractInput): Promise<WorkerDelegationContractRecord | null>;
  remove(userId: string, contractId: string): Promise<boolean>;
}

function normalizeIds(ids?: string[]): string[] {
  if (!Array.isArray(ids)) return [];
  return ids.map((x) => String(x).trim()).filter((x) => x.length > 0);
}

function clampStr(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (s.length === 0) return null;
  return s.slice(0, max);
}

/** Default Postgres-backed store. Additive `worker_delegation_contracts` table (migration 029). */
export const PostgresDelegationContractStore: DelegationContractStore = {
  async create(userId, input) {
    const status = input.status && CONTRACT_STATUSES.includes(input.status) ? input.status : "draft";
    const result = await query(
      `INSERT INTO worker_delegation_contracts
        (conversation_id, user_id, title, objective, intended_worker, input_summary,
         memory_ref_ids, trust_ref_ids, constraints, expected_output, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        input.conversation_id,
        userId,
        clampStr(input.title, 255) ?? "(untitled)",
        clampStr(input.objective, 4000) ?? "",
        clampStr(input.intended_worker, 255),
        clampStr(input.input_summary, 2000),
        normalizeIds(input.memory_ref_ids),
        normalizeIds(input.trust_ref_ids),
        clampStr(input.constraints, 2000),
        clampStr(input.expected_output, 2000),
        status,
      ]
    );
    return rowToRecord(result.rows[0]);
  },

  async listByConversation(userId, conversationId) {
    const result = await query(
      `SELECT * FROM worker_delegation_contracts
       WHERE conversation_id = $1 AND user_id = $2
       ORDER BY created_at DESC`,
      [conversationId, userId]
    );
    return result.rows.map(rowToRecord);
  },

  async get(userId, contractId) {
    const result = await query(
      `SELECT * FROM worker_delegation_contracts WHERE contract_id = $1 AND user_id = $2`,
      [contractId, userId]
    );
    if (result.rows.length === 0) return null;
    return rowToRecord(result.rows[0]);
  },

  async update(userId, contractId, patch) {
    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;
    const add = (col: string, val: any) => {
      sets.push(`${col} = $${i}`);
      params.push(val);
      i++;
    };
    if (patch.title !== undefined) add("title", clampStr(patch.title, 255) ?? "(untitled)");
    if (patch.objective !== undefined) add("objective", clampStr(patch.objective, 4000) ?? "");
    if (patch.intended_worker !== undefined) add("intended_worker", clampStr(patch.intended_worker, 255));
    if (patch.input_summary !== undefined) add("input_summary", clampStr(patch.input_summary, 2000));
    if (patch.memory_ref_ids !== undefined) add("memory_ref_ids", normalizeIds(patch.memory_ref_ids));
    if (patch.trust_ref_ids !== undefined) add("trust_ref_ids", normalizeIds(patch.trust_ref_ids));
    if (patch.constraints !== undefined) add("constraints", clampStr(patch.constraints, 2000));
    if (patch.expected_output !== undefined) add("expected_output", clampStr(patch.expected_output, 2000));
    if (patch.status !== undefined) {
      if (!CONTRACT_STATUSES.includes(patch.status)) {
        throw new Error(`Invalid status '${patch.status}'. Must be one of: ${CONTRACT_STATUSES.join(", ")}`);
      }
      add("status", patch.status);
    }
    if (sets.length === 0) {
      return this.get(userId, contractId);
    }
    add("updated_at", new Date());
    const result = await query(
      `UPDATE worker_delegation_contracts SET ${sets.join(", ")} WHERE contract_id = $${i} AND user_id = $${i + 1} RETURNING *`,
      [...params, contractId, userId]
    );
    if (result.rows.length === 0) return null;
    return rowToRecord(result.rows[0]);
  },

  async remove(userId, contractId) {
    const result = await query(
      `DELETE FROM worker_delegation_contracts WHERE contract_id = $1 AND user_id = $2`,
      [contractId, userId]
    );
    return (result.rowCount ?? 0) > 0;
  },
};

function rowToRecord(r: any): WorkerDelegationContractRecord {
  return {
    contract_id: r.contract_id,
    conversation_id: r.conversation_id,
    user_id: r.user_id,
    title: r.title,
    objective: r.objective,
    intended_worker: r.intended_worker ?? null,
    input_summary: r.input_summary ?? null,
    memory_ref_ids: Array.isArray(r.memory_ref_ids) ? r.memory_ref_ids : [],
    trust_ref_ids: Array.isArray(r.trust_ref_ids) ? r.trust_ref_ids : [],
    constraints: r.constraints ?? null,
    expected_output: r.expected_output ?? null,
    status: r.status as ContractStatus,
    created_at: new Date(r.created_at).toISOString(),
    updated_at: new Date(r.updated_at).toISOString(),
  };
}

export class WorkerDelegationContractService {
  constructor(private store: DelegationContractStore = PostgresDelegationContractStore) {}

  async createContract(userId: string, input: CreateContractInput): Promise<WorkerDelegationContractRecord> {
    if (!userId || typeof userId !== "string") {
      throw new Error("userId is required (non-empty string)");
    }
    const conversationId = input.conversation_id?.trim();
    if (!conversationId) {
      throw new Error("conversation_id is required (non-empty string)");
    }
    const title = input.title?.trim();
    if (!title) {
      throw new Error("title is required (non-empty string)");
    }
    const objective = input.objective?.trim();
    if (!objective) {
      throw new Error("objective is required (non-empty string)");
    }
    return this.store.create(userId, {
      conversation_id: conversationId,
      title,
      objective,
      intended_worker: input.intended_worker ?? null,
      input_summary: input.input_summary ?? null,
      memory_ref_ids: normalizeIds(input.memory_ref_ids),
      trust_ref_ids: normalizeIds(input.trust_ref_ids),
      constraints: input.constraints ?? null,
      expected_output: input.expected_output ?? null,
      status: input.status ?? "draft",
    });
  }

  async listContracts(userId: string, conversationId: string): Promise<WorkerDelegationContractRecord[]> {
    if (!conversationId?.trim()) {
      throw new Error("conversation_id is required (non-empty string)");
    }
    return this.store.listByConversation(userId, conversationId);
  }

  async getContract(userId: string, contractId: string): Promise<WorkerDelegationContractRecord | null> {
    if (!contractId?.trim()) {
      throw new Error("contract_id is required (non-empty string)");
    }
    return this.store.get(userId, contractId);
  }

  async updateContract(
    userId: string,
    contractId: string,
    patch: UpdateContractInput
  ): Promise<WorkerDelegationContractRecord> {
    if (!contractId?.trim()) {
      throw new Error("contract_id is required (non-empty string)");
    }
    const existing = await this.store.get(userId, contractId);
    if (!existing) {
      throw new Error(`Contract not found or not owned: ${contractId}`);
    }
    // Guard: an approved/rejected/superseded contract cannot be silently edited.
    // It must be superseded (PM review loop is the path to change an approved contract).
    if (existing.status !== "draft" && existing.status !== "ready_for_review") {
      throw new Error(
        `Contract status '${existing.status}' is locked. Create a new draft or supersede instead.`
      );
    }
    const updated = await this.store.update(userId, contractId, patch);
    if (!updated) {
      throw new Error(`Contract not found or not owned: ${contractId}`);
    }
    return updated;
  }

  async setStatus(
    userId: string,
    contractId: string,
    status: ContractStatus
  ): Promise<WorkerDelegationContractRecord> {
    if (!CONTRACT_STATUSES.includes(status)) {
      throw new Error(`Invalid status '${status}'. Must be one of: ${CONTRACT_STATUSES.join(", ")}`);
    }
    const existing = await this.store.get(userId, contractId);
    if (!existing) {
      throw new Error(`Contract not found or not owned: ${contractId}`);
    }
    if (existing.status === "superseded") {
      throw new Error("Cannot change status of a superseded contract");
    }
    const updated = await this.store.update(userId, contractId, { status });
    if (!updated) {
      throw new Error(`Contract not found or not owned: ${contractId}`);
    }
    return updated;
  }

  async deleteContract(userId: string, contractId: string): Promise<boolean> {
    if (!contractId?.trim()) {
      throw new Error("contract_id is required (non-empty string)");
    }
    const existing = await this.store.get(userId, contractId);
    if (!existing) return false;
    // Only drafts may be hard-deleted. Approved/rejected/ready contracts must be
    // superseded via the review loop, never silently removed.
    if (existing.status !== "draft") {
      throw new Error(
        `Only draft contracts can be deleted. Current status: '${existing.status}'. Supersede instead.`
      );
    }
    return this.store.remove(userId, contractId);
  }
}

/** Singleton default instance (Postgres-backed). */
export const workerDelegationContractService = new WorkerDelegationContractService();
