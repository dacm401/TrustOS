/**
 * S98P: User Session & Task Quota Middleware
 *
 * Enforces daily limits on:
 *   - Sessions created (TRUSTOS_DAILY_SESSION_QUOTA, default 20)
 *   - Tasks created (TRUSTOS_DAILY_TASK_QUOTA, default 50)
 *
 * Queries sessions + tasks tables for today's UTC date.
 */

import type { Context, Next } from "hono";
import { getContextUserId } from "./identity.js";
import { query } from "../db/connection.js";

const DAILY_SESSION_QUOTA = parseInt(
  process.env.TRUSTOS_DAILY_SESSION_QUOTA || "20"
);
const DAILY_TASK_QUOTA = parseInt(
  process.env.TRUSTOS_DAILY_TASK_QUOTA || "50"
);

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function quotaMiddleware(
  c: Context,
  next: Next
): Promise<Response | void> {
  // Master kill switch
  if (process.env.TRUSTOS_QUOTA_ENABLED === "false") {
    return next();
  }

  const userId = getContextUserId(c);
  if (!userId) return next();

  const today = todayUTC();

  try {
    // Check both session count and task count in parallel
    const [sessionRes, taskRes] = await Promise.all([
      query(
        `SELECT COUNT(*)::int AS count
         FROM sessions
         WHERE user_id = $1
           AND created_at::date = $2::date`,
        [userId, today]
      ),
      query(
        `SELECT COUNT(*)::int AS count
         FROM tasks
         WHERE user_id = $1
           AND created_at::date = $2::date`,
        [userId, today]
      ),
    ]);

    const sessionCount = sessionRes.rows[0]?.count ?? 0;
    const taskCount = taskRes.rows[0]?.count ?? 0;
    const sessionRemaining = Math.max(0, DAILY_SESSION_QUOTA - sessionCount);
    const taskRemaining = Math.max(0, DAILY_TASK_QUOTA - taskCount);

    // Task quota check (more granular — check this first)
    if (taskCount >= DAILY_TASK_QUOTA) {
      return new Response(
        JSON.stringify({
          error: "Daily Task Quota Exceeded",
          message: `You have reached your daily task limit of ${DAILY_TASK_QUOTA}. Please try again tomorrow.`,
          quota: {
            tasks: { used: taskCount, limit: DAILY_TASK_QUOTA, remaining: 0 },
            sessions: { used: sessionCount, limit: DAILY_SESSION_QUOTA, remaining: sessionRemaining },
          },
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(
              Math.ceil(
                (new Date(today + "T23:59:59Z").getTime() - Date.now()) / 1000
              )
            ),
            "X-Task-Quota-Exceeded": "true",
            "X-Task-Quota-Remaining": "0",
            "X-Task-Quota-Limit": String(DAILY_TASK_QUOTA),
            "X-Session-Quota-Remaining": String(sessionRemaining),
            "X-Session-Quota-Limit": String(DAILY_SESSION_QUOTA),
          },
        }
      );
    }

    // Pass — inject quota headers
    c.res.headers.set("X-Task-Quota-Remaining", String(taskRemaining));
    c.res.headers.set("X-Task-Quota-Limit", String(DAILY_TASK_QUOTA));
    c.res.headers.set("X-Session-Quota-Remaining", String(sessionRemaining));
    c.res.headers.set("X-Session-Quota-Limit", String(DAILY_SESSION_QUOTA));
    return next();
  } catch (err: any) {
    // DB query failed — allow pass (fail-open)
    console.warn("[quota] Query failed, allowing pass:", err.message);
    return next();
  }
}
