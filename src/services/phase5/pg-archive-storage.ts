/**
 * Phase 5 — PostgreSQL Archive Storage + Semantic Query
 *
 * 使用现有 task_archives 表作为存储后端。
 * 支持 pgvector 语义搜索（需要 embedding 列和向量维度配置）。
 */

import { query } from "../../db/connection.js";
import type {
  IArchiveStorage,
  IArchiveQuery,
  ArchiveDocument,
  SearchFilters,
  SearchResult,
} from "./storage-backend.js";

// ── PGArchiveStorage ──────────────────────────────────────────────────────────

export class PGArchiveStorage implements IArchiveStorage {
  async save(doc: ArchiveDocument): Promise<string> {
    await query(
      `INSERT INTO task_archives
        (id, task_id, session_id, user_id, manager_decision, command,
         user_input, task_brief, goal, state, status, constraints,
         fast_observations, slow_execution, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (id) DO UPDATE SET
         state = EXCLUDED.state,
         status = EXCLUDED.status,
         fast_observations = EXCLUDED.fast_observations,
         slow_execution = EXCLUDED.slow_execution,
         updated_at = EXCLUDED.updated_at`,
      [
        doc.id,
        doc.task_id ?? null,
        doc.session_id,
        doc.user_id,
        JSON.stringify(doc.manager_decision),
        doc.command ? JSON.stringify(doc.command) : null,
        doc.user_input,
        doc.task_brief ?? null,
        doc.goal ?? null,
        doc.state,
        doc.status,
        JSON.stringify(doc.constraints),
        JSON.stringify(doc.fast_observations),
        JSON.stringify(doc.slow_execution),
        doc.created_at,
        doc.updated_at,
      ]
    );
    return doc.id;
  }

  async getById(id: string): Promise<ArchiveDocument | null> {
    const row = await queryRow(
      `SELECT id, task_id, session_id, user_id, manager_decision, command,
              user_input, task_brief, goal, state, status, constraints,
              fast_observations, slow_execution, created_at, updated_at
       FROM task_archives WHERE id = $1`,
      [id]
    );
    return row ? parseRow(row) : null;
  }

  async getBySession(
    sessionId: string,
    userId: string
  ): Promise<ArchiveDocument | null> {
    const row = await queryRow(
      `SELECT id, task_id, session_id, user_id, manager_decision, command,
              user_input, task_brief, goal, state, status, constraints,
              fast_observations, slow_execution, created_at, updated_at
       FROM task_archives
       WHERE session_id = $1 AND user_id = $2
       ORDER BY updated_at DESC
       LIMIT 1`,
      [sessionId, userId]
    );
    return row ? parseRow(row) : null;
  }

  async update(
    id: string,
    updates: Partial<ArchiveDocument>
  ): Promise<boolean> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;

    const map: Record<string, { dbCol: string; transform?: (v: unknown) => unknown }> = {
      state: { dbCol: "state" },
      status: { dbCol: "status" },
      constraints: { dbCol: "constraints", transform: JSON.stringify },
      fast_observations: { dbCol: "fast_observations", transform: JSON.stringify },
      slow_execution: { dbCol: "slow_execution", transform: JSON.stringify },
      task_brief: { dbCol: "task_brief" },
      goal: { dbCol: "goal" },
    };

    for (const [key, { dbCol, transform }] of Object.entries(map)) {
      if (key in updates && updates[key as keyof ArchiveDocument] !== undefined) {
        sets.push(`${dbCol} = $${idx++}`);
        vals.push(transform ? transform(updates[key as keyof ArchiveDocument]) : updates[key as keyof ArchiveDocument]);
      }
    }

    if (sets.length === 0) return false;

    sets.push(`updated_at = $${idx++}`);
    vals.push(new Date().toISOString());
    vals.push(id);

