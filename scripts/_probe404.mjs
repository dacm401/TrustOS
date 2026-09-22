import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
const bad = [];
page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });

await page.goto('http://127.0.0.1:3000/login', { waitUntil: 'load' });
await page.fill('input#username', 'admin');
await page.fill('input#password', 'changeme');
await page.click('button:has-text("登录")');
await page.waitForTimeout(2500);

for (const nav of ['任务', '审计']) {
  const btn = page.locator('aside button', { hasText: nav }).first();
  if (await btn.count()) { await btn.click().catch(() => {}); await page.waitForTimeout(2500); }
}
console.log('non-2xx responses:');
console.log(bad.length ? [...new Set(bad)].join('\n') : '(none)');
await browser.close();
