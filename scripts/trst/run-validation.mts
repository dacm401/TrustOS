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
