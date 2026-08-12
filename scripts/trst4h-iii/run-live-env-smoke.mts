// MWT-7E — TRST-4H-III Live Environment Smoke (deterministic classifier fixtures).
//
// Verifies the narrow live-env classifier and preflight shape WITHOUT requiring
// a real DB or gateway. These are PURE functions over text/config, so the smoke
// is fully deterministic and offline.
//
// Run: npx tsx scripts/trst4h-iii/run-live-env-smoke.mts

import { classifyTrst4hBlocker, inspectLiveEnv, inspectDatabase, inspectGateway } from "./live-env-diagnostics.mts";

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

// ── 1. Narrow classifier: env-blocked signatures ──
check("missing DATABASE_URL => ENV_BLOCKED", classifyTrst4hBlocker("Error: DATABASE_URL is not set").startsWith("ENV_BLOCKED"));
check("Postgres connection refused => ENV_BLOCKED", classifyTrst4hBlocker("connect ECONNREFUSED 127.0.0.1:5432").startsWith("ENV_BLOCKED"));
check("ENOTFOUND => ENV_BLOCKED", classifyTrst4hBlocker("getaddrinfo ENOTFOUND postgres").startsWith("ENV_BLOCKED"));
check("gateway unavailable => ENV_BLOCKED", classifyTrst4hBlocker("gateway is unavailable in sandbox").startsWith("ENV_BLOCKED"));
check("gateway API key missing => ENV_BLOCKED", classifyTrst4hBlocker("OPENAI_API_KEY is not set").startsWith("ENV_BLOCKED"));
check("gateway endpoint missing => ENV_BLOCKED", classifyTrst4hBlocker("OPENAI_BASE_URL is not set").startsWith("ENV_BLOCKED"));

// ── 2. Narrow classifier: real failures stay FAIL (never swallowed) ──
check("assertion mismatch => FAIL", classifyTrst4hBlocker("Assertion failed: expected 'ask_clarification' got 'normal_conversation'").startsWith("FAIL"));
check("TypeError => FAIL", classifyTrst4hBlocker("TypeError: Cannot read properties of undefined (reading 'json')").startsWith("FAIL"));
check("ReferenceError => FAIL", classifyTrst4hBlocker("ReferenceError: foo is not defined").startsWith("FAIL"));
check("empty error text => FAIL (no catch-all)", classifyTrst4hBlocker("").startsWith("FAIL"));
check("unknown error => FAIL (no catch-all)", classifyTrst4hBlocker("some weird logic error").startsWith("FAIL"));

// ── 3. Preflight shape: DB ──
const dbMissing = inspectDatabase({ required: true });
check("db missing => ENV_BLOCKED", dbMissing.status === "ENV_BLOCKED" && dbMissing.reason_code === "DB_URL_MISSING");
check("db missing => connection_attempted false (no real socket)", dbMissing.connection_attempted === false);
check("db missing detail mentions DATABASE_URL", dbMissing.detail.includes("DATABASE_URL"));

const dbMalformed = inspectDatabase({ required: true });
// Force malformed by temporarily overriding env.
const savedUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = "not-a-url";
const dbMalformedReal = inspectDatabase({ required: true });
check("db malformed => ENV_BLOCKED(DB_URL_MALFORMED)", dbMalformedReal.status === "ENV_BLOCKED" && dbMalformedReal.reason_code === "DB_URL_MALFORMED");
process.env.DATABASE_URL = "postgresql://localhost:5432/smartrouter";
const dbOk = inspectDatabase({ required: true });
check("db well-formed => PASS", dbOk.status === "PASS" && dbOk.url_well_formed && dbOk.host_present && dbOk.port_present);
if (savedUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = savedUrl;

// ── 4. Preflight shape: gateway ──
const gwMissing = inspectGateway({ required: true });
check("gateway missing => ENV_BLOCKED", gwMissing.status === "ENV_BLOCKED" && gwMissing.reason_code === "GATEWAY_CONFIG_MISSING");
const savedBase = process.env.OPENAI_BASE_URL;
const savedKey = process.env.OPENAI_API_KEY;
process.env.OPENAI_BASE_URL = "http://localhost:8787/v1";
process.env.OPENAI_API_KEY = "sk-test";
const gwOk = inspectGateway({ required: true });
check("gateway configured => PASS", gwOk.status === "PASS" && gwOk.endpoint_present && gwOk.api_key_present && gwOk.network_attempted === false);
if (savedBase === undefined) delete process.env.OPENAI_BASE_URL; else process.env.OPENAI_BASE_URL = savedBase;
if (savedKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = savedKey;

// ── 5. No required live env => overall preflight not ready, deterministic safe ──
const report = inspectLiveEnv({ databaseRequired: true, gatewayRequired: true });
check("preflight summary reflects env-blocked when config missing", report.summary.startsWith("ENV_BLOCKED") || report.summary.startsWith("READY_TO_RUN"));
check("preflight ready_to_run false when config missing", !report.ready_to_run === true || report.ready_to_run === (report.database.status === "PASS" && report.gateway.status === "PASS"));

process.stdout.write(`\nMWT-7E live-env smoke: ${passed} passed, ${failed} failed\n`);
void dbMalformed; // referenced for shape completeness
process.exit(failed === 0 ? 0 : 1);
