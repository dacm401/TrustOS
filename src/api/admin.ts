/**
 * S98P/S99P: Admin API — Health, Usage, Error, Feedback Triage, Daily Ops & Alerts
 *
 * Endpoints:
 *   S98P (existing):
 *     GET /v1/admin/health          — DB connectivity, active workers, pending tasks
 *     GET /v1/admin/usage           — Today's user/session/task/cost aggregation
 *     GET /v1/admin/errors          — Recent error aggregation
 *
 *   S99P (new) — Feedback Triage:
 *     GET /v1/admin/feedback        — List feedback with triage filters
 *     GET /v1/admin/feedback/:id    — Single feedback detail (linked to user/session/task/decision)
 *     PATCH /v1/admin/feedback/:id  — Update triage status, severity, add notes
 *
 *   S99P (new) — Daily Ops:
 *     GET /v1/admin/daily-summary   — Daily users/sessions/tasks/feedback/cost summary
 *     GET /v1/admin/cost-trend      — Per-user daily cost trend
 *     GET /v1/admin/satisfaction-trend — Daily satisfaction ratio trend
 *     GET /v1/admin/failure-reasons — Top thumbs_down reason keywords
 *
 *   S99P (new) — Alerts:
 *     GET /v1/admin/alerts          — List recent alerts
 *     PATCH /v1/admin/alerts/:id/ack — Acknowledge an alert
 *
 *   S99P (new) — User Management:
 *     GET /v1/admin/users           — List beta users
 *     PATCH /v1/admin/users/:id/notes — Update user notes
 *     PATCH /v1/admin/users/:id/status — Set user status (active/paused/blocked)
 *
 *   S99P (new) — Export:
 *     GET /v1/admin/export          — Export CSV (type=users|feedback|cost)
 *
 * All endpoints protected by X-Admin-Key header (via adminAuthMiddleware).
 */

import { Hono } from "hono";
import { adminAuthMiddleware } from "../middleware/admin-auth.js";
import { query } from "../db/connection.js";
import { v4 as uuid } from "uuid";

const adminRouter = new Hono();

// Apply admin auth to all routes
adminRouter.use("/*", adminAuthMiddleware);

// ── Health (S98P) ────────────────────────────────────────────────────────────

