/**
 * Verify the L0 rule-based memory distiller (RFC-001 Phase 1).
 *
 * Run: npx tsx scripts/verify-memory-distiller.mts
 *
 * Two things matter equally:
 *   1. It EXTRACTS explicit signals correctly.
 *   2. It stays SILENT on ordinary text — a wrong memory misleads every later
 *      turn, so false positives are worse than misses.
 */

import {
  distilTurn,
  partitionByConfidence,
  toMemoryEntryInput,
  LOW_CONFIDENCE_THRESHOLD,
} from "../src/services/memory/distiller.js";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const has = (text: string, needle: string) =>
  distilTurn(text).some((e) => e.content.includes(needle));

console.log("\n── 1. Explicit 'remember' → fact ───────────────────────");
{
  const r = distilTurn("记住我的项目用的是 PostgreSQL");
  check("extracts fact", r.length >= 1, JSON.stringify(r));
  check("content carries the fact", r.some((e) => e.content.includes("PostgreSQL")), JSON.stringify(r));
  check("category = fact", r[0]?.category === "fact", r[0]?.category);
  check("high confidence", (r[0]?.confidence ?? 0) >= 0.9, String(r[0]?.confidence));
}

console.log("\n── 2. Standing instruction ─────────────────────────────");
{
  const r = distilTurn("以后都用 TypeScript 写代码");
  check("extracts instruction", r.some((e) => e.category === "instruction"), JSON.stringify(r));
  check("content preserved", r.some((e) => e.content.includes("TypeScript")), JSON.stringify(r));
}

console.log("\n── 3. Preference ───────────────────────────────────────");
{
  const r = distilTurn("我喜欢简洁的回答");
  check("extracts preference", r.some((e) => e.category === "preference"), JSON.stringify(r));
  check("content preserved", r.some((e) => e.content.includes("简洁")), JSON.stringify(r));
}
{
  const r = distilTurn("用 pnpm 不要再用 npm");
  check("captures tooling switch", r.some((e) => e.category === "preference"), JSON.stringify(r));
  check("records both sides", r.some((e) => e.content.includes("pnpm") && e.content.includes("npm")), JSON.stringify(r));
}

console.log("\n── 4. Decision ─────────────────────────────────────────");
{
  const r = distilTurn("我们决定用 Monorepo 结构");
  check("extracts decision", r.some((e) => e.content.includes("Monorepo")), JSON.stringify(r));
}

console.log("\n── 5. Constraint ───────────────────────────────────────");
{
  const r = distilTurn("不要在代码里硬编码密钥");
  check("extracts prohibition", r.some((e) => e.content.includes("硬编码密钥")), JSON.stringify(r));
  check("category = instruction", r.some((e) => e.category === "instruction"), JSON.stringify(r));
}
{
  const r = distilTurn("提交前必须跑一遍测试");
  check("extracts requirement", r.some((e) => e.content.includes("跑一遍测试")), JSON.stringify(r));
}

console.log("\n── 6. English signals ──────────────────────────────────");
{
  check("remember (en)", has("Please remember that I work in UTC+8", "UTC"));
  check("prefer (en)", has("I prefer dark mode", "dark mode"));
  check("always (en)", has("Always write tests first", "tests first"), JSON.stringify(distilTurn("Always write tests first")));
}

console.log("\n── 7. SILENCE on ordinary text (false-positive guard) ──");
{
  // These must NOT produce memories — over-extraction pollutes memory.
  const ordinary = [
    "帮我写一个快速排序算法",
    "今天天气怎么样",
    "解释一下什么是哈希表",
    "这个函数报错了，帮我看看",
    "hi",
    "把这段代码重构一下",
  ];
  for (const t of ordinary) {
    const r = distilTurn(t);
    check(`silent: "${t.slice(0, 16)}"`, r.length === 0, JSON.stringify(r.map((e) => e.content)));
  }
}

console.log("\n── 8. Secrets are never distilled ──────────────────────");
{
  const secrets = [
    "记住我的 key 是 sk-AbCdEf1234567890XyZqqqq",
    "以后都用这个 token: Bearer abcdef1234567890xyz",
    "记住 password: hunter2supersecret",
  ];
  for (const t of secrets) {
    const r = distilTurn(t);
    check(`refuses: "${t.slice(0, 22)}…"`, r.length === 0, JSON.stringify(r.map((e) => e.content)));
  }
}

console.log("\n── 9. Confidence partitioning ──────────────────────────");
{
  const entries = distilTurn("记住用 Redis 做缓存");
  const { active, pending } = partitionByConfidence(entries);
  check("high-confidence goes active", active.length === entries.length, `active=${active.length}`);
  check("nothing pending", pending.length === 0, `pending=${pending.length}`);
  check("threshold is 0.7", LOW_CONFIDENCE_THRESHOLD === 0.7);
}

console.log("\n── 10. Conversion to memory entry ──────────────────────");
{
  const entry = distilTurn("记住我的项目用 PostgreSQL")[0];
  const input = toMemoryEntryInput(entry, "admin", "turn-123");
  check("user_id set", input.user_id === "admin");
  check("source = auto_learn", input.source === "auto_learn", input.source);
  check("provenance in tags", input.tags.some((t) => t === "turn:turn-123"), JSON.stringify(input.tags));
  check("rule traced in tags", input.tags.some((t) => t.startsWith("rule:")), JSON.stringify(input.tags));
  check("importance in 1-5", input.importance >= 1 && input.importance <= 5, String(input.importance));
}

console.log("\n── 11. Overlap suppression (no redundant memories) ─────");
{
  // One sentence, one fact. Three rules can match this same span, but only
  // ONE entry should survive — otherwise retrieval returns duplicates and
  // the prompt wastes tokens repeating the same thing.
  const r = distilTurn("以后都用 pnpm 不要再用 npm");
  check("single entry for one fact", r.length === 1, `got ${r.length}: ${JSON.stringify(r.map((e) => e.content))}`);
  check("keeps the MOST COMPLETE match", (r[0]?.evidence.length ?? 0) >= 10, JSON.stringify(r[0]?.evidence));
  check("prefers instruction for standing rule", r[0]?.category === "instruction", r[0]?.category);
}
{
  // Two independent signals in one message → two entries (not suppressed).
  const r = distilTurn("记住用 Redis 做缓存。以后都用 TypeScript 写代码。");
  check("independent signals both kept", r.length === 2, `got ${r.length}: ${JSON.stringify(r.map((e) => e.content))}`);
}

console.log("\n── 12. No duplicate extraction ─────────────────────────");
{
  const r = distilTurn("记住A项目用 Redis。记住B项目也用 Redis。");
  const contents = r.map((e) => e.content);
  check("no exact duplicates", new Set(contents).size === contents.length, JSON.stringify(contents));
}

console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILURES"}: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
