/**
 * S100P-002: Agent Session Repository
 *
 * agent_sessions table — independent delegated task sessions.
 * Each Session represents a durable AI work process (delegated task).
 */

import { v4 as uuid } from "uuid";
import { query } from "../connection.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type SessionStatus =
  | "planning"
  | "delegated"
  | "running"
  | "waiting_approval"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "rolled_back";

export interface AgentSessionRecord {
  id: string;
  user_id: string;
  title: string;
  goal: string | null;
  status: SessionStatus;
  worker_id: string | null;
  delegation_contract: Record<string, unknown>;
  risk_level: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface AgentSessionInput {
  user_id: string;
  title: string;
  goal?: string;
  status?: SessionStatus;
  worker_id?: string;
  delegation_contract?: Record<string, unknown>;
  risk_level?: string;
}

function mapRow(r: any): AgentSessionRecord {
  return {
    id: r.id,
    user_id: r.user_id,
    title: r.title,
    goal: r.goal ?? null,
    status: r.status,
    worker_id: r.worker_id ?? null,
    delegation_contract:
      typeof r.delegation_contract === "object" ? r.delegation_contract : {},
    risk_level: r.risk_level ?? "low",
    created_at: new Date(r.created_at).toISOString(),
    updated_at: new Date(r.updated_at).toISOString(),
    completed_at: r.completed_at
      ? new Date(r.completed_at).toISOString()
      : null,
  };
}

// ── Repo ─────────────────────────────────────────────────────────────────────

export const AgentSessionRepo = {
  /** Create a new agent session */
  async create(input: AgentSessionInput): Promise<AgentSessionRecord> {
    const id = uuid();
    const result = await query(
      `INSERT INTO agent_sessions
       (id, user_id, title, goal, status, worker_id, delegation_contract, risk_level)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        id,
        input.user_id,
        input.title,
        input.goal ?? null,
        input.status ?? "planning",
        input.worker_id ?? null,
        JSON.stringify(input.delegation_contract ?? {}),
        input.risk_level ?? "low",
      ]
    );
    return mapRow(result.rows[0]);
  },

  /** Get session by ID */
  async getById(id: string): Promise<AgentSessionRecord | null> {
    const result = await query(
      `SELECT * FROM agent_sessions WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) return null;
    return mapRow(result.rows[0]);
  },

  /** List sessions for a user, with optional status filter */
  async list(
    userId: string,
    options?: {
      status?: SessionStatus;
      limit?: number;
      offset?: number;
    }
  ): Promise<AgentSessionRecord[]> {
    const limit = Math.min(options?.limit ?? 50, 100);
    const offset = options?.offset ?? 0;

    let sql = `SELECT * FROM agent_sessions WHERE user_id = $1`;
    const params: any[] = [userId];
    let idx = 2;

    if (options?.status) {
      sql += ` AND status = $${idx}`;
      params.push(options.status);
      idx++;
    }

    sql += ` ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);

    const result = await query(sql, params);
    return result.rows.map(mapRow);
  },

  /** Update session status */
  async setStatus(
    id: string,
    status: SessionStatus,
    userId?: string
  ): Promise<void> {
    let sql = `UPDATE agent_sessions SET status = $1, updated_at = NOW()`;
    const params: any[] = [status];
    let idx = 2;

    if (status === "completed" || status === "failed" || status === "cancelled" || status === "rolled_back") {
      sql += `, completed_at = NOW()`;
    }

    sql += ` WHERE id = $${idx}`;
    params.push(id);
    idx++;

    if (userId) {
      sql += ` AND user_id = $${idx}`;
      params.push(userId);
    }

    await query(sql, params);
  },

  /** Update session fields (partial update) */
  async update(
    id: string,
    fields: {
      title?: string;
      goal?: string;
      worker_id?: string | null;
      delegation_contract?: Record<string, unknown>;
      risk_level?: string;
    },
    userId?: string
  ): Promise<AgentSessionRecord | null> {
    const sets: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (fields.title !== undefined) {
      sets.push(`title = $${idx++}`);
      params.push(fields.title);
    }
    if (fields.goal !== undefined) {
      sets.push(`goal = $${idx++}`);
      params.push(fields.goal);
    }
    if (fields.worker_id !== undefined) {
      sets.push(`worker_id = $${idx++}`);
      params.push(fields.worker_id);
    }
    if (fields.delegation_contract !== undefined) {
      sets.push(`delegation_contract = $${idx++}`);
      params.push(JSON.stringify(fields.delegation_contract));
    }
    if (fields.risk_level !== undefined) {
      sets.push(`risk_level = $${idx++}`);
      params.push(fields.risk_level);
    }

    if (sets.length === 0) return this.getById(id);

    sets.push(`updated_at = NOW()`);
    params.push(id);

    let sql = `UPDATE agent_sessions SET ${sets.join(", ")} WHERE id = $${idx++}`;
    if (userId) {
      sql += ` AND user_id = $${idx}`;
      params.push(userId);
    }
    sql += ` RETURNING *`;

    const result = await query(sql, params);
    if (result.rows.length === 0) return null;
    return mapRow(result.rows[0]);
  },

  /** Count sessions for a user (optional status filter) */
  async count(
    userId: string,
    status?: SessionStatus
  ): Promise<number> {
    let sql = `SELECT COUNT(*)::int AS total FROM agent_sessions WHERE user_id = $1`;
    const params: any[] = [userId];

    if (status) {
      sql += ` AND status = $2`;
      params.push(status);
    }

    const result = await query(sql, params);
    return result.rows[0]?.total ?? 0;
  },
};
