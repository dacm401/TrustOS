/**
 * Backfill Delegation Log routing_layer — Sprint 68 (Phase 2.0 L2 Feature Flag)
 *
 * 回填 delegation_logs.routing_layer（如果 migration 017 未执行或漏填）。
 * routing_layer 从 routed_action 推断：
 *   direct_answer / ask_clarification → L0
 *   delegate_to_slow                 → L2
 *   execute_task                     → L3
 *   其他 / 未知                       → L1
 *
 * Usage: npx tsx scripts/backfill-routing-layer.ts
 */

import { query } from "../src/db/connection.js";

async function main() {
  console.log("🚀 Delegation Log routing_layer Backfill — Sprint 68\n");

  const result = await query(`
    WITH updated AS (
      UPDATE delegation_logs
      SET routing_layer =
        CASE
          WHEN routed_action IN ('direct_answer', 'ask_clarification') THEN 'L0'
          WHEN routed_action = 'delegate_to_slow' THEN 'L2'
          WHEN routed_action = 'execute_task' THEN 'L3'
          ELSE 'L1'
        END
      WHERE routing_layer IS NULL
        AND routed_action IS NOT NULL
      RETURNING id, routed_action, routing_layer
    )
    SELECT
      routing_layer,
      COUNT(*)::int as count
    FROM updated
    GROUP BY routing_layer
    ORDER BY routing_layer
  `);

  const rows = result.rows;
  let total = 0;
  console.log("📊 Backfilled records by routing_layer:");
  for (const row of rows) {
    console.log(`   ${row.routing_layer}: ${row.count}`);
    total += Number(row.count);
  }

  // Summary
  const summary = await query(`
    SELECT
      COUNT(*)::int                                        as total,
      COUNT(*) FILTER (WHERE routing_layer = 'L0')::int    as l0,
      COUNT(*) FILTER (WHERE routing_layer = 'L1')::int    as l1,
      COUNT(*) FILTER (WHERE routing_layer = 'L2')::int    as l2,
      COUNT(*) FILTER (WHERE routing_layer = 'L3')::int    as l3,
      COUNT(*) FILTER (WHERE routing_layer IS NULL)::int  as null_layer
    FROM delegation_logs
  `);

  const s = summary.rows[0];
  console.log("\n📈 Full Summary:");
  console.log(`   Total logs:             ${s.total}`);
  console.log(`   L0 (direct/clarify):   ${s.l0}`);
  console.log(`   L1 (unknown):           ${s.l1}`);
  console.log(`   L2 (delegate_to_slow):  ${s.l2}`);
  console.log(`   L3 (execute_task):      ${s.l3}`);
  console.log(`   routing_layer=null:     ${s.null_layer} (should be 0 after migration)`);

  console.log(`\n✅ Backfill complete! Updated ${total} records.`);
}

main().catch((err) => {
  console.error("💥 Fatal error:", err);
  process.exit(1);
});
