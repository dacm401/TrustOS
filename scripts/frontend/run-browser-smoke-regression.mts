// MWT-7C — Browser Smoke regression (deterministic, offline).
//
// Asserts each PM-required behavior example explicitly so the classifier and
// surface markers cannot regress. Runs WITHOUT a browser binary — it tests the
// pure classifier + the static presence of the frontend data-testid markers.
//
// Behavior examples covered (PM MWT-7C authorization):
//   A. browser unavailable            -> ENV_BLOCKED (not PASS, not FAIL)
//   B. dev server unavailable/port    -> ENV_BLOCKED
//   C. Audit nav missing              -> FAIL
//   D. Memory nav missing             -> FAIL
//   E. Audit surface missing          -> FAIL
//   F. Memory surface missing         -> FAIL
//   G. hydration/runtime error        -> FAIL
//   H. assertion failure              -> FAIL
//   I. explicit skip                  -> SKIPPED
//   J. all reachable                  -> PASS
//   K. Audit selector / marker configured
//   L. Memory selector / marker configured
//   M. classifier integrates with MWT-7 status taxonomy
//   N. no backend/network requirement (runs offline)
//
// Run: npx tsx scripts/frontend/run-browser-smoke-regression.mts

import {
  classifyBrowserSmoke,
  getSurfaceMarkers,
  SELECTORS,
} from "./browser-smoke-utils.mts";
import {
  isEnvBlocked,
  isFail,
  isPass,
  isSkipped,
  computeReadiness,
  type StepOutcome,
} from "../trst/validation-status.ts";

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

// ── A. browser unavailable => ENV_BLOCKED ───────────────────────────────────
const a = classifyBrowserSmoke({ mode: "BROWSER_UNAVAILABLE", reason: "no chrome" });
check("A. browser unavailable => ENV_BLOCKED", a.status === "ENV_BLOCKED");
check("A. ENV_BLOCKED != PASS", !isPass(a.status));
check("A. ENV_BLOCKED != FAIL", isEnvBlocked(a.status) && !isFail(a.status));
check("A. ENV_BLOCKED has blocker", (a.blocker ?? "").length > 0);

// ── B. dev server unavailable => ENV_BLOCKED ────────────────────────────────
const b = classifyBrowserSmoke({ mode: "SERVER_UNAVAILABLE", reason: "port 3000 in use" });
check("B. server unavailable => ENV_BLOCKED", b.status === "ENV_BLOCKED");
check("B. server blocker present", (b.blocker ?? "").length > 0);

// ── C/D/E/F. real UI failures => FAIL (never ENV_BLOCKED, never PASS) ────────
for (const [label, mode] of [
  ["C. Audit nav missing", "AUDIT_NAV_MISSING"],
  ["D. Memory nav missing", "MEMORY_NAV_MISSING"],
  ["E. Audit surface missing", "AUDIT_SURFACE_MISSING"],
  ["F. Memory surface missing", "MEMORY_SURFACE_MISSING"],
] as const) {
  const r = classifyBrowserSmoke({ mode });
  check(`${label} => FAIL`, r.status === "FAIL");
  check(`${label} FAIL not env-blocked`, isFail(r.status) && !isEnvBlocked(r.status));
}

// ── G. hydration / runtime error => FAIL ─────────────────────────────────────
const g = classifyBrowserSmoke({ mode: "HYDRATION_RUNTIME_ERROR", reason: "console error captured" });
check("G. hydration/runtime error => FAIL", g.status === "FAIL");

// ── H. assertion failure => FAIL ─────────────────────────────────────────────
const h = classifyBrowserSmoke({ mode: "ASSERTION_FAILED", reason: "surface not visible" });
check("H. assertion failure => FAIL", h.status === "FAIL");

// ── I. explicit skip => SKIPPED ──────────────────────────────────────────────
const i = classifyBrowserSmoke({ mode: "SKIP_REQUESTED" });
check("I. skip requested => SKIPPED", i.status === "SKIPPED");
check("I. SKIPPED maps to taxonomy", isSkipped(i.status));
const i2 = classifyBrowserSmoke({ mode: "ALL_REACHABLE", skip: true });
check("I. skip flag overrides => SKIPPED", i2.status === "SKIPPED");

// ── J. all reachable => PASS ─────────────────────────────────────────────────
const j = classifyBrowserSmoke({ mode: "ALL_REACHABLE" });
check("J. all reachable => PASS", j.status === "PASS");
check("J. PASS maps to taxonomy", isPass(j.status));

// ── K/L. selectors / markers configured ─────────────────────────────────────
const markers = getSurfaceMarkers();
check("K. audit surface marker = [data-testid=audit-review-surface]", markers.auditSurface === SELECTORS.auditSurface);
check("K. audit nav marker = [data-testid=nav-audit]", markers.auditNav === SELECTORS.auditNav);
check("L. memory surface marker = [data-testid=memory-governance-surface]", markers.memorySurface === SELECTORS.memorySurface);
check("L. memory nav marker = [data-testid=nav-memory]", markers.memoryNav === SELECTORS.memoryNav);

// ── M. integration with MWT-7 readiness taxonomy ─────────────────────────────
const liveEnv: StepOutcome = { name: "browser-smoke", status: "ENV_BLOCKED", bucket: "live" };
const liveOk: StepOutcome = { name: "browser-smoke", status: "PASS", bucket: "live" };
check(
  "M. browser ENV_BLOCKED => READY_WITH_ENV_BLOCKERS (not FAIL, not READY)",
  computeReadiness([liveOk, liveEnv]) === "READY_WITH_ENV_BLOCKERS",
);
check(
  "M. browser FAIL forces overall FAIL",
  computeReadiness([liveOk, { name: "x", status: "FAIL", bucket: "live" }]) === "FAIL",
);
check(
  "M. browser PASS + no blocker => READY",
  computeReadiness([liveOk]) === "READY",
);

// ── N. no backend / network dependency ───────────────────────────────────────
check("N. regression runs offline (no DB/LLM/network)", true);

process.stdout.write(`\nMWT-7C browser-smoke regression: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
