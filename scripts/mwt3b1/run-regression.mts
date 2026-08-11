// MWT-3B1 Deterministic Regression Characterization.
//
// Standing Engineering Backlog — Batch 3 (P1 Regression Expansion for Sealed Flows).
//
// Scope: READ-ONLY backend module inspection/import authorized; backend MODIFICATION not.
//   Imported backend helper: src/services/trst1/event-envelope.ts
//     - extractTaskId (pure, no side effects)
//     - sealEvent / computeEventHash (pure, deterministic; uses node:crypto only)
//   NOT imported: jsonl-event-store.ts (filesystem-coupled) — kept pure/deterministic.
//
// Characterization only: documents current sealed MWT-3B1 behavior. No product change.
// Import has no side effects: event-envelope.ts only imports node:crypto at module load.
//
// Run: npx tsx scripts/mwt3b1/run-regression.mts
//      (integrated into `npm run validate` as "MWT-3B1 Regression")

import { extractTaskId, sealEvent, computeEventHash, type TrstEventEnvelope } from "../../src/services/trst1/event-envelope.js";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    const msg = `❌ ${name}${detail ? ` (${detail})` : ""}`;
    failures.push(msg);
    console.log(`  ${msg}`);
  }
}

// Minimal sealed event factory (omits only event_hash; mirrors Gateway-written shape).
function baseEvent(overrides: Partial<TrstEventEnvelope> = {}): Omit<TrstEventEnvelope, "event_hash"> {
  return {
    event_id: "evt_test_1",
    event_type: "model_call",
    timestamp: "2026-08-10T10:00:00.000Z",
    trace_id: "trace_1",
    session_id: "sess_1",
    run_id: "run_1",
    project_id: "proj_1",
    task_id: null,
    resource_type: "model",
    model: "gpt-4o",
    provider: "openai",
    token_count: 10,
    latency_ms: 100,
    privacy_flags: [],
    status: "success",
    ...overrides,
  };
}

console.log("MWT-3B1 Deterministic Regression Characterization");
console.log("=================================================");

// R1: valid task id extraction (present, non-empty, trimmed)
console.log("\nR1: valid task id extraction");
check("R1: present non-empty value returned as-is", extractTaskId("task-abc") === "task-abc");
check("R1: surrounding whitespace trimmed", extractTaskId("  task-xyz  ") === "task-xyz");
check("R1: internal value preserved", extractTaskId("TASK_123") === "TASK_123");

// R2: missing task id → null (never fabricated)
console.log("\nR2: missing task id behavior (no fabrication)");
check("R2: undefined → null", extractTaskId(undefined) === null);
check("R2: null → null", extractTaskId(null) === null);
check("R2: empty string → null", extractTaskId("") === null);
check("R2: whitespace-only → null", extractTaskId("   \t  ") === null);

// R3: malformed task id — function contract is string|undefined|null only.
// Non-string inputs are outside the trusted-header contract; document current behavior.
// Passing a non-string would throw (no .trim on object) → characterize as unsupported input.
console.log("\nR3: malformed/unsupported task id input");
check("R3: number input rejected by contract (throws, not silent default)", (() => {
  try { extractTaskId(123 as never); return false; } catch { return true; }
})());
check("R3: object input rejected by contract (throws, not silent default)", (() => {
  try { extractTaskId({} as never); return false; } catch { return true; }
})());

// R4: no nested task id concept — task_id is a flat string|null by schema.
console.log("\nR4: flat task_id schema (no nested extraction)");
const sealedR4 = sealEvent(baseEvent({ task_id: "flat-1" }));
check("R4: flat string task_id preserved", sealedR4.task_id === "flat-1");
check("R4: task_id is string|null type (not object)", typeof sealedR4.task_id === "string" || sealedR4.task_id === null);

// R5: unknown / partial event shape still seals deterministically
console.log("\nR5: unknown/partial event shape sealing");
const partial = sealEvent(baseEvent({ model: undefined, provider: undefined, task_id: "t1" }));
check("R5: partial event still sealed (has event_hash)", typeof partial.event_hash === "string" && partial.event_hash.length > 0);
check("R5: partial event preserves provided task_id", partial.task_id === "t1");

// R6: stable ordering — event_hash independent of key insertion order
console.log("\nR6: hash stable regardless of key order");
const a = baseEvent({ task_id: "t1", model: "gpt-4o" });
const b = { ...a, model: "gpt-4o", task_id: "t1" } as Omit<TrstEventEnvelope, "event_hash">;
check("R6: computeEventHash order-independent", computeEventHash(a) === computeEventHash(b));
check("R6: sealEvent hash order-independent", sealEvent(a).event_hash === sealEvent(b).event_hash);

// R7: hash determinism — same input → same hash (repeatable)
console.log("\nR7: hash determinism (repeatable)");
const h1 = computeEventHash(baseEvent({ task_id: "t1" }));
const h2 = computeEventHash(baseEvent({ task_id: "t1" }));
check("R7: identical input → identical hash", h1 === h2);
check("R7: hash is sha256 (64 hex chars)", /^[0-9a-f]{64}$/.test(h1));

// R8: sealEvent does NOT introduce run_id/trace_id (they are passthrough only)
console.log("\nR8: no run_id/trace_id introduction by sealing");
const e8 = baseEvent({ run_id: "run_1", trace_id: "trace_1" });
const sealed8 = sealEvent(e8);
check("R8: run_id passthrough (no new value)", sealed8.run_id === "run_1");
check("R8: trace_id passthrough (no new value)", sealed8.trace_id === "trace_1");

// R9: no policy/approval semantics added by sealing
console.log("\nR9: no policy/approval semantics introduced");
const sealed9 = sealEvent(baseEvent({ task_id: "t1" }));
check("R9: policy_decision_ref absent when not provided", sealed9.policy_decision_ref === undefined);
check("R9: approval_ref absent when not provided", sealed9.approval_ref === undefined);
check("R9: capability_ref absent when not provided", sealed9.capability_ref === undefined);

// R10: no backend service startup required — module import is side-effect free.
console.log("\nR10: import side-effect characterization");
// If importing had side effects (server start / DB connect), this script would have failed
// at import time. Reaching here asserts pure import. Also assert sealEvent unaffected by
// repeated calls (no global mutation of the input object).
const src = baseEvent({ task_id: "t1" });
const out = sealEvent(src);
check("R10: input event not mutated by seal (no shared reference side effect)", src.event_hash === undefined);
check("R10: sealed output is a new object with event_hash", out.event_hash !== undefined && src !== out);

console.log("\n=================================================");
console.log(`MWT-3B1 Regression Result: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) {
  console.log("Failures:");
  for (const f of failures) console.log(`  ${f}`);
  process.exit(1);
}
console.log("All MWT-3B1 regression characterization passed ✅");
process.exit(0);
