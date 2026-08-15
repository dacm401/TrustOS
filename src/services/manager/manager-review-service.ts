// MWT-19: Manager Review / Approve Loop v0
//
// Minimal, append-only review-record service for Worker Delegation Contracts
// (MWT-17) and Worker Execution Attempts (MWT-18).
//
// Scope guard (MWT-19):
//   - NOT autonomous policy enforcement
//   - NOT external beta reviewer evidence
//   - NOT live readiness proof
//   - does NOT mutate Trust Spine / Memory
//   - review records are additive/auditable; never rewrite execution results
//
// The service keeps contract/attempt integrity rules intact: it only records a
// review decision and returns it. Status transitions on contracts/attempts remain
// owned by their respective services (MWT-17 / MWT-18).

export type ReviewTargetType = "delegation_contract" | "execution_attempt";

// union vocabulary, split by target type at the API layer
export type ReviewDecision =
  | "approve"
  | "reject"
  | "request_changes"
  | "accept_result"
  | "reject_result"
  | "request_rerun";

export interface ManagerReviewRecord {
  review_id: string;
  conversation_id: string;
  user_id: string;
  target_type: ReviewTargetType;
  target_id: string;
  decision: ReviewDecision;
  reason: string | null;
  reviewer_label: string | null;
  created_at: string; // ISO
}

export interface CreateReviewInput {
  conversation_id: string;
  user_id: string;
  target_type: ReviewTargetType;
  target_id: string;
  decision: ReviewDecision;
  reason?: string;
  reviewer_label?: string;
}

export interface ManagerReviewStore {
  createReview(rec: ManagerReviewRecord): Promise<ManagerReviewRecord>;
  listByConversation(conversationId: string): Promise<ManagerReviewRecord[]>;
  listByTarget(
    targetType: ReviewTargetType,
    targetId: string
  ): Promise<ManagerReviewRecord[]>;
}

// in-memory store for deterministic tests
export class InMemoryManagerReviewStore implements ManagerReviewStore {
  private reviews = new Map<string, ManagerReviewRecord>();

  async createReview(rec: ManagerReviewRecord): Promise<ManagerReviewRecord> {
    this.reviews.set(rec.review_id, rec);
    return rec;
  }

  async listByConversation(
    conversationId: string
  ): Promise<ManagerReviewRecord[]> {
    return [...this.reviews.values()]
      .filter((r) => r.conversation_id === conversationId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async listByTarget(
    targetType: ReviewTargetType,
    targetId: string
  ): Promise<ManagerReviewRecord[]> {
    return [...this.reviews.values()]
      .filter((r) => r.target_type === targetType && r.target_id === targetId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
}

export const CONTRACT_DECISIONS: ReviewDecision[] = [
  "approve",
  "reject",
  "request_changes",
];

export const ATTEMPT_DECISIONS: ReviewDecision[] = [
  "accept_result",
  "reject_result",
  "request_rerun",
];

export function isContractDecision(d: ReviewDecision): boolean {
  return CONTRACT_DECISIONS.includes(d);
}

export function isAttemptDecision(d: ReviewDecision): boolean {
  return ATTEMPT_DECISIONS.includes(d);
}

export function isValidDecisionForTarget(
  targetType: ReviewTargetType,
  decision: ReviewDecision
): boolean {
  if (targetType === "delegation_contract") return isContractDecision(decision);
  return isAttemptDecision(decision);
}

function ulid(): string {
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 10)
  ).toUpperCase();
}

export class ManagerReviewService {
  constructor(private store: ManagerReviewStore) {}

  async createReview(
    input: CreateReviewInput
  ): Promise<ManagerReviewRecord> {
    if (!isValidDecisionForTarget(input.target_type, input.decision)) {
      throw new Error(
        `invalid decision "${input.decision}" for target_type "${input.target_type}"`
      );
    }
    if (!input.conversation_id || !input.user_id || !input.target_id) {
      throw new Error(
        "conversation_id, user_id and target_id are required"
      );
    }
    // safety: store only safe reason/comment; never raw memory/trust payloads
    const safeReason = input.reason ? String(input.reason).slice(0, 4000) : null;
    const safeLabel = input.reviewer_label
      ? String(input.reviewer_label).slice(0, 120)
      : null;

    const rec: ManagerReviewRecord = {
      review_id: `mrr_${ulid()}`,
      conversation_id: input.conversation_id,
      user_id: input.user_id,
      target_type: input.target_type,
      target_id: input.target_id,
      decision: input.decision,
      reason: safeReason,
      reviewer_label: safeLabel,
      created_at: new Date().toISOString(),
    };
    return this.store.createReview(rec);
  }

  listByConversation(
    conversationId: string
  ): Promise<ManagerReviewRecord[]> {
    return this.store.listByConversation(conversationId);
  }

  listByTarget(
    targetType: ReviewTargetType,
    targetId: string
  ): Promise<ManagerReviewRecord[]> {
    return this.store.listByTarget(targetType, targetId);
  }
}

// ── Postgres-backed store ───────────────────────────────────────────────────────
import { query } from "../../db/connection.js";

function rowToReviewRecord(row: any): ManagerReviewRecord {
  return {
    review_id: row.review_id,
    conversation_id: row.conversation_id,
    user_id: row.user_id,
    target_type: row.target_type,
    target_id: row.target_id,
    decision: row.decision,
    reason: row.reason,
    reviewer_label: row.reviewer_label,
    created_at: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at),
  };
}

export const PostgresManagerReviewStore: ManagerReviewStore = {
  async createReview(rec) {
    const result = await query(
      `INSERT INTO manager_review_records
        (review_id, conversation_id, user_id, target_type, target_id, decision, reason, reviewer_label)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        rec.review_id,
        rec.conversation_id,
        rec.user_id,
        rec.target_type,
        rec.target_id,
        rec.decision,
        rec.reason,
        rec.reviewer_label,
      ]
    );
    return rowToReviewRecord(result.rows[0]);
  },
  async listByConversation(conversationId) {
    const result = await query(
      `SELECT * FROM manager_review_records WHERE conversation_id = $1 ORDER BY created_at ASC`,
      [conversationId]
    );
    return result.rows.map(rowToReviewRecord);
  },
  async listByTarget(targetType, targetId) {
    const result = await query(
      `SELECT * FROM manager_review_records WHERE target_type = $1 AND target_id = $2 ORDER BY created_at ASC`,
      [targetType, targetId]
    );
    return result.rows.map(rowToReviewRecord);
  },
};
