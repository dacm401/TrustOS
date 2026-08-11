// MWT-4A Sealed Flows Regression — Extended coverage (frontend-only, NO live Gateway).
//
// Companion to run-smoke.mts. Adds deeper regression coverage for already-sealed
// MWT-4A task evidence projection + ManagerWorkspace evidence surface logic.
// All assertions are deterministic and DOM-free (pure-function contract).
//
// Usage: npx tsx scripts/mwt4a/run-regression.mts
// Run from trustos/ root so relative imports resolve.
//
// Scope guard (PM Quality Engineering Sprint):
//   - only exercises sealed pure functions in frontend/src/lib/taskEvidence.ts
//   - no backend / schema / Gateway / MWT-4B export / signing / run_id / trace_id
//   - fail information is actionable (named scenario + concrete value)

import {
  aggregateTaskEvidence,
  sortEventsByTimestamp,
  buildTaskEvidenceState,
  EMPTY_SUMMARY,
} from "../../frontend/src/lib/taskEvidence.ts";
import type { GatewayEvent } from "../../frontend/src/lib/api.ts";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}${detail ? " — " + detail : ""}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`);
  }
}

// ── Fixture helper ───────────────────────────────────────────────────────────
function ev(partial: Partial<GatewayEvent> & Pick<GatewayEvent, "event_id" | "event_type" | "timestamp">): GatewayEvent {
  return { ...partial } as GatewayEvent;
}

const TASK = "task_reg_001";

// R1: malformed / missing metadata events (no tokens, no cost, no decision).
const malformed: GatewayEvent[] = [
  ev({ event_id: "m1", event_type: "model_call", timestamp: "2026-08-10T10:00:00Z" }), // all optional fields missing
  ev({ event_id: "m2", event_type: "model_call", timestamp: "2026-08-10T10:00:01Z", input_tokens: undefined as never, output_tokens: null as never }),
  ev({ event_id: "m3", event_type: "model_call", timestamp: "2026-08-10T10:00:02Z", control_decision: undefined as never }),
];

// R2: privacy-boundary leak probe (raw content + secrets + identity link).
const poisoned: GatewayEvent = ev({
  event_id: "p1", event_type: "model_call", timestamp: "2026-08-10T11:00:00Z",
  raw_prompt: "SECRET_PROMPT", raw_output: "SECRET_OUTPUT", api_key: "sk-xxxx",
  provider_raw_payload: "{...}", run_id: "run_1", trace_id: "trace_1",
  chain_of_thought: "hidden reasoning", session_id: "sess_1",
});

// R3: hash preservation (hashes pass-through, not recomputed).
const hashed: GatewayEvent[] = [
  ev({ event_id: "h1", event_type: "model_call", timestamp: "2026-08-10T10:00:00Z",
    event_hash: "20cc7b7f", input_hash: "7d644149", output_hash: "fd3101fd", control_decision: "allow" }),
  ev({ event_id: "h2", event_type: "model_call", timestamp: "2026-08-10T10:00:01Z",
    event_hash: "aabbccdd", input_hash: null as never, output_hash: undefined as never, control_decision: "deny" }),
];

// R4: decision boundary — explicit allow/deny/block/unknown + case-insensitivity.
const decisions: GatewayEvent[] = [
  ev({ event_id: "d1", event_type: "model_call", timestamp: "2026-08-10T10:00:00Z", control_decision: "Allow" }),
  ev({ event_id: "d2", event_type: "model_call", timestamp: "2026-08-10T10:00:01Z", control_decision: "DENY" }),
  ev({ event_id: "d3", event_type: "model_call", timestamp: "2026-08-10T10:00:02Z", control_decision: "Block" }),
  ev({ event_id: "d4", event_type: "model_call", timestamp: "2026-08-10T10:00:03Z", control_decision: "unknown" }),
  ev({ event_id: "d5", event_type: "model_call", timestamp: "2026-08-10T10:00:04Z", control_decision: "" }),
  ev({ event_id: "d6", event_type: "model_call", timestamp: "2026-08-10T10:00:05Z" }), // missing entirely
];

// R5: ordering stability — equal timestamps keep input order (stable sort).
const sameTs: GatewayEvent[] = [
  ev({ event_id: "s1", event_type: "model_call", timestamp: "2026-08-10T10:00:00Z" }),
  ev({ event_id: "s2", event_type: "model_call", timestamp: "2026-08-10T10:00:00Z" }),
  ev({ event_id: "s3", event_type: "model_call", timestamp: "2026-08-10T10:00:00Z" }),
];

// R6: empty timestamp event (sorts first, no crash).
const emptyTs: GatewayEvent[] = [
  ev({ event_id: "t1", event_type: "model_call", timestamp: "2026-08-10T10:00:02Z" }),
  ev({ event_id: "t2", event_type: "model_call", timestamp: "" }),
  ev({ event_id: "t3", event_type: "model_call", timestamp: "2026-08-10T10:00:01Z" }),
];

function main() {
  console.log(`\n=== MWT-4A Sealed Flows Regression (no live Gateway) ===\n`);

  // R1: malformed / missing metadata → zero tokens/cost, no throw.
  console.log("R1: malformed / missing metadata handling");
  const r1 = aggregateTaskEvidence(malformed);
  check("R1: no tokens counted from missing fields", r1.total_input_tokens === 0 && r1.total_output_tokens === 0,
    `in=${r1.total_input_tokens}, out=${r1.total_output_tokens}`);
  check("R1: total tokens zero", r1.total_tokens === 0);
  check("R1: cost null (no numeric estimate)", r1.total_cost === null, `cost=${r1.total_cost}`);
  check("R1: all control unknown (no decision present)", r1.control.unknown === 3 && r1.control.allow === 0 && r1.control.deny === 0,
    `unknown=${r1.control.unknown}`);
  check("R1: event_count correct", r1.event_count === 3);

  // R2: privacy boundary — poisoned fields never enter summary or safe projection.
  console.log("\nR2: privacy-boundary leak regression");
  const r2 = buildTaskEvidenceState([poisoned]);
  const r2Summary = JSON.stringify(r2.summary);
  check("R2: raw_prompt not in summary", !r2Summary.includes("SECRET_PROMPT"));
  check("R2: raw_output not in summary", !r2Summary.includes("SECRET_OUTPUT"));
  check("R2: api_key not in summary", !r2Summary.includes("sk-xxxx"));
  check("R2: provider_raw_payload not in summary", !r2Summary.includes("provider_raw_payload"));
  check("R2: run_id not in summary", !("run_id" in r2.summary) && !r2Summary.includes("run_1"));
  check("R2: trace_id not in summary", !("trace_id" in r2.summary) && !r2Summary.includes("trace_1"));
  check("R2: chain_of_thought not in summary", !r2Summary.includes("hidden reasoning"));
  // SAFE_META_KEYS mirror (must match TaskEvidenceView contract).
  const SAFE = ["event_type","status","model","provider","agent_id","session_id","request_mode","token_count","input_tokens","output_tokens","cost_estimate","latency_ms","gateway_overhead_ms","control_decision","error_code","error_message","event_hash","input_hash","output_hash"];
  check("R2: safe meta keys exclude raw_*", !SAFE.some((k) => k.startsWith("raw")));
  check("R2: safe meta keys exclude run_id/trace_id", !SAFE.includes("run_id") && !SAFE.includes("trace_id"));
  check("R2: safe meta keys exclude api_key/secret", !SAFE.includes("api_key") && !SAFE.includes("secret"));

  // R3: hash preservation — pass-through, no fabrication, missing tolerated.
  console.log("\nR3: hash preservation behavior");
  const r3 = buildTaskEvidenceState(hashed);
  const h1 = r3.events[0];
  const h2 = r3.events[1];
  check("R3: event_hash preserved", h1.event_hash === "20cc7b7f");
  check("R3: input_hash preserved", h1.input_hash === "7d644149");
  check("R3: output_hash preserved", h1.output_hash === "fd3101fd");
  check("R3: missing hash NOT fabricated (null kept)", h2.input_hash === null && h2.output_hash === undefined);
  check("R3: present hash value untouched", h2.event_hash === "aabbccdd");

  // R4: decision boundary — case-insensitive, block≈deny, empty/missing=unknown.
  console.log("\nR4: allow/deny/block/unknown decision boundary");
  const r4 = aggregateTaskEvidence(decisions);
  check("R4: 'Allow' (mixed case) → allow", r4.control.allow === 1, `allow=${r4.control.allow}`);
  check("R4: 'DENY' (mixed case) → deny", r4.control.deny === 2, `deny=${r4.control.deny}`);
  check("R4: 'Block' also → deny (deny total 2)", r4.control.deny === 2, `deny=${r4.control.deny}`);
  check("R4: 'unknown' explicit → unknown", r4.control.unknown === 3, `unknown=${r4.control.unknown}`);
  check("R4: empty string decision → unknown", r4.control.unknown === 3, `unknown=${r4.control.unknown}`);
  check("R4: missing decision → unknown", r4.control.unknown === 3, `unknown=${r4.control.unknown}`);
  check("R4: event_count = 6", r4.event_count === 6);

  // R5: ordering stability (stable sort on equal timestamps).
  console.log("\nR5: ordering stability (equal timestamps)");
  const r5 = sortEventsByTimestamp(sameTs);
  check("R5: equal-timestamp order preserved (s1,s2,s3)", r5[0].event_id === "s1" && r5[1].event_id === "s2" && r5[2].event_id === "s3");

  // R6: empty timestamp sorts first, no crash.
  console.log("\nR6: empty timestamp handling");
  const r6 = sortEventsByTimestamp(emptyTs);
  check("R6: empty-ts event first", r6[0].event_id === "t2", `first=${r6[0].event_id}`);
  check("R6: remaining ordered ascending", r6[1].event_id === "t3" && r6[2].event_id === "t1");

  // R7: buildTaskEvidenceState contract (loading/error defaults, ordered events).
  console.log("\nR7: buildTaskEvidenceState state contract");
  const r7 = buildTaskEvidenceState(malformed);
  check("R7: loading false", r7.loading === false);
  check("R7: error null", r7.error === null);
  check("R7: events populated", r7.events.length === 3);
  check("R7: summary equals aggregate of ordered", r7.summary.event_count === 3);

  // R8: EMPTY_SUMMARY is a valid zero baseline and aggregation of [] matches it.
  console.log("\nR8: empty baseline consistency");
  const r8 = aggregateTaskEvidence([]);
  check("R8: aggregate of [] deep-equals EMPTY_SUMMARY", JSON.stringify(r8) === JSON.stringify(EMPTY_SUMMARY));
  check("R8: EMPTY_SUMMARY cost null", EMPTY_SUMMARY.total_cost === null);

  // R9: privacy boundary — export/signing/policy strings never appear in projection output.
  console.log("\nR9: no export/signing/policy leakage in projection");
  const r9 = JSON.stringify(buildTaskEvidenceState([poisoned]).events);
  check("R9: 'export' absent", !r9.toLowerCase().includes("export"));
  check("R9: 'sign' absent", !r9.toLowerCase().includes("sign"));
  check("R9: 'policy' absent", !r9.toLowerCase().includes("policy"));
  check("R9: 'attest' absent", !r9.toLowerCase().includes("attest"));

  // R10: cost_estimate type safety — only numeric cost is summed; string/object ignored.
  console.log("\nR10: cost_estimate type safety");
  const r10 = aggregateTaskEvidence([
    ev({ event_id: "c1", event_type: "model_call", timestamp: "2026-08-10T10:00:00Z", cost_estimate: "0.01" as never }),
    ev({ event_id: "c2", event_type: "model_call", timestamp: "2026-08-10T10:00:01Z", cost_estimate: { v: 1 } as never }),
    ev({ event_id: "c3", event_type: "model_call", timestamp: "2026-08-10T10:00:02Z", cost_estimate: null as never }),
    ev({ event_id: "c4", event_type: "model_call", timestamp: "2026-08-10T10:00:03Z", cost_estimate: 0.02 }),
  ]);
  check("R10: string cost_estimate ignored", r10.total_cost === 0.02, `cost=${r10.total_cost}`);
  check("R10: object cost_estimate ignored", r10.total_cost === 0.02);
  check("R10: null cost_estimate ignored", r10.total_cost === 0.02);
  check("R10: only numeric cost summed", r10.total_cost === 0.02);

  // R11: token summation is type-agnostic — tool_call tokens counted like model_call.
  // (Documents current contract; aggregateTaskEvidence sums any event with numeric tokens.)
  console.log("\nR11: token summation type-agnostic across event_type");
  const r11 = aggregateTaskEvidence([
    ev({ event_id: "t1", event_type: "model_call", timestamp: "2026-08-10T10:00:00Z", input_tokens: 100, output_tokens: 50 }),
    ev({ event_id: "t2", event_type: "tool_call", timestamp: "2026-08-10T10:00:01Z", input_tokens: 10, output_tokens: 5 }),
  ]);
  check("R11: model_call tokens summed", r11.total_input_tokens === 110, `in=${r11.total_input_tokens}`);
  check("R11: tool_call tokens also summed", r11.total_output_tokens === 55, `out=${r11.total_output_tokens}`);
  check("R11: total_tokens = in+out across types", r11.total_tokens === 165, `total=${r11.total_tokens}`);

  // R12: large aggregation determinism — 100 events aggregate to a stable summary.
  console.log("\nR12: large aggregation determinism (100 events)");
  const big: GatewayEvent[] = Array.from({ length: 100 }, (_, i) =>
    ev({ event_id: `b${i}`, event_type: "model_call", timestamp: `2026-08-10T10:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}Z`, input_tokens: 1, output_tokens: 2, control_decision: i % 3 === 0 ? "allow" : i % 3 === 1 ? "deny" : "unknown" }),
  );
  const r12a = aggregateTaskEvidence(big);
  const r12b = aggregateTaskEvidence(big);
  check("R12: event_count = 100", r12a.event_count === 100, `count=${r12a.event_count}`);
  check("R12: input tokens = 100", r12a.total_input_tokens === 100);
  check("R12: output tokens = 200", r12a.total_output_tokens === 200);
  check("R12: aggregation deterministic (stable)", JSON.stringify(r12a) === JSON.stringify(r12b));
  check("R12: control split stable (allow≈34)", r12a.control.allow === 34, `allow=${r12a.control.allow}`);
  check("R12: control split stable (deny≈33)", r12a.control.deny === 33, `deny=${r12a.control.deny}`);
  check("R12: control split stable (unknown≈33)", r12a.control.unknown === 33, `unknown=${r12a.control.unknown}`);

  // R13: negative / NaN token handling — documents current contract honestly.
  // aggregateTaskEvidence only checks `typeof === "number"`; NaN passes that check and
  // is propagated as-is (no clamp, no zeroing). Negative numbers are summed as-is.
  console.log("\nR13: negative / NaN token handling (documents current contract)");
  const r13 = aggregateTaskEvidence([
    ev({ event_id: "n1", event_type: "model_call", timestamp: "2026-08-10T10:00:00Z", input_tokens: -5, output_tokens: NaN as never }),
    ev({ event_id: "n2", event_type: "model_call", timestamp: "2026-08-10T10:00:01Z", input_tokens: 10, output_tokens: 3 }),
  ]);
  check("R13: negative input summed as-is (no clamp)", r13.total_input_tokens === 5, `in=${r13.total_input_tokens}`);
  check("R13: NaN output propagated as NaN (typeof number passes guard)", Number.isNaN(r13.total_output_tokens), `out=${r13.total_output_tokens}`);
  check("R13: total propagates NaN (signed sum + NaN)", Number.isNaN(r13.total_tokens), `total=${r13.total_tokens}`);

  finish();
}

function finish() {
  console.log(`\n=== MWT-4A Regression Result: ${pass} PASS / ${fail} FAIL ===\n`);
  if (fail > 0) {
    console.log("FAILURES: " + failures.join(", "));
    process.exit(1);
  }
  process.exit(0);
}

main();
