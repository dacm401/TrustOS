/**
 * S99P: Alert Detector — lightweight operational alerting for Beta.
 *
 * Detects:
 *   - High cost: user exceeds 80% of daily cap
 *   - Error spike: failed/timed_out tasks spike vs baseline
 *   - Negative feedback burst: consecutive thumbs_down events
 *
 * Alerts are written to the `alerts` table for display in Admin panel.
 */

import { query } from "../db/connection.js";
import { config } from "../config.js";
import { v4 as uuid } from "uuid";

interface AlertRecord {
  id: string;
  type: string;
  severity: "warning" | "critical";
  title: string;
  detail: Record<string, unknown>;
}

async function insertAlert(alert: AlertRecord): Promise<void> {
  await query(
    `INSERT INTO alerts (id, type, severity, title, detail)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO NOTHING`,
    [alert.id, alert.type, alert.severity, alert.title, JSON.stringify(alert.detail)]
  );
}

async function detectHighCost(): Promise<void> {
  const cap = config.beta.dailyCostCapUsd;
  const threshold = cap * 0.8; // 80% of cap
  const today = new Date().toISOString().slice(0, 10);

  try {
    const res = await query(
      `SELECT user_id,
         COALESCE(SUM(total_cost_usd), 0)::float AS daily_cost
       FROM decision_logs
       WHERE created_at::date = $1::date
       GROUP BY user_id
       HAVING COALESCE(SUM(total_cost_usd), 0) > $2`,
      [today, threshold]
    );

    for (const row of res.rows) {
      await insertAlert({
        id: uuid(),
        type: "high_cost",
        severity: row.daily_cost >= cap ? "critical" : "warning",
        title: `User ${row.user_id?.slice(0, 12)}... cost $${Number(row.daily_cost).toFixed(4)} exceeds threshold`,
        detail: {
          userId: row.user_id,
          dailyCost: Number(row.daily_cost),
          capUsd: cap,
          thresholdUsd: threshold,
          date: today,
        },
      });
    }
  } catch (err) {
    console.error("[alert-detector] high_cost check failed:", err);
  }
}

async function detectErrorSpike(): Promise<void> {
  try {
    // Compare today's error rate vs last 7-day average
    const res = await query(
      `WITH today_stats AS (
         SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status IN ('failed', 'timed_out'))::int AS errors
         FROM tasks WHERE created_at::date = CURRENT_DATE
       ),
       baseline AS (
         SELECT COUNT(*)::float / 7 AS avg_total,
           COUNT(*) FILTER (WHERE status IN ('failed', 'timed_out'))::float / 7 AS avg_errors
         FROM tasks
         WHERE created_at::date >= CURRENT_DATE - INTERVAL '7 days'
           AND created_at::date < CURRENT_DATE
       )
       SELECT
         t.total, t.errors,
         b.avg_total, b.avg_errors,
         CASE WHEN b.avg_errors > 0 THEN (t.errors::float / NULLIF(b.avg_errors, 0)) ELSE 0 END AS ratio
       FROM today_stats t, baseline b
       WHERE t.total > 5 AND t.errors > b.avg_errors * 2`
    );

    for (const row of res.rows) {
      await insertAlert({
        id: uuid(),
        type: "error_spike",
        severity: row.ratio > 5 ? "critical" : "warning",
        title: `Error spike detected: ${row.errors} errors today (${row.ratio.toFixed(1)}x baseline)`,
        detail: {
          todayErrors: row.errors,
          todayTotal: row.total,
          baselineAvgErrors: Number(row.avg_errors.toFixed(1)),
          ratio: Number(row.ratio.toFixed(1)),
        },
      });
    }
  } catch (err) {
    console.error("[alert-detector] error_spike check failed:", err);
  }
}

async function detectNegativeFeedbackBurst(): Promise<void> {
  try {
    // Check for 3+ thumbs_down in last hour with no intervening thumbs_up
    const res = await query(
      `WITH recent AS (
         SELECT user_id, event_type,
           ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn
         FROM feedback_events
         WHERE created_at >= NOW() - INTERVAL '1 hour'
           AND event_type IN ('thumbs_up', 'thumbs_down')
       )
       SELECT user_id,
         COUNT(*) FILTER (WHERE event_type = 'thumbs_down') AS downs,
         COUNT(*) FILTER (WHERE event_type = 'thumbs_up') AS ups
       FROM recent
       WHERE rn <= 10
       GROUP BY user_id
       HAVING COUNT(*) FILTER (WHERE event_type = 'thumbs_down') >= 3
          AND COUNT(*) FILTER (WHERE event_type = 'thumbs_up') = 0`
    );

    for (const row of res.rows) {
      await insertAlert({
        id: uuid(),
        type: "negative_feedback_burst",
        severity: row.downs >= 5 ? "critical" : "warning",
        title: `Negative feedback burst: user ${row.user_id?.slice(0, 12)}... gave ${row.downs} thumbs_down in a row`,
        detail: {
          userId: row.user_id,
          consecutiveDowns: row.downs,
          ups: row.ups,
          windowHours: 1,
        },
      });
    }
  } catch (err) {
    console.error("[alert-detector] negative_feedback_burst check failed:", err);
  }
}

let detectionInterval: ReturnType<typeof setInterval> | null = null;

export function startAlertDetector(intervalMs = 300_000): void {
  if (detectionInterval) return; // already running

  console.log(`[alert-detector] Starting, interval=${intervalMs}ms`);

  // Run immediately on start
  void runAllDetections();

  detectionInterval = setInterval(() => {
    void runAllDetections();
  }, intervalMs);
}

export function stopAlertDetector(): void {
  if (detectionInterval) {
    clearInterval(detectionInterval);
    detectionInterval = null;
    console.log("[alert-detector] Stopped");
  }
}

async function runAllDetections(): Promise<void> {
  await Promise.all([
    detectHighCost(),
    detectErrorSpike(),
    detectNegativeFeedbackBurst(),
  ]);
}
