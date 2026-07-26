/**
 * TRST-2D Gateway Health Metrics Smoke Test
 *
 * Validates:
 *   - /health returns 200
 *   - Existing fields preserved (status, mode, streaming, mcp_lifecycle, providers)
 *   - uptime_seconds exists as number >= 0
 *   - events_count exists as number >= 0
 *   - gateway_overhead_ms exists as number | null
 *   - No secrets/API keys in response
 *   - No raw event content in response
 *   - /playground returns 404
 *
 * Usage:
 *   node scripts/trst2/run-health-metrics-smoke.mjs
 *
 * Environment:
 *   TRUSTOS_GATEWAY_URL — default: http://localhost:8795
 */

const GATEWAY = process.env.TRUSTOS_GATEWAY_URL ?? "http://localhost:8795";

let passed = 0;
let failed = 0;
const failures = [];

function pass(label) {
  console.log(`  ✅ ${label}`);
  passed++;
}

function fail(label, detail) {
  console.log(`  ❌ ${label} — ${detail}`);
  failed++;
  failures.push({ label, detail });
}

async function main() {
  console.log("TRST-2D Health Metrics Smoke Test");
  console.log(`Gateway: ${GATEWAY}`);
  console.log("");

  // ── 1. /health returns 200 ──────────────────────────────────────────────────
  console.log("1. /health endpoint:");
  let res;
  let body;
  try {
    res = await fetch(`${GATEWAY}/health`);
    if (res.status === 200) {
      pass("GET /health → 200 OK");
    } else {
      fail("GET /health → 200 OK", `got ${res.status}`);
    }
    body = await res.json();
  } catch (e) {
    fail("GET /health reachable", e.message);
    // Cannot continue without health response
    summary();
    return;
  }

  // ── 2. Existing fields preserved ────────────────────────────────────────────
  console.log("\n2. Existing fields preserved:");
  for (const field of ["status", "service", "mode", "streaming", "mcp_lifecycle", "providers"]) {
    if (field in body) {
      pass(`  ${field}: present (${JSON.stringify(body[field])})`);
    } else {
      fail(`  ${field}: present`, "missing");
    }
  }

  // ── 3. New fields ───────────────────────────────────────────────────────────
  console.log("\n3. New health metrics:");

  // uptime_seconds
  if ("uptime_seconds" in body) {
    if (typeof body.uptime_seconds === "number" && body.uptime_seconds >= 0) {
      pass(`uptime_seconds: ${body.uptime_seconds} (>=0)`);
    } else {
      fail("uptime_seconds: number >= 0", `got ${typeof body.uptime_seconds} = ${body.uptime_seconds}`);
    }
  } else {
    fail("uptime_seconds: present", "missing field");
  }

  // events_count
  if ("events_count" in body) {
    if (typeof body.events_count === "number" && body.events_count >= 0) {
      pass(`events_count: ${body.events_count} (>=0)`);
    } else {
      fail("events_count: number >= 0", `got ${typeof body.events_count} = ${body.events_count}`);
    }
  } else {
    fail("events_count: present", "missing field");
  }

  // gateway_overhead_ms
  if ("gateway_overhead_ms" in body) {
    const val = body.gateway_overhead_ms;
    if (val === null || (typeof val === "number")) {
      pass(`gateway_overhead_ms: ${val === null ? "null" : val + "ms"}`);
    } else {
      fail("gateway_overhead_ms: number | null", `got ${typeof val} = ${val}`);
    }
  } else {
    fail("gateway_overhead_ms: present", "missing field");
  }

  // ── 4. Security — no secrets, no raw event content ──────────────────────────
  console.log("\n4. Security checks:");
  const bodyStr = JSON.stringify(body);
  // Check for common secret patterns
  const secretPatterns = [
    /sk-[a-zA-Z0-9]{20,}/,
    /Bearer\s+[a-zA-Z0-9_-]{20,}/,
    /OPENAI_API_KEY/i,
    /api[_-]?key\s*[:=]\s*['"]?[a-zA-Z0-9_-]{20,}/i,
  ];
  let secretFound = false;
  for (const pattern of secretPatterns) {
    if (pattern.test(bodyStr)) {
      secretFound = true;
      break;
    }
  }
  if (secretFound) {
    fail("No secrets in /health", "potential key/token pattern detected");
  } else {
    pass("No secrets/API keys in /health response");
  }

  // No raw event content (prompt/args/result)
  const rawContentKeys = ["prompt", "args", "result", "response", "messages", "content", "raw", "payload", "input", "output"];
  let rawFound = false;
  for (const key of rawContentKeys) {
    if (key in body) {
      rawFound = true;
      break;
    }
  }
  if (rawFound) {
    fail("No raw event content in /health", "found keys matching raw content patterns");
  } else {
    pass("No raw event/prompt/args/result content in /health");
  }

  // ── 5. /playground → 404 ────────────────────────────────────────────────────
  console.log("\n5. /playground deprecated:");
  let pgRes;
  try {
    pgRes = await fetch(`${GATEWAY}/playground`);
    if (pgRes.status === 404) {
      pass("/playground → 404 (removed)");
    } else {
      fail("/playground → 404", `got ${pgRes.status}`);
    }
  } catch (e) {
    fail("/playground → 404", `fetch failed: ${e.message}`);
  }

  // ── 6. Summary ──────────────────────────────────────────────────────────────
  summary();
}

function summary() {
  const total = passed + failed;
  console.log("");
  console.log("═══════════════════════════════════════════");
  console.log(`  Result: ${failed === 0 ? "PASS" : "FAIL"} — ${passed}/${total} PASS`);
  if (failures.length > 0) {
    console.log("  Failures:");
    for (const f of failures) {
      console.log(`    - ${f.label}: ${f.detail}`);
    }
  }
  console.log("═══════════════════════════════════════════");
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exitCode = 1;
});
