import { Hono } from "hono";
import { TaskRepo, DecisionRepo, TaskArchiveRepo } from "../db/repositories.js";
import { formatTraceSummaries } from "../services/trace-formatter.js";
import { getContextUserId } from "../middleware/identity.js";

// Mounted at /v1/tasks via index.ts
export const taskRouter = new Hono();

// S94P: GET /v1/tasks/recent — paginated task list with status filter
taskRouter.get("/recent", async (c) => {
  const userId = getContextUserId(c)!;
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 100);
  const offset = parseInt(c.req.query("offset") || "0");
  const status = c.req.query("status") || undefined;

  try {
    const { query } = await import("../db/connection.js");

    let sql = `SELECT id, session_id, user_input, command, status, created_at, updated_at,
               slow_execution->>'result' as result_preview
               FROM task_archives WHERE user_id = $1`;
    const params: any[] = [userId];
    let paramIdx = 2;

    if (status) {
      sql += ` AND status = $${paramIdx}`;
      params.push(status);
      paramIdx++;
    }

    // Count total
    const countResult = await query(
      `SELECT COUNT(*)::int as total FROM task_archives WHERE user_id = $1` +
      (status ? ` AND status = $2` : ""),
      status ? [userId, status] : [userId]
    );
    const total = countResult.rows[0]?.total || 0;

    sql += ` ORDER BY created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
    params.push(limit, offset);

    const result = await query(sql, params);

    const tasks = result.rows.map((r: any) => ({
      task_id: r.id,
      title: r.command?.task || r.user_input || "未命名任务",
      user_input: r.user_input,
      mode: r.command?.action || "unknown",
      status: r.status,
      result_preview: r.result_preview ? String(r.result_preview).slice(0, 200) : null,
      created_at: r.created_at,
      updated_at: r.updated_at,
      session_id: r.session_id,
    }));

    return c.json({ tasks, total, limit, offset });
  } catch (error: any) {
    console.error("[S94P] Task recent error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// S94P: GET /v1/tasks/:task_id/result — get task full result
taskRouter.get("/:task_id/result", async (c) => {
  const taskId = c.req.param("task_id");
  try {
    const archive = await TaskArchiveRepo.getById(taskId);
    if (!archive) return c.json({ error: `Task not found: ${taskId}` }, 404);

    return c.json({
      task_id: archive.id,
      user_input: archive.user_input,
      command: archive.command,
      status: archive.status,
      result: archive.slow_execution?.result || null,
      errors: archive.slow_execution?.errors || [],
      created_at: archive.created_at,
      updated_at: archive.updated_at,
    });
  } catch (error: any) {
    console.error("[S94P] Task result error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// GET /v1/tasks/all — list all tasks (uses /all to avoid /:task_id shadowing the "" route)
taskRouter.get("/all", async (c) => {
  // C3a: userId from middleware context (trusted source)
  const userId = getContextUserId(c)!;
  const sessionId = c.req.query("session_id") || undefined;
  try {
    // 从 task_archives 表获取任务（系统实际使用的表）
    const archives = await TaskArchiveRepo.getRecent(userId, 100);
    const tasks = archives.map((a: any) => ({
      task_id: a.id,
      title: a.command?.task || a.user_input || "未命名任务",
      mode: a.command?.action || "unknown",
      status: a.status,
      complexity: null,
      risk: null,
      updated_at: a.updated_at,
      session_id: a.session_id,
    }));
    return c.json({ tasks });
  } catch (error: any) {
    console.error("Task list error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// GET /v1/tasks/:task_id/summary — must be registered before /:task_id
taskRouter.get("/:task_id/summary", async (c) => {
  const taskId = c.req.param("task_id");
  try {
    // First check if task exists
    const task = await TaskRepo.getById(taskId);
    if (!task) return c.json({ error: `Task not found: ${taskId}` }, 404);

    const summary = await TaskRepo.getSummary(taskId);
    if (!summary) return c.json({ error: `Summary not found for task: ${taskId}` }, 404);
    return c.json({ summary });
  } catch (error: any) {
    console.error("Task summary error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// GET /v1/tasks/:task_id/traces — must be registered before /:task_id
taskRouter.get("/:task_id/traces", async (c) => {
  const taskId = c.req.param("task_id");
  const type = c.req.query("type") || undefined;
  const limitParam = c.req.query("limit");
  const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 100, 500) : 100;

  try {
    const traces = await TaskRepo.getTraces(taskId, { type, limit });
    const summaries = formatTraceSummaries(traces);

    return c.json({
      task_id: taskId,
      count: traces.length,
      traces,
      summaries,
    });
  } catch (error: any) {
    console.error("Task traces error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// GET /v1/tasks/:task_id/decision — get latest decision log for a task (before /:task_id to avoid shadowing)
taskRouter.get("/:task_id/decision", async (c) => {
  const taskId = c.req.param("task_id");
  try {
    const task = await TaskRepo.getById(taskId);
    if (!task) return c.json({ error: `Task not found: ${taskId}` }, 404);
    const decision = await DecisionRepo.getByTaskId(taskId);
    if (!decision) return c.json({ error: `No decision found for task: ${taskId}` }, 404);
    return c.json({ decision });
  } catch (error: any) {
    console.error("Task decision error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// GET /v1/tasks/:task_id — get task detail
taskRouter.get("/:task_id", async (c) => {
  const taskId = c.req.param("task_id");
  try {
    const task = await TaskRepo.getById(taskId);
    if (!task) return c.json({ error: `Task not found: ${taskId}` }, 404);
    return c.json({ task });
  } catch (error: any) {
    console.error("Task detail error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// PATCH /v1/tasks/:task_id — control task lifecycle (T1: resume / pause / cancel)
taskRouter.patch("/:task_id", async (c) => {
  const taskId = c.req.param("task_id");
  // C3a: userId from middleware context
  const userId = getContextUserId(c);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  const action = body.action as string | undefined;
  if (!action) return c.json({ error: "body.action is required (resume | pause | cancel)" }, 400);

  const validActions = ["resume", "pause", "cancel"];
  if (!validActions.includes(action)) {
    return c.json({ error: `Invalid action '${action}'. Must be one of: ${validActions.join(", ")}` }, 400);
  }

  // Validate task exists and belongs to user
  const task = await TaskRepo.getById(taskId);
  if (!task) return c.json({ error: `Task not found: ${taskId}` }, 404);
  if (task.user_id !== userId) return c.json({ error: "Forbidden: task does not belong to this user" }, 403);

  // Map action to status
  const statusMap: Record<string, string> = {
    resume: "responding",
    pause: "paused",
    cancel: "cancelled",
  };
  const newStatus = statusMap[action];

  try {
    await TaskRepo.setStatus(taskId, newStatus);

    // S90P: When cancelling, best-effort write to task_archives.state so the
    // slow-worker loop and SSE poller can detect cancellation immediately.
    // If the archive row doesn't exist or the update fails, cancellation still
    // succeeds (archive write is not required for task-level cancel).
    if (action === "cancel") {
      try {
        await TaskArchiveRepo.updateState(taskId, "cancelled");
        // Also write cancel metadata into slow_execution for poller visibility
        await TaskArchiveRepo.setSlowExecution(taskId, {
          cancelledAt: new Date().toISOString(),
          cancelReason: "Task cancelled by user",
        });
      } catch (archiveErr: any) {
        console.warn(`[S90P] PATCH cancel: archive sync failed for ${taskId}:`, archiveErr.message);
        // Best-effort: task cancel succeeds even if archive sync fails
      }
    }

    return c.json({ task_id: taskId, action, status: newStatus });
  } catch (error: any) {
    console.error("Task PATCH error:", error);
    return c.json({ error: error.message }, 500);
  }
});
