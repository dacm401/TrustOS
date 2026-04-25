/**
 * Backfill Delegation Log Success Fields — Sprint 55 (G4-B)
 *
 * 回填 delegation_logs.routing_success 和 delegation_logs.user_success。
 *
 * routing_success 回填逻辑：
 *   - execution_status = 'success' → routing_success = true  （执行成功说明路由选对了）
 *   - execution_status = 'failed'  → routing_success = false （执行失败可能是路由选错了）
 *   - execution_status IS NULL     → 保持 null（还在 pending）
 *
 * user_success 回填逻辑（同 session 内下一条 user turn 判断）：
 *   - 同 session 中存在下一条 turn（用户发了新消息）→ user_success = true（无需追问）
 *   - 没有下一条 turn（同 session 最后一条）        → 保持 null（无法判断）
 *
 * 注意：这是执行结果代理回填，不是 ground truth benchmark。
 * 真正的 routing_success 需要 benchmark 离线跑完后对比 expected_mode，
 * 由 benchmark 脚本触发更新。
 *
 * Usage: npx tsx backend/scripts/backfill-delegation-success.ts
 */

import { query } from "../src/db/connection.js";

async function main() {
  console.log("🚀 Delegation Log Success Backfill — Sprint 55\n");

  // ── 1. routing_success 回填 ─────────────────────────────────────────────────
  console.log("📊 Step 1: Backfilling routing_success...");

  const routingResult = await query(`
    WITH updated AS (
      UPDATE delegation_logs
      SET routing_success = CASE
          WHEN execution_status = 'success' THEN true
          WHEN execution_status = 'failed'  THEN false
          ELSE routing_success
        END
      WHERE routing_success IS NULL
        AND execution_status IS NOT NULL
        AND execution_status IN ('success', 'failed')
      RETURNING id, execution_status, routing_success
    )
    SELECT
      execution_status,
      COUNT(*)::int as count
    FROM updated
    GROUP BY execution_status
  `);

  const rows = routingResult.rows;
  const trueCount = rows.find((r: any) => r.execution_status === "success")?.count ?? 0;
  const falseCount = rows.find((r: any) => r.execution_status === "failed")?.count ?? 0;

  console.log(`   ✅ routing_success=true (execution=success): ${trueCount}`);
  console.log(`   ❌ routing_success=false (execution=failed): ${falseCount}`);

  // ── 2. user_success 回填 ─────────────────────────────────────────────────────
  console.log("\n📊 Step 2: Backfilling user_success...");

  // 策略：在同一 session 中，查找"用户的下一条消息"的 delegation_logs 记录。
  // 如果下一条记录的 user_success = true，说明用户在此轮之后继续对话 → 说明此轮满足了用户。
  // 如果一条记录是 session 中最后一条 delegation_log（没有下一条），无法判断 → 保持 null。
  //
  // 简化版：找到 delegation_logs 之间插入了新 user turn 的 gap，
  // 表示用户在此轮之后继续发消息 → 前一条 delegation 的 user_success = true。
  // 如果 delegation 之后没有新 user turn（session 结束/任务中断），无法判断。

  const userSuccessResult = await query(`
    WITH session_gaps AS (
      SELECT
        dl.id,
        dl.session_id,
        dl.turn_id,
        dl.created_at,
        -- 找下一条同 session 的 delegation_log
        LEAD(dl.id) OVER w AS next_dl_id,
        LEAD(dl.created_at) OVER w AS next_created_at,
        LEAD(dl.turn_id) OVER w AS next_turn_id,
        -- 找同 session 中下一条 user message（如果 delegation 与下一条 delegation 之间
        -- 存在 tasks 或 decision_logs 记录，且有 user turn，说明用户主动发了新消息）
        LEAD(dl.created_at) OVER w AS gap_end
      FROM delegation_logs dl
      WHERE dl.execution_status IS NOT NULL
        AND dl.user_success IS NULL
      WINDOW w AS (PARTITION BY dl.session_id ORDER BY dl.turn_id ASC)
    )
    -- 更新条件：有下一条 delegation log 且 turn_id 有增长
    -- 说明用户在此轮之后继续对话，没有卡住或追问
    UPDATE delegation_logs dl
    SET user_success = true
    FROM session_gaps sg
    WHERE dl.id = sg.id
      AND sg.next_dl_id IS NOT NULL
      AND sg.next_turn_id > sg.turn_id
      AND dl.user_success IS NULL
    RETURNING dl.id
  `);

  const userSuccessCount = userSuccessResult.rowCount ?? 0;
  console.log(`   ✅ user_success=true (有后续对话): ${userSuccessCount}`);

  // ── 3. 统计汇总 ─────────────────────────────────────────────────────────────
  const summary = await query(`
    SELECT
      COUNT(*)::int as total_logs,
      COUNT(*) FILTER (WHERE routing_success = true)::int as routing_true,
      COUNT(*) FILTER (WHERE routing_success = false)::int as routing_false,
      COUNT(*) FILTER (WHERE routing_success IS NULL AND execution_status IS NOT NULL)::int as routing_pending_null,
      COUNT(*) FILTER (WHERE execution_status IS NULL)::int as execution_pending,
      COUNT(*) FILTER (WHERE user_success = true)::int as user_true,
      COUNT(*) FILTER (WHERE user_success IS NULL AND execution_status IS NOT NULL)::int as user_unknown
    FROM delegation_logs
  `);

  const s = summary.rows[0];
  console.log("\n📈 Final Summary:");
  console.log(`   Total delegation logs:       ${s.total_logs}`);
  console.log(`   routing_success=true:        ${s.routing_true}`);
  console.log(`   routing_success=false:       ${s.routing_false}`);
  console.log(`   routing_success=null (pending exec): ${s.routing_pending_null}`);
  console.log(`   execution_status=null (pending):    ${s.execution_pending}`);
  console.log(`   user_success=true:          ${s.user_true}`);
  console.log(`   user_success=null (unknown): ${s.user_unknown}`);
  console.log("\n✅ Backfill complete!");
}

main().catch((err) => {
  console.error("💥 Fatal error:", err);
  process.exit(1);
});
