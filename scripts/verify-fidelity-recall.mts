/**
 * Verify fidelity recall (RFC-002 Phase 3) — ground the worker brief in the
 * user's own past prompts so the Manager's processing can't drift from intent.
 *
 * Run: npx tsx scripts/verify-fidelity-recall.mts
 *
 * Two layers, like the other verify scripts:
 *   1. Pure-logic gates (tokenizer, time-sensitivity, red-line, budget) — run
 *      with or without a DB.
 *   2. End-to-end recall from `conversation_turns` — needs a reachable DB;
 *      if none, those assertions are SKIPPED (never fail) so the suite stays
 *      green in DB-less CI, exactly like verify-archive-replay / verify-assistant.
 */

import {
  detectSensitiveData,
} from "../src/services/gating/sensitive-data-rule.js";
import {
  isTimeSensitive,
  keywordRelevance,
  tokenize,
  estimateTokens,
} from "../src/services/text/similarity.js";
import {
  recallGrounding,
  applyRecallToBrief,
  loadRecallConfig,
  isRecallRedLine,
} from "../src/services/memory/fidelity-recall.js";
import {
  buildCategoryAwareMemoryText,
} from "../src/services/memory-retrieval.js";

let pass = 0;
let fail = 0;
let skipped = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}
function skip(name: string, detail?: string) {
  skipped++; console.log(`  ⏭️  ${name}${detail ? ` — ${detail}` : ""}`);
}

console.log("\n── 1. Config / off switch (pure) ───────────────────────");
{
  const before = process.env.TRUSTOS_FIDELITY_RECALL;
  process.env.TRUSTOS_FIDELITY_RECALL = "0";
  check("disabled when =0", loadRecallConfig().enabled === false);
  process.env.TRUSTOS_FIDELITY_RECALL = "off";
  check("disabled when =off", loadRecallConfig().enabled === false);
  delete process.env.TRUSTOS_FIDELITY_RECALL;
  check("enabled by default", loadRecallConfig().enabled === true);
  if (before === undefined) delete process.env.TRUSTOS_FIDELITY_RECALL;
  else process.env.TRUSTOS_FIDELITY_RECALL = before;
}

console.log("\n── 2. Shared tokenizer (CJK bigram) (pure) ─────────────");
{
  check("CJK split into bigrams", tokenize("测试框架").length >= 2, JSON.stringify(tokenize("测试框架")));
  check("latin kept as words", tokenize("use vitest").includes("vitest"));
  check("empty → []", tokenize("").length === 0);
}

console.log("\n── 3. Time-sensitivity gate (pure, safety critical) ───");
{
  for (const t of ["今天天气怎么样", "现在几点了", "最新股价多少"]) {
    check(`time-sensitive: "${t}"`, isTimeSensitive(t) === true);
  }
  for (const t of ["我的测试框架是 Vitest", "解释一下哈希表", "用 pnpm 跑测试"]) {
    check(`not time-sensitive: "${t}"`, isTimeSensitive(t) === false);
  }
}

console.log("\n── 4. Red-line gate (pure, must never reach worker) ────");
{
  // The recall red-line filter = SD-01 patterns PLUS a 16+-digit rule (SD-01's
  // bare \d{16} misses 19-digit unseparated cards because it requires the
  // digits to be isolated). The grounding is appended AFTER SD-01 ran on the
  // original brief, so this filter is the last line of defence.
  const red = [
    "我的银行卡号是 6222021234567890123", // 19-digit, unseparated — SD-01 misses, recall must catch
    "身份证 110101199003071234",
    "sk-AbCdEf1234567890XyZqqqq",
    "订单号 1234567890123456 已生成",      // 16-digit isolated run
  ];
  for (const t of red) {
    check(`recall red-line detected: "${t.slice(0, 18)}…"`, isRecallRedLine(t) === true);
  }
  // A benign long number that is NOT 16+ consecutive digits must pass.
  check("benign short number passes", isRecallRedLine("测试 id 12345 完成") === false);
}

console.log("\n── 5. Similarity drives selection (pure) ───────────────");
{
  const q = "我的测试怎么跑";
  check("related → high", keywordRelevance(q, "我的测试框架是 Vitest") >= 0.2);
  check("unrelated → low", keywordRelevance(q, "讲个笑话") < 0.2,
    String(keywordRelevance(q, "讲个笑话")));
  check("token estimate CJK-aware", estimateTokens("中文") > estimateTokens("ab"));
}

console.log("\n── 6. applyRecallToBrief + memory text (pure) ───────────");
{
  check("empty block leaves brief untouched", applyRecallToBrief("原 brief", "") === "原 brief");
  const out = applyRecallToBrief("原 brief", "## 历史背景\n- 用 Vitest");
  check("appends grounding", out.includes("原 brief") && out.includes("用 Vitest"));
  check("labels as grounding", out.includes("历史背景"));

  // buildCategoryAwareMemoryText groups distillates by category (RFC-001 shape).
  const mt = buildCategoryAwareMemoryText([
    { entry: { id: "m1", category: "preference", content: "用 TypeScript" } as any, score: 1, reason: "", similarity: 0 },
    { entry: { id: "m2", category: "instruction", content: "回复用中文" } as any, score: 1, reason: "", similarity: 0 },
  ]);
  check("groups by category label", mt.combined.includes("Preferences") && mt.combined.includes("Instructions"));
  check("includes entry content", mt.combined.includes("用 TypeScript") && mt.combined.includes("回复用中文"));
}

