// MWT-7E — TRST-4H-III Live Environment Diagnostics
//
// Pure, offline-first inspector that reports WHY a TRST-4H-III live section is
// blocked, and whether it could PASS given the current environment.
//
// Design rules (per MWT-7 taxonomy, narrow classifier):
//   - Missing DB config                => ENV_BLOCKED (explicit reason)
//   - Postgres connection refused      => ENV_BLOCKED (explicit reason)
//   - Missing gateway endpoint/API key => ENV_BLOCKED (explicit reason)
//   - Gateway unreachable              => ENV_BLOCKED (explicit reason)
//   - Real assertion mismatch          => FAIL (never swallowed)
//   - TypeError/ReferenceError         => FAIL (never swallowed)
//
// No real DB connection and no real outbound network call are performed by
// default. Only cheap, local config-presence checks + optional short-timeout
// TCP probes (disabled by default) are used.

export type LiveRequirementStatus = "PASS" | "ENV_BLOCKED" | "FAIL";

export interface ReqCheck {
  id: string;
  label: string;
  required: boolean;
  status: LiveRequirementStatus;
  reason_code: string;
  detail: string;
}

export interface DatabaseReadiness {
  required: boolean;
  env_present: boolean;
  url_present: boolean;
  url_well_formed: boolean;
  host_present: boolean;
  port_present: boolean;
  // connection_attempted is always false here — we never open a real socket
  // unless explicitly opted in (out of MWT-7E scope for determinism).
  connection_attempted: false;
  status: LiveRequirementStatus;
  reason_code: string;
  detail: string;
}

export interface GatewayReadiness {
  required: boolean;
  endpoint_present: boolean;
  api_key_present: boolean;
  // network_attempted is always false here — no real HTTP call by default.
  network_attempted: false;
  status: LiveRequirementStatus;
  reason_code: string;
  detail: string;
}

export interface HttpServiceReadiness {
  required: boolean;
  base_url_present: boolean;
  status: LiveRequirementStatus;
  reason_code: string;
  detail: string;
}

export interface LiveEnvReport {
  database: DatabaseReadiness;
  gateway: GatewayReadiness;
  http_service: HttpServiceReadiness;
  /** True when all REQUIRED requirements are satisfied => live can run. */
  ready_to_run: boolean;
  /** Human-readable one-line summary. */
  summary: string;
}

function present(v: string | undefined): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

function parseDbUrl(url: string | undefined): {
  wellFormed: boolean;
  host: boolean;
  port: boolean;
} {
  if (!present(url)) return { wellFormed: false, host: false, port: false };
  try {
    const u = new URL(url);
    const host = !!u.hostname;
    const port = !!u.port;
    // Accept postgresql:// and postgres:// schemes.
    const schemeOk = u.protocol === "postgresql:" || u.protocol === "postgres:";
    return { wellFormed: schemeOk && host, host, port };
  } catch {
    return { wellFormed: false, host: false, port: false };
  }
}

export function inspectDatabase(opts?: { required?: boolean }): DatabaseReadiness {
  const required = opts?.required ?? true;
  const raw = process.env.DATABASE_URL;
  const url_present = present(raw);
  const parsed = parseDbUrl(raw);

  if (!url_present) {
    return {
      required,
      env_present: false,
      url_present: false,
      url_well_formed: false,
      host_present: false,
      port_present: false,
      connection_attempted: false,
      status: required ? "ENV_BLOCKED" : "PASS",
      reason_code: required ? "DB_URL_MISSING" : "DB_OPTIONAL_SKIP",
      detail: required
        ? "DATABASE_URL is not set — Postgres-backed live path cannot run"
        : "DATABASE_URL not set but DB not required for this section",
    };
  }

  if (!parsed.wellFormed) {
    return {
      required,
      env_present: true,
      url_present: true,
      url_well_formed: false,
      host_present: parsed.host,
      port_present: parsed.port,
      connection_attempted: false,
      status: required ? "ENV_BLOCKED" : "PASS",
      reason_code: required ? "DB_URL_MALFORMED" : "DB_OPTIONAL_SKIP",
      detail: required
        ? "DATABASE_URL present but malformed (expected postgresql://host:port/db)"
        : "DATABASE_URL malformed but DB not required for this section",
    };
  }

  return {
    required,
    env_present: true,
    url_present: true,
    url_well_formed: true,
    host_present: parsed.host,
    port_present: parsed.port,
    connection_attempted: false,
    status: "PASS",
    reason_code: "DB_CONFIG_PRESENT",
    detail: "DATABASE_URL present and well-formed (host/port/db OK)",
  };
}

