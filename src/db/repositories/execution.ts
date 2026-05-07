import { v4 as uuid } from "uuid";
import { query } from "../connection.js";
import type { ExecutionResultRecord, ExecutionResultInput, Evidence, EvidenceInput } from "../../types/index.js";

// ── ExecutionResultRepo ───────────────────────────────────────────────────────

function mapExecutionResultRow(r: any): ExecutionResultRecord {
  return {
    id: r.id,
    task_id: r.task_id,
    user_id: r.user_id,
    session_id: r.session_id,
    final_content: r.final_content,
    steps_summary: r.steps_summary ?? null,
    memory_entries_used: r.memory_entries_used ?? [],
    model_used: r.model_used,
    tool_count: r.tool_count ?? 0,
    duration_ms: r.duration_ms ?? null,
    reason: r.reason,
    created_at: new Date(r.created_at).toISOString(),
  };
}

export const ExecutionResultRepo = {
  async save(r: ExecutionResultInput): Promise<ExecutionResultRecord> {
    const id = uuid();
    const result = await query(
      `INSERT INTO execution_results (
        id, task_id, user_id, session_id,
        final_content, steps_summary, memory_entries_used,
        model_used, tool_count, duration_ms, reason
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        id,
        r.task_id,
        r.user_id,
        r.session_id,
        r.final_content,
        JSON.stringify(r.steps_summary),
        r.memory_entries_used ?? [],
        r.model_used ?? null,
        r.tool_count,
        r.duration_ms ?? null,
        r.reason,
      ]
    );
    return mapExecutionResultRow(result.rows[0]);
  },

  async getByTaskId(taskId: string): Promise<ExecutionResultRecord | null> {
    const result = await query(
      `SELECT * FROM execution_results WHERE task_id=$1 LIMIT 1`,
      [taskId]
    );
    if (result.rows.length === 0) return null;
    return mapExecutionResultRow(result.rows[0]);
  },

  async listByUser(userId: string, limit = 20): Promise<ExecutionResultRecord[]> {
    const result = await query(
      `SELECT * FROM execution_results
       WHERE user_id=$1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows.map(mapExecutionResultRow);
  },
};

// ── EvidenceRepo ──────────────────────────────────────────────────────────────

function mapEvidenceRow(r: any): Evidence {
  return {
    evidence_id: r.evidence_id,
    task_id: r.task_id,
    user_id: r.user_id,
    source: r.source,
    content: r.content,
    source_metadata: r.source_metadata ?? null,
    relevance_score: r.relevance_score ?? null,
    created_at: new Date(r.created_at).toISOString(),
  };
}

export const EvidenceRepo = {
  async create(input: EvidenceInput): Promise<Evidence> {
    const id = uuid();
    const result = await query(
      `INSERT INTO evidence (evidence_id, task_id, user_id, source, content, source_metadata, relevance_score)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        id,
        input.task_id,
        input.user_id,
        input.source,
        input.content,
        input.source_metadata ? JSON.stringify(input.source_metadata) : null,
        input.relevance_score ?? null,
      ]
    );
    return mapEvidenceRow(result.rows[0]);
  },

  async getById(evidenceId: string): Promise<Evidence | null> {
    const result = await query(
      `SELECT * FROM evidence WHERE evidence_id=$1`,
      [evidenceId]
    );
    if (result.rows.length === 0) return null;
    return mapEvidenceRow(result.rows[0]);
  },

  async listByTask(taskId: string): Promise<Evidence[]> {
    const result = await query(
      `SELECT * FROM evidence WHERE task_id=$1 ORDER BY created_at ASC`,
      [taskId]
    );
    return result.rows.map(mapEvidenceRow);
  },

  async listByUser(userId: string, limit = 100): Promise<Evidence[]> {
    const result = await query(
      `SELECT * FROM evidence WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`,
      [userId, limit]
    );
    return result.rows.map(mapEvidenceRow);
  },

  async getEvidenceForUser(userId: string, limit = 20): Promise<Evidence[]> {
    const result = await query(
      `SELECT * FROM evidence
       WHERE user_id=$1 AND (relevance_score IS NULL OR relevance_score > 0.1)
       ORDER BY relevance_score DESC NULLS LAST, created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows.map(mapEvidenceRow);
  },
};
