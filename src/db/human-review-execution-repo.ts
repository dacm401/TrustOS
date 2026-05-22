/**
 * S81P: Resume Execution Persistence V0 — Repository
 *
 * 持久化 human_review_resume_executions 到 PostgreSQL。
 * 幂等性：create 基于 UNIQUE(decision_id) constraint，
 * 若已存在则返回现有记录。
 */

import { v4 as uuid } from "uuid";
import { query } from "./connection.js";
import type {
  HumanReviewResumeExecutionResult,
  ResumeExecutionStatus,
  ExecutedResumeAction,
} from "../services/human-review/human-review-types.js";

// ── Row ↔ Execution Mapping ──────────────────────────────────────────────

interface ExecutionRow {
  id: string;
  decision_id: string;
  review_request_id: string;
  task_id: string;
  status: string;
  executed_action: string;
  audit_json: string;
  created_at: string;
  executed_at: string | null;
}

function rowToExecution(row: Record<string, unknown>): HumanReviewResumeExecutionResult {
  const r = row as unknown as ExecutionRow;
  return {
    id: r.id,
    decisionId: r.decision_id,
    reviewRequestId: r.review_request_id,
    taskId: r.task_id,
    status: r.status as ResumeExecutionStatus,
    executedAction: r.executed_action as ExecutedResumeAction,
    createdAt: r.created_at,
    executedAt: r.executed_at ?? undefined,
    audit: JSON.parse(r.audit_json) as HumanReviewResumeExecutionResult["audit"],
  };
}

// ── Table Ensure ─────────────────────────────────────────────────────────

async function ensureTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS human_review_resume_executions (
      id                TEXT PRIMARY KEY,
      decision_id       TEXT NOT NULL UNIQUE,
      review_request_id TEXT NOT NULL,
      task_id           TEXT NOT NULL,
      status            TEXT NOT NULL,
      executed_action   TEXT NOT NULL,
      audit_json        TEXT NOT NULL,
      created_at        TEXT NOT NULL,
      executed_at       TEXT
    )
  `);
}

// ── Repo Implementation ───────────────────────────────────────────────────

export const HumanReviewResumeExecutionRepo = {
  /**
   * 创建 resume execution。幂等：若同一 decision_id 已存在则返回现有记录。
   */
  async create(
    result: Omit<HumanReviewResumeExecutionResult, "id">
  ): Promise<HumanReviewResumeExecutionResult> {
    await ensureTable();

    const id = uuid();

    try {
      const row = await query(
        `INSERT INTO human_review_resume_executions
           (id, decision_id, review_request_id, task_id, status, executed_action, audit_json, created_at, executed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          id,
          result.decisionId,
          result.reviewRequestId,
          result.taskId,
          result.status,
          result.executedAction,
          JSON.stringify(result.audit),
          result.createdAt,
          result.executedAt ?? null,
        ]
      );
      return rowToExecution(row.rows[0]);
    } catch (err: any) {
      // 幂等：若 unique constraint 冲突，返回现有记录
      if (err.code === "23505") {
        const existing = await query(
          `SELECT * FROM human_review_resume_executions
             WHERE decision_id = $1 LIMIT 1`,
          [result.decisionId]
        );
        return rowToExecution(existing.rows[0]);
      }
      throw err;
    }
  },

  async getById(id: string): Promise<HumanReviewResumeExecutionResult | null> {
    await ensureTable();
    const result = await query(
      `SELECT * FROM human_review_resume_executions WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (!result.rows.length) return null;
    return rowToExecution(result.rows[0]);
  },

  async getByDecisionId(decisionId: string): Promise<HumanReviewResumeExecutionResult | null> {
    await ensureTable();
    const result = await query(
      `SELECT * FROM human_review_resume_executions WHERE decision_id = $1 LIMIT 1`,
      [decisionId]
    );
    if (!result.rows.length) return null;
    return rowToExecution(result.rows[0]);
  },

  async list(opts?: {
    status?: ResumeExecutionStatus;
    executedAction?: ExecutedResumeAction;
    limit?: number;
  }): Promise<HumanReviewResumeExecutionResult[]> {
    let sql = `SELECT * FROM human_review_resume_executions`;
    const params: unknown[] = [];

    const conditions: string[] = [];
    if (opts?.status) {
      conditions.push(`status = $${params.length + 1}`);
      params.push(opts.status);
    }
    if (opts?.executedAction) {
      conditions.push(`executed_action = $${params.length + 1}`);
      params.push(opts.executedAction);
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
    return result.rows.map(rowToExecution);
  },
};
