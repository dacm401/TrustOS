/**
 * check-db.cjs — 根据已知 ID 查 DB 状态（列名已校准）
 */
const { Pool } = require('pg');
const DB = new Pool({ connectionString: 'postgresql://postgres:postgres@localhost:5432/smartrouter' });

const COMMAND_ID = '881cdde9-2be9-44c5-83b7-b010fa85753c';
const ARCHIVE_ID = 'b5f2170d-b989-4481-81b7-97dbf122a90d';

async function main() {
  console.log('🔍 查询 DB 状态（列名已校准）...\n');

  // 1. task_commands
  const c = await DB.query(
    'SELECT id::text, archive_id, status, issued_at, finished_at FROM task_commands WHERE id = $1',
    [COMMAND_ID]
  );
  console.log('📋 task_commands:');
  console.log(JSON.stringify(c.rows, null, 2) || '  (空)');

  // 2. task_archives（用 delegation.task_id = archive.id）
  const a = await DB.query(
    'SELECT id, state, status, created_at, updated_at FROM task_archives WHERE id = $1',
    [ARCHIVE_ID]
  );
  console.log('\ntask_archives (by delegation.task_id):');
  console.log(JSON.stringify(a.rows, null, 2) || '  (空)');

  // 3. task_commands.archive_id 指向的 task_archives（如果不为 null）
  if (c.rows[0]?.archive_id) {
    const a2 = await DB.query(
      'SELECT id, state, status FROM task_archives WHERE id = $1',
      [c.rows[0].archive_id]
    );
    console.log('\ntask_archives (by task_commands.archive_id):');
    console.log(JSON.stringify(a2.rows, null, 2) || '  (空)');
  }

  // 4. task_worker_results（结果在这里）
  const w = await DB.query(
    'SELECT command_id, archive_id, status, summary, length(result_json::text) as rlen, completed_at FROM task_worker_results WHERE archive_id = $1 LIMIT 3',
    [ARCHIVE_ID]
  );
  console.log('\ntask_worker_results:');
  console.log(JSON.stringify(w.rows, null, 2) || '  (空)');

  console.log('\n═════════════════════════════════');
  console.log('诊断命令:');
  console.log(`  node diagnose.cjs ${ARCHIVE_ID}`);
  console.log(`  node diagnose.cjs ${COMMAND_ID}`);
  console.log('═════════════════════════════════\n');

  await DB.end();
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
