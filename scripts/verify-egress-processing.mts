/**
 * Verify the Egress Processing pipeline (ADR-001).
 *
 * Run: npx tsx scripts/verify-egress-processing.mts
 *
 * ADR-001 rule: "本地优先，原文存本机；发往云端的内容必须加工".
 * This proves the OUTBOUND side:
 *   1. secrets / PII are redacted before egress
 *   2. redaction is irreversible — no fragment of the secret survives
 *   3. history is trimmed, long messages truncated
 *   4. stats are metadata-only (never contain the matched text)
 *   5. level=off is an explicit, deliberate opt-out
 */

import {
  processEgress,
  getEgressPolicy,
  describeEgress,
  type EgressPolicy,
} from "../src/services/egress/egress-processor.js";
import type { ChatMessage } from "../src/types/index.js";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const msg = (role: ChatMessage["role"], content: string): ChatMessage => ({ role, content });
const STANDARD: EgressPolicy = {
  level: "standard", redactSecrets: true, redactPII: true,
  maxHistoryTurns: 6, maxMessageChars: 12000,
};

const SECRET = "sk-AbCdEf1234567890XyZqqqq";
const EMAIL = "alice@personal-domain.example";
const PHONE = "13800138000";

console.log("\n── 1. Secret redaction ──────────────────────────────────");
{
  const r = processEgress([msg("user", `please use ${SECRET} to call the api`)], STANDARD);
  const out = r.messages[0].content;
  check("secret removed", !out.includes(SECRET), out);
  check("no partial fragment leaks", !out.includes(SECRET.slice(0, 12)), out);
  check("placeholder marks the type", out.includes("[REDACTED:OPENAI_KEY]"), out);
  check("stats count it", r.stats.redactions.OPENAI_KEY === 1, JSON.stringify(r.stats.redactions));
  check("surrounding text preserved", out.includes("please use") && out.includes("to call the api"));
}

console.log("\n── 2. PII redaction ─────────────────────────────────────");
{
  const r = processEgress(
    [msg("user", `contact ${EMAIL} or ${PHONE}`)],
    STANDARD,
  );
  const out = r.messages[0].content;
  check("email removed", !out.includes(EMAIL), out);
  check("phone removed", !out.includes(PHONE), out);
  check("both placeholders present", out.includes("[REDACTED:EMAIL]") && out.includes("[REDACTED:PHONE_CN]"), out);
  check("stats count both", r.stats.redactions.EMAIL === 1 && r.stats.redactions.PHONE_CN === 1, JSON.stringify(r.stats.redactions));
}

console.log("\n── 3. Additional secret shapes ──────────────────────────");
{
  const cases: Array<[string, string, string]> = [
    ["anthropic key", "key is sk-ant-api03-ZZZZ1111222233334444", "ANTHROPIC_KEY"],
    ["bearer", "Authorization: Bearer abcdef1234567890xyz", "BEARER"],
    ["jwt", "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U", "JWT"],
    ["assigned password", `password: hunter2supersecret`, "ASSIGNED_SECRET"],
    ["private key block", "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK\n-----END RSA PRIVATE KEY-----", "PRIVATE_KEY"],
  ];
  for (const [label, text, expectType] of cases) {
    const r = processEgress([msg("user", text)], STANDARD);
    const hit = (r.stats.redactions[expectType] ?? 0) > 0;
    check(`${label} → ${expectType}`, hit, JSON.stringify(r.stats.redactions));
  }
}

console.log("\n── 4. Non-sensitive text is untouched ───────────────────");
{
  const clean = "write a quicksort in python with type hints";
  const r = processEgress([msg("user", clean)], STANDARD);
  check("content preserved verbatim", r.messages[0].content === clean, r.messages[0].content);
  check("no spurious redactions", Object.keys(r.stats.redactions).length === 0, JSON.stringify(r.stats.redactions));
}

