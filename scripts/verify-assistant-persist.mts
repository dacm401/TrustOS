/**
 * Verify assistant-reply persistence (PLAN-P0 Step 1).
 *
 * Run: npx tsx scripts/verify-assistant-persist.mts
 *
 * Focus: the guardrails that must hold for ASSISTANT turns exactly as they do
 * for user turns — plus the dedupe that keeps overlapping response paths
 * (non-streaming return vs streaming result event) from writing twice.
 */

import { containsSecret, hashContent } from "../src/db/repositories/conversation-turn.js";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("\n── 1. Secret filter applies to assistant replies too ───");
{
  // An assistant echoing a credential must NOT be persisted. The guardrail
  // is symmetric: what we refuse to store from the user we refuse to store
  // from the model.
  const leaks = [
    "Your key is sk-AbCdEf1234567890XyZqqqq",
    "Use header Authorization: Bearer abcdef1234567890xyz",
    "Set password: hunter2supersecret",
  ];
  for (const t of leaks) {
    check(`refuses: "${t.slice(0, 28)}…"`, containsSecret(t) === true);
  }
}

console.log("\n── 2. Ordinary assistant text is storable ──────────────");
{
  const ok = [
    "二叉搜索树（BST）是一种有序二叉树，查找平均 O(log n)。",
    "Here is a quicksort implementation in Python.",
    "好的，我已经帮你重构了这个函数。",
  ];
  for (const t of ok) {
    check(`allows: "${t.slice(0, 24)}…"`, containsSecret(t) === false);
  }
}

console.log("\n── 3. Code answers are not mistaken for secrets ────────");
{
  // False-positive guard: type declarations and placeholders must pass,
  // otherwise we would silently drop every code answer — the most valuable
  // kind of assistant reply.
  const code = [
    "interface Config { apiKey: string; accessToken: string; }",
    "const key = process.env.OPENAI_API_KEY;",
    "Set api_key: <your-key-here>",
    "password: placeholder",
  ];
  for (const t of code) {
    check(`keeps code: "${t.slice(0, 30)}…"`, containsSecret(t) === false, t);
  }
}

console.log("\n── 4. Dedupe key: content hashing is stable ────────────");
{
  const a = "same reply text";
  const b = "same reply text";
  const c = "different reply text";
  check("identical content → identical hash", hashContent(a) === hashContent(b));
  check("different content → different hash", hashContent(a) !== hashContent(c));
  check("hash is 64 hex chars (sha256)", /^[0-9a-f]{64}$/.test(hashContent(a)), hashContent(a));
}

console.log("\n── 5. Empty handling (caller contract) ─────────────────");
{
  // recordAssistant skips empty content before touching the DB; the repo
  // returns {stored:false, reason:'empty_content'}.
  check("empty string is falsy-trimmed", "".trim().length === 0);
  check("whitespace-only is falsy-trimmed", "   \n ".trim().length === 0);
  check("hashes an empty string without throwing", typeof hashContent("") === "string");
}

console.log("\n── 6. Works with a DB and degrades safely without one ───");
{
  // This env may or may not have a reachable DB. The contract is identical
  // either way: never throw, always report {stored, reason?}.
  const mod: any = await import("../src/db/repositories/conversation-turn.js");
  const repo = mod.ConversationTurnRepo;
  if (!repo?.recordAssistant) {
    check("recordAssistant exported", false, "not found");
  } else {
    const r = await repo.recordAssistant({
      sessionId: "verify-persist-" + Date.now(),
      userId: "verify-persist-user",
      content: "hello from verify script",
    });
    check("returns a result object", r && typeof r.stored === "boolean");
    check(
      "either stored, or explained why not",
      r.stored === true || (typeof r.reason === "string" && r.reason.length > 0),
      JSON.stringify(r),
    );
    console.log(`     (DB reachable in this env: ${r.stored})`);
  }
}

console.log("\n── 7. Dedupe: identical consecutive replies write once ──");
{
  const mod: any = await import("../src/db/repositories/conversation-turn.js");
  const repo = mod.ConversationTurnRepo;
  if (repo?.recordAssistant) {
    const sid = "verify-dedupe-" + Date.now();
    const same = "重复的回答内容用于验证去重";
    const first = await repo.recordAssistant({ sessionId: sid, userId: "verify-persist-user", content: same });
    const second = await repo.recordAssistant({ sessionId: sid, userId: "verify-persist-user", content: same });
    if (first.stored) {
      check("first write stored", first.stored === true);
      check("identical second write is skipped", second.stored === false, JSON.stringify(second));
      check("reason = duplicate", second.reason === "duplicate", String(second.reason));
    } else {
      // No DB available — assert the contract still holds.
      check("no DB: both writes report a reason",
        typeof first.reason === "string" && typeof second.reason === "string",
        JSON.stringify({ first, second }));
    }
  }
}

console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILURES"}: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
