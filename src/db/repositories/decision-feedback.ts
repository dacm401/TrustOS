import { v4 as uuid } from "uuid";
import { query } from "../connection.js";
import type { DecisionRecord } from "../../types/index.js";

// ── DecisionRepo ─────────────────────────────────────────────────────────────

export const DecisionRepo = {
  async save(d: DecisionRecord): Promise<void> {
    await query(
      `INSERT INTO decision_logs (
        id, user_id, session_id, query_preview, intent, complexity_score,
        input_token_count, has_code, has_math,
        router_version, fast_score, slow_score, confidence,
        selected_model, selected_role, selection_reason,
        context_original_tokens, context_compressed_tokens,
        compression_level, compression_ratio,
        model_used, exec_input_tokens, exec_output_tokens,
        total_cost_usd, latency_ms, did_fallback, fallback_reason
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
      [
        d.id, d.user_id, d.session_id,
        d.input_features.raw_query.substring(0, 200),
        d.input_features.intent, d.input_features.complexity_score,
        d.input_features.token_count, d.input_features.has_code, d.input_features.has_math,
        d.routing.router_version, d.routing.scores.fast, d.routing.scores.slow,
        d.routing.confidence, d.routing.selected_model, d.routing.selected_role,
        d.routing.selection_reason, d.context.original_tokens, d.context.compressed_tokens,
        d.context.compression_level, d.context.compression_ratio,
        d.execution.model_used, d.execution.input_tokens, d.execution.output_tokens,
        d.execution.total_cost_usd, d.execution.latency_ms, d.execution.did_fallback,
        d.execution.fallback_reason || null,
      ]
    );
  },

  async updateFeedback(id: string, feedbackType: string, feedbackScore: number): Promise<void> {
    await query(`UPDATE decision_logs SET feedback_type=$1, feedback_score=$2 WHERE id=$3`, [feedbackType, feedbackScore, id]);
  },

  async getRecent(userId: string, limit = 20): Promise<any[]> {
    const result = await query(`SELECT * FROM decision_logs WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`, [userId, limit]);
    return result.rows;
  },

  async getById(id: string): Promise<{ id: string; user_id: string } | null> {
    const result = await query(`SELECT id, user_id FROM decision_logs WHERE id=$1`, [id]);
    if (result.rows.length === 0) return null;
    return result.rows[0];
  },

  /** Get the latest decision log for a task (ordered by created_at DESC) */
  async getByTaskId(taskId: string): Promise<any | null> {
    const taskResult = await query(`SELECT session_id FROM tasks WHERE id=$1`, [taskId]);
    if (taskResult.rows.length === 0) return null;
    const sessionId = taskResult.rows[0].session_id;
    if (!sessionId) return null;
    const result = await query(
      `SELECT * FROM decision_logs WHERE session_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [sessionId],
    );
    if (result.rows.length === 0) return null;
    return result.rows[0];
  },

  async getTodayStats(userId: string): Promise<any> {
    const result = await query(
      `WITH base AS (
        SELECT
          d.id,
          d.selected_role,
          d.did_fallback,
          d.exec_input_tokens,
          d.exec_output_tokens,
          d.total_cost_usd,
          d.cost_saved_vs_slow,
          d.latency_ms,
          d.feedback_score,
          fe.signal_level,
          fe.event_type,
          CASE
            WHEN fe.signal_level = 1 THEN true
            WHEN fe.signal_level IS NULL AND d.feedback_score IS NOT NULL THEN true
            ELSE false
          END AS is_l1,
          CASE
            WHEN fe.signal_level = 1 AND fe.event_type IN ('thumbs_up', 'regenerated') THEN true
            WHEN fe.signal_level IS NULL AND d.feedback_score >= 1 THEN true
            ELSE false
          END AS is_positive
        FROM decision_logs d
        LEFT JOIN feedback_events fe ON fe.decision_id = d.id AND fe.user_id = d.user_id
        WHERE d.user_id = $1
          AND d.created_at >= (CURRENT_DATE AT TIME ZONE 'Asia/Shanghai')::timestamptz
      )
      SELECT
        COUNT(*)::int                                                                    AS total_requests,
        COUNT(*) FILTER (WHERE selected_role = 'fast')::int                               AS fast_count,
        COUNT(*) FILTER (WHERE selected_role = 'slow')::int                               AS slow_count,
        COUNT(*) FILTER (WHERE did_fallback)::int                                        AS fallback_count,
        COALESCE(SUM(COALESCE(exec_input_tokens, 0) + COALESCE(exec_output_tokens, 0)), 0)::int AS total_tokens,
        COALESCE(SUM(total_cost_usd), 0)::float                                         AS total_cost,
        COALESCE(SUM(cost_saved_vs_slow), 0)::float                                     AS saved_cost,
        COALESCE(AVG(latency_ms), 0)::int                                               AS avg_latency,
        COALESCE(
          ROUND(
            COUNT(*) FILTER (WHERE is_l1 AND is_positive)::float /
            NULLIF(COUNT(*) FILTER (WHERE is_l1), 0)::float * 100
          ), 0
        )::int                                                                           AS satisfaction_rate
      FROM base`,
      [userId]
    );
    return result.rows[0];
  },

  async getRoutingAccuracyHistory(userId: string, days = 30): Promise<{ date: string; value: number }[]> {
    const result = await query(
      `WITH base AS (
        SELECT
          d.id,
          d.created_at::date as date,
          d.feedback_score,
          CASE
            WHEN fe.signal_level = 1 THEN true
            WHEN fe.signal_level IS NULL AND d.feedback_score IS NOT NULL THEN true
            ELSE false
          END as has_l1_signal
        FROM decision_logs d
        LEFT JOIN feedback_events fe ON fe.decision_id = d.id AND fe.user_id = d.user_id
        WHERE d.user_id = $1 AND d.created_at >= CURRENT_DATE - $2::int
      )
      SELECT
        date,
        CASE WHEN COUNT(*) FILTER (WHERE has_l1_signal = true) > 0
          THEN ROUND(
            COUNT(*) FILTER (WHERE has_l1_signal = true AND base.feedback_score > 0)::float /
            COUNT(*) FILTER (WHERE has_l1_signal = true)::float * 100
          )
          ELSE NULL END as value
      FROM base
      GROUP BY date
      ORDER BY date`,
      [userId, days]
    );
    return result.rows
      .filter((r: any) => r.value !== null)
      .map((r: any) => ({ date: r.date.toISOString().split("T")[0], value: Number(r.value) }));
  },

  async getCostStats(userId: string): Promise<{
    total_spent_usd: number;
    baseline_spent_usd: number;
    saved_usd: number;
    saved_percent: number;
    task_count: number;
    period_days: number;
  }> {
    const { calcBaselineCost } = await import("../../config/pricing.js");

    const result = await query(
      `SELECT
        COUNT(*)::int as task_count,
        COALESCE(SUM(exec_input_tokens), 0)::int as total_input_tokens,
        COALESCE(SUM(exec_output_tokens), 0)::int as total_output_tokens,
        COALESCE(SUM(total_cost_usd), 0)::float as total_spent_usd
      FROM decision_logs
      WHERE user_id = $1
        AND created_at >= NOW() - INTERVAL '30 days'
        AND exec_input_tokens IS NOT NULL`,
      [userId],
    );

    const row = result.rows[0] ?? {
      task_count: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_spent_usd: 0,
    };

    const baseline_spent_usd = calcBaselineCost(
      Number(row.total_input_tokens),
      Number(row.total_output_tokens),
    );
    const saved_usd = Math.max(0, baseline_spent_usd - Number(row.total_spent_usd));
    const saved_percent =
      baseline_spent_usd > 0
        ? Math.round((saved_usd / baseline_spent_usd) * 100)
        : 0;

    return {
      total_spent_usd: Number(row.total_spent_usd),
      baseline_spent_usd,
      saved_usd,
      saved_percent,
      task_count: row.task_count,
      period_days: 30,
    };
  },
};

