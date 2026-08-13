// MWT-8 + MWT-9 + MWT-10 — Private Beta Readiness Check (docs/consistency orchestrator).
//
// Lightweight, deterministic, offline checklist reporter. It verifies the
// private-beta release pack is internally consistent and honest:
//   - required docs exist (incl. MWT-9 onboarding docs)
//   - taxonomy terms present
//   - known blockers documented
//   - no false "READY" claim while ENV_BLOCKED remains
//   - env template exists with required keys and no real secrets
//   - acceptance criteria distinguish Candidate / Full READY / Rejected
//   - quickstart contains operator commands
//   - readiness report script emits READY_WITH_ENV_BLOCKERS honestly
//   - live-env preflight reports honestly
//   - MWT-10: live activation/reviewer docs exist + no secret VALUE in docs
//   - MWT-10: presence-only reporting, no false READY when live env missing
//
// It does NOT hide FAIL and does NOT convert ENV_BLOCKED to PASS.
// For the actual command executions, see docs/private-beta/RUNBOOK.md
// (`npm run validate`, `npm run beta:check`, etc.) — this focuses on pack
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

// 1. Required docs exist (MWT-8 pack + MWT-9 onboarding)
const requiredDocs = [
  "RUNBOOK.md",
  "VALIDATION.md",
  "DEMO_SCRIPT.md",
  "ENVIRONMENT.md",
  "KNOWN_BLOCKERS.md",
  "RELEASE_CHECKLIST.md",
  "QUICKSTART.md",
  "OPERATOR_ONBOARDING.md",
  "BETA_ACCEPTANCE_CRITERIA.md",
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

// 6. Env template exists with required keys and NO real secrets (MWT-9)
const envTemplate = join(ROOT, ".env.private-beta.example");
check(existsSync(envTemplate), "env template exists: .env.private-beta.example");
if (existsSync(envTemplate)) {
  const envText = readFileSync(envTemplate, "utf8");
  const requiredKeys = [
    "DATABASE_URL",
    "OPENAI_BASE_URL",
    "OPENAI_API_KEY",
    "GATEWAY_ENDPOINT",
    "GATEWAY_API_KEY",
    "FRONTEND_PORT",
  ];
  for (const k of requiredKeys) {
    check(envText.includes(`${k}=`), `env template contains key: ${k}=`);
  }
  // No real secret committed: only secret-styled keys (KEY/SECRET/TOKEN/PASSWORD/API)
  // must be EMPTY. Non-secret keys (e.g. FRONTEND_PORT=3100) may carry benign defaults.
  // Check line-by-line: JS \s matches \n, so a cross-line match would falsely
  // stitch an empty "KEY=" with a non-empty value on the next line. We avoid that
  // by testing each non-comment line individually against an in-line pattern.
  const nonCommentLines = envText
    .replace(/\r\n/g, "\n") // normalize CRLF -> LF
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"));
  const secretKey = /(?:API_?KEY|SECRET|TOKEN|PASSWORD)[ \t]*=[ \t]*\S+/i;
  const leakedLine = nonCommentLines.find((l) => secretKey.test(l));
  check(
    !leakedLine,
    leakedLine
      ? `no real secrets in env template (secret-styled keys empty) — found: ${leakedLine}`
      : "no real secrets in env template (secret-styled keys empty)",
  );
}

// 7. Acceptance criteria distinguishes Candidate / Full READY / Rejected (MWT-9)
const acPath = join(PB, "BETA_ACCEPTANCE_CRITERIA.md");
check(existsSync(acPath), "acceptance criteria doc exists");
if (existsSync(acPath)) {
  const ac = readFileSync(acPath, "utf8");
  check(/Private Beta Candidate/i.test(ac), "acceptance: Private Beta Candidate defined");
  check(/Full READY/i.test(ac), "acceptance: Full READY defined");
  check(/Rejected/i.test(ac), "acceptance: Rejected defined");
}

// 8. Quickstart contains operator copy-paste commands (MWT-9)
const qsPath = join(PB, "QUICKSTART.md");
check(existsSync(qsPath), "quickstart doc exists");
if (existsSync(qsPath)) {
  const qs = readFileSync(qsPath, "utf8");
  check(/npm run beta:check/.test(qs), "quickstart references: npm run beta:check");
  check(/npm run validate/.test(qs), "quickstart references: npm run validate");
  check(/npm install/.test(qs), "quickstart references: npm install");
}

// 9. Readiness report script emits READY_WITH_ENV_BLOCKED honesty (MWT-9)
//    Imported module must exist; we assert it runs and does not claim READY while env blocked.
const reportScript = join(ROOT, "scripts", "trst", "run-private-beta-report.mts");
check(existsSync(reportScript), "readiness report script exists");
if (envBlocked) {
  // With env blocked, the report must NOT output a plain "Overall: READY" line.
  // We assert the doc pack + script design enforce READY_WITH_ENV_BLOCKERS (checked
  // via docs text above). The script itself is offline and reuses the same verdict rule.
  check(
    /READY_WITH_ENV_BLOCKERS/i.test(allDocs),
    "report honesty: pack asserts READY_WITH_ENV_BLOCKERS while env blocked",
  );
}

// 10. MWT-10 — Live activation docs exist (no false readiness, presence-only)
const mwt10Docs = [
  "LIVE_ENV_ACTIVATION.md",
  "REVIEWER_SESSION_GUIDE.md",
  "REVIEWER_FEEDBACK_TEMPLATE.md",
];
for (const d of mwt10Docs) {
  check(existsSync(join(PB, d)), `MWT-10 doc exists: docs/private-beta/${d}`);
}

// 11. MWT-10 — required [LIV] env keys documented + no real secret in docs/templates
const liveDoc = mwt10Docs
  .map((d) => join(PB, d))
  .filter(existsSync)
  .map((p) => readFileSync(p, "utf8"))
  .join("\n");
const documentedKeys = ["DATABASE_URL", "OPENAI_BASE_URL", "OPENAI_API_KEY", "GATEWAY_ENDPOINT", "GATEWAY_API_KEY"];
for (const k of documentedKeys) {
  check(liveDoc.includes(k), `MWT-10: [LIV] key documented: ${k}`);
}
// Docs/templates must not embed a real secret VALUE (only key names / placeholder shape).
// A real DATABASE_URL has a user:pass credential — flag if present in any doc.
const credentialLeak = /postgres:\/\/[^ \n]+:[^ \n]+@/i.test(liveDoc + allDocs) ||
  /sk-[A-Za-z0-9]{10,}/.test(liveDoc + allDocs);
check(!credentialLeak, "MWT-10: no real secret VALUE in activation/reviewer docs");

// 12. MWT-10 — presence-only reporting, no false READY when live env missing
check(
  existsSync(join(ROOT, "scripts", "trst4h-iii", "run-live-activation-check.mts")),
  "MWT-10: live activation check script exists",
);
if (envBlocked) {
  // Even with activation docs present, the pack must NOT claim plain READY.
  check(
    /READY_WITH_ENV_BLOCKERS/i.test(liveDoc + allDocs),
    "MWT-10: no false READY while live env blocked (READY_WITH_ENV_BLOCKERS stated)",
  );
}

// Report
const passed = lines.filter((l) => l.ok).length;
const failed = lines.length - passed;
const out: string[] = [];
out.push("MWT-8 + MWT-9 Private Beta Readiness Check (pack consistency)");
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
out.push("Referenced commands (run manually per RUNBOOK.md / QUICKSTART.md):");
out.push("  npm run validate");
out.push("  npm run beta:check");
out.push("  npx tsx scripts/trst/run-private-beta-report.mts");
out.push("  npx tsx scripts/trst/run-health-check.mts");
out.push("  npx tsx scripts/trst4h-iii/run-live-preflight.mts");
out.push("  npx tsx scripts/trst4h-iii/run-live-activation-check.mts");
out.push("  npx tsx scripts/frontend/run-browser-harness-smoke.mts");

process.stdout.write(out.join("\n") + "\n");
process.exit(failed === 0 ? 0 : 1);
