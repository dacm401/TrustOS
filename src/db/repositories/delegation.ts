import { v4 as uuid } from "uuid";
import { query } from "../connection.js";
import type { DelegationLog, DelegationLogInput, DelegationLogExecutionUpdate } from "../../types/index.js";

// ── DelegationArchiveRepo ─────────────────────────────────────────────────────

export interface DelegationArchiveEntry {
  id: string;
  task_id: string;
  user_id: string;
  session_id: string;
  original_message: string;
  delegation_prompt: string;
  slow_result: string | null;
  related_task_ids: string[];
  status: "pending" | "completed" | "failed";
  processing_ms: number | null;
  created_at: string;
  completed_at: string | null;
}

function mapDelegationArchiveRow(r: any): DelegationArchiveEntry {
  return {
    id: r.id,
    task_id: r.task_id,
    user_id: r.user_id,
    session_id: r.session_id,
    original_message: r.original_message,
    delegation_prompt: r.delegation_prompt,
    slow_result: r.slow_result,
    related_task_ids: r.related_task_ids ?? [],
    status: r.status,
    processing_ms: r.processing_ms,
    created_at: new Date(r.created_at).toISOString(),
    completed_at: r.completed_at ? new Date(r.completed_at).toISOString() : null,
  };
}

// ── Phase 5: Archive Storage Side-Channel ──────────────────────────────────
// Lazy-load to avoid circular deps with storage-registry.

let _phase5Storage: import("../../services/phase5/storage-backend.js").IArchiveStorage | null = null;
let _phase5StorageAttempted = false;

async function getPhase5Storage() {
  if (_phase5Storage || _phase5StorageAttempted) return _phase5Storage;
  _phase5StorageAttempted = true;
  if (process.env.USE_PHASE5_ARCHIVE !== "true") return null;
  try {
    const { getIArchiveStorage } = await import("../../services/phase5/storage-registry.js");
    _phase5Storage = await getIArchiveStorage();
  } catch (e) {
    console.warn("[DelegationArchiveRepo] Phase 5 storage unavailable:", (e as Error).message);
  }
  return _phase5Storage;
}

function toArchiveDocument(
  entry: DelegationArchiveEntry
): import("../../services/phase5/storage-backend.js").ArchiveDocument {
  return {
    id: entry.id,
    task_id: entry.task_id,
    session_id: entry.session_id,
    user_id: entry.user_id,
    manager_decision: { delegation_prompt: entry.delegation_prompt },
    user_input: entry.original_message,
    state:
      entry.status === "completed"
        ? "completed"
        : entry.status === "failed"
          ? "failed"
          : "delegated",
    status: entry.status,
    constraints: { related_task_ids: entry.related_task_ids ?? [] },
    fast_observations: [],
    slow_execution: entry.slow_result
      ? { result: entry.slow_result, processing_ms: entry.processing_ms }
      : {},
    created_at: entry.created_at,
    updated_at: entry.completed_at ?? entry.created_at,
  };
}

async function phase5SideChannelWrite(entry: DelegationArchiveEntry): Promise<void> {
  const storage = await getPhase5Storage();
  if (!storage) return;
  try {
    const doc = toArchiveDocument(entry);
    await storage.save(doc);
    console.log(
      `[Phase5] Archive side-channel write: ${entry.id} → ${process.env.STORAGE_BACKEND}`
    );
  } catch (e) {
    console.warn(`[Phase5] Side-channel write failed for ${entry.id}:`, (e as Error).message);
  }
}

