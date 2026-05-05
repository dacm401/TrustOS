/**
 * test-raw.cjs — 打印 /api/chat 原始响应
 */
const http = require('http');

const BODY = JSON.stringify({
  message: '请帮我详细分析一下2024年全球人工智能行业的发展趋势',
  session_id: 'test-session-' + Date.now(),
  stream: 'true',
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

console.log('🚀 发送请求...\n');
const req = http.request(options, (res) => {
  console.log(`HTTP ${res.statusCode} ${res.statusMessage}`);
  console.log(`Content-Type: ${res.headers['content-type']}\n`);
  console.log('── 原始响应体 ───────────────────────────────────');
  let raw = '';
  res.on('data', (c) => { raw += c; });
  res.on('end', () => {
    console.log(raw.substring(0, 2000));
    console.log('\n── 响应结束 ─────────────────────────────────────');
  });
});

req.on('error', (e) => console.error('❌', e.message));
req.write(BODY);
req.end();
