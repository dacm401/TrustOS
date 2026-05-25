/**
 * S83P: Resume Execution Confirmation Persistence V0 — Repository
 *
 * 持久化 human_review_resume_execution_confirmations 到 PostgreSQL。
 * 幂等性：create 基于 UNIQUE(execution_id) constraint，
 * 若已存在则返回现有记录。
 */

import { v4 as uuid } from "uuid";
import { query } from "./connection.js";
import type {
  HumanReviewResumeExecutionConfirmation,
} from "../services/human-review/human-review-types.js";

// ── Row ↔ Confirmation Mapping ──────────────────────────────────────

interface ConfirmationRow {
  id: string;
  execution_id: string;
  decision_id: string;
  review_request_id: string;
  task_id: string;
  confirmed_by: string;
  result_status: string;
  executed_action: string;
  audit_json: string;
  confirmed_at: string;
}

function rowToConfirmation(row: Record<string, unknown>): HumanReviewResumeExecutionConfirmation {
  const r = row as unknown as ConfirmationRow;
  return {
    id: r.id,
    executionId: r.execution_id,
    decisionId: r.decision_id,
    reviewRequestId: r.review_request_id,
    taskId: r.task_id,
    confirmedBy: r.confirmed_by,
    resultStatus: r.result_status as "executed" | "blocked",
    executedAction: r.executed_action as "accept_final" | "block_final" | "cancel_task",
    confirmedAt: r.confirmed_at,
    audit: JSON.parse(r.audit_json) as HumanReviewResumeExecutionConfirmation["audit"],
  };
}

// ── Table Ensure ─────────────────────────────────────────────────────

async function ensureTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS human_review_resume_execution_confirmations (
      id                 TEXT PRIMARY KEY,
      execution_id       TEXT NOT NULL UNIQUE,
      decision_id        TEXT NOT NULL,
      review_request_id  TEXT NOT NULL,
      task_id            TEXT NOT NULL,
      confirmed_by       TEXT NOT NULL,
      result_status      TEXT NOT NULL,
      executed_action    TEXT NOT NULL,
      audit_json         TEXT NOT NULL,
      confirmed_at       TEXT NOT NULL
    )
  `);
}

// ── Repo Implementation ──────────────────────────────────────────────

export const HumanReviewResumeExecutionConfirmationRepo = {
  /**
   * 创建 confirmation。幂等：若同一 execution_id 已存在则返回现有记录。
   */
  async create(
    confirmation: Omit<HumanReviewResumeExecutionConfirmation, "id">
  ): Promise<HumanReviewResumeExecutionConfirmation> {
    await ensureTable();

    const id = uuid();

    try {
      const row = await query(
        `INSERT INTO human_review_resume_execution_confirmations
           (id, execution_id, decision_id, review_request_id, task_id,
            confirmed_by, result_status, executed_action, audit_json, confirmed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          id,
          confirmation.executionId,
          confirmation.decisionId,
          confirmation.reviewRequestId,
          confirmation.taskId,
          confirmation.confirmedBy,
          confirmation.resultStatus,
          confirmation.executedAction,
          JSON.stringify(confirmation.audit),
          confirmation.confirmedAt,
        ]
      );
      return rowToConfirmation(row.rows[0]);
    } catch (err: any) {
      // 幂等：若 unique constraint 冲突，返回现有记录
      if (err.code === "23505") {
        const existing = await query(
          `SELECT * FROM human_review_resume_execution_confirmations
             WHERE execution_id = $1 LIMIT 1`,
          [confirmation.executionId]
        );
        return rowToConfirmation(existing.rows[0]);
      }
      throw err;
    }
  },

  async getById(id: string): Promise<HumanReviewResumeExecutionConfirmation | null> {
    await ensureTable();
    const result = await query(
      `SELECT * FROM human_review_resume_execution_confirmations WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (!result.rows.length) return null;
    return rowToConfirmation(result.rows[0]);
  },

  async getByExecutionId(executionId: string): Promise<HumanReviewResumeExecutionConfirmation | null> {
    await ensureTable();
    const result = await query(
      `SELECT * FROM human_review_resume_execution_confirmations WHERE execution_id = $1 LIMIT 1`,
      [executionId]
    );
    if (!result.rows.length) return null;
    return rowToConfirmation(result.rows[0]);
  },

  async list(opts?: {
    resultStatus?: "executed" | "blocked";
    limit?: number;
  }): Promise<HumanReviewResumeExecutionConfirmation[]> {
    let sql = `SELECT * FROM human_review_resume_execution_confirmations`;
    const params: unknown[] = [];

    const conditions: string[] = [];
    if (opts?.resultStatus) {
      conditions.push(`result_status = $${params.length + 1}`);
      params.push(opts.resultStatus);
    }
    if (conditions.length) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }

    sql += ` ORDER BY confirmed_at DESC`;
    if (opts?.limit) {
      sql += ` LIMIT $${params.length + 1}`;
      params.push(opts.limit);
    }

    const result = await query(sql, params);
    return result.rows.map(rowToConfirmation);
  },
};
