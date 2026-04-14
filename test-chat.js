const http = require('http');

function testChat(message) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      messages: [{ role: 'user', content: message }]
    });

    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/api/chat',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': 'test-user',
        'Content-Length': data.length
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve(json);
        } catch {
          resolve({ raw: body.substring(0, 500) });
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log('=== Test 1: 今天好累啊 ===');
  const r1 = await testChat('今天好累啊');
  console.log('Decision:', JSON.stringify(r1.decision, null, 2));
  console.log('Response preview:', r1.response?.substring?.(0, 200) || r1.raw);

  console.log('\n=== Test 2: Python和JavaScript有什么区别 ===');
  const r2 = await testChat('Python和JavaScript有什么区别');
  console.log('Decision:', JSON.stringify(r2.decision, null, 2));
  console.log('Response preview:', r2.response?.substring?.(0, 200) || r2.raw);

  console.log('\n=== Test 3: 帮我把这句话翻译成英文：我今天很开心 ===');
  const r3 = await testChat('帮我把这句话翻译成英文：我今天很开心');
  console.log('Decision:', JSON.stringify(r3.decision, null, 2));
  console.log('Response preview:', r3.response?.substring?.(0, 200) || r3.raw);
}

main().catch(console.error);
