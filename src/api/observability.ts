/**
 * S94P: Observability API — Private Beta Readiness
 *
 * 提供系统可观测性数据给前端 Dashboard：
 * - GET /v1/observability/summary — 总请求数、成功率、平均延迟、P95、今日成本
 * - GET /v1/observability/errors  — 按 provider 错误类型分组统计
 */

import { Hono } from "hono";
import { getContextUserId } from "../middleware/identity.js";
import { config } from "../config.js";

export const observabilityRouter = new Hono();

// GET /v1/observability/summary
observabilityRouter.get("/summary", async (c) => {
  const userId = getContextUserId(c)!;

  try {
    const { query } = await import("../db/connection.js");

    // 1. 总请求数 & 成功率（过去 24h）
    const statsResult = await query(
      `SELECT
         COUNT(*)::int as total_requests,
         COUNT(*) FILTER (WHERE status IN ('done','completed'))::int as success_count,
         COUNT(*) FILTER (WHERE status = 'failed')::int as failure_count,
         COUNT(*) FILTER (WHERE status = 'cancelled')::int as cancelled_count,
         COALESCE(AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) FILTER (WHERE status IN ('done','completed')), 0)::float as avg_duration_sec,
         COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (updated_at - created_at))) FILTER (WHERE status IN ('done','completed')), 0)::float as p95_duration_sec
       FROM task_archives
       WHERE user_id = $1
         AND created_at > NOW() - INTERVAL '24 hours'`,
      [userId]
    );

    const stats = statsResult.rows[0] || {};

    // 2. 今日成本
    const costResult = await query(
      `SELECT COALESCE(SUM(total_cost_usd), 0)::float as total_cost_usd
       FROM decision_logs
       WHERE user_id = $1
         AND created_at > CURRENT_DATE`,
      [userId]
    );

    const todayCost = parseFloat(costResult.rows[0]?.total_cost_usd ?? "0");

    // 3. 今日 token 消耗
    const tokenResult = await query(
      `SELECT
         COALESCE(SUM(exec_input_tokens), 0)::bigint as input_tokens,
         COALESCE(SUM(exec_output_tokens), 0)::bigint as output_tokens
       FROM decision_logs
       WHERE user_id = $1
         AND created_at > CURRENT_DATE`,
      [userId]
    );

    // 4. 活跃会话数
    const sessionResult = await query(
      `SELECT COUNT(*)::int as active_sessions
       FROM sessions
       WHERE user_id = $1
         AND updated_at > NOW() - INTERVAL '24 hours'`,
      [userId]
    );

    // 5. 系统健康检查
    const dbResult = await query("SELECT 1");
    const dbHealthy = dbResult.rows.length > 0;
    const llmHealthy = Boolean(config.openaiApiKey && config.openaiApiKey !== "dummy");

    const total = stats.total_requests || 0;
    const success = stats.success_count || 0;
    const successRate = total > 0 ? (success / total) * 100 : 100;

    return c.json({
      summary: {
        total_requests_24h: total,
        success_count_24h: success,
        failure_count_24h: stats.failure_count || 0,
        cancelled_count_24h: stats.cancelled_count || 0,
        success_rate_pct: Math.round(successRate * 100) / 100,
        avg_duration_sec: Math.round((stats.avg_duration_sec || 0) * 100) / 100,
        p95_duration_sec: Math.round((stats.p95_duration_sec || 0) * 100) / 100,
      },
      cost: {
        today_cost_usd: Math.round(todayCost * 10000) / 10000,
        today_input_tokens: Number(tokenResult.rows[0]?.input_tokens ?? 0),
        today_output_tokens: Number(tokenResult.rows[0]?.output_tokens ?? 0),
      },
      sessions: {
        active_24h: sessionResult.rows[0]?.active_sessions || 0,
      },
      health: {
        database: dbHealthy ? "healthy" : "unhealthy",
        llm_api: llmHealthy ? "healthy" : "unhealthy",
        overall: dbHealthy && llmHealthy ? "healthy" : "degraded",
      },
    });
  } catch (error: any) {
    console.error("[S94P] Observability summary error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// GET /v1/observability/errors — 按 provider 错误类型分组统计（过去 24h）
observabilityRouter.get("/errors", async (c) => {
  const userId = getContextUserId(c)!;

  try {
    const { query } = await import("../db/connection.js");

    const result = await query(
      `SELECT
         COALESCE(slow_execution->>'errors', '[]') as error_data,
         status,
         created_at
       FROM task_archives
       WHERE user_id = $1
         AND status = 'failed'
         AND created_at > NOW() - INTERVAL '24 hours'
       ORDER BY created_at DESC
       LIMIT 100`,
      [userId]
    );

    // Aggregate error types
    const errorCounts: Record<string, number> = {};
    for (const row of result.rows) {
      try {
        const errors = JSON.parse(row.error_data || "[]");
        for (const err of errors) {
          const type = err?.type || err?.code || "unknown";
          errorCounts[type] = (errorCounts[type] || 0) + 1;
        }
      } catch {
        errorCounts["parse_error"] = (errorCounts["parse_error"] || 0) + 1;
      }
    }

    // Also check decision_logs for provider error patterns
    const dlResult = await query(
      `SELECT fallback_reason, COUNT(*)::int as cnt
       FROM decision_logs
       WHERE user_id = $1
         AND did_fallback = TRUE
         AND created_at > NOW() - INTERVAL '24 hours'
       GROUP BY fallback_reason
       ORDER BY cnt DESC`,
      [userId]
    );

    const fallbackErrors = dlResult.rows.map((r: any) => ({
      reason: r.fallback_reason || "unknown",
      count: r.cnt,
    }));

    return c.json({
      period: "24h",
      task_errors: Object.entries(errorCounts).map(([type, count]) => ({ type, count })),
      fallback_errors: fallbackErrors,
      total_errors_24h: result.rows.length,
    });
  } catch (error: any) {
    console.error("[S94P] Observability errors error:", error);
    return c.json({ error: error.message }, 500);
  }
});
