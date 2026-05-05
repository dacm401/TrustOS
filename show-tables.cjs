/**
 * show-tables.cjs — 打印关键表的列结构
 */
const { Pool } = require('pg');
const DB = new Pool({ connectionString: 'postgresql://postgres:postgres@localhost:5432/smartrouter' });

async function main() {
  const tables = ['task_commands', 'task_archives', 'task_worker_results', 'task_archive_events'];
  for (const t of tables) {
    const r = await DB.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
      [t]
    );
    console.log(`📋 ${t}:`);
    if (r.rows.length === 0) console.log('  (表不存在)');
    else r.rows.forEach(row => console.log(`  ${row.column_name}  (${row.data_type})`));
    console.log('');
  }
  await DB.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
