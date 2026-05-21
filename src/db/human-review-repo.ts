/**
 * S77P: Human Review Queue V0 — Repository
 *
 * 持久化 human_review_requests 到 PostgreSQL。
 * 幂等性：create 基于 (task_id, cycle_index) unique constraint，
 * 若已存在则返回现有记录。
 */

import { v4 as uuid } from "uuid";
import { query } from "./connection.js";
import type {
  HumanReviewRequest,
  HumanReviewStatus,
  HumanReviewResolution,
  HumanReviewRequestRepo as IHumanReviewRequestRepo,
} from "../services/human-review/human-review-types.js";

function rowToRequest(row: Record<string, unknown>): HumanReviewRequest {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    contractId: row.contract_id as string | undefined,
    cycleIndex: row.cycle_index as number,
    status: row.status as HumanReviewStatus,
    reasonCode: row.reason_code as HumanReviewRequest["reasonCode"],
    severity: row.severity as HumanReviewRequest["severity"],
    createdAt: row.created_at as string,
    resolvedAt: row.resolved_at as string | undefined,
    resolution: row.resolution ? (JSON.parse(row.resolution as string) as HumanReviewResolution) : undefined,
    audit: JSON.parse(row.audit as string) as HumanReviewRequest["audit"],
  };
}

async function ensureTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS human_review_requests (
      id           TEXT PRIMARY KEY,
      task_id      TEXT NOT NULL,
      contract_id  TEXT,
      cycle_index  INTEGER NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      reason_code  TEXT NOT NULL,
      severity     TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      resolved_at  TEXT,
      resolution   TEXT,
      audit        TEXT NOT NULL,
      UNIQUE(task_id, cycle_index)
    )
  `);
}

// ── Repo Implementation ────────────────────────────────────────────────────────

export const HumanReviewRequestRepo: IHumanReviewRequestRepo = {
  async create(params): Promise<HumanReviewRequest> {
    await ensureTable();

    const id = uuid();
    const createdAt = new Date().toISOString();

    try {
      const row = await query(
        `INSERT INTO human_review_requests
           (id, task_id, contract_id, cycle_index, status, reason_code, severity, created_at, audit)
         VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8)
         RETURNING *`,
        [
          id,
          params.taskId,
          params.contractId ?? null,
          params.cycleIndex,
          params.reasonCode,
          params.severity,
          createdAt,
          JSON.stringify(params.audit),
        ]
      );
      return rowToRequest(row.rows[0]);
    } catch (err: any) {
      // 幂等：若 unique constraint 冲突，返回现有记录
      if (err.code === "23505") {
        const existing = await query(
          `SELECT * FROM human_review_requests
             WHERE task_id = $1 AND cycle_index = $2 LIMIT 1`,
          [params.taskId, params.cycleIndex]
        );
        return rowToRequest(existing.rows[0]);
      }
      throw err;
    }
  },

  async getById(id: string): Promise<HumanReviewRequest | null> {
    const result = await query(
      `SELECT * FROM human_review_requests WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (!result.rows.length) return null;
    return rowToRequest(result.rows[0]);
  },

  async list(opts?: { status?: HumanReviewStatus; limit?: number }): Promise<HumanReviewRequest[]> {
    let sql = `SELECT * FROM human_review_requests`;
    const params: unknown[] = [];
    if (opts?.status) {
      sql += ` WHERE status = $1`;
      params.push(opts.status);
    }
    sql += ` ORDER BY created_at DESC`;
    if (opts?.limit) {
      sql += ` LIMIT $${params.length + 1}`;
      params.push(opts.limit);
    }
    const result = await query(sql, params);
    return result.rows.map(rowToRequest);
  },

  async resolve(id: string, resolution: HumanReviewResolution): Promise<HumanReviewRequest> {
    const resolvedAt = new Date().toISOString();
    const row = await query(
      `UPDATE human_review_requests
         SET status = 'approved', resolved_at = $1, resolution = $2
         WHERE id = $3
         RETURNING *`,
      [resolvedAt, JSON.stringify(resolution), id]
    );
    if (!row.rows.length) throw new Error(`HumanReviewRequest ${id} not found`);
    return rowToRequest(row.rows[0]);
  },

  async updateStatus(id: string, status: HumanReviewStatus): Promise<void> {
    await query(
      `UPDATE human_review_requests SET status = $1 WHERE id = $2`,
      [status, id]
    );
  },
};
