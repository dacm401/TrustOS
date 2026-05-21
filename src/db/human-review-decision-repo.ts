/**
 * S80P: Resume Decision Persistence V0 — Repository
 *
 * 持久化 human_review_resume_decisions 到 PostgreSQL。
 * 幂等性：create 基于 UNIQUE(review_request_id) constraint，
 * 若已存在则返回现有记录。
 */

import { v4 as uuid } from "uuid";
import { query } from "./connection.js";
import type {
  HumanReviewResumeDecision,
  NextAction,
  ExecutionMode,
} from "../services/human-review/human-review-types.js";

// ── Row ↔ Decision Mapping ──────────────────────────────────────────────────

interface DecisionRow {
  id: string;
  review_request_id: string;
  task_id: string;
  next_action: string;
  execution_mode: string;
  requires_operator_confirmation: boolean;
  source_json: string;
  audit_json: string;
  created_at: string;
}

function rowToDecision(row: Record<string, unknown>): HumanReviewResumeDecision {
  const r = row as unknown as DecisionRow;
  return {
    id: r.id,
    reviewRequestId: r.review_request_id,
    taskId: r.task_id,
    createdAt: r.created_at,
    source: JSON.parse(r.source_json) as HumanReviewResumeDecision["source"],
    nextAction: r.next_action as NextAction,
    executionMode: r.execution_mode as ExecutionMode,
    audit: JSON.parse(r.audit_json) as HumanReviewResumeDecision["audit"],
  };
}

// ── Table Ensure ────────────────────────────────────────────────────────────

async function ensureTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS human_review_resume_decisions (
      id                              TEXT PRIMARY KEY,
      review_request_id               TEXT NOT NULL UNIQUE,
      task_id                         TEXT NOT NULL,
      next_action                     TEXT NOT NULL,
      execution_mode                  TEXT NOT NULL,
      requires_operator_confirmation  BOOLEAN NOT NULL,
      source_json                     TEXT NOT NULL,
      audit_json                      TEXT NOT NULL,
      created_at                      TEXT NOT NULL
    )
  `);
}

// ── Repo Implementation ─────────────────────────────────────────────────────

export const HumanReviewResumeDecisionRepo = {
  /**
   * 创建 resume decision。幂等：若同一 review_request_id 已存在则返回现有记录。
   */
  async create(decision: Omit<HumanReviewResumeDecision, "id">): Promise<HumanReviewResumeDecision> {
    await ensureTable();

    const id = uuid();

    try {
      const row = await query(
        `INSERT INTO human_review_resume_decisions
           (id, review_request_id, task_id, next_action, execution_mode,
            requires_operator_confirmation, source_json, audit_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          id,
          decision.reviewRequestId,
          decision.taskId,
          decision.nextAction,
          decision.executionMode,
          decision.audit.requiresOperatorConfirmation,
          JSON.stringify(decision.source),
          JSON.stringify(decision.audit),
          decision.createdAt,
        ]
      );
      return rowToDecision(row.rows[0]);
    } catch (err: any) {
      // 幂等：若 unique constraint 冲突，返回现有记录
      if (err.code === "23505") {
        const existing = await query(
          `SELECT * FROM human_review_resume_decisions
             WHERE review_request_id = $1 LIMIT 1`,
          [decision.reviewRequestId]
        );
        return rowToDecision(existing.rows[0]);
      }
      throw err;
    }
  },

  async getById(id: string): Promise<HumanReviewResumeDecision | null> {
    await ensureTable();
    const result = await query(
      `SELECT * FROM human_review_resume_decisions WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (!result.rows.length) return null;
    return rowToDecision(result.rows[0]);
  },

  async getByReviewRequestId(reviewRequestId: string): Promise<HumanReviewResumeDecision | null> {
    await ensureTable();
    const result = await query(
      `SELECT * FROM human_review_resume_decisions WHERE review_request_id = $1 LIMIT 1`,
      [reviewRequestId]
    );
    if (!result.rows.length) return null;
    return rowToDecision(result.rows[0]);
  },

  async list(opts?: {
    nextAction?: NextAction;
    executionMode?: ExecutionMode;
    limit?: number;
  }): Promise<HumanReviewResumeDecision[]> {
    let sql = `SELECT * FROM human_review_resume_decisions`;
    const params: unknown[] = [];

    const conditions: string[] = [];
    if (opts?.nextAction) {
      conditions.push(`next_action = $${params.length + 1}`);
      params.push(opts.nextAction);
    }
    if (opts?.executionMode) {
      conditions.push(`execution_mode = $${params.length + 1}`);
      params.push(opts.executionMode);
    }
    if (conditions.length) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }

    sql += ` ORDER BY created_at DESC`;
    if (opts?.limit) {
      sql += ` LIMIT $${params.length + 1}`;
      params.push(opts.limit);
    }

    const result = await query(sql, params);
    return result.rows.map(rowToDecision);
  },
};
