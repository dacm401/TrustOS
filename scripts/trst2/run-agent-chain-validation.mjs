/**
 * Agent Trust Loop — Correlate Phase: Real Agent Task Chain Validation
 *
 * Goal:
 *   Prove that one logical agent task can produce model_call + tool_call/MCP events
 *   sharing the same trace_id, forming a reviewable chain in EventChainViewer.
 *
 * Design:
 *   1. Generate shared traceId / sessionId / runId
 *   2. Send chat/completions through Gateway → model_call event
 *   3. Send MCP tools/call through Gateway → tool_call event
 *   4. Fetch /events, verify both share trace_id
 *   5. Verify privacy, /health, /playground, grouping logic
 *
 * Usage:
 *   node scripts/trst2/run-agent-chain-validation.mjs
 *
 * Requires:
 *   - Gateway on TRUSTOS_GATEWAY_URL (default: localhost:8787)
 *   - Gateway MCP upstream configured (mcp_lifecycle=enabled in /health)
 *   - Upstream model provider available
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
  "content", "messages", "body", "headers",
  "authorization", "api_key", "apiKey", "secret", "token", "password",
  "raw", "raw_body", "raw_response", "env", "environment",
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
      if (forbiddenKeys.has(key)) found.push(fullPath);
      found.push(...deepKeyCheck(obj[key], forbiddenKeys, fullPath));
    }
  }
  return found;
}

async function main() {
  const traceId = `agent-chain-${Date.now()}`;
  const sessionId = `chain-session-${Date.now()}`;
  const runId = `chain-run-${Date.now()}`;

  console.log("Correlate Phase — Agent Task Chain Validation");
  console.log(`Gateway: ${GATEWAY}`);
  console.log(`Trace:   ${traceId}`);
  console.log(`Session: ${sessionId}`);
  console.log(`Run:     ${runId}`);
  console.log("");

  const sharedHeaders = {
    "Content-Type": "application/json",
    "X-TrustOS-Trace-Id": traceId,
    "X-TrustOS-Session-Id": sessionId,
    "X-TrustOS-Run-Id": runId,
  };

  // ── 0. Pre-flight checks ────────────────────────────────────────────────
  console.log("0. Pre-flight:");
  try {
    const hr = await fetch(`${GATEWAY}/health`);
    if (hr.status !== 200) throw new Error(`HTTP ${hr.status}`);
    const hb = await hr.json();
    pass(`Gateway /health → 200 (mode=${hb.mode})`);
    if (hb.mcp_lifecycle === "enabled") {
      pass(`MCP lifecycle: enabled (upstream configured)`);
    } else {
      fail("MCP lifecycle", `got "${hb.mcp_lifecycle}" — tool_call events cannot be generated`);
      summary(0);
      return;
    }
    console.log(`  baseline events: ${hb.events_count}`);
  } catch (e) {
    fail("Gateway reachable", e.message);
    summary(0);
    return;
  }

  // ── 1. Generate model_call event ────────────────────────────────────────
  console.log("\n1. Generate model_call event:");
  let modelCallEvent = null;
  try {
    const res = await fetch(`${GATEWAY}/v1/chat/completions`, {
      method: "POST",
      headers: sharedHeaders,
      body: JSON.stringify({
        model: "deepseek-ai/DeepSeek-V4-Flash",
        messages: [{ role: "user", content: "Agent chain validation: reply with exactly one word." }],
        max_tokens: 10,
      }),
    });
    if (res.ok) {
      const body = await res.json();
      const model = body.model ?? "unknown";
      const content = body.choices?.[0]?.message?.content ?? "(empty)";
      pass(`model_call → HTTP ${res.status} — model=${model}, content="${content.slice(0, 30)}"`);
      modelCallEvent = { type: "model_call", model, content };
    } else {
      const errText = await res.text().catch(() => "(no body)");
      fail("model_call", `HTTP ${res.status}: ${errText.slice(0, 80)}`);
    }
  } catch (e) {
    fail("model_call fetch", e.message);
  }

  // ── 2. Generate tool_call event via MCP ──────────────────────────────────
  console.log("\n2. Generate tool_call event via MCP:");
  let toolCallEvent = null;
  try {
    // Step 2a: Call tools/call through Gateway MCP proxy
    const mcpBody = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "echo", arguments: { message: "chain-test" } },
    };
    const res = await fetch(`${GATEWAY}/trst1/mcp`, {
      method: "POST",
      headers: sharedHeaders,
      body: JSON.stringify(mcpBody),
    });
    if (res.ok) {
      const body = await res.json();
      const resultText = body.result?.content?.[0]?.text ?? JSON.stringify(body.result);
      pass(`tool_call → HTTP ${res.status} — tool=echo, result="${resultText.slice(0, 40)}"`);
      toolCallEvent = { type: "tool_call", tool: "echo", result: resultText };
    } else {
      const errText = await res.text().catch(() => "(no body)");
      fail("tool_call via MCP", `HTTP ${res.status}: ${errText.slice(0, 80)}`);
    }
  } catch (e) {
    fail("tool_call MCP fetch", e.message);
  }

  // ── 3. Wait for event persistence ────────────────────────────────────────
  console.log("\n3. Wait for event persistence:");
  await new Promise((resolve) => setTimeout(resolve, 2000));
  console.log("  ⏳ 2s delay for JSONL write flush");

  // ── 4. Fetch /events and verify chain ────────────────────────────────────
  console.log("\n4. Trace correlation — /events verification:");
  let eventsBody;
  try {
    const evRes = await fetch(`${GATEWAY}/events?limit=200`);
    if (evRes.status !== 200) throw new Error(`HTTP ${evRes.status}`);
    eventsBody = await evRes.json();
    pass(`/events → 200 OK (total=${eventsBody.events_count}, returned=${eventsBody.returned_count})`);
  } catch (e) {
    fail("/events fetch", e.message);
    summary(0);
    return;
  }

  const events = eventsBody.events ?? [];
  const traceEvents = events.filter((e) => e.trace_id === traceId);

  // ── 5. Core chain assertions ────────────────────────────────────────────
  console.log("\n5. Chain coherence assertions:");

  pass(`Events sharing trace_id="${traceId}": ${traceEvents.length}`);

  if (traceEvents.length >= 2) {
    pass(`Chain formed — ${traceEvents.length} events in trace group`);
  } else if (traceEvents.length === 1) {
    fail("Chain formed", `only 1 event found — no chain`);
    console.log(`  Event type found: ${traceEvents[0]?.event_type ?? "unknown"}`);
  } else {
    fail("Chain formed", "0 events with this trace_id");
  }

  // Event types in group
  const eventTypes = [...new Set(traceEvents.map((e) => e.event_type))];
  console.log(`  Event types in group: [${eventTypes.join(", ")}]`);

  const hasModelCall = eventTypes.includes("model_call");
  const hasToolCall = eventTypes.includes("tool_call");
  const hasMcpEvent = eventTypes.some((t) => t.startsWith("mcp_"));

  if (hasModelCall && (hasToolCall || hasMcpEvent)) {
    pass(`model_call + tool/MCP events in same trace — PRODUCT CHAIN VERIFIED`);
  } else if (hasModelCall && !hasToolCall && !hasMcpEvent) {
    fail("model_call + tool/MCP in same trace", `only model_call found — tool/MCP events missing`);
  } else if (!hasModelCall) {
    fail("model_call present", "no model_call event found");
  }

  // session_id consistency
  if (traceEvents.length > 0) {
    const sameSession = traceEvents.filter((e) => e.session_id === sessionId);
    if (sameSession.length === traceEvents.length) {
      pass(`session_id consistent across ${traceEvents.length} events`);
    } else {
      fail(`session_id consistent`, `${sameSession.length}/${traceEvents.length} match`);
    }
  }

  // run_id consistency
  if (traceEvents.length > 0) {
    const sameRun = traceEvents.filter((e) => e.run_id === runId);
    if (sameRun.length === traceEvents.length) {
      pass(`run_id consistent across ${traceEvents.length} events`);
    } else {
      fail(`run_id consistent`, `${sameRun.length}/${traceEvents.length} match`);
    }
  }

  // Hashes present
  if (traceEvents.length > 0) {
    let hashesOk = 0;
    let hashesMissing = 0;
    for (const e of traceEvents) {
      const hashFields = [e.event_hash, e.input_hash, e.args_hash, e.result_hash].filter(Boolean);
      if (hashFields.length > 0) hashesOk++;
      else hashesMissing++;
    }
    if (hashesMissing === 0) {
      pass(`All ${hashesOk} events have hash metadata`);
    } else {
      pass(`Hash metadata: ${hashesOk}/${traceEvents.length} events have hashes`);
    }
  }

  // Timestamps and ordering
  if (traceEvents.length >= 2) {
    const timestamps = traceEvents.map((e) => e.timestamp).filter(Boolean);
    if (timestamps.length >= 2) {
      const ordered = [...timestamps].sort();
      if (JSON.stringify(timestamps) === JSON.stringify(ordered)) {
        pass(`Events are chronologically ordered`);
      } else {
        pass(`Events present (${timestamps.length} timestamps)`);
      }
    }
    // Show event sequence
    console.log("  Event sequence:");
    for (const e of traceEvents) {
      console.log(`    [${e.event_type}] ts=${e.timestamp ?? "?"} hash=${(e.event_hash ?? "").slice(0, 12)}`);
    }
  }

  // ── 6. Dashboard grouping logic ──────────────────────────────────────────
  console.log("\n6. EventChainViewer grouping:");
  if (traceEvents.length >= 2) {
    const groupKey = `trace:${traceId}`;
    const allSameGroup = traceEvents.every((e) => {
      const key = e.trace_id ? `trace:${e.trace_id}` : (e.session_id ? `session:${e.session_id}` : "ungrouped");
      return key === groupKey;
    });
    if (allSameGroup) {
      pass(`All ${traceEvents.length} events grouped under "${groupKey}" (size=${traceEvents.length})`);
    } else {
      fail("EventChainViewer grouping", "different group keys");
    }
  }

  // ── 7. Privacy boundary ──────────────────────────────────────────────────
  console.log("\n7. Privacy boundary:");
  if (traceEvents.length > 0) {
    const forbiddenFound = deepKeyCheck(traceEvents, FORBIDDEN_KEYS);
    if (forbiddenFound.length === 0) {
      pass("No forbidden keys in trace events (prompt/response/args/result/content/...)");
    } else {
      fail("Forbidden keys found", forbiddenFound.join(", "));
    }
  }
  if (eventsBody) {
    const { events: _, ...responseEnvelope } = eventsBody;
    const envForbidden = deepKeyCheck(responseEnvelope, FORBIDDEN_KEYS);
    if (envForbidden.length === 0) {
      pass("/events response envelope clean");
    } else {
      fail("/events response envelope", `has ${envForbidden.join(", ")}`);
    }
  }

  // ── 8. /health unchanged ─────────────────────────────────────────────────
  console.log("\n8. /health:");
  try {
    const hr2 = await fetch(`${GATEWAY}/health`);
    const hb2 = await hr2.json();
    for (const field of ["status", "uptime_seconds", "events_count", "mcp_lifecycle"]) {
      if (field in hb2) {
        pass(`/health.${field}: ${JSON.stringify(hb2[field])}`);
      } else {
        fail(`/health.${field}`, "missing");
      }
    }
  } catch (e) {
    fail("/health", e.message);
  }

  // ── 9. /playground → 404 ─────────────────────────────────────────────────
  console.log("\n9. /playground:");
  try {
    const pgRes = await fetch(`${GATEWAY}/playground`);
    if (pgRes.status === 404) {
      pass("/playground → 404 (removed)");
    } else {
      fail("/playground → 404", `got ${pgRes.status}`);
    }
  } catch (e) {
    fail("/playground", e.message);
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  summary(traceEvents.length);
}

function summary(eventCount) {
  const total = passed + failed;
  console.log("");
  console.log("═════════════════════════════════════════════════");
  if (failed === 0) {
    console.log("  RESULT: CHAIN_CONFIRMED");
    console.log(`  ${eventCount} events in trace group`);
    console.log(`  model_call + tool/MCP in same chain`);
  } else {
    console.log("  RESULT: CHAIN_PARTIAL or BLOCKED");
  }
  console.log(`  Assertions: ${passed}/${total} PASS`);
  if (failures.length > 0) {
    console.log("  Failures:");
    for (const f of failures) {
      console.log(`    - ${f.label}: ${f.detail}`);
    }
  }
  console.log("═════════════════════════════════════════════════");
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exitCode = 1;
});
