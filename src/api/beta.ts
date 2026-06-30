import { Hono } from "hono";
import { getContextUserId } from "../middleware/identity.js";
import { query } from "../db/connection.js";

const betaRouter = new Hono();

// S97P: Per-user beta statistics
betaRouter.get("/stats/:userId", async (c) => {
  const userId = c.req.param("userId") || getContextUserId(c);
  if (!userId) return c.json({ error: "userId is required" }, 400);

  // Total sessions
  const sessionsRes = await query(
    `SELECT COUNT(*)::int AS total FROM sessions WHERE user_id = $1`,
    [userId],
  );
  const totalSessions = sessionsRes.rows[0]?.total ?? 0;

  // Feedback stats
  const feedbackRes = await query(
    `SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE event_type = 'thumbs_up')::int AS thumbs_up,
      COUNT(*) FILTER (WHERE event_type = 'thumbs_down')::int AS thumbs_down
     FROM feedback_events
     WHERE user_id = $1`,
    [userId],
  );
  const fb = feedbackRes.rows[0] ?? { total: 0, thumbs_up: 0, thumbs_down: 0 };

  // Task stats (tasks table uses updated_at, no completed_at column)
  const tasksRes = await query(
    `SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
      COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
      COUNT(*) FILTER (WHERE status = 'timed_out')::int AS timed_out,
      COALESCE(AVG(EXTRACT(EPOCH FROM (updated_at - created_at))), 0)::float AS avg_duration_seconds
     FROM tasks
     WHERE user_id = $1`,
    [userId],
  );
  const tasks = tasksRes.rows[0] ?? { total: 0, completed: 0, failed: 0, cancelled: 0, timed_out: 0, avg_duration_seconds: 0 };

  // Token/cost stats from delegation_logs
  const tokensRes = await query(
    `SELECT
      COALESCE(SUM(exec_input_tokens), 0)::bigint AS total_input,
      COALESCE(SUM(exec_output_tokens), 0)::bigint AS total_output,
      COALESCE(SUM(total_cost_usd), 0)::float AS estimated_cost_usd
     FROM decision_logs
     WHERE user_id = $1`,
    [userId],
  );
  const tokens = tokensRes.rows[0] ?? { total_input: 0, total_output: 0, estimated_cost_usd: 0 };

  return c.json({
    userId,
    totalSessions,
    feedback: {
      total: fb.total,
      thumbsUp: fb.thumbs_up,
      thumbsDown: fb.thumbs_down,
      ratio: fb.total > 0 ? Math.round((fb.thumbs_up / fb.total) * 100) : 0,
    },
    tasks: {
      total: tasks.total,
      completed: tasks.completed,
      failed: tasks.failed,
      cancelled: tasks.cancelled,
      timedOut: tasks.timed_out,
      avgDurationMs: Math.round(tasks.avg_duration_seconds * 1000),
    },
    tokens: {
      totalInput: Number(tokens.total_input),
      totalOutput: Number(tokens.total_output),
      estimatedCostUsd: Number(tokens.estimated_cost_usd),
    },
  });
});

// S97P: Per-session statistics
betaRouter.get("/session/:sessionId/stats", async (c) => {
  const sessionId = c.req.param("sessionId");
  if (!sessionId) return c.json({ error: "sessionId is required" }, 400);

  // Session metadata
  const sessionRes = await query(
    `SELECT id, user_id, created_at, updated_at FROM sessions WHERE id = $1`,
    [sessionId],
  );
  if (sessionRes.rows.length === 0) return c.json({ error: "session not found" }, 404);

  // Message count from tasks
  const messagesRes = await query(
    `SELECT COUNT(*)::int AS total FROM tasks WHERE session_id = $1`,
    [sessionId],
  );

  // Feedback for this session
  const feedbackRes = await query(
    `SELECT fe.event_type, fe.created_at, fe.raw_data
     FROM feedback_events fe
     JOIN decision_logs d ON fe.decision_id = d.id
     WHERE d.session_id = $1
     ORDER BY fe.created_at DESC
     LIMIT 50`,
    [sessionId],
  );

  // Task results for this session
  const tasksRes = await query(
    `SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
      COALESCE(AVG(EXTRACT(EPOCH FROM (updated_at - created_at))), 0)::float AS avg_duration_seconds
     FROM tasks
     WHERE session_id = $1`,
    [sessionId],
  );
  const tasks = tasksRes.rows[0] ?? { total: 0, completed: 0, failed: 0, avg_duration_seconds: 0 };

  // Token/cost for this session
  const tokensRes = await query(
    `SELECT
      COALESCE(SUM(exec_input_tokens), 0)::bigint AS total_input,
      COALESCE(SUM(exec_output_tokens), 0)::bigint AS total_output,
      COALESCE(SUM(total_cost_usd), 0)::float AS estimated_cost_usd
     FROM decision_logs
     WHERE session_id = $1`,
    [sessionId],
  );
  const tokens = tokensRes.rows[0] ?? { total_input: 0, total_output: 0, estimated_cost_usd: 0 };

  return c.json({
    sessionId,
    userId: sessionRes.rows[0].user_id,
    messageCount: messagesRes.rows[0]?.total ?? 0,
    feedback: feedbackRes.rows.map((r: any) => ({
      eventType: r.event_type,
      createdAt: r.created_at,
      reason: r.raw_data?.reason ?? null,
    })),
    tasks: {
      total: tasks.total,
      completed: tasks.completed,
      failed: tasks.failed,
      avgDurationMs: Math.round(tasks.avg_duration_seconds * 1000),
    },
    tokens: {
      totalInput: Number(tokens.total_input),
      totalOutput: Number(tokens.total_output),
      estimatedCostUsd: Number(tokens.estimated_cost_usd),
    },
  });
});

// S97P: Feedback timeline for a user
betaRouter.get("/feedback/:userId", async (c) => {
  const userId = c.req.param("userId") || getContextUserId(c);
  if (!userId) return c.json({ error: "userId is required" }, 400);

  const typeFilter = c.req.query("type"); // optional: thumbs_up, thumbs_down
  const limit = Math.min(parseInt(c.req.query("limit") || "50"), 100);

  let sql = `
    SELECT fe.event_type, fe.created_at, fe.raw_data, d.query_preview
    FROM feedback_events fe
    JOIN decision_logs d ON fe.decision_id = d.id
    WHERE fe.user_id = $1`;
  const params: any[] = [userId];

  if (typeFilter && ["thumbs_up", "thumbs_down"].includes(typeFilter)) {
    params.push(typeFilter);
    sql += ` AND fe.event_type = $${params.length}`;
  }

  sql += ` ORDER BY fe.created_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const result = await query(sql, params);

  return c.json({
    userId,
    events: result.rows.map((r: any) => ({
      eventType: r.event_type,
      createdAt: r.created_at,
      reason: r.raw_data?.reason ?? null,
      queryPreview: r.query_preview,
    })),
  });
});

export { betaRouter };
