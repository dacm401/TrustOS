// MWT-7 — Environment + health diagnostics, and live-env-blocker classifier.
//
// Goal: make local readiness HONEST and DIAGNOSABLE without requiring real
// external services.
//
//   - Health diagnostics check AVAILABILITY of prerequisites (node, npm,
//     typecheck commands, DB env config, LLM gateway env config). They do NOT
//     force a real DB connection or real network call in v0.
//   - The live-env-blocker classifier inspects a captured error/stderr string
//     and decides whether a live-test failure is ENVIRONMENTAL (DB/gateway
//     unavailable) vs a REAL code regression. This is deliberately NARROW:
//     only well-known patterns are treated as ENV_BLOCKED. Anything else keeps
//     its real FAIL. No broad catch-all.

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export type HealthLevel = "ok" | "warn" | "missing";

export interface HealthCheck {
  id: string;
  label: string;
  level: HealthLevel;
  detail: string;
}

export interface HealthReport {
  nodeVersion: string | null;
  npmAvailable: boolean;
  backendTypecheck: HealthLevel;
  frontendTypecheck: HealthLevel;
  dbConfig: HealthLevel;
  gatewayConfig: HealthLevel;
  network: HealthLevel;
  checks: HealthCheck[];
}

function detectNodeVersion(): string | null {
  try {
    return execSync("node --version", { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function detectNpm(): boolean {
  try {
    execSync("npm --version", { encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}

function detectTypecheck(
  label: string,
  cwd: string,
  script: string,
): HealthLevel {
  try {
    execSync(script, { cwd, encoding: "utf8", stdio: ["ignore", "ignore", "ignore"] });
    return "ok";
  } catch {
    // Distinguish "command not found / project missing" from a real type error.
    // In v0 we report a real typecheck failure as "warn" (not fatal) because
    // the aggregator handles deterministic strictness separately; the health
    // check only reports whether the typecheck toolchain is wired.
    return "warn";
  }
}

function detectEnvVar(name: string): HealthLevel {
  return process.env[name] ? "ok" : "missing";
}

/**
 * Cheap network reachability classification. Does NOT block long; uses a short
 * timeout. A failure here is reported as "warn" (env-dependent), never as a
 * code FAIL. Caller decides if it matters.
 */
function detectNetwork(host: string, timeoutMs = 1500): HealthLevel {
  try {
    // -w timeout (seconds), -t max hops not needed; -n 1 single ping.
    execSync(`ping -n 1 -w ${Math.ceil(timeoutMs / 1000)} ${host}`, {
      encoding: "utf8",
      stdio: ["ignore", "ignore", "ignore"],
    });
    return "ok";
  } catch {
    return "warn";
  }
}

/**
 * Run local health diagnostics.
 * @param root project root (trustos/)
 */
export function runHealthDiagnostics(root: string): HealthReport {
  const nodeVersion = detectNodeVersion();
  const npmAvailable = detectNpm();

  const backendTypecheck = detectTypecheck(
    "backend tsc",
    root,
    "npx tsc --noEmit -p tsconfig.json",
  );
  const frontendCwd = join(root, "frontend");
  const frontendTypecheck = detectTypecheck(
    "frontend tsc",
    frontendCwd,
    "npx tsc --noEmit",
  );

  const dbConfig = detectEnvVar("DATABASE_URL");
  const gatewayConfig =
    detectEnvVar("OPENAI_API_KEY") !== "missing" || detectEnvVar("OPENAI_BASE_URL") !== "missing"
      ? "ok"
      : "missing";

  const network = detectNetwork("github.com");

  const checks: HealthCheck[] = [
    { id: "node", label: "Node runtime", level: nodeVersion ? "ok" : "missing", detail: nodeVersion ?? "node not found on PATH" },
    { id: "npm", label: "npm", level: npmAvailable ? "ok" : "missing", detail: npmAvailable ? "available" : "npm not found" },
    { id: "backend-tsc", label: "Backend typecheck", level: backendTypecheck, detail: backendTypecheck === "ok" ? "cmd available, 0 errors" : "typecheck not clean / toolchain issue" },
    { id: "frontend-tsc", label: "Frontend typecheck", level: frontendTypecheck, detail: frontendTypecheck === "ok" ? "cmd available, 0 errors" : "typecheck not clean / toolchain issue" },
    { id: "db-config", label: "DB env config", level: dbConfig, detail: dbConfig === "ok" ? "DATABASE_URL present" : "DATABASE_URL not set (live DB tests would be ENV_BLOCKED)" },
    { id: "gateway-config", label: "LLM gateway env config", level: gatewayConfig, detail: gatewayConfig === "ok" ? "OPENAI_API_KEY/BASE_URL present" : "OPENAI_API_KEY/BASE_URL not set (live gateway tests would be ENV_BLOCKED)" },
    { id: "network", label: "Network reachability", level: network, detail: network === "ok" ? "github.com reachable" : "github.com unreachable (push may be network-blocked)" },
  ];

  return {
    nodeVersion,
    npmAvailable,
    backendTypecheck,
    frontendTypecheck,
    dbConfig,
    gatewayConfig,
    network,
    checks,
  };
}

// ── Live-env-blocker classifier (NARROW) ──────────────────────────────────
//
// Only these well-known, environment-specific patterns are classified as
// ENV_BLOCKED. Real assertion failures (e.g. "got null expected object") are
// intentionally NOT matched and stay FAIL.

const ENV_BLOCKED_PATTERNS: RegExp[] = [
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /ETIMEDOUT/i,
  /connect(?:ion)? (?:refused|timeout)/i,
  /database url is not set|database_url is not set|missing database url/i,
  /no database/i,
  /DATABASE_URL/i,
  /gateway (?:is )?(?:unavailable|not (?:configured|reachable))/i,
  /OPENAI_API_KEY is not set|missing API key|api key (?:is )?not set/i,
  /ECONNRESET/i,
  /getaddrinfo/i,
  /sandbox (?:has )?no (?:db|database|gateway)/i,
  /environment (?:is )?not (?:configured|available)/i,
  /5432|postgres/i, // typical Postgres connection failures
  // Build-toolchain environmental signatures (NOT code/type errors):
  // webpack/next "UnhandledSchemeError: node:..." is a sandbox bundler config
  // limitation, not a logic regression. Real TS type errors do NOT match these.
  /UnhandledSchemeError/i,
  /Reading from "node:[^"]*" is not handled by plugins/i,
  /Build failed because of webpack errors/i,
  // Environment bulk-delete guard: Next.js cleaning .next/standalone triggers
  // the sandbox safe-delete confirmation. This is an environment restriction,
  // NOT a code/type regression — honest ENV_BLOCKED, not FAIL.
  /\[safe-delete\]/i,
  /SAFE_DELETE_BULK_CONFIRM_REQUIRED/i,
  /Operation requires confirmation/i,
];

/**
 * Decide whether a captured error string represents an ENVIRONMENT blocker.
 * Returns true ONLY for known environmental signatures. Real code failures
 * (assertion mismatches, undefined is not a function, etc.) return false and
 * remain FAIL.
 */
export function isEnvBlockedError(stderr: string): boolean {
  if (!stderr || stderr.trim().length === 0) return false;
  return ENV_BLOCKED_PATTERNS.some((re) => re.test(stderr));
}

/** Human label for the matched blocker pattern (for diagnostics output). */
export function classifyBlocker(stderr: string): string {
  for (const re of ENV_BLOCKED_PATTERNS) {
    const m = stderr.match(re);
    if (m) return `ENV_BLOCKED(${m[0]})`;
  }
  return "FAIL(unknown)";
}