async function phase5SideChannelUpdate(
  id: string,
  slow_result: string,
  processing_ms: number,
  status: string
): Promise<void> {
  const storage = await getPhase5Storage();
  if (!storage) return;
  try {
    await storage.update(id, {
      slow_execution: { result: slow_result, processing_ms },
      status,
      state:
        status === "completed" ? "completed" : status === "failed" ? "failed" : "delegated",
      updated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn(`[Phase5] Side-channel update failed for ${id}:`, (e as Error).message);
  }
}

export const DelegationArchiveRepo = {
  async create(data: {
    task_id: string;
    user_id: string;
    session_id: string;
    original_message: string;
    delegation_prompt: string;
    slow_result?: string;
    processing_ms?: number;
  }): Promise<DelegationArchiveEntry> {
    const id = uuid();
    const status = data.slow_result !== undefined ? "completed" : "pending";
    const result = await query(
      `INSERT INTO delegation_archive
        (id, task_id, user_id, session_id, original_message, delegation_prompt, slow_result, status, processing_ms, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        id,
        data.task_id,
        data.user_id,
        data.session_id,
        data.original_message,
        data.delegation_prompt,
        data.slow_result ?? null,
        status,
        data.processing_ms ?? null,
        status === "completed" ? new Date() : null,
      ]
    );
    const entry = mapDelegationArchiveRow(result.rows[0]);
    phase5SideChannelWrite(entry).catch((e) =>
      console.warn("[DelegationArchiveRepo.save] phase5 side-channel write failed:", e?.message)
    );
    return entry;
  },

  async complete(data: {
    task_id: string;
    slow_result: string;
    processing_ms: number;
  }): Promise<void> {
    await query(
      `UPDATE delegation_archive
       SET slow_result=$1, status='completed', processing_ms=$2, completed_at=NOW()
       WHERE task_id=$3`,
      [data.slow_result, data.processing_ms, data.task_id]
    );
    const entry = await DelegationArchiveRepo.getById(data.task_id);
    if (entry) {
      phase5SideChannelUpdate(entry.id, data.slow_result, data.processing_ms, "completed").catch(
        (e) =>
          console.warn(
            "[DelegationArchiveRepo.complete] phase5 side-channel update failed:",
            e?.message
          )
      );
    }
  },

  async fail(task_id: string, error: string): Promise<void> {
    await query(
      `UPDATE delegation_archive SET status='failed', completed_at=NOW() WHERE task_id=$1`,
      [task_id]
    );
    const entry = await DelegationArchiveRepo.getById(task_id);
    if (entry) {
      phase5SideChannelUpdate(entry.id, error, 0, "failed").catch((e) =>
        console.warn("[DelegationArchiveRepo.fail] phase5 side-channel update failed:", e?.message)
      );
    }
  },

  async getRecentByUser(userId: string, limit = 5): Promise<DelegationArchiveEntry[]> {
    const result = await query(
      `SELECT * FROM delegation_archive
       WHERE user_id=$1 AND status='completed'
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows.map(mapDelegationArchiveRow);
  },

  async getById(taskId: string): Promise<DelegationArchiveEntry | null> {
    const result = await query(
      `SELECT * FROM delegation_archive WHERE task_id=$1`,
      [taskId]
    );
    if (result.rows.length === 0) return null;
    return mapDelegationArchiveRow(result.rows[0]);
  },

  async listBySession(
    userId: string,
    sessionId: string
  ): Promise<DelegationArchiveEntry[]> {
    const result = await query(
      `SELECT * FROM delegation_archive
       WHERE user_id=$1 AND session_id=$2
       ORDER BY created_at ASC`,
      [userId, sessionId]
    );
    return result.rows.map(mapDelegationArchiveRow);
  },

  async hasPending(userId: string, sessionId: string): Promise<boolean> {
    const result = await query(
      `SELECT COUNT(*) as cnt FROM delegation_archive
       WHERE user_id=$1 AND session_id=$2 AND status='pending'`,
      [userId, sessionId]
    );
    return parseInt(result.rows[0]?.cnt ?? "0") > 0;
  },

  async getPendingBySession(userId: string, sessionId: string): Promise<DelegationArchiveEntry[]> {
    const result = await query(
      `SELECT * FROM delegation_archive
       WHERE user_id=$1 AND session_id=$2 AND status='pending'
       ORDER BY created_at ASC`,
      [userId, sessionId]
    );
    return result.rows.map(mapDelegationArchiveRow);
  },
};

// ── DelegationLogRepo ────────────────────────────────────────────────────────

function mapDelegationLogRow(row: any): DelegationLog {
  return {
    id: row.id,
    user_id: row.user_id,
    session_id: row.session_id,
    turn_id: row.turn_id,
    task_id: row.task_id,
    routing_version: row.routing_version,
    llm_scores: row.llm_scores,
    llm_confidence: row.llm_confidence,
    system_confidence: row.system_confidence,
    calibrated_scores: row.calibrated_scores,
    policy_overrides: row.policy_overrides,
    g2_final_action: row.g2_final_action,
    did_rerank: row.did_rerank,
    rerank_gap: row.rerank_gap,
    rerank_rules: row.rerank_rules,
    g3_final_action: row.g3_final_action,
    routed_action: row.routed_action,
    routing_reason: row.routing_reason,
    routing_layer: row.routing_layer,
    execution_status: row.execution_status,
    execution_correct: row.execution_correct,
    error_message: row.error_message,
    model_used: row.model_used,
    latency_ms: row.latency_ms,
    cost_usd: row.cost_usd ? Number(row.cost_usd) : undefined,
    routing_success: row.routing_success,
    value_success: row.value_success,
    user_success: row.user_success,
    selected_role: row.selected_role ?? undefined,
    exec_input_tokens: row.exec_input_tokens ?? undefined,
    cost_saved_vs_slow: row.cost_saved_vs_slow ? Number(row.cost_saved_vs_slow) : undefined,
    created_at: row.created_at,
    executed_at: row.executed_at,
  };
}

export const DelegationLogRepo = {
  async save(d: DelegationLogInput): Promise<DelegationLog> {
    const id = d.id ?? uuid();
    await query(
      `INSERT INTO delegation_logs (
        id, user_id, session_id, turn_id, task_id, routing_version,
        llm_scores, llm_confidence,
        system_confidence,
        calibrated_scores, policy_overrides, g2_final_action,
        did_rerank, rerank_gap, rerank_rules, g3_final_action,
        grayzone_shortcut,
        routed_action, routing_reason, routing_layer,
        routing_success, value_success, user_success,
        selected_role
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8,
        $9,
        $10, $11, $12,
        $13, $14, $15, $16,
        $17,
        $18, $19, $20,
        $21, $22, $23,
        $24
      )`,
      [
        id,
        d.user_id,
        d.session_id,
        d.turn_id,
        d.task_id ?? null,
        d.routing_version ?? "v2",
        JSON.stringify(d.llm_scores),
        d.llm_confidence,
        d.system_confidence,
        JSON.stringify(d.calibrated_scores),
        JSON.stringify(d.policy_overrides),
        d.g2_final_action,
        d.did_rerank,
        d.rerank_gap ?? null,
        JSON.stringify(d.rerank_rules),
        d.g3_final_action ?? null,
        d.grayzone_shortcut ?? null,
        d.routed_action,
        d.routing_reason ?? null,
        d.routing_layer ?? null,
        d.routing_success ?? null,
        d.value_success ?? null,
        d.user_success ?? null,
        d.selected_role ?? null,
      ]
    );

    const result = await query(`SELECT * FROM delegation_logs WHERE id=$1`, [id]);
    return mapDelegationLogRow(result.rows[0]);
  },

  async updateExecution(
    id: string,
    update: DelegationLogExecutionUpdate
  ): Promise<void> {
    await query(
      `UPDATE delegation_logs SET
        execution_status   = $1,
        execution_correct  = $2,
        error_message      = $3,
        model_used         = $4,
        latency_ms         = $5,
        cost_usd           = $6,
        exec_input_tokens  = $7,
        cost_saved_vs_slow = $8,
        executed_at        = NOW(),
        routing_success    = $9,
        value_success      = $10,
        user_success       = $11
       WHERE id = $12`,
      [
        update.execution_status,
        update.execution_correct ?? null,
        update.error_message ?? null,
        update.model_used ?? null,
        update.latency_ms ?? null,
        update.cost_usd ?? null,
        update.exec_input_tokens ?? null,
        update.cost_saved_vs_slow ?? null,
        update.routing_success ?? null,
        update.value_success ?? null,
        update.user_success ?? null,
        id,
      ]
    );
  },

  async listByUser(
    userId: string,
    limit = 100,
    offset = 0
  ): Promise<DelegationLog[]> {
    const result = await query(
      `SELECT * FROM delegation_logs
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return result.rows.map(mapDelegationLogRow);
  },

  async listBySession(sessionId: string): Promise<DelegationLog[]> {
    const result = await query(
      `SELECT * FROM delegation_logs
       WHERE session_id = $1
       ORDER BY turn_id ASC`,
      [sessionId]
    );
    return result.rows.map(mapDelegationLogRow);
  },

  async getActionStats(
    userId: string,
    field: "routed_action" | "g2_final_action" | "g3_final_action",
    since?: Date
  ): Promise<Record<string, number>> {
    const sinceClause = since ? `AND created_at >= '${since.toISOString()}'` : "";
    const result = await query(
      `SELECT ${field}, COUNT(*)::int as count
       FROM delegation_logs
       WHERE user_id = $1 ${sinceClause}
       GROUP BY ${field}
       ORDER BY count DESC`,
      [userId]
    );
    return Object.fromEntries(result.rows.map((r) => [r[field], r.count]));
  },

  async getRerankStats(userId: string): Promise<{
    total: number;
    rerank_count: number;
    rerank_rate: number;
    corrected_count: number;
    correction_rate: number;
  }> {
    const result = await query(
      `SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE did_rerank = true)::int as rerank_count,
        COUNT(*) FILTER (WHERE did_rerank = true AND g2_final_action != g3_final_action)::int as corrected_count
       FROM delegation_logs
       WHERE user_id = $1 AND execution_status IS NOT NULL`,
      [userId]
    );
    const row = result.rows[0];
    return {
      total: row.total,
      rerank_count: row.rerank_count,
      rerank_rate: row.total > 0 ? row.rerank_count / row.total : 0,
      corrected_count: row.corrected_count,
      correction_rate: row.rerank_count > 0 ? row.corrected_count / row.rerank_count : 0,
    };
  },

  async getBenchmarkMetrics(userId: string): Promise<{
    total_decisions: number;
    action_distribution: Record<string, number>;
    execution_success_rate: number;
    avg_latency_ms: number;
    avg_cost_usd: number;
    rerank_stats: { rate: number; correction_rate: number };
    routing_agreement_rate: number;
    routing_success_rate: number;
    execution_correct_rate: number;
    value_success_rate: number;
    user_success_rate: number;
  }> {
    const result = await query(
      `WITH exec AS (
        SELECT
          COUNT(*)::int as total,
          COUNT(*) FILTER (WHERE execution_status = 'success')::int as success_count,
          AVG(latency_ms)::int as avg_latency,
          AVG(cost_usd)::float as avg_cost
        FROM delegation_logs
        WHERE user_id = $1 AND execution_status IS NOT NULL
      ),
      rerank AS (
        SELECT
          COUNT(*) FILTER (WHERE did_rerank = true)::int as rerank_count,
          COUNT(*) FILTER (WHERE did_rerank = true AND g2_final_action = g3_final_action)::int as agreed_count
        FROM delegation_logs WHERE user_id = $1
      ),
      g4 AS (
        SELECT
          COUNT(*) FILTER (WHERE routing_success = true)::int    as routing_ok,
          COUNT(*) FILTER (WHERE routing_success IS NOT NULL)::int as routing_total,
          COUNT(*) FILTER (WHERE execution_correct = true)::int  as exec_ok,
          COUNT(*) FILTER (WHERE execution_correct IS NOT NULL)::int as exec_total,
          COUNT(*) FILTER (WHERE value_success = 'better')::int  as value_ok,
          COUNT(*) FILTER (WHERE value_success IS NOT NULL)::int as value_total,
          COUNT(*) FILTER (WHERE user_success = true)::int       as user_ok,
          COUNT(*) FILTER (WHERE user_success IS NOT NULL)::int as user_total
        FROM delegation_logs WHERE user_id = $1
      )
      SELECT
        exec.total,
        exec.success_count,
        exec.avg_latency,
        exec.avg_cost,
        exec.success_count::float / NULLIF(exec.total, 0) as success_rate,
        rerank.rerank_count,
        rerank.agreed_count,
        rerank.rerank_count::float / NULLIF(exec.total, 0) as rerank_rate,
        (rerank.rerank_count - rerank.agreed_count)::float / NULLIF(rerank.rerank_count, 0) as correction_rate,
        rerank.agreed_count::float / NULLIF(rerank.rerank_count, 0) as agreement_rate,
        g4.routing_ok::float  / NULLIF(g4.routing_total, 0) as routing_success_rate,
        g4.exec_ok::float     / NULLIF(g4.exec_total,     0) as execution_correct_rate,
        g4.value_ok::float    / NULLIF(g4.value_total,    0) as value_success_rate,
        g4.user_ok::float    / NULLIF(g4.user_total,     0) as user_success_rate
      FROM exec, rerank, g4`,
      [userId]
    );
    const row = result.rows[0];

    const actionResult = await query(
      `SELECT routed_action, COUNT(*)::int as cnt
       FROM delegation_logs WHERE user_id = $1 GROUP BY routed_action`,
      [userId]
    );

    return {
      total_decisions: row.total ?? 0,
      action_distribution: Object.fromEntries(actionResult.rows.map((r) => [r.routed_action, r.cnt])),
      execution_success_rate: row.success_rate ?? 0,
      avg_latency_ms: row.avg_latency ?? 0,
      avg_cost_usd: row.avg_cost ?? 0,
      rerank_stats: {
        rate: row.rerank_rate ?? 0,
        correction_rate: row.correction_rate ?? 0,
      },
      routing_agreement_rate: row.agreement_rate ?? 1,
      routing_success_rate: row.routing_success_rate ?? 0,
      execution_correct_rate: row.execution_correct_rate ?? 0,
      value_success_rate: row.value_success_rate ?? 0,
      user_success_rate: row.user_success_rate ?? 0,
    };
  },
};
