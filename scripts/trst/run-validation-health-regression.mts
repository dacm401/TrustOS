// MWT-7 — Validation Health regression (deterministic, no network/DB).
//
// Exhaustive matrix over the readiness state machine + classifier matrix to
// assert the honest contract holds for ALL combinations.
//
// Run: npx tsx scripts/trst/run-validation-health-regression.mts

import {
  computeReadiness,
  type StepOutcome,
  type ValidationStatus,
  type OverallReadiness,
} from "./validation-status";
import { isEnvBlockedError } from "./env-diagnostics";

const STATUSES: ValidationStatus[] = ["PASS", "FAIL", "ENV_BLOCKED", "SKIPPED"];

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    process.stdout.write(`  ❌ ${name}\n`);
  }
}

// ── Readiness state machine over single-step combos ──
function mk(status: ValidationStatus): StepOutcome {
  const bucket = status === "ENV_BLOCKED" ? "live" : status === "SKIPPED" ? "skipped" : "deterministic";
  return { name: `s-${status}`, status, bucket };
}

// Any set containing FAIL => FAIL, regardless of other statuses.
for (const a of STATUSES) {
  for (const b of STATUSES) {
    const outcomes = [mk(a), mk(b)];
    const hasFail = outcomes.some((o) => o.status === "FAIL");
    const hasEnv = outcomes.some((o) => o.status === "ENV_BLOCKED");
    const expected: OverallReadiness = hasFail
      ? "FAIL"
      : hasEnv
        ? "READY_WITH_ENV_BLOCKERS"
        : "READY";
    check(`readiness[${a},${b}] => ${expected}`, computeReadiness(outcomes) === expected);
  }
}

// Larger mix: 3 steps, all combinations.
for (const a of STATUSES) {
  for (const b of STATUSES) {
    for (const c of STATUSES) {
      const outcomes = [mk(a), mk(b), mk(c)];
      const hasFail = outcomes.some((o) => o.status === "FAIL");
      const hasEnv = outcomes.some((o) => o.status === "ENV_BLOCKED");
      const expected = hasFail ? "FAIL" : hasEnv ? "READY_WITH_ENV_BLOCKERS" : "READY";
      check(`readiness[${a},${b},${c}]`, computeReadiness(outcomes) === expected);
    }
  }
}

// ── ENV_BLOCKED must never count as PASS across the matrix ──
for (const a of STATUSES) {
  for (const b of STATUSES) {
    const outcomes = [mk(a), mk(b)];
    const readiness = computeReadiness(outcomes);
    // If no FAIL and no ENV_BLOCKED, readiness MUST be READY (never blocked).
    const noFailNoEnv = !outcomes.some((o) => o.status === "FAIL") && !outcomes.some((o) => o.status === "ENV_BLOCKED");
    check(`no-env-no-fail[${a},${b}] => READY`, noFailNoEnv ? readiness === "READY" : true);
  }
}

// ── Classifier matrix: known env patterns vs real failures ──
const ENV_PATTERNS: string[] = [
  "ECONNREFUSED 127.0.0.1:5432",
  "Error: DATABASE_URL is not set",
  "gateway is unavailable",
  "ETIMEDOUT db:5432",
  "ENOTFOUND postgres",
  "connection refused",
  "sandbox has no db",
  "environment not configured",
  'Reading from "node:crypto" is not handled by plugins',
  "Build failed because of webpack errors",
  "UnhandledSchemeError: Reading from \"node:fs\"",
];
const REAL_FAILURES: string[] = [
  "Assertion failed: expected 'ask_clarification' got 'normal_conversation'",
  "TypeError: Cannot read properties of undefined",
  "expected object but got null",
  "RangeError: invalid array length",
  "ReferenceError: foo is not defined",
];
for (const p of ENV_PATTERNS) {
  check(`env pattern classified: ${p.slice(0, 24)}`, isEnvBlockedError(p));
}
for (const r of REAL_FAILURES) {
  check(`real failure NOT env-blocked: ${r.slice(0, 24)}`, !isEnvBlockedError(r));
}

// ── Determinism: classifier stable across repeated calls ──
for (const p of ENV_PATTERNS) {
  let stable = true;
  const first = isEnvBlockedError(p);
  for (let i = 0; i < 20; i++) if (isEnvBlockedError(p) !== first) stable = false;
  check(`classifier deterministic: ${p.slice(0, 20)}`, stable);
}

process.stdout.write(`\nMWT-7 validation-health regression: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
