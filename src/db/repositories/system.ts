import { v4 as uuid } from "uuid";
import { query } from "../connection.js";
import type { PromptTemplate, PromptTemplateInput, PromptTemplateUpdate } from "../../types/index.js";

// ── PromptTemplateRepo ────────────────────────────────────────────────────────

function mapPromptTemplateRow(r: any): PromptTemplate {
  return {
    ...r,
    content: typeof r.content === "string" ? JSON.parse(r.content) : r.content,
    metadata: typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata ?? {},
  };
}

export const PromptTemplateRepo = {
  async create(input: PromptTemplateInput & { created_by?: string }): Promise<PromptTemplate> {
    const id = uuid();
    const result = await query(
      `INSERT INTO prompt_templates (id, name, description, version, content, scope, created_by, tags, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        id,
        input.name,
        input.description ?? "",
        1,
        JSON.stringify(input.content),
        input.scope ?? "global",
        input.created_by ?? "system",
        input.tags ?? [],
        JSON.stringify(input.metadata ?? {}),
      ]
    );
    return mapPromptTemplateRow(result.rows[0]);
  },

  async getById(id: string): Promise<PromptTemplate | null> {
    const result = await query(`SELECT * FROM prompt_templates WHERE id=$1`, [id]);
    if (result.rows.length === 0) return null;
    return mapPromptTemplateRow(result.rows[0]);
  },

  async update(id: string, update: PromptTemplateUpdate): Promise<PromptTemplate | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (update.name !== undefined) { fields.push(`name=$${idx++}`); values.push(update.name); }
    if (update.description !== undefined) { fields.push(`description=$${idx++}`); values.push(update.description); }
    if (update.content !== undefined) { fields.push(`content=$${idx++}`); values.push(JSON.stringify(update.content)); }
    if (update.is_active !== undefined) { fields.push(`is_active=$${idx++}`); values.push(update.is_active); }
    if (update.tags !== undefined) { fields.push(`tags=$${idx++}`); values.push(update.tags); }
    if (update.metadata !== undefined) { fields.push(`metadata=$${idx++}`); values.push(JSON.stringify(update.metadata)); }

    if (fields.length === 0) return this.getById(id);

    fields.push(`updated_at=NOW()`);
    if (update.content !== undefined) fields.push(`version=version+1`);

    values.push(id);
    const result = await query(
      `UPDATE prompt_templates SET ${fields.join(", ")} WHERE id=$${idx} RETURNING *`,
      values
    );
    if (result.rows.length === 0) return null;
    return mapPromptTemplateRow(result.rows[0]);
  },

  async setActive(id: string): Promise<void> {
    const template = await this.getById(id);
    if (!template) return;
    await query(
      `UPDATE prompt_templates SET is_active=FALSE WHERE scope=$1 AND is_active=TRUE`,
      [template.scope]
    );
    await query(`UPDATE prompt_templates SET is_active=TRUE, updated_at=NOW() WHERE id=$1`, [id]);
  },

  async getActive(scope = "global"): Promise<PromptTemplate | null> {
    const result = await query(
      `SELECT * FROM prompt_templates WHERE scope=$1 AND is_active=TRUE LIMIT 1`,
      [scope]
    );
    if (result.rows.length === 0) return null;
    return mapPromptTemplateRow(result.rows[0]);
  },

  async list(scope?: string): Promise<PromptTemplate[]> {
    const sql = scope
      ? `SELECT * FROM prompt_templates WHERE scope=$1 ORDER BY is_active DESC, updated_at DESC`
      : `SELECT * FROM prompt_templates ORDER BY is_active DESC, updated_at DESC`;
    const result = await query(sql, scope ? [scope] : []);
    return result.rows.map(mapPromptTemplateRow);
  },

  async delete(id: string): Promise<void> {
    await query(`DELETE FROM prompt_templates WHERE id=$1`, [id]);
  },
};

// ── SessionContextRepo ────────────────────────────────────────────────────────

export const SessionContextRepo = {
  async getRecentSessions(userId: string, limit = 5): Promise<any[]> {
    const result = await query(
      `SELECT s.id, s.active_topic, s.slow_count, s.total_requests, s.turn_count,
              s.created_at, s.updated_at,
              ss.summary_text, ss.topic, ss.key_facts, ss.decisions_made, ss.open_questions
       FROM sessions s
       LEFT JOIN session_summaries ss ON ss.session_id = s.id
       WHERE s.user_id = $1 AND s.slow_count > 0
       ORDER BY s.updated_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows;
  },

  async getIncompleteTasks(userId: string, limit = 5): Promise<any[]> {
    const result = await query(
      `SELECT t.id, t.title, t.mode, t.status, t.goal,
              ts.next_step, ts.blocked_by, ts.completed_steps,
              t.session_id, t.updated_at
       FROM tasks t
       LEFT JOIN task_summaries ts ON ts.task_id = t.id
       WHERE t.user_id = $1 AND t.status NOT IN ('completed', 'failed', 'cancelled')
       ORDER BY t.updated_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows;
  },

  async getRecentKeyFacts(userId: string, limit = 3): Promise<string[]> {
    const result = await query(
      `SELECT ss.key_facts
       FROM session_summaries ss
       WHERE ss.user_id = $1
       ORDER BY ss.created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    const facts: string[] = [];
    for (const row of result.rows) {
      const kf: string[] = row.key_facts || [];
      facts.push(...kf.slice(0, 2));
    }
    return facts.slice(0, limit);
  },
};

// ── PermissionRequestRepo ─────────────────────────────────────────────────────

export interface PermissionRequestInput {
  id: string;
  task_id: string;
  worker_id: string;
  user_id: string;
  session_id: string;
  field_name: string;
  field_key: string;
  purpose: string;
  value_preview?: string;
  status?: "pending" | "approved" | "denied" | "expired";
  expires_in?: number;
  approved_scope?: string;
}

export interface PermissionRequestRecord {
  id: string;
  task_id: string;
  worker_id: string;
  user_id: string;
  session_id: string;
  field_name: string;
  field_key: string;
  purpose: string;
  value_preview?: string;
  status: "pending" | "approved" | "denied" | "expired";
  expires_in: number;
  approved_scope?: string;
  created_at: string;
  resolved_at?: string;
  resolved_by?: string;
}

export const PermissionRequestRepo = {
  async create(input: PermissionRequestInput): Promise<PermissionRequestRecord> {
    const result = await query(
      `INSERT INTO permission_requests
       (id, task_id, worker_id, user_id, session_id, field_name, field_key,
        purpose, value_preview, status, expires_in, approved_scope)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        input.id,
        input.task_id,
        input.worker_id,
        input.user_id,
        input.session_id,
        input.field_name,
        input.field_key,
        input.purpose,
        input.value_preview ?? null,
        input.status ?? "pending",
        input.expires_in ?? 300,
        input.approved_scope ?? null,
      ]
    );
    return result.rows[0] as PermissionRequestRecord;
  },

  async approve(id: string, resolvedBy: string, approvedScope?: string): Promise<void> {
    await query(
      `UPDATE permission_requests
       SET status='approved', resolved_at=NOW(), resolved_by=$1, approved_scope=$2
       WHERE id=$3`,
      [resolvedBy, approvedScope ?? null, id]
    );
  },

  async deny(id: string, resolvedBy: string): Promise<void> {
    await query(
      `UPDATE permission_requests
       SET status='denied', resolved_at=NOW(), resolved_by=$1
       WHERE id=$2`,
      [resolvedBy, id]
    );
  },

  async getPending(userId: string): Promise<PermissionRequestRecord[]> {
    const result = await query(
      `SELECT * FROM permission_requests
       WHERE user_id=$1 AND status='pending'
         AND created_at > NOW() - INTERVAL '5 minutes'
       ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows as PermissionRequestRecord[];
  },

  async getByTask(taskId: string): Promise<PermissionRequestRecord[]> {
    const result = await query(
      `SELECT * FROM permission_requests WHERE task_id=$1 ORDER BY created_at DESC`,
      [taskId]
    );
    return result.rows as PermissionRequestRecord[];
  },

  async expireOld(): Promise<void> {
    await query(
      `UPDATE permission_requests SET status='expired'
       WHERE status='pending' AND created_at < NOW() - INTERVAL '5 minutes'`
    );
  },

  async getById(id: string): Promise<PermissionRequestRecord | null> {
    const result = await query(
      `SELECT * FROM permission_requests WHERE id=$1 LIMIT 1`,
      [id]
    );
    return result.rows.length > 0 ? (result.rows[0] as PermissionRequestRecord) : null;
  },
};

// ── TaskWorkspaceRepo ─────────────────────────────────────────────────────────

export interface TaskWorkspaceInput {
  id: string;
  task_id: string;
  user_id: string;
  session_id: string;
  objective: string;
  constraints?: string[];
  shared_outputs?: Record<string, unknown>;
}

export interface TaskWorkspaceRecord {
  id: string;
  task_id: string;
  user_id: string;
  session_id: string;
  objective: string;
  constraints: string[];
  shared_outputs: Record<string, unknown>;
  access_log: unknown[];
  created_at: string;
  updated_at: string;
}

export const TaskWorkspaceRepo = {
  async create(input: TaskWorkspaceInput): Promise<TaskWorkspaceRecord> {
    const result = await query(
      `INSERT INTO task_workspaces
       (id, task_id, user_id, session_id, objective, constraints, shared_outputs)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        input.id,
        input.task_id,
        input.user_id,
        input.session_id,
        input.objective,
        input.constraints ?? [],
        JSON.stringify(input.shared_outputs ?? {}),
      ]
    );
    return result.rows[0] as TaskWorkspaceRecord;
  },

  async getByTask(taskId: string): Promise<TaskWorkspaceRecord | null> {
    const result = await query(
      `SELECT * FROM task_workspaces WHERE task_id=$1 LIMIT 1`,
      [taskId]
    );
    return result.rows.length > 0 ? (result.rows[0] as TaskWorkspaceRecord) : null;
  },

  async getActiveByUser(userId: string, limit = 3): Promise<TaskWorkspaceRecord[]> {
    const result = await query(
      `SELECT * FROM task_workspaces WHERE user_id=$1 ORDER BY updated_at DESC LIMIT $2`,
      [userId, limit]
    );
    return result.rows as TaskWorkspaceRecord[];
  },

  async updateOutputs(taskId: string, outputs: Record<string, unknown>): Promise<void> {
    await query(
      `UPDATE task_workspaces
       SET shared_outputs = shared_outputs || $1::jsonb, updated_at = NOW()
       WHERE task_id=$2`,
      [JSON.stringify(outputs), taskId]
    );
  },

  async appendAccessLog(
    taskId: string,
    entry: { worker_id: string; action: string; keys: string[]; ts?: string }
  ): Promise<void> {
    const logEntry = { ...entry, ts: entry.ts ?? new Date().toISOString() };
    await query(
      `UPDATE task_workspaces
       SET access_log = access_log || $1::jsonb, updated_at = NOW()
       WHERE task_id=$2`,
      [JSON.stringify(logEntry), taskId]
    );
  },

  async getPeerOutputs(
    taskId: string,
    excludeWorkerId?: string
  ): Promise<Record<string, unknown>> {
    const ws = await this.getByTask(taskId);
    if (!ws) return {};
    if (!excludeWorkerId) return ws.shared_outputs;
    const out = { ...ws.shared_outputs };
    delete out[excludeWorkerId];
    return out;
  },
};

// ── ScopedTokenRepo ───────────────────────────────────────────────────────────

export interface ScopedTokenRecord {
  id: string;
  token: string;
  task_id: string;
  worker_id: string;
  user_id: string;
  scope: string[];
  expires_at: string;
  created_at: string;
}

export const ScopedTokenRepo = {
  async create(input: {
    id: string;
    token: string;
    task_id: string;
    worker_id: string;
    user_id: string;
    scope: string[];
    expires_at: string;
  }): Promise<ScopedTokenRecord> {
    const result = await query(
      `INSERT INTO scoped_tokens (id, token, task_id, worker_id, user_id, scope, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        input.id,
        input.token,
        input.task_id,
        input.worker_id,
        input.user_id,
        input.scope,
        input.expires_at,
      ]
    );
    return result.rows[0] as ScopedTokenRecord;
  },

  async validate(token: string): Promise<ScopedTokenRecord | null> {
    const result = await query(
      `SELECT * FROM scoped_tokens WHERE token=$1 AND expires_at > NOW() LIMIT 1`,
      [token]
    );
    return result.rows.length > 0 ? (result.rows[0] as ScopedTokenRecord) : null;
  },

  async revoke(token: string): Promise<void> {
    await query(`DELETE FROM scoped_tokens WHERE token=$1`, [token]);
  },

  async revokeByTask(taskId: string): Promise<void> {
    await query(`DELETE FROM scoped_tokens WHERE task_id=$1`, [taskId]);
  },

  async cleanup(): Promise<void> {
    await query(`DELETE FROM scoped_tokens WHERE expires_at < NOW()`);
  },
};
