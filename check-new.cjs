/**
 * check-new.cjs — 用最新 ID 查 DB
 */
const { Pool } = require('pg');
const DB = new Pool({ connectionString: 'postgresql://postgres:postgres@localhost:5432/smartrouter' });

const COMMAND_ID = 'a21f7814-6ae0-4cdb-8ab9-f59f211249a6';
const ARCHIVE_ID = 'db71c134-14c7-4ac2-acc0-95d37f6cae54';

async function main() {
  console.log('🔍 查询最新记录...\n');

  // 1. task_commands
  const c = await DB.query(
    'SELECT id::text, archive_id, status, issued_at, finished_at FROM task_commands WHERE id = $1',
    [COMMAND_ID]
  );
  console.log('📋 task_commands:');
  console.log(JSON.stringify(c.rows, null, 2) || '  (空)');

  // 2. task_archives（archive_id 来自 delegation.task_id）
  const a = await DB.query(
    'SELECT id, state, status, created_at, updated_at FROM task_archives WHERE id = $1',
    [ARCHIVE_ID]
  );
  console.log('\ntask_archives (by archive_id):');
  console.log(JSON.stringify(a.rows, null, 2) || '  (空)');

  // 3. task_worker_results
  const w = await DB.query(
    'SELECT command_id, archive_id, status, summary, length(result_json::text) as rlen, completed_at FROM task_worker_results WHERE archive_id = $1 LIMIT 3',
    [ARCHIVE_ID]
  );
  console.log('\ntask_worker_results:');
  console.log(JSON.stringify(w.rows, null, 2) || '  (空)');

  // 4. 最新 3 条 task_commands（不管 ID）
  const latest = await DB.query(
    'SELECT id::text, archive_id, status FROM task_commands ORDER BY issued_at DESC LIMIT 3'
  );
  console.log('\n📋 task_commands 最新 3 条:');
  console.log(JSON.stringify(latest.rows, null, 2) || '  (空)');

  await DB.end();
}
main().catch(e => { console.error('❌', e.message); process.exit(1); });
