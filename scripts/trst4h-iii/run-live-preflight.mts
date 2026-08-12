// MWT-7E — TRST-4H-III Live Environment Preflight (executable, offline).
//
// Prints an honest table of the live prerequisites for the TRST-4H-III
// live sections (DB-backed Manager route-message + gateway-backed model
// availability). It reports config presence only — it never opens a real
// DB socket or makes a real outbound HTTP call.
//
// Exit code is ALWAYS 0: the preflight is a reporting gate, not a failure
// gate. A genuine script crash would still exit 1. Use it to see at a
// glance why a live section is ENV_BLOCKED before attempting it.
//
// Run: npx tsx scripts/trst4h-iii/run-live-preflight.mts

import { inspectLiveEnv } from "./live-env-diagnostics.mts";

const report = inspectLiveEnv({ databaseRequired: true, gatewayRequired: true });

const ICON: Record<string, string> = {
  PASS: "✅",
  ENV_BLOCKED: "⚠️ ",
  FAIL: "❌",
};

function row(id: string, label: string, status: string, reason: string, detail: string): string {
  return `  ${ICON[status] ?? "?"} ${label.padEnd(28)} [${status}] ${reason}\n      ${detail}`;
}

const out: string[] = [];
out.push("MWT-7E TRST-4H-III Live Environment Preflight");
out.push("");
out.push(row("database", "Postgres (DATABASE_URL)", report.database.status, report.database.reason_code, report.database.detail));
out.push(`      env_present=${report.database.env_present} url_present=${report.database.url_present} well_formed=${report.database.url_well_formed} host=${report.database.host_present} port=${report.database.port_present} connection_attempted=${report.database.connection_attempted}`);
out.push(row("gateway", "Gateway (OPENAI_BASE_URL/KEY)", report.gateway.status, report.gateway.reason_code, report.gateway.detail));
out.push(`      endpoint_present=${report.gateway.endpoint_present} api_key_present=${report.gateway.api_key_present} network_attempted=${report.gateway.network_attempted}`);
out.push(row("http_service", "HTTP service (optional)", report.http_service.status, report.http_service.reason_code, report.http_service.detail));
out.push("");
out.push(`Summary: ${report.summary}`);
out.push(`Ready to run live tests: ${report.ready_to_run ? "YES" : "NO (env-blocked)"}`);
out.push("");
out.push("Note: ENV_BLOCKED here means a live section cannot run due to missing");
out.push("config — not a code regression. Provide DATABASE_URL + gateway config to");
out.push("make the live sections PASS. Real assertion/code failures remain FAIL.");

process.stdout.write(out.join("\n") + "\n");
process.exit(0);
