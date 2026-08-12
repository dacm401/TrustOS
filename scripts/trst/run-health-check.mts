// MWT-7 — Local readiness health check (no hard network/DB dependency).
//
// Prints an honest table of local prerequisites so a private-beta runner can
// see AT A GLANCE what is missing before attempting live steps.
//
// Run: npx tsx scripts/trst/run-health-check.mts

import { runHealthDiagnostics, type HealthLevel } from "./env-diagnostics";

const ROOT = process.cwd();

const report = runHealthDiagnostics(ROOT);

const ICON: Record<HealthLevel, string> = {
  ok: "✅",
  warn: "⚠️",
  missing: "❌",
};

function line(c: { id: string; label: string; level: HealthLevel; detail: string }): string {
  return `  ${ICON[c.level]} ${c.label.padEnd(22)} ${c.detail}`;
}

// eslint-friendly header printing
const out: string[] = [];
out.push("MWT-7 Local Readiness Health Check");
out.push(`  node: ${report.nodeVersion ?? "MISSING"}`);
out.push(`  npm:  ${report.npmAvailable ? "available" : "MISSING"}`);
for (const c of report.checks) out.push(line(c));

const blockers = report.checks.filter((c) => c.level === "missing");
const warnon = report.checks.filter((c) => c.level === "warn");

out.push("");
if (blockers.length > 0) {
  out.push(`ENV BLOCKERS (missing config): ${blockers.length}`);
  for (const b of blockers) out.push(`  - ${b.label}: ${b.detail}`);
}
if (warnon.length > 0) {
  out.push(`WARNINGS (may be environment-dependent): ${warnon.length}`);
  for (const w of warnon) out.push(`  - ${w.label}: ${w.detail}`);
}
if (blockers.length === 0 && warnon.length === 0) {
  out.push("All local prerequisites OK.");
}

out.push("");
out.push(`DB config:        ${report.dbConfig}`);
out.push(`Gateway config:   ${report.gatewayConfig}`);
out.push(`Network (github): ${report.network}`);

process.stdout.write(out.join("\n") + "\n");

// Health check itself is a prerequisite gate: it should EXIT 0 even when env
// is missing (that is the point — it reports, it does not fail the build for
// env reasons). A genuine runtime crash (e.g. script bug) would still exit 1.
process.exit(0);
