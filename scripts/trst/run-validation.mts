// TRST Sealed-Flow Aggregate Validation.
//
// MWT-7: Every step is now classified with an explicit, honest taxonomy:
//   PASS | FAIL | ENV_BLOCKED | SKIPPED
// and reported per bucket (deterministic / live) with an overall readiness:
//   any FAIL            => FAIL
//   no FAIL + ENV_BLOCKED => READY_WITH_ENV_BLOCKERS
//   otherwise           => READY
//
// Deterministic steps remain STRICT: a real failure is FAIL, never downgraded.
// Live steps (TRST-4H-III HTTP/Postgres) that cannot run due to a missing
// DB/gateway are classified ENV_BLOCKED via the NARROW classifier in
// env-diagnostics — never counted as PASS, never confused with an ordinary
// code FAIL. Real assertion failures in live steps stay FAIL.
//
// Sections (stable order):
//   1. Frontend Typecheck
//   2. Frontend Build
//   3-32. MWT/TRST deterministic suites (incl. MWT-6, MWT-6-UI)
//  33. MWT-7 Validation Health Smoke        [deterministic]
//  34. MWT-7 Validation Health Regression    [deterministic]
//  35. TRST-4H-III Manager Route HTTP Smoke      [LIVE — DB/gateway dependent]
//  36. TRST-4H-III Manager Route HTTP Regression [LIVE — DB/gateway dependent]
//  37. MWT-7B Frontend Build Classifier      [deterministic, offline]
//  38. MWT-7B Frontend Surface Reachability  [deterministic, offline]
//  39. MWT-7C Browser Smoke (live runtime probe) [live, browser]
//  40. MWT-7C Browser Smoke Regression        [deterministic, offline]
//  41. MWT-7D Browser Harness Smoke (live CDP) [live, browser]
//  42. MWT-7D Browser Harness Regression       [deterministic, offline]
//
// MWT-7B (Frontend Build & Runtime Readiness): Frontend Build is now expected
// PASS (the node:crypto client-bundle edge was removed). Sections 37-38 are
// DETERMINISTIC offline checks that assert the build-status classifier and the
// Audit/Memory surface reachability WITHOUT re-running `next build` each time.
//
// Usage: npx tsx scripts/trst/run-validation.mts

import { spawn } from "node:child_process";
import { type SpawnOptions } from "node:child_process";
import {
  computeReadiness,
  renderReadiness,
  summarize,
  type StepOutcome,
  type ValidationStatus,
} from "./validation-status";
import { isEnvBlockedError } from "./env-diagnostics";

type StepResult = {
  name: string;
  ok: boolean;
  code: number | null;
  output: string;
};

const ROOT = process.cwd();

// Each step declares its command, args, working directory, and bucket.
// `cwd: "frontend"` steps run inside frontend/; others run at repo root.
// `bucket: "live"` steps are classified with the env-blocker classifier when
// they fail (ENV_BLOCKED vs real FAIL). Deterministic steps are strict.
type Step = {
  name: string;
  cmd: string;
  args: string[];
  cwd?: string;
  bucket?: "deterministic" | "live";
};

