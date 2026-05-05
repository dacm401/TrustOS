/**
 * run-e2e.cjs — 一键端到端：发请求 → 查 DB → 等完成 → 跑诊断
 * 用法: node run-e2e.cjs
 */
const http = require('http');
const { Pool } = require('pg');

const DB = new Pool({
  connectionString: 'postgresql://postgres:postgres@localhost:5432/smartrouter'
});

function httpPost(body) {
  return new Promise((resolve, reject) => {
    const opt = {
      hostname: 'localhost', port: 3001, path: '/api/chat',
      method: 'POST', timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': 'test-user-001',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = http.request(opt, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => resolve({ status: res.statusCode, data: d }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('🚀 Step 1: 发送 /api/chat 请求...\n');

  const res = await httpPost(JSON.stringify({
    message: '请分析2024年全球人工智能行业的发展趋势和主要投资机会',
    session_id: 'e2e-' + Date.now(),
    stream: 'false', language: 'zh'
  }));

  console.log(`HTTP ${res.status}\n`);
  let j;
  try { j = JSON.parse(res.data); } catch { console.log('非JSON:', res.data.substring(0,300)); process.exit(1); }

  console.log('响应:', JSON.stringify(j, null, 2).substring(0, 400), '\n');

  const commandId = j.task_id;
  if (!commandId) { console.log('❌ 无 task_id'); process.exit(1); }
  console.log(`✅ command_id = ${commandId}\n`);

  console.log('🔍 Step 2: 查 task_commands 获取 archive_id...');
  let archiveId = null;
  for (let i = 0; i < 15; i++) {
    const r = await DB.query('SELECT archive_id, status FROM task_commands WHERE id = $1', [commandId]);
    if (r.rows[0]?.archive_id) { archiveId = r.rows[0].archive_id; break; }
    process.stdout.write(`  等待 task_commands 写入... (${i+1}/15)\r`);
    await sleep(1000);
  }
  if (!archiveId) { console.log('\n❌ task_commands 中未找到 archive_id'); process.exit(1); }
  console.log(`\n✅ archive_id = ${archiveId}\n`);

  console.log('⏳ Step 3: 等待 worker 写 done（最多 180s）...');
  let finalState = null;
  for (let i = 0; i < 90; i++) {
    const r = await DB.query('SELECT state, length(result) as len FROM task_archives WHERE id = $1', [archiveId]);
    const row = r.rows[0];
    if (row && (row.state === 'done' || row.state === 'error')) {
      finalState = row;
      console.log(`\n✅ task_archives.state = ${row.state} (result ${row.len || 0} 字符)\n`); break;
    }
    process.stdout.write(`  轮询中... (${(i+1)*2}s)\r`);
    await sleep(2000);
  }
  if (!finalState) { console.log('\n❌ 超时，worker 未完成'); process.exit(1); }

  console.log('══════════════════════════════════════════════════');
  console.log('🎉 端到端成功！');
  console.log('══════════════════════════════════════════════════');
  console.log(`  command_id:  ${commandId}`);
  console.log(`  archive_id:  ${archiveId}`);
  console.log(`  state:       ${finalState.state}`);
  console.log('══════════════════════════════════════════════════\n');
  console.log('运行诊断:');
  console.log(`  node diagnose.cjs ${archiveId}\n`);

  await DB.end();
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
