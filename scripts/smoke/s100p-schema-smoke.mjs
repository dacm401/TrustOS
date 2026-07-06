// S100P Phase 1.5 — Schema Verification Script
// Verifies tables, columns, and indexes exist for S100P Phase 1

import pg from "pg";

const pool = new pg.Pool({
  connectionString: "postgresql://postgres:postgres@localhost:5432/smartrouter",
  connectionTimeoutMillis: 5000,
});

const results = [];

function check(name, expected, actual) {
  const pass = actual === expected || (Array.isArray(expected) && Array.isArray(actual) && expected.every(e => actual.includes(e)));
  results.push({ name, expected, actual, pass });
  console.log(`${pass ? "✅" : "❌"} ${name}: expected=${JSON.stringify(expected)}, actual=${JSON.stringify(actual)}`);
}

async function main() {
  // ── 1. Verify tables exist ──────────────────────────────────────────
  console.log("\n=== Table Verification ===");
  const tablesRes = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name IN ('agent_sessions', 'manager_messages', 'session_events', 'permission_requests')
    ORDER BY table_name
  `);
  const foundTables = tablesRes.rows.map(r => r.table_name);
  check("Tables exist", ["agent_sessions", "manager_messages", "session_events", "permission_requests"], foundTables);

  // ── 2. Verify agent_sessions columns ────────────────────────────────
  console.log("\n=== agent_sessions Columns ===");
  const asCols = await pool.query(`
    SELECT column_name, data_type, is_nullable FROM information_schema.columns
    WHERE table_name = 'agent_sessions' ORDER BY ordinal_position
  `);
  const asColNames = asCols.rows.map(r => r.column_name);
  check("agent_sessions.id", true, asColNames.includes("id"));
  check("agent_sessions.user_id", true, asColNames.includes("user_id"));
  check("agent_sessions.delegation_contract", true, asColNames.includes("delegation_contract"));
  check("agent_sessions.status", true, asColNames.includes("status"));
  console.log("  All columns:", asColNames.join(", "));

  // ── 3. Verify manager_messages columns ──────────────────────────────
  console.log("\n=== manager_messages Columns ===");
  const mmCols = await pool.query(`
    SELECT column_name, data_type, is_nullable FROM information_schema.columns
    WHERE table_name = 'manager_messages' ORDER BY ordinal_position
  `);
  const mmColNames = mmCols.rows.map(r => r.column_name);
  check("manager_messages.id", true, mmColNames.includes("id"));
  check("manager_messages.user_id", true, mmColNames.includes("user_id"));
  check("manager_messages.conversation_id", true, mmColNames.includes("conversation_id"));
  check("manager_messages.related_session_id", true, mmColNames.includes("related_session_id"));
  console.log("  All columns:", mmColNames.join(", "));

  // ── 4. Verify session_events columns ────────────────────────────────
  console.log("\n=== session_events Columns ===");
  const seCols = await pool.query(`
    SELECT column_name, data_type, is_nullable FROM information_schema.columns
    WHERE table_name = 'session_events' ORDER BY ordinal_position
  `);
  const seColNames = seCols.rows.map(r => r.column_name);
  check("session_events.id", true, seColNames.includes("id"));
  check("session_events.session_id", true, seColNames.includes("session_id"));
  check("session_events.visibility", true, seColNames.includes("visibility"));
  console.log("  All columns:", seColNames.join(", "));

  // ── 5. Verify permission_requests columns ───────────────────────────
  console.log("\n=== permission_requests Columns ===");
  const prCols = await pool.query(`
    SELECT column_name, data_type, is_nullable FROM information_schema.columns
    WHERE table_name = 'permission_requests' ORDER BY ordinal_position
  `);
  const prColNames = prCols.rows.map(r => r.column_name);
  check("permission_requests.session_id", true, prColNames.includes("session_id"));
  check("permission_requests.action_id", true, prColNames.includes("action_id"));
  check("permission_requests.risk_level", true, prColNames.includes("risk_level"));
  check("permission_requests.manager_recommendation", true, prColNames.includes("manager_recommendation"));
  console.log("  All columns:", prColNames.join(", "));

  // ── 6. Verify indexes exist ─────────────────────────────────────────
  console.log("\n=== Index Verification ===");
  const idxRes = await pool.query(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public'
    AND indexname LIKE 'idx_%'
    AND tablename IN ('agent_sessions', 'manager_messages', 'session_events', 'permission_requests')
    ORDER BY indexname
  `);
  const allIndexes = idxRes.rows.map(r => r.indexname);
  console.log("  All S100P-related indexes:", allIndexes.join(", "));

  // Check key indexes
  check("agent_sessions user index", true, allIndexes.some(i => i.startsWith("idx_as_")));
  check("manager_messages user/conv index", true, allIndexes.some(i => i.startsWith("idx_mm_user")));
  check("session_events session/time index", true, allIndexes.some(i => i.startsWith("idx_se_")));
  check("permission_requests session index", true, allIndexes.includes("idx_pr_session"));
  check("permission_requests action index", true, allIndexes.includes("idx_pr_action"));

  // ── 7. Summary ──────────────────────────────────────────────────────
  console.log("\n=== Summary ===");
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`Passed: ${passed}/${results.length}, Failed: ${failed}`);

  if (failed > 0) {
    console.log("\n❌ FAILED checks:");
    results.filter(r => !r.pass).forEach(r => {
      console.log(`  - ${r.name}: expected=${JSON.stringify(r.expected)}, actual=${JSON.stringify(r.actual)}`);
    });
  }

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Schema verification failed:", err.message);
  pool.end();
  process.exit(1);
});
