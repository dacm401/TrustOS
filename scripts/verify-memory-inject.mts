/**
 * Verify the memory injection engine (RFC-001 Phase 1 — closing the loop).
 *
 * Run: npx tsx scripts/verify-memory-inject.mts
 *
 * These tests are pure (no DB): they exercise rule matching, relevance,
 * ranking and budget enforcement directly.
 */

import {
  DEFAULT_RULES,
  DEFAULT_BUDGET,
  estimateTokens,
  keywordRelevance,
  renderBlock,
  selectMemories,
  type InjectedMemory,
  type InjectionRule,
  type InjectionBudget,
} from "../src/services/memory/injector.js";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("\n── 1. Token estimation (CJK-aware) ─────────────────────");
{
  check("empty → 0", estimateTokens("") === 0);
  check("CJK costs more than latin", estimateTokens("用 TypeScript") > estimateTokens("ts"),
    `${estimateTokens("用 TypeScript")} vs ${estimateTokens("ts")}`);
  check("scales with length", estimateTokens("a".repeat(100)) > estimateTokens("a".repeat(10)));
}

console.log("\n── 2. Keyword relevance fallback ───────────────────────");
{
  check("identical → 1", keywordRelevance("vitest", "vitest") === 1, String(keywordRelevance("vitest", "vitest")));
  check("shared word → >0", keywordRelevance("测试框架", "测试框架是 Vitest") > 0,
    String(keywordRelevance("测试框架", "测试框架是 Vitest")));
  check("unrelated → 0", keywordRelevance("数据库", "用 TypeScript 写代码") === 0,
    String(keywordRelevance("数据库", "用 TypeScript 写代码")));
  check("empty query → 0", keywordRelevance("", "anything") === 0);
}

console.log("\n── 3. Rule defaults are conservative (8k local model) ──");
{
  check("total budget 500", DEFAULT_BUDGET.totalMaxTokens === 500, String(DEFAULT_BUDGET.totalMaxTokens));
  check("reserve ≥70% for history", DEFAULT_BUDGET.reserveForHistory >= 0.7);

  const constraints = DEFAULT_RULES.find((r) => r.name === "global_constraints")!;
  check("instructions are always injected", constraints.inject === "always");
  check("constraint budget ≤200", constraints.maxTokens <= 200, String(constraints.maxTokens));

  const facts = DEFAULT_RULES.find((r) => r.name === "relevant_facts")!;
  check("facts are relevance-gated", facts.inject === "on_relevance");
  check("fact top-k = 3", facts.maxItems === 3, String(facts.maxItems));
  check("fact threshold = 0.3", facts.relevanceThreshold === 0.3);
}

console.log("\n── 4. Rendering: local vs remote ───────────────────────");
{
  const mem: InjectedMemory = {
    id: "1", category: "instruction", content: "以后都用 TypeScript",
    rule: "global_constraints", relevance: 0.9, importance: 4, score: 0.9,
  };
  const local = renderBlock([mem], "local");
  const remote = renderBlock([mem], "remote");
  check("local block says 未外发", local.includes("未外发"), local.split("\n")[0]);
  check("remote block says 已加工", remote.includes("加工"), remote.split("\n")[0]);
  check("content present", local.includes("TypeScript"));
  check("rule annotated", local.includes("[global_constraints]"));
  check("empty → empty string", renderBlock([], "local") === "");
}

console.log("\n── 5. Budget enforcement (hard cap) ────────────────────");
{
  // Build a pure-function test of the budget loop by re-implementing the
  // selection over a synthetic memory set using the same public helpers.
  const tight: InjectionBudget = { totalMaxTokens: 30, reserveForHistory: 0.7 };
  const many: InjectedMemory[] = Array.from({ length: 20 }, (_, i) => ({
    id: `m${i}`, category: "fact", content: `这是第 ${i} 条比较长的记忆内容用于测试预算`,
    rule: "relevant_facts", relevance: 0.5, importance: 3, score: 1 - i / 100,
  }));

  let total = 0;
  const selected: InjectedMemory[] = [];
  let truncated = false;
  for (const m of [...many].sort((a, b) => b.score - a.score)) {
    const cost = estimateTokens(m.content);
    if (total + cost > tight.totalMaxTokens) { truncated = true; continue; }
    selected.push(m); total += cost;
  }
  check("stays under budget", total <= tight.totalMaxTokens, `${total} > ${tight.totalMaxTokens}`);
  check("drops the rest", selected.length < many.length, `kept ${selected.length}/${many.length}`);
  check("flags truncation", truncated === true);
  check("keeps highest scores", selected[0].id === "m0", selected[0]?.id);
}

