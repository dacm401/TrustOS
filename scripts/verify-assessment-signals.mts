/**
 * Verify the enhanced Assessment signals (2026-08-28).
 *
 * Run: npx tsx scripts/verify-assessment-signals.mts
 *
 * Focus: the new hash-chain integrity signals must detect DELETION —
 * something per-event hashing alone cannot do.
 */

import { assessEvents, type AssessmentEvent } from "../src/services/assessment/assess-engine.js";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const ev = (n: number, over: Partial<AssessmentEvent> = {}): AssessmentEvent => ({
  trace_id: "trace-1",
  session_id: "sess-1",
  agent_id: "worker-1",
  provider: "openai",
  event_type: "model_call",
  status: "success",
  event_hash: `hash_${n}`,
  prev_hash: n === 1 ? null : `hash_${n - 1}`,
  input_hash: `in_${n}`,
  output_hash: `out_${n}`,
  timestamp: new Date(Date.now() + n * 1000).toISOString(),
  latency_ms: 100,
  ...over,
});

/** assessEvents returns TraceAssessment[] (one entry per trace group). */
const codes = (events: AssessmentEvent[]): string[] => {
  const results = assessEvents(events);
  return results.flatMap((a) => a.signals.map((s) => s.code));
};

console.log("\n── 1. Clean chain → no integrity signals ────────────────");
const clean = [ev(1), ev(2), ev(3)];
const cleanCodes = codes(clean);
check("no CHAIN_BREAK", !cleanCodes.includes("CHAIN_BREAK"), cleanCodes.join(","));
check("no CHAIN_GENESIS_UNEXPECTED", !cleanCodes.includes("CHAIN_GENESIS_UNEXPECTED"));
check("no MISSING_EVENT_HASH", !cleanCodes.includes("MISSING_EVENT_HASH"));

console.log("\n── 2. DELETION detection (the key new capability) ──────");
// Drop the middle event — per-event hashing alone would NOT notice.
const deleted = [ev(1), ev(3)];
const delCodes = codes(deleted);
check(
  "deleted middle event → CHAIN_BREAK",
  delCodes.includes("CHAIN_BREAK"),
  delCodes.join(","),
);

console.log("\n── 3. Tamper detection ─────────────────────────────────");
const tampered = [ev(1), { ...ev(2), event_hash: "hash_TAMPERED" }, ev(3)];
const tamperCodes = codes(tampered);
check("tampered hash → CHAIN_BREAK", tamperCodes.includes("CHAIN_BREAK"), tamperCodes.join(","));

console.log("\n── 4. Non-genesis event without predecessor ─────────────");
const orphan = [ev(1), { ...ev(2), prev_hash: null }];
const orphanCodes = codes(orphan);
check(
  "orphan mid-chain → CHAIN_GENESIS_UNEXPECTED",
  orphanCodes.includes("CHAIN_GENESIS_UNEXPECTED"),
  orphanCodes.join(","),
);

console.log("\n── 5. New behavioral / operational signals ─────────────");
const failing = [ev(1, { status: "failure", error_code: "E" }), ev(2, { status: "failure", error_code: "E" })];
check("REPEATED_FAILURE", codes(failing).includes("REPEATED_FAILURE"), codes(failing).join(","));

const unmeasured = [ev(1, { latency_ms: 0 })];
check("UNMEASURED_LATENCY", codes(unmeasured).includes("UNMEASURED_LATENCY"), codes(unmeasured).join(","));

const runaway = Array.from({ length: 51 }, (_, i) => ev(i + 1));
check("RUNAWAY_TRACE", codes(runaway).includes("RUNAWAY_TRACE"));

const noTrace = [ev(1, { trace_id: null })];
check("MISSING_TRACE_ID", codes(noTrace).includes("MISSING_TRACE_ID"), codes(noTrace).join(","));

console.log("\n── 6. Pre-chain legacy data is not misreported ──────────");
const legacy = [ev(1, { event_hash: null, prev_hash: null }), ev(2, { event_hash: null, prev_hash: null })];
const legacyCodes = codes(legacy);
check(
  "legacy (no hashes) → MISSING_EVENT_HASH, not CHAIN_BREAK",
  legacyCodes.includes("MISSING_EVENT_HASH") && !legacyCodes.includes("CHAIN_BREAK"),
  legacyCodes.join(","),
);

console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILURES"}: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
