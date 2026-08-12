// MWT-7E — TRST-4H-III Live Environment Regression (deterministic).
//
// Broader classifier + preflight regression covering all env-blocked vs FAIL
// boundaries and the documented behavior examples. No real DB/network.
//
// Run: npx tsx scripts/trst4h-iii/run-live-env-regression.mts

import {
  classifyTrst4hBlocker,
  inspectLiveEnv,
  inspectDatabase,
  inspectGateway,
  inspectHttpService,
  type LiveRequirementStatus,
} from "./live-env-diagnostics.mts";

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

// ── Behavior example matrix (from PM authorization) ──
// 1. missing DATABASE_URL => ENV_BLOCKED
check("ex1 missing DATABASE_URL => ENV_BLOCKED", inspectDatabase({ required: true }).status === "ENV_BLOCKED");

// 2. malformed DATABASE_URL => explicit ENV_BLOCKED
const saved = process.env.DATABASE_URL;
process.env.DATABASE_URL = "postgres:///broken?db"; // missing host/port-ish; schema ok but no host
const malformed = inspectDatabase({ required: true });
check("ex2 malformed DATABASE_URL => explicit ENV_BLOCKED", malformed.status === "ENV_BLOCKED" && malformed.reason_code === "DB_URL_MALFORMED");

// 3. Postgres connection refused => ENV_BLOCKED (classifier level)
check("ex3 connection refused => ENV_BLOCKED", classifyTrst4hBlocker("[DB] Connecting to: postgresql://x@localhost:5432").startsWith("ENV_BLOCKED"));
check("ex3b ECONNRESET => ENV_BLOCKED", classifyTrst4hBlocker("read ECONNRESET").startsWith("ENV_BLOCKED"));
check("ex3c ETIMEDOUT => ENV_BLOCKED", classifyTrst4hBlocker("connect ETIMEDOUT db:5432").startsWith("ENV_BLOCKED"));

// 4. missing gateway endpoint/API key => ENV_BLOCKED
check("ex4 missing gateway => ENV_BLOCKED", inspectGateway({ required: true }).status === "ENV_BLOCKED");

// 5. gateway unavailable => ENV_BLOCKED
check("ex5 gateway unavailable => ENV_BLOCKED", classifyTrst4hBlocker("gateway is unavailable in sandbox").startsWith("ENV_BLOCKED"));

// 6. real response assertion mismatch => FAIL (never ENV_BLOCKED)
check("ex6 assertion mismatch => FAIL", classifyTrst4hBlocker("Assertion failed: expected routeType 'ask_clarification' got 'normal_conversation'").startsWith("FAIL"));

// 7. TypeError/ReferenceError => FAIL
check("ex7a TypeError => FAIL", classifyTrst4hBlocker("TypeError: Cannot read properties of undefined (reading 'json')").startsWith("FAIL"));
check("ex7b ReferenceError => FAIL", classifyTrst4hBlocker("ReferenceError: foo is not defined").startsWith("FAIL"));

// 8. all required config present => preflight READY_TO_RUN
const sb = process.env.OPENAI_BASE_URL, sk = process.env.OPENAI_API_KEY;
process.env.DATABASE_URL = "postgresql://localhost:5432/smartrouter";
process.env.OPENAI_BASE_URL = "http://localhost:8787/v1";
process.env.OPENAI_API_KEY = "sk-test";
const ready = inspectLiveEnv({ databaseRequired: true, gatewayRequired: true });
check("ex8 all config present => ready_to_run", ready.ready_to_run && ready.summary.startsWith("READY_TO_RUN"));
check("ex8 db PASS", ready.database.status === "PASS");
check("ex8 gateway PASS", ready.gateway.status === "PASS");
if (saved === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved;
if (sb === undefined) delete process.env.OPENAI_BASE_URL; else process.env.OPENAI_BASE_URL = sb;
if (sk === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = sk;

// 9. no required live env => deterministic validation still PASS (other suites)
//    Demonstrated by an optional-only report.
const optionalOnly = inspectLiveEnv({ databaseRequired: false, gatewayRequired: false });
check("ex9 no required live env => not blocking", optionalOnly.database.status === "PASS" && optionalOnly.gateway.status === "PASS");

// ── HTTP service optional path ──
const httpOpt = inspectHttpService({ required: false, envVar: "SERVICE_BASE_URL" });
check("http optional absent => PASS (skipped)", httpOpt.status === "PASS" && httpOpt.reason_code === "HTTP_OPTIONAL_SKIP");

// ── status type exhaustiveness ──
const statuses: LiveRequirementStatus[] = ["PASS", "ENV_BLOCKED", "FAIL"];
check("status union covers 3 values", statuses.length === 3);

// ── no network hard dependency: preflight never throws ──
let threw = false;
try {
  inspectLiveEnv({ databaseRequired: true, gatewayRequired: true });
} catch {
  threw = true;
}
check("ex10 no network hard dependency (preflight does not throw)", !threw);

// ── integration with validation-status taxonomy (reason is ENV_BLOCKED-prefixed) ──
check("classifier integrates as ENV_BLOCKED prefix", classifyTrst4hBlocker("DATABASE_URL is not set").startsWith("ENV_BLOCKED"));
check("classifier integrates as FAIL prefix for code error", classifyTrst4hBlocker("TypeError: x").startsWith("FAIL"));

process.stdout.write(`\nMWT-7E live-env regression: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
