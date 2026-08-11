import http from 'http';

const data = JSON.stringify({
  user_input: '创建一个简洁的个人简介网页，包含姓名、职位和联系方式',
  session_id: 's94p-e2e-004',
  mode: 'fast',
});

const req = http.request(
  {
    hostname: 'localhost',
    port: 3001,
    path: '/api/chat',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': 'user-001',
      'Content-Length': Buffer.byteLength(data),
    },
    timeout: 120000,
  },
  (res) => {
    let body = '';
    res.on('data', (c) => (body += c));
    res.on('end', () => {
      console.log('Status:', res.statusCode);
      console.log('Length:', body.length);
      const hasDone = body.includes('"type":"done"');
      const hasCost = body.includes('"cost"');
      const hasResult = body.includes('"hasResult":true');
      const noLeak = !body.includes('sk-pbmbwdx');
      console.log('hasDone:', hasDone);
      console.log('hasCost:', hasCost);
      console.log('hasResult:', hasResult);
      console.log('noLeak:', noLeak);
      const events = (body.match(/data:/g) || []).length;
      console.log('SSE events:', events);

      if (!hasDone) {
        console.log('\n=== Body preview (first 500 chars) ===');
        console.log(body.slice(0, 500));
      }
    });
  }
);

req.on('error', (e) => console.log('Error:', e.message));
req.write(data);
req.end();