adminRouter.get("/health", async (c) => {
  const checks: Record<string, { status: string; latencyMs?: number; detail?: string }> = {};

  try {
    const start = Date.now();
    await query("SELECT 1");
    checks.db = { status: "ok", latencyMs: Date.now() - start };
  } catch (err: any) {
    checks.db = { status: "down", detail: err.message };
  }

  try {
    const activeRes = await query(
      `SELECT COUNT(*)::int AS active FROM tasks WHERE status IN ('processing', 'responding')`
    );
    checks.activeWorkers = { status: "ok", detail: String(activeRes.rows[0]?.active ?? 0) };
  } catch (err: any) {
    checks.activeWorkers = { status: "error", detail: err.message };
  }

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

// ── Usage (S98P) ─────────────────────────────────────────────────────────────

adminRouter.get("/usage", async (c) => {
  const today = new Date().toISOString().slice(0, 10);

  try {
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

// ── Errors (S98P) ────────────────────────────────────────────────────────────

adminRouter.get("/errors", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 100);
  const today = new Date().toISOString().slice(0, 10);

  try {
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

// ══════════════════════════════════════════════════════════════════════════════
// S99P: Feedback Triage
// ══════════════════════════════════════════════════════════════════════════════

const VALID_TRIAGE_STATUSES = ["open", "investigating", "resolved", "wontfix"];
const VALID_SEVERITIES = ["low", "medium", "high", "blocker"];

// GET /v1/admin/feedback — list feedback with filters
adminRouter.get("/feedback", async (c) => {
  const status = c.req.query("status");
  const severity = c.req.query("severity");
  const eventType = c.req.query("event_type");
  const limit = Math.min(parseInt(c.req.query("limit") || "50"), 200);
  const offset = parseInt(c.req.query("offset") || "0");
  const date = c.req.query("date"); // YYYY-MM-DD

  try {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIdx = 0;

    if (status && VALID_TRIAGE_STATUSES.includes(status)) {
      paramIdx++;
      conditions.push(`fe.raw_data->'triage'->>'status' = $${paramIdx}`);
      params.push(status);
    }
    if (severity && VALID_SEVERITIES.includes(severity)) {
      paramIdx++;
      conditions.push(`fe.raw_data->'triage'->>'severity' = $${paramIdx}`);
      params.push(severity);
    }
    if (eventType) {
      paramIdx++;
      conditions.push(`fe.event_type = $${paramIdx}`);
      params.push(eventType);
    }
    if (date) {
      paramIdx++;
      conditions.push(`fe.created_at::date = $${paramIdx}::date`);
      params.push(date);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Count total
    const countRes = await query(
      `SELECT COUNT(*)::int AS total FROM feedback_events fe ${whereClause}`,
      params
    );
    const total = countRes.rows[0]?.total ?? 0;

    // Fetch page
    const pLimit = limit;
    const pOffset = offset;
    const dataRes = await query(
      `SELECT
        fe.id, fe.decision_id, fe.user_id, fe.event_type,
        fe.signal_level, fe.source, fe.raw_data, fe.created_at,
        d.query_preview, d.session_id,
        d.model_used, d.total_cost_usd
       FROM feedback_events fe
       LEFT JOIN decision_logs d ON fe.decision_id = d.id
       ${whereClause}
       ORDER BY fe.created_at DESC
       LIMIT $${paramIdx + 1} OFFSET $${paramIdx + 2}`,
      [...params, pLimit, pOffset]
    );

    return c.json({
      total,
      limit: pLimit,
      offset: pOffset,
      items: dataRes.rows.map((r: any) => ({
        id: r.id,
        decisionId: r.decision_id,
        userId: r.user_id,
        eventType: r.event_type,
        signalLevel: r.signal_level,
        source: r.source,
        triage: r.raw_data?.triage ?? { status: "open", severity: "low", notes: [] },
        reason: r.raw_data?.reason ?? null,
        queryPreview: r.query_preview,
        sessionId: r.session_id,
        modelUsed: r.model_used,
        costUsd: r.total_cost_usd ? Number(r.total_cost_usd) : null,
        createdAt: r.created_at,
      })),
    });
  } catch (err: any) {
    return c.json({ error: "Failed to fetch feedback", detail: err.message }, 500);
  }
});

// GET /v1/admin/feedback/:id — single feedback detail with full linkage
adminRouter.get("/feedback/:id", async (c) => {
  const feedbackId = c.req.param("id");

  try {
    const res = await query(
      `SELECT
        fe.id, fe.decision_id, fe.user_id, fe.event_type,
        fe.signal_level, fe.source, fe.raw_data, fe.created_at,
        d.query_preview, d.session_id, d.intent,
        d.model_used, d.exec_input_tokens, d.exec_output_tokens,
        d.total_cost_usd, d.latency_ms, d.did_fallback, d.fallback_reason,
        d.selected_model, d.selected_role, d.selection_reason,
        d.feedback_type, d.feedback_score
       FROM feedback_events fe
       LEFT JOIN decision_logs d ON fe.decision_id = d.id
       WHERE fe.id = $1`,
      [feedbackId]
    );

    if (res.rows.length === 0) {
      return c.json({ error: "Feedback not found" }, 404);
    }

    const fb = res.rows[0];

    // Get related tasks (via session_id from decision_logs)
    let relatedTasks: any[] = [];
    if (fb.session_id) {
      const tasksRes = await query(
        `SELECT id, title, status, goal, created_at
         FROM tasks
         WHERE session_id = $1
         ORDER BY created_at DESC
         LIMIT 20`,
        [fb.session_id]
      );
      relatedTasks = tasksRes.rows.map((t: any) => ({
        taskId: t.id,
        title: t.title,
        status: t.status,
        goal: t.goal?.slice(0, 200) ?? null,
        createdAt: t.created_at,
      }));
    }

    // Get session info
    let sessionInfo = null;
    if (fb.session_id) {
      const sessRes = await query(
        `SELECT id, user_id, created_at, updated_at FROM sessions WHERE id = $1`,
        [fb.session_id]
      );
      if (sessRes.rows.length > 0) {
        const s = sessRes.rows[0];
        sessionInfo = {
          sessionId: s.id,
          userId: s.user_id,
          createdAt: s.created_at,
          updatedAt: s.updated_at,
        };
      }
    }

    return c.json({
      id: fb.id,
      decisionId: fb.decision_id,
      userId: fb.user_id,
      eventType: fb.event_type,
      signalLevel: fb.signal_level,
      source: fb.source,
      triage: fb.raw_data?.triage ?? { status: "open", severity: "low", notes: [] },
      reason: fb.raw_data?.reason ?? null,
      createdAt: fb.created_at,
      decision: {
        queryPreview: fb.query_preview,
        intent: fb.intent,
        modelUsed: fb.model_used,
        selectedModel: fb.selected_model,
        selectedRole: fb.selected_role,
        selectionReason: fb.selection_reason,
        inputTokens: fb.exec_input_tokens,
        outputTokens: fb.exec_output_tokens,
        costUsd: fb.total_cost_usd ? Number(fb.total_cost_usd) : null,
        latencyMs: fb.latency_ms,
        didFallback: fb.did_fallback,
        fallbackReason: fb.fallback_reason,
        feedbackType: fb.feedback_type,
        feedbackScore: fb.feedback_score ? Number(fb.feedback_score) : null,
      },
      session: sessionInfo,
      relatedTasks,
    });
  } catch (err: any) {
    return c.json({ error: "Failed to fetch feedback detail", detail: err.message }, 500);
  }
});

// PATCH /v1/admin/feedback/:id — update triage status, severity, or add notes
adminRouter.patch("/feedback/:id", async (c) => {
  const feedbackId = c.req.param("id");

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { triage_status, severity, add_note, updated_by } = body;
  const author = updated_by || "admin";

  // Validate
  if (triage_status && !VALID_TRIAGE_STATUSES.includes(triage_status)) {
    return c.json({ error: `Invalid triage_status. Must be one of: ${VALID_TRIAGE_STATUSES.join(", ")}` }, 400);
  }
  if (severity && !VALID_SEVERITIES.includes(severity)) {
    return c.json({ error: `Invalid severity. Must be one of: ${VALID_SEVERITIES.join(", ")}` }, 400);
  }

  try {
    // Get current raw_data
    const currentRes = await query(
      `SELECT raw_data FROM feedback_events WHERE id = $1`,
      [feedbackId]
    );
    if (currentRes.rows.length === 0) {
      return c.json({ error: "Feedback not found" }, 404);
    }

    let rawData = currentRes.rows[0].raw_data || {};
    let triage = rawData.triage || { status: "open", severity: "low", notes: [] };

    const now = new Date().toISOString();

    if (triage_status) {
      triage.status = triage_status;
    }
    if (severity) {
      triage.severity = severity;
    }
    if (add_note && typeof add_note === "string" && add_note.trim()) {
      if (!Array.isArray(triage.notes)) triage.notes = [];
      triage.notes.push({ author, text: add_note.trim(), at: now });
    }

    triage.updated_at = now;
    triage.updated_by = author;

    rawData = { ...rawData, triage };

    await query(
      `UPDATE feedback_events SET raw_data = $1 WHERE id = $2`,
      [JSON.stringify(rawData), feedbackId]
    );

    return c.json({
      success: true,
      id: feedbackId,
      triage,
    });
  } catch (err: any) {
    return c.json({ error: "Failed to update feedback triage", detail: err.message }, 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// S99P: Daily Ops
// ══════════════════════════════════════════════════════════════════════════════

// GET /v1/admin/daily-summary — daily beta report summary
adminRouter.get("/daily-summary", async (c) => {
  const dateParam = c.req.query("date");
  const targetDate = dateParam || new Date().toISOString().slice(0, 10);

  try {
    // Users active that day
    const usersRes = await query(
      `SELECT COUNT(DISTINCT user_id)::int AS active_users
       FROM sessions WHERE created_at::date = $1::date`,
      [targetDate]
    );

    // Sessions created
    const sessionsRes = await query(
      `SELECT COUNT(*)::int AS total FROM sessions WHERE created_at::date = $1::date`,
      [targetDate]
    );

    // Tasks
    const tasksRes = await query(
      `SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
        COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
        COUNT(*) FILTER (WHERE status = 'timed_out')::int AS timed_out
       FROM tasks WHERE created_at::date = $1::date`,
      [targetDate]
    );

    // Feedback
    const feedbackRes = await query(
      `SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE event_type = 'thumbs_up')::int AS thumbs_up,
        COUNT(*) FILTER (WHERE event_type = 'thumbs_down')::int AS thumbs_down
       FROM feedback_events WHERE created_at::date = $1::date`,
      [targetDate]
    );

    // Cost
    const costRes = await query(
      `SELECT
        COALESCE(SUM(total_cost_usd), 0)::float AS total_cost,
        COALESCE(SUM(exec_input_tokens), 0)::bigint AS input_tokens,
        COALESCE(SUM(exec_output_tokens), 0)::bigint AS output_tokens
       FROM decision_logs WHERE created_at::date = $1::date`,
      [targetDate]
    );

    // Open feedback count
    const openFeedbackRes = await query(
      `SELECT COUNT(*)::int AS open_count
       FROM feedback_events
       WHERE raw_data->'triage'->>'status' = 'open'`,
      []
    );

    const fb = feedbackRes.rows[0] ?? { total: 0, thumbs_up: 0, thumbs_down: 0 };
    const tasks = tasksRes.rows[0] ?? { total: 0, completed: 0, failed: 0, cancelled: 0, timed_out: 0 };
    const cost = costRes.rows[0] ?? { total_cost: 0, input_tokens: 0, output_tokens: 0 };

    return c.json({
      date: targetDate,
      users: {
        active: usersRes.rows[0]?.active_users ?? 0,
      },
      sessions: {
        total: sessionsRes.rows[0]?.total ?? 0,
      },
      tasks: {
        total: tasks.total,
        completed: tasks.completed,
        failed: tasks.failed,
        cancelled: tasks.cancelled,
        timedOut: tasks.timed_out,
      },
      feedback: {
        total: fb.total,
        thumbsUp: fb.thumbs_up,
        thumbsDown: fb.thumbs_down,
        satisfactionRatio: fb.total > 0 ? Math.round((fb.thumbs_up / fb.total) * 100) : 0,
        openTriage: openFeedbackRes.rows[0]?.open_count ?? 0,
      },
      cost: {
        totalUsd: Number(Number(cost.total_cost).toFixed(4)),
        inputTokens: Number(cost.input_tokens),
        outputTokens: Number(cost.output_tokens),
      },
    });
  } catch (err: any) {
    return c.json({ error: "Failed to fetch daily summary", detail: err.message }, 500);
  }
});

// GET /v1/admin/cost-trend — per-user daily cost over N days
adminRouter.get("/cost-trend", async (c) => {
  const days = Math.min(parseInt(c.req.query("days") || "7"), 30);
  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);

  try {
    const res = await query(
      `SELECT
        d::date AS day,
        COALESCE(dl.total_cost, 0)::float AS cost_usd,
        COALESCE(dl.task_count, 0)::int AS tasks
       FROM generate_series($1::date, $2::date, '1 day'::interval) AS d
       LEFT JOIN LATERAL (
         SELECT
           COALESCE(SUM(total_cost_usd), 0) AS total_cost,
           COUNT(*) AS task_count
         FROM decision_logs
         WHERE created_at::date = d::date
       ) dl ON true
       ORDER BY d::date ASC`,
      [startDate, endDate]
    );

    // Per-user breakdown for most recent day
    const perUserRes = await query(
      `SELECT user_id,
         COALESCE(SUM(total_cost_usd), 0)::float AS cost_usd,
         COUNT(*)::int AS requests
       FROM decision_logs
       WHERE created_at::date = $1::date
       GROUP BY user_id
       ORDER BY cost_usd DESC
       LIMIT 20`,
      [endDate]
    );

    return c.json({
      startDate,
      endDate,
      days,
      daily: res.rows.map((r: any) => ({
        day: r.day.toISOString().slice(0, 10),
        costUsd: Number(r.cost_usd.toFixed(4)),
        tasks: r.tasks,
      })),
      perUser: perUserRes.rows.map((r: any) => ({
        userId: r.user_id,
        costUsd: Number(r.cost_usd.toFixed(4)),
        requests: r.requests,
      })),
    });
  } catch (err: any) {
    return c.json({ error: "Failed to fetch cost trend", detail: err.message }, 500);
  }
});

// GET /v1/admin/satisfaction-trend — daily thumbs_up / thumbs_down ratio
adminRouter.get("/satisfaction-trend", async (c) => {
  const days = Math.min(parseInt(c.req.query("days") || "7"), 30);
  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);

  try {
    const res = await query(
      `SELECT
        d::date AS day,
        COALESCE(fb.total, 0)::int AS total,
        COALESCE(fb.thumbs_up, 0)::int AS thumbs_up,
        COALESCE(fb.thumbs_down, 0)::int AS thumbs_down
       FROM generate_series($1::date, $2::date, '1 day'::interval) AS d
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE event_type = 'thumbs_up') AS thumbs_up,
           COUNT(*) FILTER (WHERE event_type = 'thumbs_down') AS thumbs_down
         FROM feedback_events
         WHERE created_at::date = d::date
       ) fb ON true
       ORDER BY d::date ASC`,
      [startDate, endDate]
    );

    return c.json({
      startDate,
      endDate,
      days,
      daily: res.rows.map((r: any) => ({
        day: r.day.toISOString().slice(0, 10),
        total: r.total,
        thumbsUp: r.thumbs_up,
        thumbsDown: r.thumbs_down,
        satisfactionRatio: r.total > 0 ? Math.round((r.thumbs_up / r.total) * 100) : 0,
      })),
    });
  } catch (err: any) {
    return c.json({ error: "Failed to fetch satisfaction trend", detail: err.message }, 500);
  }
});

// GET /v1/admin/failure-reasons — aggregate thumbs_down reasons
adminRouter.get("/failure-reasons", async (c) => {
  const days = Math.min(parseInt(c.req.query("days") || "7"), 30);
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 50);

  try {
    // Get all thumbs_down events with reasons in the time window
    const res = await query(
      `SELECT fe.raw_data->>'reason' AS reason, fe.created_at, d.query_preview
       FROM feedback_events fe
       LEFT JOIN decision_logs d ON fe.decision_id = d.id
       WHERE fe.event_type = 'thumbs_down'
         AND fe.created_at >= NOW() - ($1 || ' days')::interval
         AND fe.raw_data->>'reason' IS NOT NULL
         AND fe.raw_data->>'reason' != ''
       ORDER BY fe.created_at DESC
       LIMIT 500`,
      [String(days)]
    );

    // Simple keyword extraction: split by common delimiters, count freq
    const keywordCount: Record<string, number> = {};
    const stopWords = new Set([
      "the", "a", "an", "is", "are", "was", "were", "it", "to", "of", "in",
      "for", "on", "and", "or", "but", "not", "this", "that", "with", "as",
      "be", "has", "have", "do", "does", "did", "will", "would", "could",
      "should", "may", "might", "can", "shall", "i", "me", "my", "we", "our",
      "you", "your", "he", "she", "they", "them", "很", "的", "了", "是", "不",
      "我", "这", "那", "有", "在", "和", "就", "都", "也", "要", "会", "可",
      "没", "吗", "吧", "呢", "啊", "哦", "嗯",
    ]);

    for (const row of res.rows) {
      const reason = (row.reason || "").toLowerCase();
      const words = reason.split(/[\s,，。.!！?？;；:：、]+/).filter(Boolean);
      for (const word of words) {
        if (word.length >= 2 && !stopWords.has(word)) {
          keywordCount[word] = (keywordCount[word] || 0) + 1;
        }
      }
    }

    const sorted = Object.entries(keywordCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([keyword, count]) => ({ keyword, count }));

    // Recent samples with reasons
    const samples = res.rows.slice(0, 10).map((r: any) => ({
      reason: r.reason,
      queryPreview: r.query_preview?.slice(0, 200) ?? null,
      createdAt: r.created_at,
    }));

    return c.json({
      periodDays: days,
      totalThumbsDown: res.rows.length,
      topKeywords: sorted,
      recentSamples: samples,
    });
  } catch (err: any) {
    return c.json({ error: "Failed to fetch failure reasons", detail: err.message }, 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// S99P: Alerts
// ══════════════════════════════════════════════════════════════════════════════

// GET /v1/admin/alerts — list alerts
adminRouter.get("/alerts", async (c) => {
  const acknowledged = c.req.query("acknowledged"); // "true" | "false" | undefined=all
  const limit = Math.min(parseInt(c.req.query("limit") || "50"), 200);

  try {
    let whereClause = "";
    const params: any[] = [];

    if (acknowledged === "true") {
      whereClause = "WHERE acknowledged = true";
    } else if (acknowledged === "false") {
      whereClause = "WHERE acknowledged = false";
    }

    const res = await query(
      `SELECT id, type, severity, title, detail, acknowledged, acknowledged_by, acknowledged_at, created_at
       FROM alerts
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1}`,
      [...params, limit]
    );

    return c.json({
      items: res.rows.map((r: any) => ({
        id: r.id,
        type: r.type,
        severity: r.severity,
        title: r.title,
        detail: r.detail,
        acknowledged: r.acknowledged,
        acknowledgedBy: r.acknowledged_by,
        acknowledgedAt: r.acknowledged_at,
        createdAt: r.created_at,
      })),
    });
  } catch (err: any) {
    return c.json({ error: "Failed to fetch alerts", detail: err.message }, 500);
  }
});

// PATCH /v1/admin/alerts/:id/ack — acknowledge an alert
adminRouter.patch("/alerts/:id/ack", async (c) => {
  const alertId = c.req.param("id");
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const ackBy = body.acknowledged_by || "admin";

  try {
    const res = await query(
      `UPDATE alerts
       SET acknowledged = true,
           acknowledged_by = $1,
           acknowledged_at = NOW()
       WHERE id = $2
       RETURNING id`,
      [ackBy, alertId]
    );

    if (res.rows.length === 0) {
      return c.json({ error: "Alert not found" }, 404);
    }

    return c.json({ success: true, id: alertId });
  } catch (err: any) {
    return c.json({ error: "Failed to acknowledge alert", detail: err.message }, 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// S99P: User Management
// ══════════════════════════════════════════════════════════════════════════════

// GET /v1/admin/users — list beta users with stats
adminRouter.get("/users", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") || "50"), 200);
  const status = c.req.query("status"); // active | paused | blocked

  try {
    // We don't have a dedicated users table; aggregate from sessions/feedback_events/decision_logs
    const res = await query(
      `SELECT
        u.user_id,
        MAX(u.last_seen) AS last_seen,
        COALESCE(s.session_count, 0)::int AS total_sessions,
        COALESCE(t.task_count, 0)::int AS total_tasks,
        COALESCE(fb.feedback_count, 0)::int AS total_feedback,
        COALESCE(dl.total_cost, 0)::float AS total_cost_usd
       FROM (
         SELECT user_id, MAX(created_at) AS last_seen
         FROM sessions
         GROUP BY user_id
       ) u
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS session_count FROM sessions WHERE user_id = u.user_id
       ) s ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS task_count FROM tasks WHERE user_id = u.user_id
       ) t ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS feedback_count FROM feedback_events WHERE user_id = u.user_id
       ) fb ON true
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(total_cost_usd), 0) AS total_cost FROM decision_logs WHERE user_id = u.user_id
       ) dl ON true
       ORDER BY u.last_seen DESC
       LIMIT $1`,
      [limit]
    );

    return c.json({
      items: res.rows.map((r: any) => ({
        userId: r.user_id,
        lastSeen: r.last_seen,
        totalSessions: r.total_sessions,
        totalTasks: r.total_tasks,
        totalFeedback: r.total_feedback,
        totalCostUsd: Number(r.total_cost_usd.toFixed(4)),
      })),
    });
  } catch (err: any) {
    return c.json({ error: "Failed to fetch users", detail: err.message }, 500);
  }
});

// PATCH /v1/admin/users/:id/notes — update user notes (stored in identity_memories or a notes JSONB)
adminRouter.patch("/users/:id/notes", async (c) => {
  const userId = c.req.param("id");
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { note } = body;
  if (!note || typeof note !== "string") {
    return c.json({ error: "note (string) is required" }, 400);
  }

  try {
    // Store user notes in identity_memories table (extend with notes JSONB)
    // First ensure the column exists (idempotent via ALTER TABLE IF NOT EXISTS pattern)
    await query(
      `ALTER TABLE identity_memories ADD COLUMN IF NOT EXISTS admin_notes JSONB DEFAULT '[]'`
    );

    const now = new Date().toISOString();
    await query(
      `INSERT INTO identity_memories (user_id, response_style, expertise_level, admin_notes)
       VALUES ($1, 'balanced', 'intermediate', $2::jsonb)
       ON CONFLICT (user_id)
       DO UPDATE SET admin_notes = identity_memories.admin_notes || $2::jsonb`,
      [userId, JSON.stringify([{ text: note, at: now }])]
    );

    return c.json({ success: true, userId });
  } catch (err: any) {
    return c.json({ error: "Failed to update user notes", detail: err.message }, 500);
  }
});

// PATCH /v1/admin/users/:id/status — set user status
adminRouter.patch("/users/:id/status", async (c) => {
  const userId = c.req.param("id");
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const VALID_STATUSES = ["active", "paused", "blocked"];
  const { status } = body;

  if (!status || !VALID_STATUSES.includes(status)) {
    return c.json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` }, 400);
  }

  try {
    // Store status in identity_memories
    await query(
      `ALTER TABLE identity_memories ADD COLUMN IF NOT EXISTS user_status VARCHAR(20) DEFAULT 'active'`
    );

    await query(
      `INSERT INTO identity_memories (user_id, response_style, expertise_level, user_status)
       VALUES ($1, 'balanced', 'intermediate', $2)
       ON CONFLICT (user_id)
       DO UPDATE SET user_status = $2`,
      [userId, status]
    );

    return c.json({ success: true, userId, status });
  } catch (err: any) {
    return c.json({ error: "Failed to update user status", detail: err.message }, 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// S99P: CSV Export
// ══════════════════════════════════════════════════════════════════════════════

adminRouter.get("/export", async (c) => {
  const exportType = c.req.query("type") || "feedback"; // users | feedback | cost

  try {
    let csv = "";
    let filename = "";

    if (exportType === "feedback") {
      const res = await query(
        `SELECT fe.id, fe.user_id, fe.event_type, fe.signal_level, fe.source,
           fe.raw_data->>'reason' AS reason,
           fe.raw_data->'triage'->>'status' AS triage_status,
           fe.raw_data->'triage'->>'severity' AS severity,
           d.query_preview, d.session_id, d.total_cost_usd,
           fe.created_at
         FROM feedback_events fe
         LEFT JOIN decision_logs d ON fe.decision_id = d.id
         ORDER BY fe.created_at DESC
         LIMIT 10000`
      );

      csv = [
        "id,user_id,event_type,signal_level,source,reason,triage_status,severity,query_preview,session_id,cost_usd,created_at",
        ...res.rows.map((r: any) =>
          [
            r.id,
            r.user_id,
            r.event_type,
            r.signal_level,
            r.source,
            `"${(r.reason || "").replace(/"/g, '""')}"`,
            r.triage_status,
            r.severity,
            `"${(r.query_preview || "").replace(/"/g, '""').slice(0, 200)}"`,
            r.session_id,
            r.total_cost_usd,
            r.created_at,
          ].join(",")
        ),
      ].join("\n");
      filename = `feedback-export-${new Date().toISOString().slice(0, 10)}.csv`;
    } else if (exportType === "users") {
      const res = await query(
        `SELECT u.user_id, MAX(u.last_seen) AS last_seen,
           COALESCE(s.session_count, 0)::int AS total_sessions,
           COALESCE(t.task_count, 0)::int AS total_tasks,
           COALESCE(fb.feedback_count, 0)::int AS total_feedback,
           COALESCE(dl.total_cost, 0)::float AS total_cost_usd
         FROM (
           SELECT user_id, MAX(created_at) AS last_seen FROM sessions GROUP BY user_id
         ) u
         LEFT JOIN LATERAL (SELECT COUNT(*) AS session_count FROM sessions WHERE user_id = u.user_id) s ON true
         LEFT JOIN LATERAL (SELECT COUNT(*) AS task_count FROM tasks WHERE user_id = u.user_id) t ON true
         LEFT JOIN LATERAL (SELECT COUNT(*) AS feedback_count FROM feedback_events WHERE user_id = u.user_id) fb ON true
         LEFT JOIN LATERAL (SELECT COALESCE(SUM(total_cost_usd), 0) AS total_cost FROM decision_logs WHERE user_id = u.user_id) dl ON true
         ORDER BY u.last_seen DESC`
      );

      csv = [
        "user_id,last_seen,total_sessions,total_tasks,total_feedback,total_cost_usd",
        ...res.rows.map((r: any) =>
          [r.user_id, r.last_seen, r.total_sessions, r.total_tasks, r.total_feedback, r.total_cost_usd].join(",")
        ),
      ].join("\n");
      filename = `users-export-${new Date().toISOString().slice(0, 10)}.csv`;
    } else if (exportType === "cost") {
      const res = await query(
        `SELECT user_id, created_at::date AS day,
           COUNT(*)::int AS requests,
           COALESCE(SUM(total_cost_usd), 0)::float AS cost_usd,
           COALESCE(SUM(exec_input_tokens), 0)::bigint AS input_tokens,
           COALESCE(SUM(exec_output_tokens), 0)::bigint AS output_tokens
         FROM decision_logs
         WHERE created_at >= NOW() - INTERVAL '30 days'
         GROUP BY user_id, created_at::date
         ORDER BY created_at::date DESC, cost_usd DESC`
      );

      csv = [
        "user_id,day,requests,cost_usd,input_tokens,output_tokens",
        ...res.rows.map((r: any) =>
          [r.user_id, r.day, r.requests, r.cost_usd, r.input_tokens, r.output_tokens].join(",")
        ),
      ].join("\n");
      filename = `cost-export-${new Date().toISOString().slice(0, 10)}.csv`;
    } else {
      return c.json({ error: "type must be one of: users, feedback, cost" }, 400);
    }

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err: any) {
    return c.json({ error: "Failed to export data", detail: err.message }, 500);
  }
});

export { adminRouter };