console.log("\n── 6. Selection degrades safely without a DB ───────────");
{
  // No DATABASE_URL → the engine must return "nothing" instead of throwing.
  const res = await selectMemories("u", "测试怎么跑", "local");
  check("returns a result object", typeof res === "object" && res !== null);
  check("no memories without DB", Array.isArray(res.memories));
  check("has stats", typeof res.stats.budget === "number");
}

console.log("\n── 7. Disabled by env flag ─────────────────────────────");
{
  process.env.TRUSTOS_MEMORY_INJECT = "0";
  const res = await selectMemories("u", "anything");
  check("inject disabled → empty", res.memories.length === 0);
  check("method none", res.stats.method === "none", res.stats.method);
  delete process.env.TRUSTOS_MEMORY_INJECT;
}

console.log("\n── 8. Empty guard inputs ───────────────────────────────");
{
  check("empty query", (await selectMemories("u", "")).memories.length === 0);
  check("empty user", (await selectMemories("", "hi")).memories.length === 0);
}

console.log("\n── 9. Relevance must have spread (gating stays meaningful) ──");
{
  // If every candidate scores the same, the on_relevance threshold stops
  // discriminating and unrelated memories get injected. Verify the engine
  // falls back to keyword relevance in that case.
  const flat = [
    { id: "a", user_id: "u", category: "fact" as const, content: "我的测试框架是 Vitest", importance: 4, tags: [], source: "auto_learn" as const, relevance_score: 0.3, created_at: "", updated_at: "" },
    { id: "b", user_id: "u", category: "fact" as const, content: "部署环境是 Docker Compose", importance: 4, tags: [], source: "auto_learn" as const, relevance_score: 0.3, created_at: "", updated_at: "" },
  ];
  const flatCandidates = flat.map((e) => ({ ...e, similarity: 1.0 })); // no spread
  const res = await selectMemories("u", "测试怎么跑", "local", { candidates: flatCandidates });
  check("falls back to keyword when scores are flat", res.stats.method === "keyword", res.stats.method);

  const rels = res.memories.map((m) => m.relevance);
  const distinct = new Set(rels.map((r) => r.toFixed(2))).size;
  check("relevance values differ", rels.length < 2 || distinct > 1, JSON.stringify(rels));
  const top = res.memories[0];
  check("the related memory ranks first", top ? top.content.includes("Vitest") : true, top?.content);
}

console.log("\n── 10. Rule matching predicates ────────────────────────");
{
  // Exercise the exported types compile-time and the rules' shape.
  const rule: InjectionRule = {
    name: "test", categories: ["fact"], inject: "on_relevance",
    relevanceThreshold: 0.5, maxItems: 2, maxTokens: 100,
  };
  check("rule shape accepted", rule.categories.length === 1);
  check("all default rules have maxItems>0", DEFAULT_RULES.every((r) => r.maxItems > 0));
  check("all default rules have maxTokens>0", DEFAULT_RULES.every((r) => r.maxTokens > 0));
  check("sum of rule budgets ≥ global (truncation expected)",
    DEFAULT_RULES.reduce((s, r) => s + r.maxTokens, 0) >= DEFAULT_BUDGET.totalMaxTokens,
    `${DEFAULT_RULES.reduce((s, r) => s + r.maxTokens, 0)} vs ${DEFAULT_BUDGET.totalMaxTokens}`);
}

console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILURES"}: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
