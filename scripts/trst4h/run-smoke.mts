/**
 * TRST-4H — Manager Routing Intelligence v0 — Smoke
 *
 * Minimal deterministic checks that the hybrid classifier:
 *   - preserves the keyword fast-path (delegate / clarification)
 *   - classifies ambiguous math / problem-solving prompts as delegate
 *   - classifies greetings as normal
 *   - classifies under-specified questions as ask_clarification
 *
 * Run: npx tsx scripts/trst4h/run-smoke.mts
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

console.log("TRST-4H Routing Intelligence — Smoke");

// Keyword fast-path: delegate.
check("24-point puzzle → delegate", classifyManagerIntent("请用3、4、9、10拼出24点").route === "delegate");
check("explicit task → delegate", classifyManagerIntent("帮我分析这个问题").route === "delegate");
check("solve problem → delegate", classifyManagerIntent("求解下面的问题").route === "delegate");
check("design plan → delegate", classifyManagerIntent("设计一个方案").route === "delegate");

// Keyword fast-path: clarification.
check("what does this mean → ask_clarification", classifyManagerIntent("这个什么意思").route === "ask_clarification");

// Heuristic: greeting → normal.
check("greeting → normal", classifyManagerIntent("你好，今天天气怎么样").route === "normal");

// Heuristic: under-specified question → ask_clarification.
check("short question → ask_clarification", classifyManagerIntent("怎么弄？").route === "ask_clarification");

// Heuristic: substantive problem-solving → delegate.
check("analyze report → delegate", classifyManagerIntent("请帮我评估一下这个系统的性能瓶颈并给出优化建议").route === "delegate");

// Source attribution on keyword path.
check("keyword source tagged", classifyManagerIntent("帮我生成一份报告").source === "keyword");

console.log(`\nSmoke: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
