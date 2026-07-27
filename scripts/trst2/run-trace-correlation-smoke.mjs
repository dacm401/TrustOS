/**
 * Agent Trust Loop Trace Correlation Spike — Smoke Test
 *
 * Goal:
 *   Verify that two or more Gateway events sharing the same trace_id
 *   are correctly captured by JSONL store and exposed via /events,
 *   so that Dashboard EventChainViewer can group them as one chain.
 *
 * Design:
 *   1. Generate shared traceId / sessionId / runId
 *   2. Send >= 2 Gateway requests with headers carrying the shared IDs
 *   3. Poll /events to confirm those events share the traceId
 *   4. Verify privacy, /health, /playground unchanged
 *
 * Usage:
 *   node scripts/trst2/run-trace-correlation-smoke.mjs
 *
 * Environment:
 *   TRUSTOS_GATEWAY_URL — default: http://localhost:8787
 */

const GATEWAY = process.env.TRUSTOS_GATEWAY_URL ?? "http://localhost:8787";

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
  const traceId = `e2e-trace-${Date.now()}`;
  const sessionId = `e2e-session-${Date.now()}`;
  const runId = `e2e-run-${Date.now()}`;

  console.log("Agent Trust Loop Trace Correlation Spike — Smoke Test");
  console.log(`Gateway: ${GATEWAY}`);
  console.log(`Trace:   ${traceId}`);
  console.log(`Session: ${sessionId}`);
  console.log(`Run:     ${runId}`);
  console.log("");

  // ── 1. Gateway alive check ─────────────────────────────────────────────
  console.log("1. Gateway alive:");
  try {
    const hr = await fetch(`${GATEWAY}/health`);
    if (hr.status === 200) {
      const hb = await hr.json();
      pass(`Gateway /health → 200 OK (mode=${hb.mode}, uptime=${hb.uptime_seconds ?? "?"}s)`);
    } else {
      fail("Gateway /health → 200", `got ${hr.status}`);
      summary();
      return;
    }
  } catch (e) {
    fail("Gateway reachable", e.message);
    summary();
    return;
  }

  // ── 2. Generate events through Gateway ──────────────────────────────────
  console.log("\n2. Generate events with shared trace_id:");
  const sharedHeaders = {
    "Content-Type": "application/json",
    "X-TrustOS-Trace-Id": traceId,
    "X-TrustOS-Session-Id": sessionId,
    "X-TrustOS-Run-Id": runId,
  };

  const eventCount = 2;
  const generatedEvents = [];
  const eventTypes = [];

  for (let i = 0; i < eventCount; i++) {
    const requestBody = {
      model: "deepseek-ai/DeepSeek-V4-Flash",
      messages: [
        { role: "user", content: `Trace correlation smoke: request ${i + 1} of ${eventCount}. Reply with one word only.` },
      ],
      max_tokens: 10,
    };

    try {
      const res = await fetch(`${GATEWAY}/v1/chat/completions`, {
        method: "POST",
        headers: sharedHeaders,
        body: JSON.stringify(requestBody),
      });

      if (res.ok) {
        const respBody = await res.json();
        const model = respBody.model ?? "unknown";
        const content = respBody.choices?.[0]?.message?.content ?? "(empty)";
        pass(`Request ${i + 1}: HTTP ${res.status} — model=${model}, content="${content.slice(0, 40)}"`);

        // Capture trace headers echoed back
        const respTraceId = res.headers.get("X-TrustOS-Trace-Id");
        const respSessionId = res.headers.get("X-TrustOS-Session-Id");
        if (respTraceId === traceId) {
          pass(`  Response X-TrustOS-Trace-Id matches → ${respTraceId}`);
        } else if (respTraceId) {
          fail(`  Response X-TrustOS-Trace-Id matches`, `expected ${traceId}, got ${respTraceId}`);
        }

        generatedEvents.push({ index: i, status: res.status, model });
        eventTypes.push("model_call");
      } else {
        const errText = await res.text().catch(() => "(no body)");
        fail(`Request ${i + 1}: HTTP ${res.status}`, errText.slice(0, 80));
      }
    } catch (e) {
      fail(`Request ${i + 1}: fetch`, e.message);
    }
  }

  if (generatedEvents.length < eventCount) {
    console.log(`\n  ⚠️  Only ${generatedEvents.length}/${eventCount} events generated — upstream may be unavailable`);
  }

  // ── 3. Wait for events to be written to JSONL ───────────────────────────
  console.log("\n3. Wait for event persistence:");
  await new Promise((resolve) => setTimeout(resolve, 1500));
  console.log("  ⏳ 1.5s delay for JSONL write flush");

  // ── 4. Fetch /events and verify trace_id grouping ───────────────────────
  console.log("\n4. Trace correlation — /events grouping:");
  let eventsBody;
  try {
    const evRes = await fetch(`${GATEWAY}/events?limit=200`);
    if (evRes.status === 200) {
      eventsBody = await evRes.json();
      pass(`GET /events?limit=200 → 200 OK (events_count=${eventsBody.events_count}, returned=${eventsBody.returned_count})`);
    } else {
      fail("GET /events → 200", `got ${evRes.status}`);
      summary();
      return;
    }
  } catch (e) {
    fail("GET /events reachable", e.message);
    summary();
    return;
  }

  const events = eventsBody.events ?? [];
  const traceEvents = events.filter((e) => e.trace_id === traceId);

  // ── 5. Core assertions ─────────────────────────────────────────────────
  console.log("\n5. Core trace coherence assertions:");

  if (traceEvents.length >= 2) {
    pass(`trace_id "${traceId}" has ${traceEvents.length} events (>= 2) — Chain Formed`);
  } else if (traceEvents.length === 1) {
    fail(`trace_id "${traceId}" has ${traceEvents.length} event (need >= 2)`, "Insufficient — only one event captured");
  } else {
    fail(`trace_id "${traceId}" found in /events`, "0 events — trace_id not present in event store");
  }

  // Check all trace events share the same trace_id
  if (traceEvents.length > 0) {
    const allSameTrace = traceEvents.every((e) => e.trace_id === traceId);
    if (allSameTrace) {
      pass(`All ${traceEvents.length} events share trace_id="${traceId}"`);
    } else {
      const different = traceEvents.filter((e) => e.trace_id !== traceId);
      fail("All trace events share same trace_id", `found ${different.length} with different trace_id`);
    }
  }

  // Check session_id consistency
  if (traceEvents.length > 0) {
    const sameSession = traceEvents.filter((e) => e.session_id === sessionId);
    if (sameSession.length === traceEvents.length) {
      pass(`All ${traceEvents.length} events share session_id="${sessionId}"`);
    } else {
      fail(`All trace events share session_id`, `${sameSession.length}/${traceEvents.length} match`);
    }
  }

  // Check run_id consistency
  if (traceEvents.length > 0) {
    const sameRun = traceEvents.filter((e) => e.run_id === runId);
    if (sameRun.length === traceEvents.length) {
      pass(`All ${traceEvents.length} events share run_id="${runId}"`);
    } else {
      fail(`All trace events share run_id`, `${sameRun.length}/${traceEvents.length} match`);
    }
  }

  // Event types in group
  if (traceEvents.length > 0) {
    const types = [...new Set(traceEvents.map((e) => e.event_type))];
    pass(`Event types in trace group: [${types.join(", ")}]`);
  }

  // ── 6. Dashboard grouping logic verification ────────────────────────────
  console.log("\n6. EventChainViewer grouping logic:");
  if (traceEvents.length >= 2) {
    // Simulate getGroupKey() from EventChainViewer.tsx:
    // function getGroupKey(e) { if (e.trace_id) return `trace:${e.trace_id}`; ... }
    const groupKey = `trace:${traceId}`;
    const allSameGroup = traceEvents.every((e) => {
      const key = e.trace_id ? `trace:${e.trace_id}` : (e.session_id ? `session:${e.session_id}` : "ungrouped");
      return key === groupKey;
    });
    if (allSameGroup) {
      pass(`EventChainViewer would group all ${traceEvents.length} events under "${groupKey}" (group size=${traceEvents.length})`);
    } else {
      fail("EventChainViewer grouping", "events would appear in different groups");
    }
  } else {
    console.log("  ⚠️  Skipped — insufficient events for grouping check");
  }

  // ── 7. Privacy boundary ─────────────────────────────────────────────────
  console.log("\n7. Privacy boundary:");
  if (traceEvents.length > 0) {
    const forbiddenFound = deepKeyCheck(traceEvents, FORBIDDEN_KEYS);
    if (forbiddenFound.length === 0) {
      pass("No forbidden keys in trace events (prompt/response/args/result/content/...)");
    } else {
      fail("No forbidden keys in trace events", `found: ${forbiddenFound.join(", ")}`);
    }
  } else {
    pass("Privacy check skipped (no trace events)");
  }

  // Also check overall response
  if (eventsBody) {
    const respForbidden = deepKeyCheck(
      { ...eventsBody, events: undefined },
      FORBIDDEN_KEYS,
    );
    if (respForbidden.length === 0) {
      pass("No forbidden keys at /events response level");
    } else {
      fail("No forbidden keys at response level", `found: ${respForbidden.join(", ")}`);
    }
  }

  // ── 8. /health unchanged ────────────────────────────────────────────────
  console.log("\n8. /health compatibility:");
  try {
    const hr2 = await fetch(`${GATEWAY}/health`);
    const hb2 = await hr2.json();
    for (const field of ["status", "uptime_seconds", "events_count", "gateway_overhead_ms"]) {
      if (field in hb2) {
        pass(`/health.${field}: present (${JSON.stringify(hb2[field])})`);
      } else {
        fail(`/health.${field}: present`, "missing");
      }
    }
  } catch (e) {
    fail("/health check", e.message);
  }

  // ── 9. /playground → 404 ────────────────────────────────────────────────
  console.log("\n9. /playground deprecated:");
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

  // ── Summary ─────────────────────────────────────────────────────────────
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