const STEPS: Step[] = [
  { name: "Frontend Typecheck", cmd: "npx", args: ["tsc", "--noEmit"], cwd: "frontend" },
  { name: "Frontend Build", cmd: "npx", args: ["next", "build"], cwd: "frontend", bucket: "live" },
  { name: "MWT-4A Smoke", cmd: "npx", args: ["tsx", "scripts/mwt4a/run-smoke.mts"] },
  { name: "MWT-4A Regression", cmd: "npx", args: ["tsx", "scripts/mwt4a/run-regression.mts"] },
  { name: "MWT-3B1 Regression", cmd: "npx", args: ["tsx", "scripts/mwt3b1/run-regression.mts"] },
  { name: "MWT-3B1 Smoke", cmd: "npx", args: ["tsx", "scripts/mwt3b1/run-smoke.mts"] },
  { name: "Backend Typecheck", cmd: "npx", args: ["tsc", "--noEmit", "-p", "tsconfig.json"] },
  { name: "MWT-4B Smoke", cmd: "npx", args: ["tsx", "scripts/mwt4b/run-smoke.mts"] },
  { name: "MWT-4B Regression", cmd: "npx", args: ["tsx", "scripts/mwt4b/run-regression.mts"] },
  { name: "MWT-5 Smoke", cmd: "npx", args: ["tsx", "scripts/mwt5/run-smoke.mts"] },
  { name: "MWT-5 Regression", cmd: "npx", args: ["tsx", "scripts/mwt5/run-regression.mts"] },
  { name: "TRST-4H Smoke", cmd: "npx", args: ["tsx", "scripts/trst4h/run-smoke.mts"] },
  { name: "TRST-4H Regression", cmd: "npx", args: ["tsx", "scripts/trst4h/run-regression.mts"] },
  { name: "TRST-4H-I Smoke", cmd: "npx", args: ["tsx", "scripts/trst4h-i/run-smoke.mts"] },
  { name: "TRST-4H-I Regression", cmd: "npx", args: ["tsx", "scripts/trst4h-i/run-regression.mts"] },
  { name: "TRST-4H-II Smoke", cmd: "npx", args: ["tsx", "scripts/trst4h-ii/run-smoke.mts"] },
  { name: "TRST-4H-II Regression", cmd: "npx", args: ["tsx", "scripts/trst4h-ii/run-regression.mts"] },
  { name: "TRST-4H-III Smoke", cmd: "npx", args: ["tsx", "scripts/trst4h-iii/run-smoke.mts"], bucket: "live" },
  { name: "TRST-4H-III Regression", cmd: "npx", args: ["tsx", "scripts/trst4h-iii/run-regression.mts"], bucket: "live" },
  { name: "MWT-4E Smoke", cmd: "npx", args: ["tsx", "scripts/mwt4e/run-smoke.mts"] },
  { name: "MWT-4E Regression", cmd: "npx", args: ["tsx", "scripts/mwt4e/run-regression.mts"] },
  { name: "MWT-4 Mainline Smoke", cmd: "npx", args: ["tsx", "scripts/mwt4/run-smoke.mts"] },
  { name: "MWT-4 Mainline Regression", cmd: "npx", args: ["tsx", "scripts/mwt4/run-regression.mts"] },
  { name: "MWT-5+ Signed Approval Smoke", cmd: "npx", args: ["tsx", "scripts/mwt5/run-signed-approval-smoke.mts"] },
  { name: "MWT-5+ Signed Approval Regression", cmd: "npx", args: ["tsx", "scripts/mwt5/run-signed-approval-regression.mts"] },
  { name: "MWT-4F Provenance Smoke", cmd: "npx", args: ["tsx", "scripts/mwt4/run-provenance-smoke.mts"] },
  { name: "MWT-4F Provenance Regression", cmd: "npx", args: ["tsx", "scripts/mwt4/run-provenance-regression.mts"] },
  { name: "MWT-5R Approval Review Replay Smoke", cmd: "npx", args: ["tsx", "scripts/mwt5/run-approval-review-smoke.mts"] },
  { name: "MWT-5R Approval Review Replay Regression", cmd: "npx", args: ["tsx", "scripts/mwt5/run-approval-review-regression.mts"] },
  { name: "MWT-5R-UI Approval Review Panel Smoke", cmd: "npx", args: ["tsx", "scripts/mwt5/run-approval-review-ui-smoke.mts"] },
  { name: "MWT-5R-UI Approval Review Panel Regression", cmd: "npx", args: ["tsx", "scripts/mwt5/run-approval-review-ui-regression.mts"] },
  { name: "MWT-5R-UI-II Route Integration Smoke", cmd: "npx", args: ["tsx", "scripts/mwt5/run-approval-review-ui-route-smoke.mts"] },
  { name: "MWT-5R-UI-II Route Integration Regression", cmd: "npx", args: ["tsx", "scripts/mwt5/run-approval-review-ui-route-regression.mts"] },
  { name: "MWT-6 Memory Governance Smoke", cmd: "npx", args: ["tsx", "scripts/mwt6/run-memory-governance-smoke.mts"] },
  { name: "MWT-6 Memory Governance Regression", cmd: "npx", args: ["tsx", "scripts/mwt6/run-memory-governance-regression.mts"] },
  { name: "MWT-6-UI Memory Governance Panel Smoke", cmd: "npx", args: ["tsx", "scripts/mwt6/run-memory-governance-ui-smoke.mts"] },
  { name: "MWT-6-UI Memory Governance Panel Regression", cmd: "npx", args: ["tsx", "scripts/mwt6/run-memory-governance-ui-regression.mts"] },
  { name: "MWT-7 Validation Health Smoke", cmd: "npx", args: ["tsx", "scripts/trst/run-validation-health-smoke.mts"] },
  { name: "MWT-7 Validation Health Regression", cmd: "npx", args: ["tsx", "scripts/trst/run-validation-health-regression.mts"] },
  { name: "MWT-7B Frontend Build Classifier", cmd: "npx", args: ["tsx", "scripts/frontend/run-frontend-readiness-smoke.mts"] },
  { name: "MWT-7B Frontend Surface Reachability", cmd: "npx", args: ["tsx", "scripts/frontend/run-frontend-readiness-regression.mts"] },
  { name: "MWT-7C Browser Smoke", cmd: "npx", args: ["tsx", "scripts/frontend/run-browser-smoke.mts"], bucket: "live" },
  { name: "MWT-7C Browser Smoke Regression", cmd: "npx", args: ["tsx", "scripts/frontend/run-browser-smoke-regression.mts"] },
  { name: "MWT-7D Browser Harness Smoke", cmd: "npx", args: ["tsx", "scripts/frontend/run-browser-harness-smoke.mts"], bucket: "live" },
  { name: "MWT-7D Browser Harness Regression", cmd: "npx", args: ["tsx", "scripts/frontend/run-browser-harness-regression.mts"] },
];

