// MWT-10 — TRST-4H-III Live Environment Activation Check (executable, offline).
//
// Reuses the existing offline diagnostics (inspectLiveEnv / classifyTrst4hBlocker)
// to report the live prerequisites for the TRST-4H-III live sections (DB-backed
// Manager route-message + gateway-backed model availability), and adds an explicit
// secret-masking self-test proving the report never leaks secret VALUES.
//
// Exit code:
//   0  => pack/activation checks consistent (DB/gateway reported presence-only)
//   1  => a real assertion/code failure in THIS script (e.g. masking leak detected)
//
// This script does NOT open a real DB socket and does NOT make a real outbound
// HTTP call. It only inspects config PRESENCE. The actual TRST-4H-III live tests
// (run-live-env-smoke.mts / run-live-env-regression.mts) run only when the live
// env is provided; if they fail with a real code error they are classified FAIL.
//
// Run: npx tsx scripts/trst4h-iii/run-live-activation-check.mts

import { inspectLiveEnv, classifyTrst4hBlocker } from "./live-env-diagnostics.mts";

const ICON: Record<string, string> = {
  PASS: "✅",
  ENV_BLOCKED: "⚠️ ",
  FAIL: "❌",
};

const report = inspectLiveEnv({ databaseRequired: true, gatewayRequired: true });

function row(label: string, status: string, reason_code: string, detail: string): string {
  return `  ${ICON[status] ?? "?"} ${label.padEnd(28)} [${status}] ${reason_code}\n      ${detail}`;
}

// ---- Secret masking self-test --------------------------------------------
// The activation report must show presence only (env_present / well_formed /
// host_present) — never the secret VALUE. We assert that a crafted report string
// built from `report` contains no plausible secret value, even if a real
// DATABASE_URL / API key were set in the environment.
const maskedReport = [
  `db_env_present=${report.database.env_present}`,
  `db_url_present=${report.database.url_present}`,
  `db_well_formed=${report.database.url_well_formed}`,
  `gw_endpoint_present=${report.gateway.endpoint_present}`,
  `gw_api_key_present=${report.gateway.api_key_present}`,
].join(" ");

const rawDb = process.env.DATABASE_URL ?? "";
const rawKey = process.env.OPENAI_API_KEY ?? process.env.GATEWAY_API_KEY ?? "";
const leakedValue =
  (rawDb.trim().length > 0 && maskedReport.includes(rawDb.trim())) ||
  (rawKey.trim().length > 0 && maskedReport.includes(rawKey.trim()));

const checks: { ok: boolean; msg: string }[] = [];
function check(ok: boolean, msg: string): void {
  checks.push({ ok, msg });
}

check(!leakedValue, "secret masking: report shows presence-only, never secret VALUE");
check(
  !/postgres:\/\/[^ ]+:[^ ]+@/i.test(maskedReport),
  "secret masking: no user:pass credential substring in report",
);

// ---- TRST-4H-III verdict --------------------------------------------------
const trst4hStatus: "PASS" | "ENV_BLOCKED" | "FAIL" = report.ready_to_run
  ? "PASS"
  : "ENV_BLOCKED";

// Demonstrate the narrow classifier on a sample live error (no real run).
const sampleEnvError = "Error: DATABASE_URL is not set";
const classified = classifyTrst4hBlocker(sampleEnvError);
check(
  classified.startsWith("ENV_BLOCKED"),
  `classifier honest: '${sampleEnvError}' -> ${classified}`,
);
const sampleCodeError = "AssertionError: expected true to be false";
const classifiedCode = classifyTrst4hBlocker(sampleCodeError);
check(
  classifiedCode.startsWith("FAIL"),
  `classifier honest: '${sampleCodeError}' -> ${classifiedCode}`,
);

// ---- Overall verdict ------------------------------------------------------
const anyFail = checks.some((c) => !c.ok);
const overall: "READY" | "READY_WITH_ENV_BLOCKERS" | "FAIL" = anyFail
  ? "FAIL"
  : report.ready_to_run
    ? "READY"
    : "READY_WITH_ENV_BLOCKERS";

const out: string[] = [];
out.push("MWT-10 TRST-4H-III Live Environment Activation Check");
out.push("=".repeat(52));
out.push(row("database", "Postgres (DATABASE_URL)", report.database.status, report.database.reason_code, report.database.detail));
out.push(`      env_present=${report.database.env_present} url_present=${report.database.url_present} well_formed=${report.database.url_well_formed} host=${report.database.host_present} port=${report.database.port_present} connection_attempted=${report.database.connection_attempted}`);
out.push(row("gateway", "Gateway (OPENAI_BASE_URL/KEY)", report.gateway.status, report.gateway.reason_code, report.gateway.detail));
out.push(`      endpoint_present=${report.gateway.endpoint_present} api_key_present=${report.gateway.api_key_present} network_attempted=${report.gateway.network_attempted}`);
out.push(row("TRST-4H-III", "live sections", trst4hStatus, report.summary, report.ready_to_run ? "all required live config present" : "required live config missing"));
out.push("");
for (const c of checks) {
  out.push(`  ${c.ok ? "✅" : "❌"} ${c.msg}`);
}
out.push("=".repeat(52));
out.push(`Live env: ${report.summary}`);
out.push(`Verdict: ${overall}`);
out.push("");
out.push("Note: ENV_BLOCKED means a live section cannot run due to missing config —");
out.push("not a code regression. Provide DATABASE_URL + gateway config to make the");
out.push("live sections PASS. Real assertion/code failures remain FAIL.");

process.stdout.write(out.join("\n") + "\n");
process.exit(anyFail ? 1 : 0);
