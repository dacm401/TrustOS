// TRST Sealed-Flow Aggregate Validation.
//
// Standing Engineering Backlog — Batch 1 (P0 Validation Integration).
//
// Runs the canonical sealed-flow quality gate in one command:
//   1. frontend typecheck        (npx tsc --noEmit, cwd frontend/)
//   2. frontend build            (npx next build,   cwd frontend/)
//   3. MWT-4A smoke              (npx tsx scripts/mwt4a/run-smoke.mts)
//   4. MWT-4A regression         (npx tsx scripts/mwt4a/run-regression.mts)
//   5. MWT-3B1 smoke             (npx tsx scripts/mwt3b1/run-smoke.mts)
//   6. backend typecheck         (npx tsc --noEmit -p tsconfig.json)
//   7. MWT-4B smoke              (npx tsx scripts/mwt4b/run-smoke.mts)
//   8. MWT-4B regression         (npx tsx scripts/mwt4b/run-regression.mts)
//   9. MWT-5 smoke              (npx tsx scripts/mwt5/run-smoke.mts)
//  10. MWT-5 regression         (npx tsx scripts/mwt5/run-regression.mts)
//  11. TRST-4H smoke            (npx tsx scripts/trst4h/run-smoke.mts)
//  12. TRST-4H regression       (npx tsx scripts/trst4h/run-regression.mts)
//  13. TRST-4H-I smoke          (npx tsx scripts/trst4h-i/run-smoke.mts)
//  14. TRST-4H-I regression     (npx tsx scripts/trst4h-i/run-regression.mts)
//  15. TRST-4H-II smoke         (npx tsx scripts/trst4h-ii/run-smoke.mts)
//  16. TRST-4H-II regression    (npx tsx scripts/trst4h-ii/run-regression.mts)
//  17. TRST-4H-III smoke        (npx tsx scripts/trst4h-iii/run-smoke.mts)
//  18. TRST-4H-III regression   (npx tsx scripts/trst4h-iii/run-regression.mts)
//  19. MWT-4E smoke             (npx tsx scripts/mwt4e/run-smoke.mts)
//  20. MWT-4E regression        (npx tsx scripts/mwt4e/run-regression.mts)
//  21. MWT-4 Mainline smoke     (npx tsx scripts/mwt4/run-smoke.mts)
//  22. MWT-4 Mainline regression(npx tsx scripts/mwt4/run-regression.mts)
//  23. MWT-5+ Signed Approval smoke   (npx tsx scripts/mwt5/run-signed-approval-smoke.mts)
//  24. MWT-5+ Signed Approval regression(npx tsx scripts/mwt5/run-signed-approval-regression.mts)
//  25. MWT-4F Provenance smoke   (npx tsx scripts/mwt4/run-provenance-smoke.mts)
//  26. MWT-4F Provenance regression(npx tsx scripts/mwt4/run-provenance-regression.mts)
//  27. MWT-5R Approval Review Replay smoke   (npx tsx scripts/mwt5/run-approval-review-smoke.mts)
//  28. MWT-5R Approval Review Replay regression(npx tsx scripts/mwt5/run-approval-review-regression.mts)
//  29. MWT-5R-UI Approval Review Panel smoke   (npx tsx scripts/mwt5/run-approval-review-ui-smoke.mts)
//  30. MWT-5R-UI Approval Review Panel regression(npx tsx scripts/mwt5/run-approval-review-ui-regression.mts)
//  31. MWT-5R-UI-II Route Integration Smoke   (npx tsx scripts/mwt5/run-approval-review-ui-route-smoke.mts)
//  32. MWT-5R-UI-II Route Integration Regression(npx tsx scripts/mwt5/run-approval-review-ui-route-regression.mts)
//  33. MWT-6 Memory Governance Smoke          (npx tsx scripts/mwt6/run-memory-governance-smoke.mts)
//  34. MWT-6 Memory Governance Regression      (npx tsx scripts/mwt6/run-memory-governance-regression.mts)
//
// Scope guard:
//   - validation only; MWT-4B implementation is the minimal export slice
//   - no new dependencies; reuses already-present tsx + next
//   - exits non-zero on ANY section failure
//
// Usage: npx tsx scripts/trst/run-validation.mts
//        npm run validate        (if package script alias added)
//
// Architecture note:
//   This script's own type-safety is intentionally narrow: a spawned command's
//   outcome is modeled as { name, ok, code, output } so we never `any` the
//   child_process result. Output is captured to a buffer and streamed per-section.

import { spawn } from "node:child_process";
import { type SpawnOptions } from "node:child_process";

type StepResult = {
  name: string;
  ok: boolean;
  code: number | null;
  output: string;
};

const ROOT = process.cwd();

// Each step declares its command, args, and working directory.
// `cwd: "frontend"` steps run inside frontend/; others run at repo root.
type Step = {
  name: string;
  cmd: string;
  args: string[];
  cwd?: string;
};

const STEPS: Step[] = [
  { name: "Frontend Typecheck", cmd: "npx", args: ["tsc", "--noEmit"], cwd: "frontend" },
  { name: "Frontend Build", cmd: "npx", args: ["next", "build"], cwd: "frontend" },
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
  { name: "TRST-4H-III Smoke", cmd: "npx", args: ["tsx", "scripts/trst4h-iii/run-smoke.mts"] },
  { name: "TRST-4H-III Regression", cmd: "npx", args: ["tsx", "scripts/trst4h-iii/run-regression.mts"] },
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

async function main(): Promise<void> {
  const banner = "═".repeat(64);
  process.stdout.write(`${banner}\n  TRST SEALED-FLOW VALIDATION\n${banner}\n`);
  process.stdout.write(`Root: ${ROOT}\n`);
  process.stdout.write(`Steps: ${STEPS.length}\n`);

  const results: StepResult[] = [];
  for (const step of STEPS) {
    section(`▶ ${step.name}`);
    const r = await runStep(step);
    results.push(r);
    if (r.ok) {
      process.stdout.write(`\n✅ ${step.name} PASSED (exit ${r.code})\n`);
    } else {
      process.stdout.write(`\n❌ ${step.name} FAILED (exit ${r.code})\n`);
    }
  }

  // Final summary.
  process.stdout.write(`\n${banner}\n  VALIDATION SUMMARY\n${banner}\n`);
  let failed = 0;
  for (const r of results) {
    const mark = r.ok ? "PASS" : "FAIL";
    if (!r.ok) failed++;
    process.stdout.write(`  [${mark}] ${r.name}${r.ok ? "" : ` (exit ${r.code})`}\n`);
  }
  process.stdout.write(`${banner}\n`);
  if (failed === 0) {
    process.stdout.write(`  ALL ${results.length} SECTIONS PASSED ✅\n`);
    process.stdout.write(`${banner}\n`);
    process.exit(0);
  } else {
    process.stdout.write(`  ${failed}/${results.length} SECTION(S) FAILED ❌\n`);
    process.stdout.write(`${banner}\n`);
    process.exit(1);
  }
}

main();
