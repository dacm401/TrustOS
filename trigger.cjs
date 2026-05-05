/**
 * trigger.cjs — 只发请求，拿到 task_id 和 archive_id 立即退出
 * 用法: node trigger.cjs
 */
const http = require('http');
const { Pool } = require('pg');
const DB = new Pool({ connectionString: 'postgresql://postgres:postgres@localhost:5432/smartrouter' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const body = JSON.stringify({
  message: '请分析2024年全球人工智能行业的发展趋势和主要投资机会',
  session_id: 'e2e-' + Date.now(),
  stream: 'false', language: 'zh'
});

const opt = {
  hostname: 'localhost', port: 3001, path: '/api/chat', method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-User-Id': 'test-user-001',
             'Content-Length': Buffer.byteLength(body) },
  timeout: 30000
};

console.log('🚀 发送请求...');
const req = http.request(opt, async (res) => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', async () => {
    console.log(`HTTP ${res.statusCode}`);
    let j;
    try { j = JSON.parse(d); } catch { console.log('非JSON:', d.substring(0,300)); process.exit(1); }
    console.log('响应:', JSON.stringify(j, null, 2).substring(0, 400));

    const cmdId = j.task_id;           // 响应里的 task_id
    const realArchiveId = j.delegation?.task_id || null;  // 这才是真正的 archive_id
    if (!cmdId) { console.log('❌ 无 task_id'); process.exit(1); }

    // 查 task_commands（archive_id 列存的是响应 task_id）
    let realCommandId = null;
    for (let i = 0; i < 20; i++) {
      const r = await DB.query(
        'SELECT id, archive_id, status FROM task_commands WHERE archive_id = $1',
        [cmdId]
      );
      if (r.rows[0]) { realCommandId = r.rows[0].id; break; }
      await sleep(500);
    }

    console.log(`\n✅ task_commands.id:                ${realCommandId || '(null)'}`);
    console.log(`✅ response.task_id (存于 archive_id 列): ${cmdId}`);
    console.log(`✅ response.delegation.task_id (= archive_id): ${realArchiveId || '(null)'}\n`);

    console.log('════════════════════════════════════');
    if (realArchiveId) {
      console.log('运行诊断:');
      console.log(`  node diagnose.cjs ${realArchiveId}`);
    } else {
      console.log('⚠️  响应中无 delegation.task_id');
    }
    console.log('════════════════════════════════════\n');

    await DB.end();
    process.exit(0);
  });
});
req.on('error', e => { console.error('❌', e.message); process.exit(1); });
req.write(body);
req.end();
