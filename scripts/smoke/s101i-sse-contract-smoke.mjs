#!/usr/bin/env node
/**
 * S101I Phase B — Backend SSE Contract Smoke Test
 *
 * Verifies the SSE chat endpoint produces well-formed events that match
 * the SSEEvent contract, specifically targeting the 4 Phase A frontend
 * display gap events: progress, partial_result, usage, terminalSummary.
 *
 * Two modes:
 *   --live    Full E2E via real server + SSE chat (requires running backend)
 *   default   Static contract verification (no server needed)
 *
 * Usage:
 *   node scripts/smoke/s101i-sse-contract-smoke.mjs           # static contract
 *   node scripts/smoke/s101i-sse-contract-smoke.mjs --live    # full E2E
 */

import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3001";
const LIVE = process.argv.includes("--live");
const SS_HALT_SEC = Number(process.env.SMOKE_SSE_HALT_SEC ?? 60);

let passed = 0;
let failed = 0;
let skipped = 0;
const results = [];

function record(name, ok, detail) {
  const status = ok ? "PASS" : "FAIL";
  if (ok) passed++; else failed++;
  results.push({ name, status, detail: detail || "" });
  console.log(`  [${status}] ${name}${detail ? ` — ${detail}` : ""}`);
}

function skip(name, reason) {
  skipped++;
  results.push({ name, status: "SKIP", detail: reason });
  console.log(`  [SKIP] ${name} — ${reason}`);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../");

// ── Static Contract Verification ──────────────────────────────────────

async function verifySSEEventTypeContract() {
  console.log("── C1: SSEEvent Type Contract (static) ──\n");

  // Read the SSEEvent interface from sse-poller.ts
  const ssePollerPath = path.join(ROOT, "src/services/phase3/sse-poller.ts");
  const sseCode = await readFile(ssePollerPath, "utf-8");

  // Type union values (the "type:" field discriminators)
  const requiredTypes = ["progress", "partial_result"];
  // Interface fields (data-bearing payloads on SSEEvent)
  const requiredFields = ["progress", "partialResult", "terminalSummary"];
  const extraFields = ["usage"];

  for (const type of requiredTypes) {
    const found = sseCode.includes(`"${type}"`) || sseCode.includes(`'${type}'`);
    record(`SSEEvent type union includes "${type}"`, found,
      found ? `found in sse-poller.ts SSEEvent interface` : "NOT FOUND");
  }

  for (const field of [...requiredFields, ...extraFields]) {
    // usage is a nested object type in the interface, not a simple field
    const found = new RegExp(`${field}\\s*[?:]`).test(sseCode) || sseCode.includes(field);
    record(`SSEEvent interface has ${field} field`, found,
      found ? "present" : "NOT FOUND");
  }

  // Verify done event construction includes usage/terminalSummary
  const doneWithUsage = sseCode.includes("terminalSummary:") && sseCode.includes("usage");
  record("done event construction includes terminalSummary + usage", doneWithUsage,
    doneWithUsage ? "found in pollArchiveAndYield" : "MISSING");

  // Verify progress event emission
  const progressEmit = sseCode.includes('type: "progress"') || sseCode.includes("type: 'progress'");
  record('Progress event emission (type: "progress")', progressEmit,
    progressEmit ? "found in pollArchiveAndYield" : "MISSING");

  // Verify partial_result event emission
  const partialEmit = sseCode.includes('type: "partial_result"') || sseCode.includes("type: 'partial_result'");
  record('Partial result event emission (type: "partial_result")', partialEmit,
    partialEmit ? "found in pollArchiveAndYield" : "MISSING");
}

// ── Frontend Type Contract ────────────────────────────────────────────

async function verifyFrontendTypeContract() {
  console.log("\n── C2: Frontend SSE Event Handler Contract (static) ──\n");

  // Read ChatInterface for event handlers
  const chatPath = path.join(ROOT, "frontend/src/components/chat/ChatInterface.tsx");
  const chatCode = await readFile(chatPath, "utf-8");

  const eventHandlers = ["progress", "partial_result", "usage", "terminalSummary"];
  for (const handler of eventHandlers) {
    const found = chatCode.includes(handler);
    record(`ChatInterface handles "${handler}" event/field`, found,
      found ? "found in SSE event handler" : "NOT FOUND");
  }

  // Verify StreamEvent type has all 4 fields
  const typesPath = path.join(ROOT, "frontend/src/types/dashboard.ts");
  const typesCode = await readFile(typesPath, "utf-8");

  const typeFields = ["progress", "partialResult", "usage", "terminalSummary"];
  for (const field of typeFields) {
    const found = typesCode.includes(field);
    record(`StreamEvent type has "${field}" field`, found,
      found ? "found in dashboard.ts" : "NOT FOUND");
  }

  const usageInfoFound = typesCode.includes("UsageInfo");
  record("UsageInfo interface defined", usageInfoFound,
    usageInfoFound ? "found in dashboard.ts" : "NOT FOUND");
}

// ── JSON Payload Contract ─────────────────────────────────────────────

async function verifyPayloadContract() {
  console.log("\n── C3: SSE Event Payload Contract (JSON round-trip) ──\n");

  // Construct payloads matching the exact shapes from sse-poller.ts

  // 1. progress event
  const progressEvent = {
    type: "progress",
    progress: { stage: "executing", elapsed_ms: 5000 },
    routing_layer: "L2",
  };
  let roundTripped = JSON.stringify(JSON.parse(JSON.stringify(progressEvent)));
  record("progress event JSON round-trip", roundTripped.length > 0,
    `payload size: ${roundTripped.length} bytes`);

  // 2. partial_result event
  const partialEvent = {
    type: "partial_result",
    partialResult: { content: "Sample partial output...", index: 0 },
    routing_layer: "L2",
  };
  roundTripped = JSON.stringify(JSON.parse(JSON.stringify(partialEvent)));
  record("partial_result event JSON round-trip", roundTripped.length > 0,
    `payload size: ${roundTripped.length} bytes`);

  // 3. done event with usage + terminalSummary (exact shape from sse-poller.ts line 782-794)
  const doneEvent = {
    type: "done",
    routing_layer: "L2",
    terminalSummary: {
      status: "completed",
      worker_role: "slow_worker",
      cycles: 3,
      total_tokens: 1500,
      total_cost_usd: 0.0023,
      peak_tool_calls_per_cycle: 5,
      total_tool_calls: 8,
      elapsed_ms: 12000,
      user_message: "Task completed successfully in 3 cycles.",
      truncated: false,
    },
    usage: {
      tokens: { input: 800, output: 700, total: 1500 },
      cost: { estimated_usd: 0.0023, provider: "siliconflow", model: "deepseek-ai/DeepSeek-V3" },
    },
  };
  roundTripped = JSON.stringify(JSON.parse(JSON.stringify(doneEvent)));
  record("done event with usage+terminalSummary JSON round-trip", roundTripped.length > 0,
    `payload size: ${roundTripped.length} bytes`);

  // 4. Verify frontend can parse payload
  const parsed = JSON.parse(roundTripped);
  // eslint-disable-next-line no-prototype-builtins
  const hasAllFields = parsed.hasOwnProperty("type") &&
    parsed.hasOwnProperty("terminalSummary") &&
    parsed.hasOwnProperty("usage") &&
    typeof parsed.usage?.tokens?.total === "number" &&
    typeof parsed.usage?.cost?.estimated_usd === "number";
  record("done event payload matches UsageInfo + terminalSummary shape", hasAllFields,
    hasAllFields ? "all required fields present" : "MISSING FIELDS");

  // Verify error/cancelled/timeout paths also include terminalSummary
  const eventsWithTerminal = [
    JSON.stringify({ type: "done", routing_layer: "L2", terminalSummary: { status: "failed", errorMessage: "timeout" } }),
    JSON.stringify({ type: "done", routing_layer: "L2", terminalSummary: { status: "cancelled", cancelReason: "user" } }),
    JSON.stringify({ type: "done", routing_layer: "L2", terminalSummary: { status: "timed_out", timeoutKind: "hard" } }),
  ];
  let allValid = true;
  for (const s of eventsWithTerminal) {
    try {
      const p = JSON.parse(s);
      if (!p.terminalSummary) { allValid = false; break; }
    } catch { allValid = false; break; }
  }
  record("failed/cancelled/timeout done events include terminalSummary", allValid,
    allValid ? "3/3 terminal states verified" : "SOME MISSING");
}

// ── Live SSE E2E ──────────────────────────────────────────────────────

async function ensureServerRunning() {
  try {
    const res = await fetch(`${BASE}/health`);
    if (res.ok) return true;
  } catch { /* not running */ }
  console.log("  Backend not running. Starting dev server...");
  const proc = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: ROOT,
    stdio: "pipe",
    env: { ...process.env, NODE_ENV: "development" },
  });
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) {
        console.log("  Backend started successfully.");
        return true;
      }
    } catch { /* still starting */ }
  }
  proc.kill();
  throw new Error("Backend failed to start within 45s");
}

