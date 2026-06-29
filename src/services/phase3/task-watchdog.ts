/**
 * S96P: Task Watchdog — 检测并清理长时间卡住的任务
 *
 * 定期扫描 task_archives 和 task_commands 中 stuck 在 executing/waiting_result
 * 状态超过阈值的任务，将其标记为 timed_out。
 *
 * 运行在独立 setInterval 中，不阻塞主流程。
 */

import { TaskArchiveRepo } from "../../db/task-archive-repo.js";
import { DelegationLogRepo } from "../../db/repositories.js";

const WATCHDOG_INTERVAL_MS = 30_000; // 30s 扫描一次
const STUCK_THRESHOLD_MS = 5 * 60_000; // 5 分钟无进展视为 stuck

let watchdogTimer: NodeJS.Timeout | null = null;
let watchdogStopped = false;

export function startTaskWatchdog(): NodeJS.Timeout {
  if (watchdogTimer) {
    console.warn("[Watchdog] Already running, skipping duplicate start");
    return watchdogTimer;
  }

  console.log(`[Watchdog] Starting, interval=${WATCHDOG_INTERVAL_MS}ms, stuckThreshold=${STUCK_THRESHOLD_MS}ms`);

  watchdogTimer = setInterval(async () => {
    if (watchdogStopped) return;
    try {
      await scanStuckTasks();
    } catch (e: unknown) {
      console.error("[Watchdog] Scan error:", e instanceof Error ? e.message : String(e));
    }
  }, WATCHDOG_INTERVAL_MS);

  return watchdogTimer;
}

export function stopTaskWatchdog(): void {
  watchdogStopped = true;
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
    console.log("[Watchdog] Stopped");
  }
}

async function scanStuckTasks(): Promise<void> {
  const { query } = await import("../../db/connection.js");

  // 查找 stuck 在非终态超过阈值的 task_archives
  const stuckStates = ["executing", "waiting_result", "delegated", "synthesizing"];
  const statePlaceholders = stuckStates.map((_, i) => `$${i + 1}`).join(", ");

  const result = await query(
    `SELECT id, state, updated_at, user_id, session_id
     FROM task_archives
     WHERE state IN (${statePlaceholders})
       AND updated_at < NOW() - INTERVAL '1 millisecond' * $${stuckStates.length + 1}
       AND delivered = false
     LIMIT 50`,
    [...stuckStates, STUCK_THRESHOLD_MS]
  );

  if (result.rows.length === 0) return;

  console.log(`[Watchdog] Found ${result.rows.length} stuck task(s), marking as timed_out`);

  for (const row of result.rows as Array<{
    id: string;
    state: string;
    updated_at: string;
    user_id: string;
    session_id: string;
  }>) {
    try {
      // Mark archive as timed_out
      await TaskArchiveRepo.updateState(row.id, "timed_out");

      // Write timeout metadata
      await TaskArchiveRepo.setSlowExecution(row.id, {
        timedOutAt: new Date().toISOString(),
        previousState: row.state,
        stuckSince: row.updated_at,
        timeoutReason: `Task stuck in "${row.state}" for >${Math.floor(STUCK_THRESHOLD_MS / 60000)}min`,
      });

      // Update task_commands to timed_out
      await query(
        `UPDATE task_commands SET status = 'timed_out'
         WHERE archive_id = $1 AND status IN ('queued', 'running')`,
        [row.id]
      );

      // Update delegation_log if exists
      try {
        const logResult = await query(
          `SELECT id FROM delegation_logs WHERE task_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [row.id]
        );
        if (logResult.rows.length > 0) {
          await DelegationLogRepo.updateExecution(logResult.rows[0].id as string, {
            execution_status: "timeout",
            execution_correct: false,
            error_message: `Task stuck in "${row.state}" for >${Math.floor(STUCK_THRESHOLD_MS / 60000)}min`,
          });
        }
      } catch {
        // Best-effort
      }

      console.log(`[Watchdog] Timed out task ${row.id.slice(0, 8)} (was: ${row.state})`);
    } catch (e: unknown) {
      console.error(`[Watchdog] Failed to timeout task ${row.id.slice(0, 8)}:`,
        e instanceof Error ? e.message : String(e));
    }
  }
}
