import { v4 as uuid } from "uuid";
import { query } from "../connection.js";
import type { Task, TaskListItem, TaskSummary, TaskTrace } from "../../types/index.js";

// ── TaskRepo ─────────────────────────────────────────────────────────────────

export const TaskRepo = {
  async list(userId: string, sessionId?: string): Promise<TaskListItem[]> {
    let sql = `SELECT id as task_id, title, mode, status, complexity, risk, updated_at, session_id
      FROM tasks WHERE user_id=$1`;
    const params: any[] = [userId];
    if (sessionId) {
      sql += ` AND session_id=$2`;
      params.push(sessionId);
    }
    sql += ` ORDER BY updated_at DESC LIMIT 100`;
    const result = await query(sql, params);
    return result.rows.map((r: any) => ({
      task_id: r.task_id,
      title: r.title || "",
      mode: r.mode,
      status: r.status,
      complexity: r.complexity,
      risk: r.risk,
      updated_at: new Date(r.updated_at).toISOString(),
      session_id: r.session_id,
    }));
  },

  async getById(taskId: string): Promise<Task | null> {
    const result = await query(`SELECT * FROM tasks WHERE id=$1`, [taskId]);
    if (result.rows.length === 0) return null;
    const r: any = result.rows[0];
    return {
      task_id: r.id,
      user_id: r.user_id,
      session_id: r.session_id,
      title: r.title || "",
      mode: r.mode,
      status: r.status,
      complexity: r.complexity,
      risk: r.risk,
      goal: r.goal || null,
      budget_profile: typeof r.budget_profile === "object" ? r.budget_profile : {},
      tokens_used: r.tokens_used || 0,
      tool_calls_used: r.tool_calls_used || 0,
      steps_used: r.steps_used || 0,
      summary_ref: r.summary_ref || null,
      created_at: new Date(r.created_at).toISOString(),
      updated_at: new Date(r.updated_at).toISOString(),
    };
  },

  async create(data: {
    id: string;
    user_id: string;
    session_id: string;
    title: string;
    mode: string;
    complexity: string;
    risk: string;
    goal?: string;
    tokens_used?: number;
    status?: string;
  }): Promise<void> {
    await query(
      `INSERT INTO tasks (id, user_id, session_id, title, mode, complexity, risk, goal, tokens_used, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        data.id,
        data.user_id,
        data.session_id,
        data.title,
        data.mode,
        data.complexity,
        data.risk,
        data.goal || null,
        data.tokens_used || 0,
        data.status || "completed",
      ]
    );
  },

  async findActiveBySession(sessionId: string, userId: string): Promise<Task | null> {
    const result = await query(
      `SELECT * FROM tasks
       WHERE session_id=$1 AND user_id=$2 AND status NOT IN ('completed','failed','cancelled')
       ORDER BY updated_at DESC LIMIT 1`,
      [sessionId, userId]
    );
    if (result.rows.length === 0) return null;
    const r: any = result.rows[0];
    return {
      task_id: r.id,
      user_id: r.user_id,
      session_id: r.session_id,
      title: r.title || "",
      mode: r.mode,
      status: r.status,
      complexity: r.complexity,
      risk: r.risk,
      goal: r.goal || null,
      budget_profile: typeof r.budget_profile === "object" ? r.budget_profile : {},
      tokens_used: r.tokens_used || 0,
      tool_calls_used: r.tool_calls_used || 0,
      steps_used: r.steps_used || 0,
      summary_ref: r.summary_ref || null,
      created_at: new Date(r.created_at).toISOString(),
      updated_at: new Date(r.updated_at).toISOString(),
    };
  },

  async setStatus(taskId: string, status: string): Promise<void> {
    await query(
      `UPDATE tasks SET status=$2, updated_at=NOW() WHERE id=$1`,
      [taskId, status]
    );
  },

  async updateExecution(taskId: string, tokensUsed: number): Promise<void> {
    await query(
      `UPDATE tasks SET tokens_used=$2, steps_used=steps_used+1, updated_at=NOW() WHERE id=$1`,
      [taskId, tokensUsed]
    );
  },

  async getSummary(taskId: string): Promise<TaskSummary | null> {
    const result = await query(`SELECT * FROM task_summaries WHERE task_id=$1`, [taskId]);
    if (result.rows.length === 0) return null;
    const r: any = result.rows[0];
    return {
      task_id: r.task_id,
      summary_id: r.id,
      goal: r.goal || null,
      confirmed_facts: r.confirmed_facts || [],
      completed_steps: r.completed_steps || [],
      blocked_by: r.blocked_by || [],
      next_step: r.next_step || null,
      summary_text: r.summary_text || null,
      version: r.version || 1,
      updated_at: new Date(r.updated_at).toISOString(),
    };
  },

  async getTraces(
    taskId: string,
    options?: { type?: string; limit?: number }
  ): Promise<TaskTrace[]> {
    const typeFilter = options?.type;
    const limit = options?.limit ?? 100;

    let sql = `SELECT * FROM task_traces WHERE task_id=$1`;
    const params: any[] = [taskId];

    if (typeFilter) {
      sql += ` AND type=$2`;
      params.push(typeFilter);
    }
    sql += ` ORDER BY created_at ASC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await query(sql, params);
    return result.rows.map((r: any) => {
      let detail: Record<string, any> | null = null;
      if (r.detail) {
        try {
          detail = typeof r.detail === "string" ? JSON.parse(r.detail) : r.detail;
        } catch {
          detail = { raw: r.detail };
        }
      }
      return {
        trace_id: r.id,
        task_id: r.task_id,
        type: r.type as import("../../types/index.js").TraceType,
        detail,
        created_at: new Date(r.created_at).toISOString(),
      };
    });
  },

  async createTrace(data: {
    id: string;
    task_id: string;
    type: string;
    detail?: Record<string, any> | null;
  }): Promise<void> {
    await query(
      `INSERT INTO task_traces (id, task_id, type, detail) VALUES ($1, $2, $3, $4)`,
      [
        data.id,
        data.task_id,
        data.type,
        data.detail ? JSON.stringify(data.detail) : null,
      ]
    );
  },
};

// ── TaskArchiveRepo ───────────────────────────────────────────────────────────

export interface TaskArchiveEntry {
  id: string;
  session_id: string;
  turn_id: number;
  command: {
    action: string;
    task: string;
    constraints: string[];
    query_keys: string[];
  };
  user_input: string;
  constraints: string[];
  fast_observations: Array<{ timestamp: number; observation: string }>;
  slow_execution: {
    started_at?: string;
    deviations?: string[];
    result?: string;
    errors?: string[];
  };
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  delivered: boolean;
  created_at: string;
  updated_at: string;
}

function mapTaskArchiveRow(r: any): TaskArchiveEntry {
  return {
    id: r.id,
    session_id: r.session_id,
    turn_id: r.turn_id,
    command: r.command,
    user_input: r.user_input,
    constraints: r.constraints ?? [],
    fast_observations: r.fast_observations ?? [],
    slow_execution: r.slow_execution ?? {},
    status: r.status,
    delivered: r.delivered ?? false,
    created_at: new Date(r.created_at).toISOString(),
    updated_at: new Date(r.updated_at).toISOString(),
  };
}

export const TaskArchiveRepo = {
  async create(data: {
    task_id: string;
    session_id: string;
    turn_id?: number;
    command: TaskArchiveEntry["command"];
    user_input: string;
    constraints?: string[];
    user_id?: string;
  }): Promise<TaskArchiveEntry> {
    const id = uuid();
    const result = await query(
      `INSERT INTO task_archives
        (id, session_id, turn_id, command, user_input, constraints, status, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
       RETURNING *`,
      [
        id,
        data.session_id,
        data.turn_id ?? 0,
        JSON.stringify(data.command),
        data.user_input,
        data.constraints ?? [],
        data.user_id ?? null,
      ]
    );
    return mapTaskArchiveRow(result.rows[0]);
  },

  async getById(id: string): Promise<TaskArchiveEntry | null> {
    const result = await query(`SELECT * FROM task_archives WHERE id=$1`, [id]);
    if (result.rows.length === 0) return null;
    return mapTaskArchiveRow(result.rows[0]);
  },

  async updateStatus(id: string, status: TaskArchiveEntry["status"]): Promise<void> {
    await query(
      `UPDATE task_archives SET status=$1, updated_at=NOW() WHERE id=$2`,
      [status, id]
    );
  },

  async appendObservation(
    id: string,
    observation: { timestamp: number; observation: string }
  ): Promise<void> {
    await query(
      `UPDATE task_archives
       SET fast_observations = fast_observations || $1::jsonb,
           updated_at = NOW()
       WHERE id=$2`,
      [JSON.stringify([observation]), id]
    );
  },

  async writeExecution(data: {
    id: string;
    status: "done" | "failed";
    result?: string;
    errors?: string[];
    started_at?: string;
    deviations?: string[];
  }): Promise<void> {
    const exec = {
      started_at: data.started_at ?? null,
      deviations: data.deviations ?? [],
      result: data.result ?? null,
      errors: data.errors ?? [],
    };
    await query(
      `UPDATE task_archives
       SET slow_execution=$1, status=$2, updated_at=NOW()
       WHERE id=$3`,
      [JSON.stringify(exec), data.status, data.id]
    );
  },

  async markDelivered(id: string): Promise<void> {
    await query(
      `UPDATE task_archives SET delivered=TRUE, updated_at=NOW() WHERE id=$1`,
      [id]
    );
  },

  async getBySession(sessionId: string, limit = 10): Promise<TaskArchiveEntry[]> {
    const result = await query(
      `SELECT * FROM task_archives
       WHERE session_id=$1
       ORDER BY created_at DESC
       LIMIT $2`,
      [sessionId, limit]
    );
    return result.rows.map(mapTaskArchiveRow);
  },

  async listPending(sessionId: string): Promise<TaskArchiveEntry[]> {
    const result = await query(
      `SELECT * FROM task_archives
       WHERE session_id=$1 AND status NOT IN ('done', 'failed', 'cancelled')
       ORDER BY created_at ASC`,
      [sessionId]
    );
    return result.rows.map(mapTaskArchiveRow);
  },

  async hasPending(sessionId: string): Promise<boolean> {
    const result = await query(
      `SELECT COUNT(*) as cnt FROM task_archives
       WHERE session_id=$1 AND status NOT IN ('done', 'failed', 'cancelled')`,
      [sessionId]
    );
    return parseInt(result.rows[0]?.cnt ?? "0") > 0;
  },

  async getRecent(userId: string, limit = 50): Promise<TaskArchiveEntry[]> {
    const result = await query(
      `SELECT * FROM task_archives
       WHERE user_id=$1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows.map(mapTaskArchiveRow);
  },
};
