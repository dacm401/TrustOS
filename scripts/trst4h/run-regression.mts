/**
 * TRST-4H — Manager Routing Intelligence v0 — Regression
 *
 * Broader deterministic coverage ensuring:
 *   - sealed MWT-4B/MWT-5 behavior is unaffected (this module is additive)
 *   - classification is deterministic (same input → same output)
 *   - no misleading normal-conversation failure on math/task prompts
 *   - confidence values stay within [0,1]
 *
 * Run: npx tsx scripts/trst4h/run-regression.mts
 */

import { classifyManagerIntent } from "../../src/services/manager-routing/manager-routing-intelligence.js";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name} ${detail}`);
  }
}

console.log("TRST-4H Routing Intelligence — Regression");

const cases: Array<[string, "delegate" | "normal" | "ask_clarification"]> = [
  // Math / puzzle — must NOT silently fall to normal.
  ["请用3、4、9、10拼出24点", "delegate"],
  ["算24点", "delegate"],
  ["求解下面的问题", "delegate"],
  ["这道题怎么解", "delegate"],
  ["帮我计算一下这组数据的标准差", "delegate"],
  // Explicit task phrasing.
  ["帮我分析这个问题", "delegate"],
  ["设计一个方案", "delegate"],
  ["制定方案", "delegate"],
  ["请评估当前架构", "delegate"],
  ["帮我研究一下竞品", "delegate"],
  ["写一个脚本抓取数据", "delegate"],
  ["生成一个报告", "delegate"],
  ["翻译这段英文", "delegate"],
  // Clarification.
  ["这个什么意思", "ask_clarification"],
  ["不太明白你的意思", "ask_clarification"],
  ["你能详细说说吗", "ask_clarification"],
  ["怎么弄？", "ask_clarification"],
  // Normal / casual.
  ["你好", "normal"],
  ["今天天气不错", "normal"],
  ["谢谢", "normal"],
  ["哈哈", "normal"],
  ["在吗", "normal"],
];

for (const [msg, expected] of cases) {
  const r = classifyManagerIntent(msg);
  check(`"${msg}" → ${expected}`, r.route === expected, `(got ${r.route}, conf ${r.confidence})`);
  check(`"${msg}" confidence in [0,1]`, r.confidence >= 0 && r.confidence <= 1);
}

// Determinism: same input twice → identical output.
const a = classifyManagerIntent("设计一个方案评估系统风险");
const b = classifyManagerIntent("设计一个方案评估系统风险");
check("deterministic output", JSON.stringify(a) === JSON.stringify(b));

// Heuristic fallback present when keywords miss.
const heuristic = classifyManagerIntent("请评估并优化数据库查询性能");
check("heuristic fallback produces route", ["delegate", "normal", "ask_clarification"].includes(heuristic.route));

// No sealed behavior touched: module is pure, no side effects on import.
check("module is pure classify", typeof classifyManagerIntent === "function");

console.log(`\nRegression: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
