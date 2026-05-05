/**
 * quick-check.cjs — 快速查 DB 状态（不等待）
 * 用法: node quick-check.cjs <archive_id>
 */
const { Pool } = require('pg');
const DB = new Pool({ connectionString: 'postgresql://postgres:postgres@localhost:5432/smartrouter' });
const ARCHIVE_ID = process.argv[2];

async function main() {
  if (!ARCHIVE_ID) {
    // 查最新 5 条
    const r = await DB.query(
      'SELECT id, state, status, updated_at FROM task_archives ORDER BY updated_at DESC LIMIT 5'
    );
    console.log('📋 task_archives 最新 5 条:');
    console.log(JSON.stringify(r.rows, null, 2));
    return;
  }

  const [a, w, e] = await Promise.all([
    DB.query('SELECT id, state, status, created_at, updated_at FROM task_archives WHERE id = $1', [ARCHIVE_ID]),
    DB.query('SELECT command_id, status, summary, completed_at FROM task_worker_results WHERE archive_id = $1', [ARCHIVE_ID]),
    DB.query('SELECT event_type, actor, created_at FROM task_archive_events WHERE archive_id = $1 ORDER BY created_at', [ARCHIVE_ID])
  ]);

  console.log(`\n📋 task_archives (id=${ARCHIVE_ID}):`);
  console.log(JSON.stringify(a.rows, null, 2) || '  (空)');

  console.log('\ntask_worker_results:');
  console.log(JSON.stringify(w.rows, null, 2) || '  (空)');

  console.log('\ntask_archive_events:');
  console.log(JSON.stringify(e.rows, null, 2) || '  (空)');

  await DB.end();
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