// ── FeedbackEventRepo ─────────────────────────────────────────────────────────

export interface FeedbackEvent {
  id: string;
  decision_id: string;
  user_id: string;
  event_type: string;
  signal_level: number;
  source: "ui" | "auto_detect" | "system";
  raw_data: Record<string, unknown> | null;
  created_at: Date;
}

const SIGNAL_CONFIG: Record<string, { signal_level: number; source: "ui" | "auto_detect" | "system" }> = {
  thumbs_up:        { signal_level: 1, source: "ui" },
  thumbs_down:      { signal_level: 1, source: "ui" },
  follow_up_thanks: { signal_level: 2, source: "auto_detect" },
  follow_up_doubt:  { signal_level: 2, source: "auto_detect" },
  regenerated:      { signal_level: 3, source: "auto_detect" },
  edited:           { signal_level: 3, source: "system" },
  accepted:         { signal_level: 1, source: "system" },
};

export const FeedbackEventRepo = {
  async save(event: {
    decisionId: string;
    userId: string;
    eventType: string;
    rawData?: Record<string, unknown>;
  }): Promise<void> {
    const config = SIGNAL_CONFIG[event.eventType] ?? { signal_level: 3, source: "system" as const };
    await query(
      `INSERT INTO feedback_events (id, decision_id, user_id, event_type, signal_level, source, raw_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [uuid(), event.decisionId, event.userId, event.eventType, config.signal_level, config.source, event.rawData ? JSON.stringify(event.rawData) : null]
    );
  },

  async getByDecisionIds(userId: string, decisionIds: string[]): Promise<Map<string, number>> {
    if (decisionIds.length === 0) return new Map();
    const result = await query(
      `SELECT decision_id, signal_level
       FROM feedback_events
       WHERE user_id = $1 AND decision_id = ANY($2)`,
      [userId, decisionIds]
    );
    const map = new Map<string, number>();
    for (const row of result.rows) {
      const existing = map.get(row.decision_id);
      if (existing === undefined || row.signal_level < existing) {
        map.set(row.decision_id, Number(row.signal_level));
      }
    }
    return map;
  },
};
