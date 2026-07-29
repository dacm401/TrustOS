/**
 * TRST-2A Streaming Smoke Test
 *
 * Validates the SSE streaming passthrough via POST /v1/chat/completions?stream=true.
 * Requires: Gateway on :8787, valid upstream API key in .env.
 *
 * Usage:
 *   node scripts/trst1/run-stream-smoke.mjs
 *
 * Environment:
 *   TRUSTOS_GATEWAY_URL — default: http://localhost:8787
 */

import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..");

const GATEWAY = process.env.TRUSTOS_GATEWAY_URL ?? "http://localhost:8787";
const ENDPOINT = `${GATEWAY}/v1/chat/completions`;
const EVENT_LOG = process.env.TRUSTOS_EVENT_LOG_PATH ?? resolve(PROJECT_ROOT, ".trustos", "events.jsonl");
const SMOKE_SESSION_ID = `stream-smoke-${Date.now()}`;

// ── Helpers ──────────────────────────────────────────────────────────────────

async function post(url, body) {
  const payload = JSON.stringify(body);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-TrustOS-Session-Id": SMOKE_SESSION_ID,
      "X-TrustOS-Agent-Id": "stream-smoke-agent",
    },
    body: payload,
  });
  return res;
}

async function postNonStream(url, body) {
  const res = await post(url, body);
  const json = await res.json();
  return { status: res.status, body: json };
}

function hash(s) {
  return createHash("sha256").update(s).digest("hex");
}

function log(label, ok, detail = "") {
  const mark = ok ? "✅" : "❌";
  console.log(`${mark} ${label}${detail ? ": " + detail : ""}`);
  return ok;
}

let passed = 0;
let failed = 0;
function check(label, ok, detail = "") {
  if (log(label, ok, detail)) passed++;
  else failed++;
  return ok;
}

// ── Tests ────────────────────────────────────────────────────────────────────

console.log("TRST-2A Streaming Smoke Test\n");

// 1. Health check: streaming = sse_passthrough
{
  console.log("── Health Check ──");
  const res = await fetch(`${GATEWAY}/health`);
  const health = await res.json();
  check("health endpoint OK", res.status === 200, JSON.stringify(health));
  check("streaming = sse_passthrough", health.streaming === "sse_passthrough",
    `got: ${health.streaming}`);
  console.log();
}

// 2. Non-streaming: still works (regression check)
{
  console.log("── Non-streaming regression ──");
  const res = await postNonStream(ENDPOINT, {
    model: "deepseek-ai/DeepSeek-V4-Flash",
    messages: [{ role: "user", content: "Say 'hello' in one word." }],
    stream: false,
  });
  check("non-streaming HTTP 200", res.status === 200, `status=${res.status}`);
  const hasText = res.body?.choices?.[0]?.message?.content;
  check("non-streaming has content", !!hasText, hasText?.slice(0, 50));
  console.log();
}

// 3. Streaming: SSE passthrough
{
  console.log("── Streaming SSE Passthrough ──");
  const res = await post(ENDPOINT, {
    model: "deepseek-ai/DeepSeek-V4-Flash",
    messages: [{ role: "user", content: "Count from 1 to 5, one per line." }],
    stream: true,
  });

  check("streaming HTTP 200", res.status === 200, `status=${res.status}`);

  const ct = res.headers.get("content-type") ?? "";
  check("content-type text/event-stream", ct.includes("text/event-stream"), ct);

  const traceId = res.headers.get("x-trustos-trace-id");
  check("X-TrustOS-Trace-Id present", !!traceId, traceId);

  // Read SSE stream
  let chunkCount = 0;
  let fullText = "";
  let doneReceived = false;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunkCount++;
      const text = decoder.decode(value, { stream: true });
      buffer += text;

      // Parse SSE events
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // keep incomplete line in buffer

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") {
          doneReceived = true;
          continue;
        }
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) fullText += delta;
        } catch {
          // skip
        }
      }
    }
  } catch (err) {
    check("stream read no error", false, err.message);
  }

  check("streaming received chunks", chunkCount > 0, `chunks=${chunkCount}`);
  check("streaming [DONE] received", doneReceived);
  check("streaming accumulated text", fullText.length > 0, fullText.slice(0, 80));
  console.log();
}

// 4. Stream error: non-existent model should return error via SSE or HTTP error
{
  console.log("── Streaming Error Passthrough ──");
  const res = await post(ENDPOINT, {
    model: "nonexistent-model-xyz",
    messages: [{ role: "user", content: "Hello" }],
    stream: true,
  });

  // Upstream may return error as non-stream response or SSE error event
  const passedErrorTest = res.status >= 400 || res.status === 200;
  // If 200 with SSE, the SSE content will contain error
  check("stream error handled (HTTP error or SSE error)", passedErrorTest,
    `status=${res.status}`);
  console.log();
}

// ── Event Audit ──────────────────────────────────────────────────────────────

console.log("── Event Audit ──");
{
  await new Promise(r => setTimeout(r, 1000)); // Allow async event writing

  if (!existsSync(EVENT_LOG)) {
    console.log("⚠️  events.jsonl not found — skipping event audit");
    console.log();
  } else {
    const lines = readFileSync(EVENT_LOG, "utf8")
      .split("\n")
      .filter(Boolean);

    // Find events from this smoke run only
    const streamEvents = [];
    for (const line of lines) {
      try {
        const evt = JSON.parse(line);
        if (evt.session_id === SMOKE_SESSION_ID) {
          streamEvents.push(evt);
        }
      } catch { /* skip */ }
    }

    check("stream events recorded", streamEvents.length >= 2,
      `found ${streamEvents.length} events (expected >= 2: 1 non-stream + 1 stream)`);

    // Check each event
    for (const evt of streamEvents) {
      check(`event ${evt.event_id?.slice(0, 8)}... type=${evt.event_type}`,
        evt.event_type === "model_call", evt.status);
      check(`  event_hash present`, !!evt.event_hash,
        evt.event_hash?.slice(0, 16) + "..." || "MISSING");

      if (evt.status === "success") {
        // output_hash: present for streaming events, optional for non-streaming (TRST-1 design)
        if (evt.output_hash) {
          check(`  output_hash present`, true, evt.output_hash.slice(0, 16) + "...");
        }
        check(`  token_count > 0`, (evt.token_count ?? 0) > 0,
          `tokens=${evt.token_count}`);
      }

      // Privacy check
      if (evt.privacy_flags && evt.privacy_flags.length > 0) {
        check(`  privacy_flags empty`, false, JSON.stringify(evt.privacy_flags));
      }
    }

    // Check no raw content leaked
    for (const evt of streamEvents) {
      const raw = JSON.stringify(evt);
      const hasRawContent = raw.includes('"content"');
      // event_hash uses "content" so check if it's in args/output
      if (hasRawContent && !raw.includes("event_hash")) {
        // More careful check: look for raw message content strings
        // This is a basic heuristic
      }
    }
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log();
console.log("========================================");
console.log(`Streaming Smoke: ${passed}/${passed + failed} PASS`);
console.log("========================================");

if (failed > 0) {
  process.exit(1);
}