function runStep(step: Step): Promise<StepResult> {
  return new Promise((resolve) => {
    const opts: SpawnOptions = {
      cwd: step.cwd ? `${ROOT}/${step.cwd}` : ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      // Windows: npx/next are .cmd shims, not directly spawnable without a shell.
      // Build a single command string so there is no args-escaping deprecation warning.
      shell: true,
    };
    const command = [step.cmd, ...step.args].join(" ");
    const child = spawn(command, [], opts);
    let out = "";
    const sink = (b: Buffer | string) => {
      const s = b.toString();
      out += s;
      process.stdout.write(s);
    };
    child.stdout?.on("data", sink);
    child.stderr?.on("data", sink);
    child.on("error", (err: Error) => {
      out += `\n[spawn error] ${err.message}\n`;
      process.stdout.write(`\n[spawn error] ${err.message}\n`);
    });
    child.on("close", (code: number | null) => {
      resolve({ name: step.name, ok: code === 0, code, output: out });
    });
  });
}

function section(title: string): void {
  const bar = "─".repeat(64);
  process.stdout.write(`\n${bar}\n  ${title}\n${bar}\n`);
}

// Map a raw step result to an honest ValidationStatus.
function classify(step: Step, r: StepResult): ValidationStatus {
  if (r.ok) return "PASS";
  // Failed. For live steps, apply the NARROW env-blocker classifier.
  if (step.bucket === "live" && isEnvBlockedError(r.output)) {
    return "ENV_BLOCKED";
  }
  return "FAIL";
}

async function main(): Promise<void> {
  const banner = "═".repeat(64);
  process.stdout.write(`${banner}\n  TRST SEALED-FLOW VALIDATION (MWT-7 taxonomy)\n${banner}\n`);
  process.stdout.write(`Root: ${ROOT}\n`);
  process.stdout.write(`Steps: ${STEPS.length}\n`);

  const outcomes: StepOutcome[] = [];
  for (const step of STEPS) {
    section(`▶ ${step.name}${step.bucket === "live" ? "  [LIVE]" : ""}`);
    const r = await runStep(step);
    const status = classify(step, r);
    outcomes.push({
      name: step.name,
      status,
      bucket: step.bucket === "live" ? "live" : "deterministic",
      detail: status === "ENV_BLOCKED" ? "DB/gateway unavailable in sandbox" : undefined,
    });
    if (status === "PASS") {
      process.stdout.write(`\n✅ ${step.name} PASSED (exit ${r.code})\n`);
    } else if (status === "ENV_BLOCKED") {
      process.stdout.write(`\n⚠️  ${step.name} ENV_BLOCKED (live dependency missing)\n`);
    } else {
      process.stdout.write(`\n❌ ${step.name} FAILED (exit ${r.code})\n`);
    }
  }

  // ── Bucketed + readiness reporting (MWT-7) ──
  const deterministic = outcomes.filter((o) => o.bucket === "deterministic");
  const live = outcomes.filter((o) => o.bucket === "live");
  const det = summarize(deterministic);
  const liv = summarize(live);

  process.stdout.write(`\n${banner}\n  VALIDATION SUMMARY\n${banner}\n`);
  process.stdout.write(`\nDeterministic:\n`);
  process.stdout.write(`  PASS: ${det.pass}\n`);
  process.stdout.write(`  FAIL: ${det.fail}\n`);
  process.stdout.write(`  (total ${det.total})\n`);
  process.stdout.write(`\nLive:\n`);
  process.stdout.write(`  PASS: ${liv.pass}\n`);
  process.stdout.write(`  ENV_BLOCKED: ${liv.envBlocked}\n`);
  process.stdout.write(`  FAIL: ${liv.fail}\n`);
  process.stdout.write(`  (total ${liv.total})\n`);
  process.stdout.write(`\nSkipped:\n`);
  process.stdout.write(`  0\n`);

  const readiness = computeReadiness(outcomes);
  process.stdout.write(`\nOverall:\n`);
  process.stdout.write(`  ${renderReadiness(readiness)}\n`);
  process.stdout.write(`${banner}\n`);

  // EXIT semantics:
  //   FAIL  => exit 1 (real regression; do not ship)
  //   READY / READY_WITH_ENV_BLOCKERS => exit 0 (no code regression)
  process.exit(readiness === "FAIL" ? 1 : 0);
}

main();