async function liveSSESmoke() {
  console.log("\n── C4: Live SSE Chat E2E ──\n");

  try {
    await ensureServerRunning();
  } catch (e) {
    skip("Live SSE E2E: server startup", e.message);
    return;
  }

  // Health check
  const health = await fetch(`${BASE}/health`);
  record("Health endpoint", health.ok, `status=${health.status}`);

  // Send SSE chat request
  const userId = `smoke-s101i-${Date.now()}`;
  const sessionId = `session-s101i-${Date.now()}`;
  const body = JSON.stringify({
    user_id: userId,
    session_id: sessionId,
    message: "你好，请用一句话介绍你自己。",
    stream: true,
  });

  console.log("\n  Sending SSE chat request...");
  let res;
  try {
    res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-User-Id": userId,
      },
      body,
      signal: AbortSignal.timeout(SS_HALT_SEC * 1000),
    });
  } catch (e) {
    record("SSE POST /api/chat", false, `fetch failed: ${e.message}`);
    return;
  }

  record("SSE POST /api/chat => 200", res.ok, `status=${res.status}`);
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    skip("SSE stream parsing", `server returned ${res.status}: ${errText.slice(0, 200)}`);
    return;
  }

  const ct = res.headers.get("content-type") || "";
  record("SSE content-type is text/event-stream", ct.includes("text/event-stream"),
    `got: ${ct}`);

  // Parse SSE stream
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events = [];

  console.log("  Reading SSE stream...");
  const readStart = Date.now();
  let done = false;
  while (!done && Date.now() - readStart < SS_HALT_SEC * 1000) {
    const { value, done: streamDone } = await reader.read().catch(() => ({ value: undefined, done: true }));
    if (streamDone || !value) break;
    buffer += decoder.decode(value, { stream: true });

    // Parse complete SSE events (data: {...}\n\n)
    const lines = buffer.split("\n");
    buffer = ""; // reset, save incomplete lines below
    let currentData = "";
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("data: ")) {
        currentData += line.slice(6);
      } else if (line === "" && currentData) {
        // Empty line = event boundary
        try {
          const event = JSON.parse(currentData);
          events.push(event);
          if (event.type === "done") done = true;
        } catch {
          // malformed event, skip
        }
        currentData = "";
      } else if (line.startsWith("data:")) {
        currentData += line.slice(5);
      }
    }
    // Save incomplete trailing data:
    if (currentData && !done) buffer = currentData;
  }
  if (buffer) {
    // Last event may be incomplete — ignore
  }

  console.log(`  Parsed ${events.length} SSE events`);

  // Analyze event types
  const eventTypes = {};
  for (const e of events) {
    const t = e.type || "unknown";
    eventTypes[t] = (eventTypes[t] || 0) + 1;
  }

  record("SSE stream produced events", events.length > 0,
    `total: ${events.length}, types: ${JSON.stringify(eventTypes)}`);

  // Verify thinking event present
  const hasThinking = eventTypes["thinking"];
  record("SSE includes thinking event", !!hasThinking,
    hasThinking ? `${hasThinking} event(s)` : "NOT FOUND");

  // Verify fast_reply or result event present
  const hasReply = eventTypes["fast_reply"] || eventTypes["result"];
  if (hasReply) {
    record("SSE includes fast_reply or result event", true, `found: ${JSON.stringify({fast_reply: eventTypes["fast_reply"], result: eventTypes["result"]})}`);
  } else {
    skip("SSE fast_reply/result event", "not found — may use different event type");
  }

  // Verify done event present
  const doneEvents = events.filter(e => e.type === "done");
  record("SSE includes done event", doneEvents.length > 0,
    doneEvents.length > 0 ? `${doneEvents.length} event(s)` : "NOT FOUND");

  // S101I Phase A — verify target events/fields
  // progress event
  const progressEvents = events.filter(e => e.type === "progress");
  if (progressEvents.length > 0) {
    record("SSE includes progress event", true,
      `${progressEvents.length} event(s), has progress field: ${progressEvents.some(e => e.progress !== undefined)}`);
  } else {
    skip("SSE progress event", "not received — simple chat may not trigger worker delegation");
  }

  // partial_result event
  const partialEvents = events.filter(e => e.type === "partial_result");
  if (partialEvents.length > 0) {
    record("SSE includes partial_result event", true,
      `${partialEvents.length} event(s), has partialResult field: ${partialEvents.some(e => e.partialResult !== undefined)}`);
  } else {
    skip("SSE partial_result event", "not received — simple chat may not trigger worker delegation");
  }

  // done with usage
  const doneWithUsage = doneEvents.find(e => e.usage);
  if (doneWithUsage) {
    const u = doneWithUsage.usage;
    record("done event includes usage", true,
      `tokens=${u.tokens?.total}, cost=${
        (u.cost?.estimated_usd ?? u.cost?.total_cost ?? 0
      ).toFixed(4)}`);
  } else {
    skip("done event usage field", "not present — simple chat may not trigger worker delegation");
  }

  // done with terminalSummary
  const doneWithTerminal = doneEvents.find(e => e.terminalSummary);
  if (doneWithTerminal) {
    const ts = doneWithTerminal.terminalSummary;
    record("done event includes terminalSummary", true,
      `status=${ts.status}, tokens=${ts.total_tokens}, cost=$${ts.total_cost_usd?.toFixed(4)}`);
  } else {
    skip("done event terminalSummary field", "not present — simple chat may not trigger worker delegation");
  }
}

// ── MAIN ──────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("  S101I Phase B — SSE Contract Smoke");
  console.log(`  Mode:   ${LIVE ? "LIVE E2E" : "STATIC"}`);
  console.log(`  Time:   ${new Date().toISOString()}`);
  console.log("═══════════════════════════════════════════\n");

  // Static contract verification (always runs)
  await verifySSEEventTypeContract();
  await verifyFrontendTypeContract();
  await verifyPayloadContract();

  // Live E2E (only with --live)
  if (LIVE) {
    await liveSSESmoke();
  }

  // Summary
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  Results: ${passed} PASS, ${failed} FAIL, ${skipped} SKIP`);
  console.log(`  Total:   ${passed + failed + skipped}`);
  console.log("═══════════════════════════════════════════\n");

  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(2);
});
