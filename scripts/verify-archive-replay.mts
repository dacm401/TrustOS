/**
 * Verify archive replay (restoring the 04-16 O-005 "查档案库" capability).
 *
 * Run: npx tsx scripts/verify-archive-replay.mts
 *
 * Two things matter equally:
 *   1. It REPLAYS near-identical questions (the O(1) token win).
 *   2. It REFUSES to replay when it would be wrong — a stale but plausible
 *      answer is worse than a slow fresh one, so the gates are the real
 *      feature here, not the shortcut.
 */

import {
  findReplayableAnswer,
  renderReplay,
  getReplayMode,
} from "../src/services/archive-replay.js";
import {
  jaccardSimilarity,
  keywordRelevance,
  tokenize,
  estimateTokens,
  isTimeSensitive,
} from "../src/services/text/similarity.js";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("\n── 1. Shared tokenizer (CJK bigram) ────────────────────");
{
  check("CJK split into bigrams", tokenize("测试框架").length >= 2, JSON.stringify(tokenize("测试框架")));
  check("latin kept as words", tokenize("use vitest").includes("vitest"), JSON.stringify(tokenize("use vitest")));
  check("empty → []", tokenize("").length === 0);
}

console.log("\n── 2. Similarity metrics ───────────────────────────────");
{
  check("identical → 1", jaccardSimilarity("写一个快速排序", "写一个快速排序") === 1);
  check("unrelated → low", jaccardSimilarity("写一个快速排序", "今天天气怎么样") < 0.3,
    String(jaccardSimilarity("写一个快速排序", "今天天气怎么样")));
  check("token estimate CJK-aware", estimateTokens("中文") > estimateTokens("ab"));

  // ── REGRESSION: replay must use COVERAGE, not Jaccard ──
  // Jaccard is diluted by length difference: a longer archived question that
  // fully contains the current one scores only 0.75. With the 0.9 gate that
  // would mean replay only ever fires on byte-identical questions — i.e. the
  // feature would be dead. Coverage ("is every point of my query present in
  // the archived question?") is both the correct semantics and the safe
  // direction. Do not switch back to Jaccard.
  check("coverage: longer archive entry still scores 1.0",
    keywordRelevance("写一个快速排序", "写一个快速排序算法") === 1,
    String(keywordRelevance("写一个快速排序", "写一个快速排序算法")));
  check("coverage: extra requirements lower the score (safe refusal)",
    keywordRelevance("写一个带类型注解的快速排序", "写一个快速排序") < 1,
    String(keywordRelevance("写一个带类型注解的快速排序", "写一个快速排序")));
  check("coverage: unrelated → low",
    keywordRelevance("写一个快速排序", "今天天气怎么样") < 0.3,
    String(keywordRelevance("写一个快速排序", "今天天气怎么样")));
}

console.log("\n── 3. Time-sensitivity gate (safety critical) ──────────");
{
  const sensitive = ["今天天气怎么样", "现在几点了", "最新消息是什么", "股价现在多少", "明天会下雨吗"];
  for (const t of sensitive) {
    check(`detects "${t}"`, isTimeSensitive(t) === true);
  }
  const safe = ["写一个快速排序", "解释一下什么是哈希表", "我的测试怎么跑"];
  for (const t of safe) {
    check(`allows "${t}"`, isTimeSensitive(t) === false);
  }
}

console.log("\n── 4. Replay refuses time-sensitive questions ──────────");
{
  // Even with an archive present, time-sensitive queries must NOT replay.
  const r = await findReplayableAnswer("u", "今天天气怎么样");
  check("no hit for time-sensitive", r.hit === null);
  check("reason recorded", r.reason === "time_sensitive_query", r.reason);
}

console.log("\n── 5. Replay honors the off switch ─────────────────────");
{
  process.env.TRUSTOS_ARCHIVE_REPLAY = "off";
  check("mode reads off", getReplayMode() === "off");
  const r = await findReplayableAnswer("u", "写一个快速排序");
  check("no hit when disabled", r.hit === null);
  check("reason = replay_disabled", r.reason === "replay_disabled", r.reason);
  delete process.env.TRUSTOS_ARCHIVE_REPLAY;
  check("mode back to direct", getReplayMode() === "direct");
}

console.log("\n── 6. Empty / missing input ────────────────────────────");
{
  check("empty message", (await findReplayableAnswer("u", "")).hit === null);
  check("empty user", (await findReplayableAnswer("", "hi")).hit === null);
}

console.log("\n── 7. Degrades safely without a DB ─────────────────────");
{
  // No DATABASE_URL in this process: must return "no hit", never throw.
  const r = await findReplayableAnswer("u", "写一个快速排序算法");
  check("returns a result", r !== null && typeof r.reason === "string");
  check("no crash", r.hit === null);
  check("reason is one of the known values",
    ["no_similar_archive_entry", "archive_lookup_failed", "time_sensitive_query"].includes(r.reason),
    r.reason);
}

console.log("\n── 8. Replay rendering is honest ───────────────────────");
{
  const fakeEntry: any = {
    id: "i1", task_id: "t1", user_id: "u", session_id: "s",
    original_message: "写一个快速排序",
    delegation_prompt: "p", slow_result: "def quick_sort(...)",
    related_task_ids: [], status: "completed",
    processing_ms: 100, created_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  };
  const out = renderReplay({ entry: fakeEntry, score: 0.95 });
  check("contains the archived answer", out.includes("quick_sort"));
  check("labels it as historical", out.includes("历史档案命中"));
  check("states no model call", out.includes("未调用模型"));
  check("shows similarity", out.includes("95%"));
  check("tells user how to refresh", out.includes("重新提问"));
}

console.log("\n── 9. Threshold is conservative by default ─────────────");
{
  delete process.env.TRUSTOS_ARCHIVE_REPLAY_THRESHOLD;
  // Default is 0.9 — near-identical only. Confirm via behaviour: a merely
  // related question must NOT be replayable.
  const r = await findReplayableAnswer("u", "讲讲排序算法");
  check("loosely related does not replay", r.hit === null, r.reason);
}

console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILURES"}: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
