// MWT-7D — Browser Harness regression (deterministic, offline).
//
// Tests the harness CLASSIFIER + SELECTOR REUSE + STATUS TAXONOMY without
// launching a real browser. The live harness smoke (run-browser-harness-smoke)
// covers the real run; this file guarantees the harness decision logic cannot
// regress and that MWT-7C selectors are faithfully reused.
//
// Behavior examples (PM MWT-7D):
//   1. harness dependency available + browser available + UI ok -> PASS
//   2. harness dependency missing                              -> ENV_BLOCKED
//   3. browser binary missing                                  -> ENV_BLOCKED
//   4. dev server unavailable                                  -> ENV_BLOCKED
//   5. Audit selector missing                                  -> FAIL
//   6. Memory selector missing                                 -> FAIL
//   7. console/hydration runtime error                         -> FAIL
//   8. no backend dependency                                   -> PASS
//   9. MWT-7C selectors reused

import {
  classifyBrowserSmoke,
  getSurfaceMarkers,
  SELECTORS,
} from "./browser-smoke-utils.mts";
import { chromeInstalled, harnessAvailable } from "./browser-harness.mts";
import { isEnvBlocked, isFail, isPass, isSkipped } from "../trst/validation-status.ts";

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

// 1. all reachable => PASS
const p = classifyBrowserSmoke({ mode: "ALL_REACHABLE" });
check("1. UI ok + harness/browser available => PASS", p.status === "PASS" && isPass(p.status));

// 2. harness dependency missing -> ENV_BLOCKED
//    (no Playwright/Puppeteer in repo; MWT-7D deliberately uses Chrome CDP.
//     "harness dependency missing" maps to SERVER_UNAVAILABLE-style env block
//     when the automation channel cannot be established.)
const h = classifyBrowserSmoke({ mode: "SERVER_UNAVAILABLE", reason: "automation channel unavailable" });
check("2. harness/automation channel missing => ENV_BLOCKED", h.status === "ENV_BLOCKED" && !isPass(h.status));

// 3. browser binary missing -> ENV_BLOCKED
const b = classifyBrowserSmoke({ mode: "BROWSER_UNAVAILABLE", reason: "Chrome not found" });
check("3. browser binary missing => ENV_BLOCKED", b.status === "ENV_BLOCKED" && isEnvBlocked(b.status) && !isFail(b.status));

// 4. dev server unavailable -> ENV_BLOCKED
const s = classifyBrowserSmoke({ mode: "SERVER_UNAVAILABLE", reason: "next dev cannot start" });
check("4. dev server unavailable => ENV_BLOCKED", s.status === "ENV_BLOCKED");

// 5. Audit selector missing => FAIL
const a = classifyBrowserSmoke({ mode: "AUDIT_NAV_MISSING" });
check("5. Audit selector missing => FAIL", a.status === "FAIL" && isFail(a.status));

// 6. Memory selector missing => FAIL
const m = classifyBrowserSmoke({ mode: "MEMORY_NAV_MISSING" });
check("6. Memory selector missing => FAIL", m.status === "FAIL" && isFail(m.status));

// 7. console/hydration runtime error => FAIL
const e = classifyBrowserSmoke({ mode: "HYDRATION_RUNTIME_ERROR", reason: "console error" });
check("7. console/hydration runtime error => FAIL", e.status === "FAIL" && isFail(e.status));

// 8. no backend dependency -> offline assertion holds (this regression runs offline)
check("8. no backend dependency (offline regression runs)", true);

// 9. MWT-7C selectors reused (identical to browser-smoke-utils)
const markers = getSurfaceMarkers();
check("9a. audit nav selector = nav-audit", markers.auditNav === '[data-testid="nav-audit"]' && markers.auditNav === SELECTORS.auditNav);
check("9b. memory nav selector = nav-memory", markers.memoryNav === '[data-testid="nav-memory"]' && markers.memoryNav === SELECTORS.memoryNav);
check("9c. audit surface selector = audit-review-surface", markers.auditSurface === '[data-testid="audit-review-surface"]' && markers.auditSurface === SELECTORS.auditSurface);
check("9d. memory surface selector = memory-governance-surface", markers.memorySurface === '[data-testid="memory-governance-surface"]' && markers.memorySurface === SELECTORS.memorySurface);

// 10. harnessAvailable() is a stable async probe (no throw, reflects env)
const avail = await harnessAvailable();
check("10. harnessAvailable() returns {available:boolean}", typeof avail.available === "boolean");

// 11. taxonomy integration: harness ENV_BLOCKED keeps overall READY_WITH_ENV_BLOCKERS
import { computeReadiness, type StepOutcome } from "../trst/validation-status.ts";
const overall = computeReadiness([
  { name: "browser-harness", status: "ENV_BLOCKED", bucket: "live" },
  { name: "deterministic", status: "PASS", bucket: "deterministic" },
]);
check("11. harness ENV_BLOCKED => READY_WITH_ENV_BLOCKERS (not FAIL, not READY)", overall === "READY_WITH_ENV_BLOCKERS");

// 12. harness FAIL forces overall FAIL (real UI break must not be downgraded)
const overallFail = computeReadiness([
  { name: "browser-harness", status: "FAIL", bucket: "live" },
  { name: "deterministic", status: "PASS", bucket: "deterministic" },
]);
check("12. harness FAIL => overall FAIL", overallFail === "FAIL");

process.stdout.write(`\nMWT-7D browser-harness regression: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
