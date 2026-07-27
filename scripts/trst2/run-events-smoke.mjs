/**
 * TRST-2E Event Chain Viewer Smoke Test
 *
 * Validates:
 *   1. GET /events returns 200
 *   2. status === "ok"
 *   3. events is array
 *   4. returned_count <= limit
 *   5. default limit works
 *   6. ?limit=5 returns <= 5 events
 *   7. forbidden keys absent from all events
 *   8. event_id/event_type/timestamp/event_hash present where event exists
 *   9. Missing event log handled gracefully (NOT DESTRUCTIVELY TESTED)
 *  10. /playground returns 404
 *  11. /health still returns TRST-2D fields
 *  12. Response size under 100KB for default limit
 *
 * Usage:
 *   node scripts/trst2/run-events-smoke.mjs
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

const FORBIDDEN_KEYS = new Set([
  "prompt", "response", "input", "output", "args", "result",
  "content", "messages",
  "body", "headers",
  "authorization", "api_key", "apiKey", "secret", "token", "password",
  "raw", "raw_body", "raw_response",
  "env", "environment",
]);

const REQUIRED_EVENT_KEYS = ["event_id", "event_type", "timestamp", "event_hash"];

function deepKeyCheck(obj, forbiddenKeys, path = "") {
  const found = [];
  if (obj == null || typeof obj !== "object") return found;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      found.push(...deepKeyCheck(obj[i], forbiddenKeys, `${path}[${i}]`));
    }
  } else {
    for (const key of Object.keys(obj)) {
      const fullPath = path ? `${path}.${key}` : key;
      if (forbiddenKeys.has(key)) {
        found.push(fullPath);
      }
      found.push(...deepKeyCheck(obj[key], forbiddenKeys, fullPath));
    }
  }
  return found;
}

async function main() {
  console.log("TRST-2E Event Chain Viewer Smoke Test");
  console.log(`Gateway: ${GATEWAY}`);
  console.log("");

  // ── 1. GET /events returns 200 ────────────────────────────────────────────
  console.log("1. GET /events endpoint:");
  let res;
  let body;
  try {
    res = await fetch(`${GATEWAY}/events`);
    if (res.status === 200) {
      pass("GET /events → 200 OK");
    } else {
      fail("GET /events → 200 OK", `got ${res.status}`);
    }
    body = await res.json();
  } catch (e) {
    fail("GET /events reachable", e.message);
    summary();
    return;
  }

  // ── 2. Response structure ─────────────────────────────────────────────────
  console.log("\n2. Response structure:");
  for (const field of ["status", "service", "mode", "limit", "events_count", "returned_count", "events"]) {
    if (field in body) {
      pass(`  ${field}: present`);
    } else {
      fail(`  ${field}: present`, "missing");
    }
  }

  if (body.status !== "ok") {
    fail("status === 'ok'", `got "${body.status}"`);
  } else {
    pass(`status === "ok"`);
  }

  // ── 3. events is array ────────────────────────────────────────────────────
  console.log("\n3. Events validation:");
  if (!Array.isArray(body.events)) {
    fail("events is array", `got ${typeof body.events}`);
  } else {
    pass(`events is array (length=${body.events.length})`);
  }

  // ── 4. returned_count <= limit ────────────────────────────────────────────
  if (typeof body.returned_count === "number" && body.returned_count <= body.limit) {
    pass(`returned_count=${body.returned_count} <= limit=${body.limit}`);
  } else {
    fail(`returned_count <= limit`, `returned_count=${body.returned_count}, limit=${body.limit}`);
  }

  // ── 5. returned_count matches events array ────────────────────────────────
  if (body.returned_count === body.events.length) {
    pass(`returned_count matches events.length (${body.returned_count})`);
  } else {
    fail("returned_count matches events length", `${body.returned_count} vs ${body.events.length}`);
  }

  // ── 6. ?limit=5 returns <= 5 events ───────────────────────────────────────
  console.log("\n4. Limit parameter:");
  try {
    const res5 = await fetch(`${GATEWAY}/events?limit=5`);
    if (res5.status === 200) {
      const body5 = await res5.json();
      if (body5.limit === 5) {
        pass("?limit=5 → limit=5 in response");
      } else {
        fail("?limit=5 → limit=5", `got limit=${body5.limit}`);
      }
      if (body5.events.length <= 5) {
        pass(`?limit=5 → returned ${body5.events.length} events (<=5)`);
      } else {
        fail("?limit=5 → <= 5 events", `returned ${body5.events.length}`);
      }
    } else {
      fail("?limit=5 → 200 OK", `got ${res5.status}`);
    }
  } catch (e) {
    fail("?limit=5 reachable", e.message);
  }

  // ── 7. Forbidden keys absent ──────────────────────────────────────────────
  console.log("\n5. Sanitization — forbidden keys:");
  if (body.events.length > 0) {
    const forbiddenFound = deepKeyCheck(body.events, FORBIDDEN_KEYS);
    if (forbiddenFound.length === 0) {
      pass("No forbidden keys in any event");
    } else {
      fail("No forbidden keys in events", `found: ${forbiddenFound.join(", ")}`);
    }
  } else {
    pass("No forbidden keys (no events to check)");
  }

  // Also check response-level forbidden keys
  const respForbidden = deepKeyCheck({ ...body, events: undefined }, FORBIDDEN_KEYS);
  if (respForbidden.length === 0) {
    pass("No forbidden keys at response level");
  } else {
    fail("No forbidden keys at response level", `found: ${respForbidden.join(", ")}`);
  }

  // ── 8. Required event fields ──────────────────────────────────────────────
  console.log("\n6. Required event fields:");
  if (body.events.length > 0) {
    let allHaveRequired = true;
    for (let i = 0; i < body.events.length; i++) {
      const ev = body.events[i];
      for (const key of REQUIRED_EVENT_KEYS) {
        if (!(key in ev) || ev[key] == null) {
          allHaveRequired = false;
          fail(`events[${i}].${key}: present`, "missing or null");
        }
      }
    }
    if (allHaveRequired) {
      pass(`All ${body.events.length} events have event_id/event_type/timestamp/event_hash`);
    }
  } else {
    pass("Required fields check skipped (no events)");
  }

  // ── 9. Missing event log behavior ─────────────────────────────────────────
  console.log("\n7. Missing event log:");
  console.log("  ⚠️  NOT DESTRUCTIVELY TESTED — code path implemented and reviewed");

  // ── 10. /playground → 404 ─────────────────────────────────────────────────
  console.log("\n8. /playground deprecated:");
  try {
    const pgRes = await fetch(`${GATEWAY}/playground`);
    if (pgRes.status === 404) {
      pass("/playground → 404 (removed)");
    } else {
      fail("/playground → 404", `got ${pgRes.status}`);
    }
  } catch (e) {
    fail("/playground → 404", `fetch failed: ${e.message}`);
  }

  // ── 11. /health still returns TRST-2D fields ──────────────────────────────
  console.log("\n9. /health TRST-2D fields preserved:");
  try {
    const hr = await fetch(`${GATEWAY}/health`);
    if (hr.status === 200) {
      const hb = await hr.json();
      for (const field of ["uptime_seconds", "events_count", "gateway_overhead_ms"]) {
        if (field in hb) {
          pass(`/health.${field}: present`);
        } else {
          fail(`/health.${field}: present`, "missing");
        }
      }
    } else {
      fail("/health → 200", `got ${hr.status}`);
    }
  } catch (e) {
    fail("/health reachable", e.message);
  }

  // ── 12. Response size check ───────────────────────────────────────────────
  console.log("\n10. Response size:");
  const bodyStr = JSON.stringify(body);
  const sizeKB = bodyStr.length / 1024;
  if (sizeKB < 100) {
    pass(`Default response size: ${sizeKB.toFixed(1)}KB (< 100KB)`);
  } else {
    fail("Response size < 100KB", `${sizeKB.toFixed(1)}KB`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
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
