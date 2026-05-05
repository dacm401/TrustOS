/**
 * wait-done.cjs — 等待 worker 完成，然后跑诊断
 * 用法: node wait-done.cjs <archive_id>
 */
const { Pool } = require('pg');
const { execSync } = require('child_process');
const DB = new Pool({ connectionString: 'postgresql://postgres:postgres@localhost:5432/smartrouter' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const ARCHIVE_ID = process.argv[2];
if (!ARCHIVE_ID) { console.error('用法: node wait-done.cjs <archive_id>'); process.exit(1); }

async function main() {
  console.log(`⏳ 等待 worker 完成，archive_id = ${ARCHIVE_ID}...\n`);

  let result = null;
  for (let i = 0; i < 90; i++) {
    const r = await DB.query(
      'SELECT id, state, status FROM task_archives WHERE id = $1',
      [ARCHIVE_ID]
    );
    const row = r.rows[0];
    if (row) {
      process.stdout.write(`  [${i*2}s] state=${row.state} status=${row.status}\r`);
      if (row.state === 'done' || row.state === 'error') {
        result = row;
        console.log(`\n\n✅ 完成! state=${row.state}\n`);
        break;
      }
    } else {
      process.stdout.write(`  [${i*2}s] task_archives 记录未找到\r`);
    }
    await sleep(2000);
  }

  if (!result) {
    console.log('\n❌ 超时，worker 未完成');
    console.log('   检查 worker 是否在运行，或查看后端日志');
    await DB.end();
    process.exit(1);
  }

  // 跑诊断
  console.log('🔍 运行 diagnose.cjs...\n');
  await DB.end();

  // 用 child_process 运行 diagnose.cjs
  try {
    const output = execSync(`node diagnose.cjs ${ARCHIVE_ID}`, {
      cwd: __dirname,
      encoding: 'utf8',
      timeout: 10000
    });
    console.log(output);
  } catch (e) {
    console.error('诊断脚本错误:', e.message);
    if (e.stdout) console.log(e.stdout);
  }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
