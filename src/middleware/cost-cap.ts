/**
 * S98P: Daily Cost Cap Middleware
 *
 * Checks if the authenticated user has exceeded their daily cost budget.
 * Runs BEFORE chat handler to prevent expensive LLM calls.
 *
 * Design:
 *   - Queries sessions table SUM(total_cost) for today's UTC date
 *   - Threshold: TRUSTOS_DAILY_COST_CAP_USD (default $1.00)
 *   - On exceed: 429 + X-Cost-Cap-Exceeded header
 *   - On pass: injects X-Daily-Cost-Remaining header
 */

import type { Context, Next } from "hono";
import { getContextUserId } from "./identity.js";
import { query } from "../db/connection.js";

const DAILY_COST_CAP_USD = parseFloat(
  process.env.TRUSTOS_DAILY_COST_CAP_USD || "1.00"
);

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10); // "2026-06-30"
}

export async function costCapMiddleware(
  c: Context,
  next: Next
): Promise<Response | void> {
  // Master kill switch
  if (process.env.TRUSTOS_COST_CAP_ENABLED === "false") {
    return next();
  }

  const userId = getContextUserId(c);
  if (!userId) {
    // No identity — pass through (identity middleware will reject if needed)
    return next();
  }

  const today = todayUTC();

  try {
    const result = await query(
      `SELECT COALESCE(SUM(total_cost), 0)::float AS daily_cost
       FROM sessions
       WHERE user_id = $1
         AND created_at::date = $2::date`,
      [userId, today]
    );

    const dailyCost = result.rows[0]?.daily_cost ?? 0;

    if (dailyCost >= DAILY_COST_CAP_USD) {
      return new Response(
        JSON.stringify({
          error: "Daily Cost Cap Exceeded",
          message: `You have reached your daily cost limit of $${DAILY_COST_CAP_USD.toFixed(2)}. Please try again tomorrow.`,
          dailyCostUsd: Number(dailyCost.toFixed(4)),
          capUsd: DAILY_COST_CAP_USD,
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
            "X-Cost-Cap-Exceeded": "true",
            "X-Daily-Cost-Remaining": "0.00",
            "X-Daily-Cost-Cap": String(DAILY_COST_CAP_USD),
          },
        }
      );
    }

    // Pass — inject remaining cost header
    c.res.headers.set(
      "X-Daily-Cost-Remaining",
      (DAILY_COST_CAP_USD - dailyCost).toFixed(4)
    );
    c.res.headers.set("X-Daily-Cost-Cap", String(DAILY_COST_CAP_USD));
    return next();
  } catch (err: any) {
    // DB query failed — allow pass (fail-open for cost cap)
    console.warn(
      "[cost-cap] Query failed, allowing pass:",
      err.message
    );
    return next();
  }
}