    const result = await query(
      `UPDATE task_archives SET ${sets.join(", ")} WHERE id = $${idx}`,
      vals
    );
    return (result.rowCount ?? 0) > 0;
  }

  async updateCommandStatus(
    id: string,
    status: string,
    result?: unknown
  ): Promise<boolean> {
    const updates: Partial<ArchiveDocument> = { status };
    if (result) {
      updates.slow_execution = result as Record<string, unknown>;
    }
    return this.update(id, updates);
  }

  async delete(id: string): Promise<boolean> {
    const result = await query("DELETE FROM task_archives WHERE id = $1", [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async listBySession(
    sessionId: string,
    userId: string
  ): Promise<ArchiveDocument[]> {
    const rows = await query(
      `SELECT id, task_id, session_id, user_id, manager_decision, command,
              user_input, task_brief, goal, state, status, constraints,
              fast_observations, slow_execution, created_at, updated_at
       FROM task_archives
       WHERE session_id = $1 AND user_id = $2
       ORDER BY created_at DESC`,
      [sessionId, userId]
    );
    return rows.rows.map(parseRow);
  }

  async ping(): Promise<boolean> {
    try {
      await query("SELECT 1 FROM task_archives LIMIT 1");
      return true;
    } catch {
      return false;
    }
  }
}

// ── PGArchiveQuery ─────────────────────────────────────────────────────────────

export class PGArchiveQuery implements IArchiveQuery {
  /** 语义搜索 — 使用 pgvector 余弦相似度 */
  async searchByEmbedding(
    userId: string,
    embedding: number[],
    topK: number = 10,
    filters?: SearchFilters
  ): Promise<SearchResult[]> {
    const conditions = ["user_id = $1"];
    const vals: unknown[] = [userId];
    let idx = 2;

    if (filters?.sessionId) {
      conditions.push(`session_id = $${idx++}`);
      vals.push(filters.sessionId);
    }
    if (filters?.taskType) {
      conditions.push(`task_brief LIKE $${idx++}`);
      vals.push(`%${filters.taskType}%`);
    }
    if (filters?.state) {
      conditions.push(`state = $${idx++}`);
      vals.push(filters.state);
    }
    if (filters?.fromDate) {
      conditions.push(`created_at >= $${idx++}`);
      vals.push(filters.fromDate);
    }
    if (filters?.toDate) {
      conditions.push(`created_at <= $${idx++}`);
      vals.push(filters.toDate);
    }

    const vectorDim = embedding.length;
    const embeddingStr = `[${embedding.join(",")}]`;

    const sql = `
      SELECT id, session_id, user_id, user_input, task_brief, state,
             created_at, updated_at,
             (embedding <=> $${idx}::vector) AS similarity
      FROM task_archives
      WHERE ${conditions.join(" AND ")}
        AND embedding IS NOT NULL
        AND array_length(embedding, 1) = $${idx + 1}
      ORDER BY embedding <=> $${idx}::vector
      LIMIT $${idx + 2}
    `;

    vals.push(embeddingStr, vectorDim, topK);

    try {
      const result = await query(sql, vals);
      return result.rows.map((r) => ({
        archiveId: r.id,
        sessionId: r.session_id,
        userId: r.user_id,
        userInput: r.user_input,
        taskBrief: r.task_brief ?? undefined,
        state: r.state,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        similarity: r.similarity,
      }));
    } catch {
      // pgvector 未安装或列不存在，降级返回空
      return [];
    }
  }

  /** 关键词全文搜索 */
  async searchByKeyword(
    userId: string,
    keyword: string,
    limit: number = 20
  ): Promise<SearchResult[]> {
    const sql = `
      SELECT id, session_id, user_id, user_input, task_brief, state,
             created_at, updated_at
      FROM task_archives
      WHERE user_id = $1
        AND (user_input ILIKE $2 OR task_brief ILIKE $2 OR goal ILIKE $2)
      ORDER BY updated_at DESC
      LIMIT $3
    `;

    const result = await query(sql, [userId, `%${keyword}%`, limit]);
    return result.rows.map((r) => ({
      archiveId: r.id,
      sessionId: r.session_id,
      userId: r.user_id,
      userInput: r.user_input,
      taskBrief: r.task_brief ?? undefined,
      state: r.state,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      highlight: r.user_input.replace(
        new RegExp(`(${keyword})`, "gi"),
        "<mark>$1</mark>"
      ),
    }));
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function queryRow(sql: string, vals: unknown[]): Promise<Record<string, unknown> | null> {
  const result = await query(sql, vals);
  return result.rows[0] ?? null;
}

function parseRow(row: Record<string, unknown>): ArchiveDocument {
  return {
    id: row.id as string,
    task_id: row.task_id as string | undefined,
    session_id: row.session_id as string,
    user_id: row.user_id as string,
    manager_decision:
      typeof row.manager_decision === "string"
        ? JSON.parse(row.manager_decision)
        : row.manager_decision,
    command:
      row.command && typeof row.command === "string"
        ? JSON.parse(row.command)
        : row.command,
    user_input: row.user_input as string,
    task_brief: row.task_brief as string | undefined,
    goal: row.goal as string | undefined,
    state: row.state as string,
    status: row.status as string,
    constraints:
      typeof row.constraints === "string"
        ? JSON.parse(row.constraints)
        : (row.constraints ?? {}),
    fast_observations:
      typeof row.fast_observations === "string"
        ? JSON.parse(row.fast_observations)
        : (row.fast_observations ?? []),
    slow_execution:
      typeof row.slow_execution === "string"
        ? JSON.parse(row.slow_execution)
        : (row.slow_execution ?? {}),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}