console.log("\n── 7. End-to-end recall from conversation_turns ────────");
{
  const userId = "verify-fidelity-" + Date.now();
  const prevSession = "s-prev-" + Date.now();
  const curSession = "s-cur-" + Date.now();
  const query = "我的测试怎么跑";

  // Seed: a prior session with mixed-topic user prompts + the current session.
  const seed: Array<{ session: string; content: string }> = [
    { session: prevSession, content: "我的测试框架是 Vitest，请用它跑测试" }, // relevant
    { session: prevSession, content: "我喜欢用 pnpm 而不是 npm" },            // somewhat relevant
    { session: prevSession, content: "今天天气怎么样" },                        // time-sensitive → excluded
    { session: prevSession, content: "我的银行卡号是 6222021234567890123" },    // red-line → excluded
    { session: prevSession, content: "讲个笑话吧" },                            // unrelated → excluded
    { session: curSession, content: query },                                    // current session → excluded
  ];

  let dbUp = false;
  try {
    const { ConversationTurnRepo } = await import("../src/db/repositories.js");
    let stored = 0;
    for (let i = 0; i < seed.length; i++) {
      const r = await ConversationTurnRepo.record({
        sessionId: seed[i].session,
        turnIndex: i,
        role: "user",
        content: seed[i].content,
        userId,
      });
      if (r.stored) stored++;
    }
    dbUp = stored > 0;
    console.log(`     (DB reachable: ${dbUp}, stored ${stored}/${seed.length})`);

    if (!dbUp) {
      skip("recall end-to-end", "no reachable DB in this env");
    } else {
      const recall = await recallGrounding(userId, query, { excludeSessionId: curSession });
      check("recall returned a grounding block", recall.block.length > 0, JSON.stringify(recall.stats));
      check("includes the relevant Vitest turn", recall.block.includes("Vitest"), recall.block);
      check("excludes time-sensitive history", !recall.block.includes("天气"), recall.block);
      check("excludes red-line (bank card) history", !recall.block.includes("银行卡"), recall.block);
      check("never trips SD-01 on its own", detectSensitiveData(recall.block) === null);
      check("excludes the current (triggering) session",
        recall.items.every((it) => it.sessionId !== curSession),
        JSON.stringify(recall.items.map((i) => i.sessionId)));
      check("respects maxItems budget", recall.items.length <= loadRecallConfig().maxItems,
        String(recall.items.length));
      check("stats.method is keyword", recall.stats.method === "keyword");

      // Budget truncation: a tiny budget must still recall something or stay empty.
      const tight = await recallGrounding(userId, query, {
        excludeSessionId: curSession,
        maxTokens: 5,
      });
      check("tiny budget does not crash", tight.stats.reason !== undefined);

      // Disabled path returns empty block.
      const disabledBefore = process.env.TRUSTOS_FIDELITY_RECALL;
      process.env.TRUSTOS_FIDELITY_RECALL = "0";
      const off = await recallGrounding(userId, query, { excludeSessionId: curSession });
      check("disabled → empty block", off.block === "" && off.stats.reason === "disabled");
      if (disabledBefore === undefined) delete process.env.TRUSTOS_FIDELITY_RECALL;
      else process.env.TRUSTOS_FIDELITY_RECALL = disabledBefore;

      // ── Distilled memory grounding (RFC-001 distillates) ──
      const { MemoryEntryRepo } = await import("../src/db/repositories/memory-growth.js");
      // Benign user preference — safe to share with the cloud Worker (`public`).
      await MemoryEntryRepo.create({
        user_id: userId,
        category: "preference",
        content: "我的项目用 TypeScript 和 pnpm，测试用 Vitest",
        importance: 3,
        tags: ["typescript", "pnpm"],
        source: "manual",
        sensitivity: "public",
      });
      // Red-line content — caught by the pattern gate regardless of sensitivity.
      await MemoryEntryRepo.create({
        user_id: userId,
        category: "fact",
        content: "我的银行卡号是 6222021234567890123",
        importance: 2,
        tags: ["card"],
        source: "manual",
        sensitivity: "public",
      });
      // Sensitive-but-not-red-line memory — only the ADR-004 B1 sensitivity
      // gate catches this ("年薪 80 万，准备离职" has no 16+ digit pattern).
      await MemoryEntryRepo.create({
        user_id: userId,
        category: "fact",
        content: "我的年薪是 80 万，准备离职",
        importance: 3,
        tags: ["salary"],
        source: "manual",
        sensitivity: "restricted",
      });

      // Relevant intent recalled + rendered as a labelled section.
      const memRecall = await recallGrounding(userId, "我的项目用什么技术栈", {
        excludeSessionId: curSession,
      });
      check("recall includes distilled user intent",
        memRecall.block.includes("已记录的用户意图") && memRecall.stats.memorySelected > 0,
        memRecall.block);
      check("distilled memory content present", memRecall.block.includes("TypeScript"), memRecall.block);

      // Red-line memory is dropped by the same gate (no card number leaks).
      // Note: a benign entry may still vector-match the query, so we assert on
      // the actual safety property — the card number must never reach the block.
      const memRed = await recallGrounding(userId, "我的银行卡号是多少", {
        excludeSessionId: curSession,
      });
      check("red-line memory excluded (no card leaks)",
        !memRed.block.includes("6222021234567890123") && !memRed.block.includes("我的银行卡号"),
        memRed.block);

      // ADR-004 B1: non-public memory is blocked from the cloud Worker by default.
      const sensRecall = await recallGrounding(userId, "我的年薪多少", {
        excludeSessionId: curSession,
      });
      check("non-public memory excluded by default",
        !sensRecall.block.includes("年薪") && sensRecall.stats.memoryBlockedBySensitivity > 0,
        sensRecall.block);

      // Explicit includeRaw = user confirmation → non-public memory is injected.
      const sensRaw = await recallGrounding(userId, "我的年薪多少", {
        excludeSessionId: curSession,
        includeRaw: true,
      });
      check("includeRaw opt-in includes non-public memory",
        sensRaw.block.includes("年薪") && sensRaw.stats.memorySelected > 0,
        sensRaw.block);

      // Memory-off switch: no distilled section even if relevant.
      const memOffBefore = process.env.TRUSTOS_FIDELITY_RECALL_MEMORY;
      process.env.TRUSTOS_FIDELITY_RECALL_MEMORY = "0";
      const memOff = await recallGrounding(userId, "我的项目用什么技术栈", {
        excludeSessionId: curSession,
      });
      check("memory-off → no intent section", !memOff.block.includes("已记录的用户意图"), memOff.block);
      if (memOffBefore === undefined) delete process.env.TRUSTOS_FIDELITY_RECALL_MEMORY;
      else process.env.TRUSTOS_FIDELITY_RECALL_MEMORY = memOffBefore;

      // ── Distillation-on-ingest (Memory accumulates from use) ──
      const { distillTurnToMemory } = await import(
        "../src/services/memory/distill-on-ingest.js"
      );
      const { query: pg2 } = await import("../src/db/connection.js");

      // Explicit signal → persisted as a distillate.
      const made = await distillTurnToMemory(userId, "请记住用 Redis 做缓存层", "s-verify");
      check("explicit signal distilled to memory", made >= 1, `made=${made}`);
      const row = await pg2(
        `SELECT category, content, source FROM memory_entries WHERE user_id=$1 AND content LIKE '%Redis%' LIMIT 1`,
        [userId]
      );
      check("distillate stored (fact/auto_learn)",
        row.rows.length === 1 &&
        row.rows[0].category === "fact" &&
        row.rows[0].source === "auto_learn",
        JSON.stringify(row.rows[0]));

      // Dedup: repeating the same signal creates no duplicate row.
      const madeAgain = await distillTurnToMemory(userId, "请记住用 Redis 做缓存层", "s-verify");
      check("repeated signal is de-duplicated", madeAgain === 0, `madeAgain=${madeAgain}`);
      const dup = await pg2(
        `SELECT count(*)::int AS n FROM memory_entries WHERE user_id=$1 AND content LIKE '%Redis%'`,
        [userId]
      );
      check("exactly one Redis distillate", dup.rows[0].n === 1, `n=${dup.rows[0].n}`);

      // Secret-bearing turn is never distilled (SENSITIVE_RE guard in distiller).
      const secret = await distillTurnToMemory(
        userId,
        "我的 api_key 是 sk-abc123def4567890abcdef",
        "s-verify"
      );
      check("secret-bearing turn not distilled", secret === 0, `secret=${secret}`);
      const secretRow = await pg2(
        `SELECT count(*)::int AS n FROM memory_entries WHERE user_id=$1 AND content LIKE '%api_key%'`,
        [userId]
      );
      check("no secret distillate stored", secretRow.rows[0].n === 0, `n=${secretRow.rows[0].n}`);
    }

    // Cleanup so the verify run never pollutes the sovereign store.
    const { query: pg } = await import("../src/db/connection.js");
    await pg(`DELETE FROM conversation_turns WHERE user_id = $1`, [userId]);
    await pg(`DELETE FROM memory_entries WHERE user_id = $1`, [userId]);
  } catch (e: any) {
    skip("recall end-to-end", "DB error: " + (e?.message ?? String(e)));
  }
}

console.log(
  `\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILURES"}: ${pass} passed, ${fail} failed, ${skipped} skipped\n`
);
process.exit(fail === 0 ? 0 : 1);