console.log("\n── 5. History trimming ──────────────────────────────────");
{
  const msgs = [
    msg("system", "sys"),
    ...Array.from({ length: 20 }, (_, i) => msg("user", `turn ${i}`)),
  ];
  const r = processEgress(msgs, STANDARD);
  check("system prompt always kept", r.messages[0].role === "system");
  check("history trimmed to 6 non-system", r.messages.length === 7, String(r.messages.length));
  check("keeps the MOST RECENT turns", r.messages[6].content === "turn 19", r.messages[6]?.content);
  check("drops the oldest", !r.messages.some((m) => m.content === "turn 0"));
  check("stats report dropped count", r.stats.history_turns_dropped === 14, String(r.stats.history_turns_dropped));
}

console.log("\n── 6. Long message truncation ───────────────────────────");
{
  const r = processEgress([msg("user", "x".repeat(20000))], STANDARD);
  check("truncated to cap", r.messages[0].content.length < 12100, String(r.messages[0].content.length));
  check("marked as truncated", r.messages[0].content.includes("[TRUNCATED]"));
  check("stats report truncation", r.stats.messages_truncated === 1);
  check("chars_out < chars_in", r.stats.chars_out < r.stats.chars_in);
}

console.log("\n── 7. Stats are metadata-only (never the secret) ────────");
{
  const r = processEgress([msg("user", `my key ${SECRET} and ${EMAIL}`)], STANDARD);
  const summary = describeEgress(r.stats);
  check("summary has no secret", !summary.includes(SECRET), summary);
  check("summary has no email", !summary.includes(EMAIL), summary);
  check("summary has counts", /OPENAI_KEYx1/.test(summary) && /EMAILx1/.test(summary), summary);
  check("summary is one line (log-safe)", !summary.includes("\n"), summary);
  console.log("     log line: " + summary);
}

console.log("\n── 8. Level presets ─────────────────────────────────────");
{
  const many = [
    msg("system", "sys"),
    ...Array.from({ length: 30 }, (_, i) => msg("user", `t${i}`)),
  ];
  for (const level of ["minimal", "standard", "strict"] as const) {
    const policy = { ...STANDARD, level };
    const preset = getEgressPolicyFor(level);
    const r = processEgress(many, preset);
    check(`${level} reduces messages`, r.messages.length < many.length, String(r.messages.length));
  }
  const off = processEgress(many, getEgressPolicyFor("off"));
  check(
    "off passes everything through",
    off.messages.length === many.length && Object.keys(off.stats.redactions).length === 0,
    JSON.stringify(off.stats.redactions),
  );
  check("off still reports level", off.stats.level === "off");
}

// Helper mirroring env-driven resolution without mutating process.env.
function getEgressPolicyFor(level: string): EgressPolicy {
  const presets: Record<string, EgressPolicy> = {
    off: { level: "off", redactSecrets: false, redactPII: false, maxHistoryTurns: 999, maxMessageChars: Number.MAX_SAFE_INTEGER },
    minimal: { level: "minimal", redactSecrets: true, redactPII: false, maxHistoryTurns: 12, maxMessageChars: 30000 },
    standard: STANDARD,
    strict: { level: "strict", redactSecrets: true, redactPII: true, maxHistoryTurns: 3, maxMessageChars: 4000 },
  };
  return presets[level];
}

console.log("\n── 9. Default policy is safe ────────────────────────────");
{
  const p = getEgressPolicy();
  check("default level is standard (not off)", p.level === "standard", p.level);
  check("default redacts secrets", p.redactSecrets === true);
  check("default redacts PII", p.redactPII === true);
}

console.log("\n── 10. Repeated processing is idempotent ────────────────");
{
  const once = processEgress([msg("user", `k=${SECRET}`)], STANDARD).messages;
  const twice = processEgress(once, STANDARD).messages;
  check("content stable across passes", once[0].content === twice[0].content, twice[0].content);
  check("no double-redaction growth", !twice[0].content.includes("[REDACTED:REDACTED"), twice[0].content);
}

console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILURES"}: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
