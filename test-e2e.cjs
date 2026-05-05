/**
 * test-e2e.cjs — 端到端测试完整流程
 * 1. 调用 /api/chat 触发委托，拿到 task_id (command_id)
 * 2. 从 DB 查询 archive_id
 * 3. 等待 worker 完成，跑 diagnose.cjs
 */
const http = require('http');
const { Pool } = require('pg');

const DB = new Pool({
  connectionString: 'postgresql://postgres:postgres@localhost:5432/smartrouter'
});

const BODY = JSON.stringify({
  message: '请帮我详细分析一下2024年全球人工智能行业的发展趋势和投资机会',
  session_id: 'test-session-' + Date.now(),
  stream: 'false',
  language: 'zh'
});

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/chat',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-User-Id': 'test-user-001',
    'Content-Length': Buffer.byteLength(BODY)
  },
  timeout: 30000
};

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getArchiveId(commandId) {
  const r = await DB.query(
    'SELECT archive_id FROM task_commands WHERE id = $1',
    [commandId]
  );
  return r.rows[0]?.archive_id || null;
}

async function waitForDone(archiveId, maxWait = 180) {
  const start = Date.now();
  while ((Date.now() - start) / 1000 < maxWait) {
    const r = await DB.query(
      'SELECT state, result FROM task_archives WHERE id = $1',
      [archiveId]
    );
    const row = r.rows[0];
    if (row && (row.state === 'done' || row.state === 'error')) {
      return row;
    }
    await sleep(2000);
  }
  return null;
}

console.log('🚀 Step 1: 发送 /api/chat 请求（触发委托）...\n');

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (c) => { data += c; });
  res.on('end', async () => {
    console.log(`HTTP ${res.statusCode}`);
    if (res.statusCode !== 200) {
      console.log('🔴 错误:', data.substring(0, 500));
      process.exit(1);
    }

    const j = JSON.parse(data);
    console.log(`  决策类型:  ${j.decision_type}`);
    console.log(`  routing:    ${j.routing_layer}`);
    console.log(`  回复:       ${(j.content || '').substring(0, 60)}`);
    console.log(`  task_id:    ${j.task_id || 'N/A'}`);
    console.log(`  delegation: ${JSON.stringify(j.delegation || {})}\n`);

    const commandId = j.task_id;
    if (!commandId) {
      console.log('⚠️  未返回 task_id，无法继续');
      process.exit(1);
    }

    console.log('🔍 Step 2: 从 DB 查询 archive_id...');
    let archiveId = await getArchiveId(commandId);
    let retries = 0;
    while (!archiveId && retries < 10) {
      await sleep(1000);
      archiveId = await getArchiveId(commandId);
      retries++;
    }

    if (!archiveId) {
      console.log('🔴 在 task_commands 中未找到 archive_id');
      console.log('   可能 command 还未写入，查看 task_commands...');
      const r = await DB.query('SELECT id, archive_id, status FROM task_commands ORDER BY id DESC LIMIT 3');
      console.log(JSON.stringify(r.rows, null, 2));
      process.exit(1);
    }

    console.log(`  ✅ command_id:  ${commandId}`);
    console.log(`  ✅ archive_id:  ${archiveId}}\n`);

    console.log('⏳ Step 3: 等待 worker 完成（最多 180s）...');
    const result = await waitForDone(archiveId);
    if (!result) {
      console.log('🔴 等待超时，worker 可能未运行或出错');
      console.log('   运行诊断: node diagnose.cjs ' + archiveId);
      process.exit(1);
    }

    console.log(`  ✅ task_archives.state = ${result.state}`);
    console.log(`  ✅ 结果长度: ${(result.result || '').length} 字符\n`);

    console.log('═'.repeat(60));
    console.log('🎉 端到端成功！');
    console.log('═'.repeat(60));
    console.log(`  command_id:  ${commandId}`);
    console.log(`  archive_id:  ${archiveId}`);
    console.log('\n运行诊断:');
    console.log(`  node diagnose.cjs ${archiveId}`);
    console.log('═'.repeat(60));

    await DB.end();
  });
});

req.on('error', (e) => console.error('❌', e.message));
req.write(BODY);
req.end();
