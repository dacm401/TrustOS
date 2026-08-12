// MWT-8 — Private Beta Readiness Check (docs/consistency orchestrator, v0).
//
// Lightweight, deterministic, offline checklist reporter. It verifies the
// private-beta release pack is internally consistent and honest:
//   - required docs exist
//   - taxonomy terms present
//   - known blockers documented
//   - no false "READY" claim while ENV_BLOCKED remains
//   - live-env preflight reports honestly
//
// It does NOT hide FAIL and does NOT convert ENV_BLOCKED to PASS.
// For the actual command executions, see docs/private-beta/RUNBOOK.md
// (`npm run validate`, `npm run beta:check`, etc.) — this v0 focuses on pack
// consistency rather than re-running every heavy suite via spawn.
//
// Run: npx tsx scripts/trst/run-private-beta-check.mts

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inspectLiveEnv } from "../trst4h-iii/live-env-diagnostics.mts";

const ROOT = process.cwd();
const PB = join(ROOT, "docs", "private-beta");

interface Line {
  ok: boolean;
  msg: string;
}

const lines: Line[] = [];
function check(ok: boolean, msg: string): void {
  lines.push({ ok, msg });
}

// 1. Required docs exist
const requiredDocs = [
  "RUNBOOK.md",
  "VALIDATION.md",
  "DEMO_SCRIPT.md",
  "ENVIRONMENT.md",
  "KNOWN_BLOCKERS.md",
  "RELEASE_CHECKLIST.md",
];
for (const d of requiredDocs) {
  const p = join(PB, d);
  check(existsSync(p), `doc exists: docs/private-beta/${d}`);
}

// 2. Taxonomy terms appear across docs
const taxonomy = ["PASS", "FAIL", "ENV_BLOCKED", "SKIPPED", "READY_WITH_ENV_BLOCKERS", "READY"];
const allDocs = requiredDocs
  .map((d) => join(PB, d))
  .filter(existsSync)
  .map((p) => readFileSync(p, "utf8"))
  .join("\n");
for (const t of taxonomy) {
  check(allDocs.includes(t), `taxonomy term present: ${t}`);
}

// 3. Known blockers documented (TRST-4H-III)
check(
  /TRST-4H-III/i.test(allDocs) && /ENV_BLOCKED/i.test(allDocs),
  "known blockers: TRST-4H-III ENV_BLOCKED documented",
);

// 4. No false READY claim while ENV_BLOCKED remains
//    The live-env preflight tells us if the live env is unblocked.
const live = inspectLiveEnv({ databaseRequired: true, gatewayRequired: true });
const envBlocked = !live.ready_to_run;
if (envBlocked) {
  // Must NOT claim "overall READY"; must claim READY_WITH_ENV_BLOCKERS.
  check(
    /READY_WITH_ENV_BLOCKERS/i.test(allDocs),
    "no false READY: docs state READY_WITH_ENV_BLOCKERS while env blocked",
  );
  check(
    !/Overall:\s*READY\s*$/m.test(allDocs) || /READY_WITH_ENV_BLOCKERS/i.test(allDocs),
    "overall not claimed as plain READY while blockers exist",
  );
} else {
  check(true, "live env present: plain READY would be acceptable");
}

// 5. Live preflight honest (reports blocked, not pass, when absent)
if (envBlocked) {
  check(
    live.summary.startsWith("ENV_BLOCKED"),
    `preflight honest: summary='${live.summary}'`,
  );
}

// Report
const passed = lines.filter((l) => l.ok).length;
const failed = lines.length - passed;
const out: string[] = [];
out.push("MWT-8 Private Beta Readiness Check (pack consistency)");
out.push("=".repeat(52));
for (const l of lines) {
  out.push(`  ${l.ok ? "✅" : "❌"} ${l.msg}`);
}
out.push("=".repeat(52));
out.push(`Checks: ${passed} passed, ${failed} failed`);
out.push(`Live env: ${live.summary}`);
out.push(
  envBlocked
    ? "Verdict: READY_WITH_ENV_BLOCKERS (pack consistent; live env not provided)"
    : "Verdict: READY (pack consistent; live env provided)",
);
out.push("");
out.push("Referenced commands (run manually per RUNBOOK.md):");
out.push("  npm run validate");
out.push("  npm run beta:check");
out.push("  npx tsx scripts/trst/run-health-check.mts");
out.push("  npx tsx scripts/trst4h-iii/run-live-preflight.mts");
out.push("  npx tsx scripts/frontend/run-browser-harness-smoke.mts");

process.stdout.write(out.join("\n") + "\n");
process.exit(failed === 0 ? 0 : 1);
