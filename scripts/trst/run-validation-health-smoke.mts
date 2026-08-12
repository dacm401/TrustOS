// MWT-7 — Validation Health smoke (deterministic, no network/DB).
//
// Verifies the status taxonomy + readiness calc + env-blocker classifier used
// by the aggregator. These are PURE functions, so the smoke is fully
// deterministic and offline.
//
// Run: npx tsx scripts/trst/run-validation-health-smoke.mts

import {
  computeReadiness,
  isEnvBlocked,
  isFail,
  isPass,
  isSkipped,
  renderReadiness,
  type StepOutcome,
} from "./validation-status";
import { isEnvBlockedError, classifyBlocker } from "./env-diagnostics";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    passed++;
    process.stdout.write(`  ✅ ${name}\n`);
  } else {
    failed++;
    process.stdout.write(`  ❌ ${name}\n`);
  }
}

const ok = (name: string): StepOutcome => ({ name, status: "PASS", bucket: "deterministic" });
const detFail = (name: string): StepOutcome => ({ name, status: "FAIL", bucket: "deterministic" });
const envBlock = (name: string): StepOutcome => ({ name, status: "ENV_BLOCKED", bucket: "live" });
const skip = (name: string): StepOutcome => ({ name, status: "SKIPPED", bucket: "skipped" });

// 1. status taxonomy predicates
check("PASS predicate", isPass("PASS") && !isPass("FAIL"));
check("FAIL predicate", isFail("FAIL") && !isFail("PASS"));
check("ENV_BLOCKED predicate", isEnvBlocked("ENV_BLOCKED") && !isEnvBlocked("FAIL"));
check("SKIPPED predicate", isSkipped("SKIPPED") && !isSkipped("PASS"));

// 2. overall readiness calc
check(
  "all pass => READY",
  computeReadiness([ok("a"), ok("b")]) === "READY",
);
check(
  "deterministic fail => FAIL",
  computeReadiness([ok("a"), detFail("b")]) === "FAIL",
);
check(
  "env blocked only => READY_WITH_ENV_BLOCKERS",
  computeReadiness([ok("a"), envBlock("live1")]) === "READY_WITH_ENV_BLOCKERS",
);
check(
  "fail + env blocked => FAIL (fail dominates)",
  computeReadiness([detFail("a"), envBlock("live1")]) === "FAIL",
);
check(
  "skipped only => READY",
  computeReadiness([skip("opt1"), skip("opt2")]) === "READY",
);
check(
  "pass + skipped => READY",
  computeReadiness([ok("a"), skip("opt1")]) === "READY",
);
check(
  "empty => READY",
  computeReadiness([]) === "READY",
);

// 3. env blocked does NOT equal PASS and does NOT equal ordinary FAIL
check(
  "ENV_BLOCKED != PASS",
  !isPass("ENV_BLOCKED"),
);
check(
  "ENV_BLOCKED != FAIL (distinct category)",
  isEnvBlocked("ENV_BLOCKED") && !isFail("ENV_BLOCKED"),
);

// 4. readiness render non-empty
check("renderReadiness non-empty", renderReadiness("READY").length > 0);

// 5. env-blocker classifier — known environmental patterns
check("classifier: ECONNREFUSED", isEnvBlockedError("Error: connect ECONNREFUSED 127.0.0.1:5432"));
check("classifier: DATABASE_URL missing", isEnvBlockedError("Error: DATABASE_URL is not set"));
check("classifier: gateway unavailable", isEnvBlockedError("gateway is unavailable in sandbox"));
check("classifier: ETIMEDOUT", isEnvBlockedError("connect ETIMEDOUT db.local:5432"));
check("classifier: ENOTFOUND", isEnvBlockedError("getaddrinfo ENOTFOUND postgres"));

// 6. env-blocker classifier — real failures stay FAIL (not swallowed)
check(
  "classifier: real assertion failure NOT env-blocked",
  !isEnvBlockedError("Assertion failed: expected routeType 'ask_clarification' got 'normal_conversation'"),
);
check(
  "classifier: TypeError NOT env-blocked",
  !isEnvBlockedError("TypeError: Cannot read properties of undefined (reading 'json')"),
);
check(
  "classifier: empty string NOT env-blocked",
  !isEnvBlockedError(""),
);

// 7. classifyBlocker label shape
check(
  "classifyBlocker returns ENV_BLOCKED(...) for known pattern",
  classifyBlocker("ECONNREFUSED 5432").startsWith("ENV_BLOCKED("),
);
check(
  "classifyBlocker returns FAIL(unknown) for unknown error",
  classifyBlocker("some weird logic error").startsWith("FAIL("),
);

process.stdout.write(`\nMWT-7 validation-health smoke: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
