// Regression: every nav view opens without console errors, and evidence
// wording is no longer ambiguous.
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 100)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 100)); });

await page.goto('http://127.0.0.1:3000/login', { waitUntil: 'load' });
await page.fill('input#username', 'admin');
await page.fill('input#password', 'changeme');
await page.click('button:has-text("登录")');
await page.waitForTimeout(2500);

let pass = 0, fail = 0;
const check = (n, c, d) => { c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n}${d ? ' — ' + d : ''}`)); };

const NAVS = ['任务', '记忆', '归档', '委托', '权限', '仪表盘', '审计', '对话'];

for (const nav of NAVS) {
  const before = errs.length;
  const btn = page.locator('aside button', { hasText: nav }).first();
  if (await btn.count()) {
    await btn.click().catch(() => {});
    await page.waitForTimeout(1800);
    const newErrs = errs.length - before;
    const body = await page.evaluate(() => document.body.innerText);
    check(`「${nav}」可打开且无新增错误`, newErrs === 0 && body.length > 0,
      `errs=${newErrs} len=${body.length}`);
  } else {
    check(`「${nav}」入口存在`, false, 'not found');
  }
}

// Evidence wording disambiguation — must select a task first, otherwise the
// detail pane shows "select a task" and no evidence block exists.
const taskBtn = page.locator('aside button', { hasText: '任务' }).first();
await taskBtn.click().catch(() => {});
await page.waitForTimeout(2000);
// Task rows render a relative timestamp ("1天前"), so match on that.
const firstTask = page.locator('main').getByText(/前$/).first();
if (await firstTask.count()) { await firstTask.click().catch(() => {}); await page.waitForTimeout(2500); }
const txt = await page.evaluate(() => document.body.innerText);
check('任务详情含「关联证据」区块', txt.includes('关联证据'),
  txt.slice(0, 120).replace(/\n/g, ' '));
check('工作台不再有三个同名「证据」入口', !txt.includes('任务证据'),
  '仍出现「任务证据」（应为「调用明细」）');

console.log('\n累计页面错误:', errs.length ? errs.slice(0, 4) : 'none');
console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}: ${pass} passed, ${fail} failed\n`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