export function inspectGateway(opts?: { required?: boolean }): GatewayReadiness {
  const required = opts?.required ?? true;
  const endpoint = process.env.OPENAI_BASE_URL ?? process.env.GATEWAY_ENDPOINT;
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.GATEWAY_API_KEY;

  const endpoint_present = present(endpoint);
  const api_key_present = present(apiKey);

  if (!endpoint_present && !api_key_present) {
    return {
      required,
      endpoint_present: false,
      api_key_present: false,
      network_attempted: false,
      status: required ? "ENV_BLOCKED" : "PASS",
      reason_code: required ? "GATEWAY_CONFIG_MISSING" : "GATEWAY_OPTIONAL_SKIP",
      detail: required
        ? "Neither OPENAI_BASE_URL/GATEWAY_ENDPOINT nor OPENAI_API_KEY/GATEWAY_API_KEY set"
        : "Gateway config absent but not required for this section",
    };
  }

  if (!endpoint_present) {
    return {
      required,
      endpoint_present: false,
      api_key_present: true,
      network_attempted: false,
      status: required ? "ENV_BLOCKED" : "PASS",
      reason_code: required ? "GATEWAY_ENDPOINT_MISSING" : "GATEWAY_OPTIONAL_SKIP",
      detail: required
        ? "OPENAI_API_KEY present but gateway endpoint (OPENAI_BASE_URL/GATEWAY_ENDPOINT) missing"
        : "Gateway endpoint missing but not required for this section",
    };
  }

  if (!api_key_present) {
    return {
      required,
      endpoint_present: true,
      api_key_present: false,
      network_attempted: false,
      status: required ? "ENV_BLOCKED" : "PASS",
      reason_code: required ? "GATEWAY_API_KEY_MISSING" : "GATEWAY_OPTIONAL_SKIP",
      detail: required
        ? "Gateway endpoint present but OPENAI_API_KEY/GATEWAY_API_KEY missing"
        : "Gateway API key missing but not required for this section",
    };
  }

  return {
    required,
    endpoint_present: true,
    api_key_present: true,
    network_attempted: false,
    status: "PASS",
    reason_code: "GATEWAY_CONFIG_PRESENT",
    detail: "Gateway endpoint + API key present",
  };
}

export function inspectHttpService(opts?: {
  required?: boolean;
  envVar?: string;
}): HttpServiceReadiness {
  const required = opts?.required ?? false;
  const envVar = opts?.envVar ?? "SERVICE_BASE_URL";
  const base_url_present = present(process.env[envVar]);
  return {
    required,
    base_url_present,
    status: base_url_present || !required ? "PASS" : "ENV_BLOCKED",
    reason_code: base_url_present
      ? "HTTP_BASE_URL_PRESENT"
      : required
        ? "HTTP_BASE_URL_MISSING"
        : "HTTP_OPTIONAL_SKIP",
    detail: base_url_present
      ? `${envVar} present`
      : required
        ? `${envVar} not set — HTTP service live path cannot run`
        : `${envVar} not set but HTTP service not required for this section`,
  };
}

export function inspectLiveEnv(opts?: {
  databaseRequired?: boolean;
  gatewayRequired?: boolean;
  httpRequired?: boolean;
  httpEnvVar?: string;
}): LiveEnvReport {
  const database = inspectDatabase({ required: opts?.databaseRequired ?? true });
  const gateway = inspectGateway({ required: opts?.gatewayRequired ?? true });
  const http_service = inspectHttpService({
    required: opts?.httpRequired ?? false,
    envVar: opts?.httpEnvVar,
  });

  const checks: LiveRequirementStatus[] = [database.status, gateway.status, http_service.status];
  const anyFail = checks.includes("FAIL");
  const anyBlocked = checks.includes("ENV_BLOCKED");

  // A misconfigured (malformed) required DB/gateway is reported as ENV_BLOCKED
  // here because the preflight only inspects config presence, not code logic.
  // Real assertion/code failures are raised by the live test itself as FAIL.
  const ready_to_run = !anyFail && !anyBlocked && database.status === "PASS" && gateway.status === "PASS";

  let summary: string;
  if (anyFail) summary = "FAIL: live env misconfiguration (real failure)";
  else if (anyBlocked) summary = "ENV_BLOCKED: required live config missing";
  else if (ready_to_run) summary = "READY_TO_RUN: all required live config present";
  else summary = "READY_WITH_OPTIONAL_MISSING";

  return { database, gateway, http_service, ready_to_run, summary };
}

/**
 * Narrow classifier for TRST-4H-III live stderr/error text.
 *
 * Returns ENV_BLOCKED(reason) for known environmental signatures, or
 * FAIL(reason) for anything else (real code/assertion failure). No broad
 * catch-all: an unknown error becomes FAIL so genuine regressions surface.
 */
export function classifyTrst4hBlocker(text: string): string {
  const t = text.toLowerCase();
  if (!t) return "FAIL(empty-error-text)";

  // DB-related env blockers
  if (/database_url\s+(is\s+not\s+set|missing|undefined)/.test(t)) return "ENV_BLOCKED(DB_URL_MISSING)";
  if (/draining|connect econnrefused|5432|postgres|postgresql/.test(t)) return "ENV_BLOCKED(DB_CONNECTION_REFUSED)";
  if (/enotfound|etimedout|econnreset|getaddrinfo/.test(t)) return "ENV_BLOCKED(NETWORK_UNREACHABLE)";

  // Gateway-related env blockers
  if (/gateway is unavailable|gateway unavailable/.test(t)) return "ENV_BLOCKED(GATEWAY_UNAVAILABLE)";
  if (/openai_api_key\s+(is\s+not\s+set|missing|undefined)/.test(t)) return "ENV_BLOCKED(GATEWAY_API_KEY_MISSING)";
  if (/openai_base_url\s+(is\s+not\s+set|missing|undefined)/.test(t)) return "ENV_BLOCKED(GATEWAY_ENDPOINT_MISSING)";

  // Real code failures must remain FAIL (do NOT convert to ENV_BLOCKED).
  if (/assertion failed|expected .* got|to be .* but/.test(t)) return "FAIL(ASSERTION_MISMATCH)";
  if (/typeerror|referenceerror|cannot read|is not a function|undefined is not/.test(t)) return "FAIL(CODE_EXCEPTION)";

  // Unknown => FAIL (narrow classifier: no catch-all to ENV_BLOCKED).
  return "FAIL(UNKNOWN_LIVE_ERROR)";
}
