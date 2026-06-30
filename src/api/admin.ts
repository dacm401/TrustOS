/**
 * S98P: Admin API — Health, Usage & Error Monitoring
 *
 * Endpoints:
 *   GET /api/admin/health   — DB connectivity, active workers, pending tasks
 *   GET /api/admin/usage    — Today's user/session/task/cost aggregation
 *   GET /api/admin/errors   — Recent error aggregation
 *
 * All endpoints protected by X-Admin-Key header (via adminAuthMiddleware).
 */

import { Hono } from "hono";
import { adminAuthMiddleware } from "../middleware/admin-auth.js";
import { query } from "../db/connection.js";

const adminRouter = new Hono();

// Apply admin auth to all routes
adminRouter.use("/*", adminAuthMiddleware);

// ── Health ──────────────────────────────────────────────────────────────────

adminRouter.get("/health", async (c) => {
  const checks: Record<string, { status: string; latencyMs?: number; detail?: string }> = {};

  // DB check
  try {
    const start = Date.now();
    await query("SELECT 1");
    checks.db = { status: "ok", latencyMs: Date.now() - start };
  } catch (err: any) {
    checks.db = { status: "down", detail: err.message };
  }

  // Active workers (tasks in 'processing' or 'responding' state)
  try {
    const activeRes = await query(
      `SELECT COUNT(*)::int AS active FROM tasks WHERE status IN ('processing', 'responding')`
    );
    checks.activeWorkers = { status: "ok", detail: String(activeRes.rows[0]?.active ?? 0) };
  } catch (err: any) {
    checks.activeWorkers = { status: "error", detail: err.message };
  }

  // Pending tasks (queued, not yet started)
  try {
    const pendingRes = await query(
      `SELECT COUNT(*)::int AS pending FROM tasks WHERE status = 'pending'`
    );
    checks.pendingTasks = { status: "ok", detail: String(pendingRes.rows[0]?.pending ?? 0) };
  } catch (err: any) {
    checks.pendingTasks = { status: "error", detail: err.message };
  }

  const allOk = Object.values(checks).every((v) => v.status === "ok");
  return c.json({
    status: allOk ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    checks,
  });
});

// ── Usage ───────────────────────────────────────────────────────────────────

adminRouter.get("/usage", async (c) => {
  const today = new Date().toISOString().slice(0, 10);
  const days = parseInt(c.req.query("days") || "7");

  try {
    // Today's snapshot
    const todayRes = await query(
      `SELECT
        (SELECT COUNT(DISTINCT user_id)::int FROM sessions WHERE created_at::date = $1::date) AS active_users,
        (SELECT COUNT(*)::int FROM sessions WHERE created_at::date = $1::date) AS sessions,
        (SELECT COUNT(*)::int FROM tasks WHERE created_at::date = $1::date) AS tasks,
        (SELECT COALESCE(SUM(total_cost_usd), 0)::float FROM decision_logs WHERE created_at::date = $1::date) AS cost_usd,
        (SELECT COALESCE(SUM(exec_input_tokens), 0)::bigint FROM decision_logs WHERE created_at::date = $1::date) AS input_tokens,
        (SELECT COALESCE(SUM(exec_output_tokens), 0)::bigint FROM decision_logs WHERE created_at::date = $1::date) AS output_tokens
      `,
      [today]
    );
    const todayStats = todayRes.rows[0];

    // Daily trend (last N days)
    const trendRes = await query(
      `SELECT
        d::date AS day,
        COALESCE(s.sessions, 0)::int AS sessions,
        COALESCE(t.tasks, 0)::int AS tasks,
        COALESCE(dl.cost_usd, 0)::float AS cost_usd
       FROM generate_series($1::date, $2::date, '1 day'::interval) AS d
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS sessions FROM sessions WHERE created_at::date = d::date
       ) s ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS tasks FROM tasks WHERE created_at::date = d::date
       ) t ON true
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(total_cost_usd), 0) AS cost_usd FROM decision_logs WHERE created_at::date = d::date
       ) dl ON true
       ORDER BY d::date DESC`,
      [today, today]
    );

    // Top users by cost (today)
    const topUsersRes = await query(
      `SELECT user_id, COUNT(*)::int AS tasks,
         COALESCE(SUM(total_cost_usd), 0)::float AS cost_usd
       FROM decision_logs
       WHERE created_at::date = $1::date
       GROUP BY user_id
       ORDER BY cost_usd DESC
       LIMIT 10`,
      [today]
    );

    return c.json({
      today: {
        date: today,
        activeUsers: todayStats.active_users ?? 0,
        sessions: todayStats.sessions ?? 0,
        tasks: todayStats.tasks ?? 0,
        costUsd: Number((todayStats.cost_usd ?? 0).toFixed(4)),
        inputTokens: Number(todayStats.input_tokens ?? 0),
        outputTokens: Number(todayStats.output_tokens ?? 0),
      },
      trend: trendRes.rows.map((r: any) => ({
        day: r.day.toISOString().slice(0, 10),
        sessions: r.sessions,
        tasks: r.tasks,
        costUsd: Number(r.cost_usd.toFixed(4)),
      })),
      topUsers: topUsersRes.rows.map((r: any) => ({
        userId: r.user_id,
        tasks: r.tasks,
        costUsd: Number(r.cost_usd.toFixed(4)),
      })),
    });
  } catch (err: any) {
    return c.json({ error: "Failed to fetch usage stats", detail: err.message }, 500);
  }
});

// ── Errors ──────────────────────────────────────────────────────────────────

adminRouter.get("/errors", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 100);
  const today = new Date().toISOString().slice(0, 10);

  try {
    // Failed/cancelled/timed_out tasks today
    const failedTasksRes = await query(
      `SELECT id AS task_id, user_id, session_id, status,
         goal,
         EXTRACT(EPOCH FROM (updated_at - created_at))::float AS duration_seconds,
         created_at
       FROM tasks
       WHERE status IN ('failed', 'cancelled', 'timed_out')
         AND created_at::date = $1::date
       ORDER BY created_at DESC
       LIMIT $2`,
      [today, limit]
    );

    // Error type aggregation
    const errorAggRes = await query(
      `SELECT status, COUNT(*)::int AS count
       FROM tasks
       WHERE status IN ('failed', 'cancelled', 'timed_out')
         AND created_at::date = $1::date
       GROUP BY status`,
      [today]
    );

    return c.json({
      date: today,
      summary: errorAggRes.rows.reduce(
        (acc: Record<string, number>, r: any) => {
          acc[r.status] = r.count;
          return acc;
        },
        {} as Record<string, number>
      ),
      recent: failedTasksRes.rows.map((r: any) => ({
        taskId: r.task_id,
        userId: r.user_id,
        sessionId: r.session_id,
        status: r.status,
        goal: r.goal?.slice(0, 200) ?? null,
        durationSeconds: r.duration_seconds,
        createdAt: r.created_at,
      })),
    });
  } catch (err: any) {
    return c.json({ error: "Failed to fetch error stats", detail: err.message }, 500);
  }
});

export { adminRouter };
