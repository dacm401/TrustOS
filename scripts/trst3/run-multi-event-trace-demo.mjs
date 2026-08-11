/**
 * TRST-3 Multi-Event Trace Demo
 *
 * Demonstrates TrustOS trace correlation by sending multiple related model
 * calls under a single trace_id via X-TrustOS-Trace-Id header.
 *
 * This showcases the "Correlate" phase of the product loop:
 * multiple events → one trace → reviewer can inspect context.
 *
 * Prerequisites:
 *   TrustOS Gateway running (npm run trst1:gateway)
 *
 * Usage:
 *   node scripts/trst3/run-multi-event-trace-demo.mjs
 *
 * Environment:
 *   TRUSTOS_GATEWAY_URL  — default: http://localhost:8787
 *   TRUSTOS_API_KEY      — Overrides .env OPENAI_API_KEY
 *
 * No dependencies beyond Node.js built-ins.
 */

import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

// ============================================================================
// Config
// ============================================================================

const GATEWAY_URL = (process.env.TRUSTOS_GATEWAY_URL || "http://localhost:8787").replace(/\/$/, "");
const MODEL = process.env.TRUSTOS_SMOKE_MODEL || "deepseek-ai/DeepSeek-V4-Flash";

function loadApiKey() {
  try {
    const envContent = readFileSync(".env", "utf8");
    const match = envContent.match(/^(?:OPENAI_API_KEY|TRUSTOS_UPSTREAM_API_KEY)\s*=\s*(.+)/m);
    return match?.[1]?.trim() ?? "";
  } catch { return ""; }
}
const API_KEY = process.env.TRUSTOS_API_KEY?.trim() || loadApiKey();

// ============================================================================
// Helpers
// ============================================================================

const PASS_MARK = "\x1b[32mPASS\x1b[0m";
const FAIL_MARK = "\x1b[31mFAIL\x1b[0m";
const WARN_MARK = "\x1b[33mWARN\x1b[0m";

let pass = 0, fail = 0, warn = 0;

function check(label, ok, detail) {
  if (ok) { pass++; console.log(`  ${PASS_MARK} ${label}`); return true; }
  else { fail++; console.log(`  ${FAIL_MARK} ${label}${detail ? " — " + detail : ""}`); return false; }
}

function warnCheck(label, detail) { warn++; console.log(`  ${WARN_MARK} ${label}${detail ? " — " + detail : ""}`); }

function isMissingHash(v) {
  return v === undefined || v === null || v === "" || (typeof v === "string" && v.trim() === "");
}

// ============================================================================
// Demo Prompts — related conversation simulating agent multi-step reasoning
// ============================================================================

const DEMO_STEPS = [
  {
    step: "Step 1 — Planning",
    agent: "trst3-demo-agent",
    messages: [
      { role: "user", content: "I need to calculate the total price for 3 items: a book ($12.50), a notebook ($4.75), and a pen ($2.25). What is the total?" }
    ],
    max_tokens: 80,
  },
  {
    step: "Step 2 — Tool selection",
    agent: "trst3-demo-agent",
    messages: [
      { role: "user", content: "I need to calculate the total price for 3 items: a book ($12.50), a notebook ($4.75), and a pen ($2.25). What is the total?" },
      { role: "assistant", content: "I will calculate the total by adding the three prices." },
      { role: "user", content: "Actually, there is a 10% discount on the book. Recalculate." }
    ],
    max_tokens: 80,
  },
  {
    step: "Step 3 — Final answer",
    agent: "trst3-demo-agent",
    messages: [
      { role: "user", content: "I need to calculate the total price for 3 items: a book ($12.50 with 10% off), a notebook ($4.75), and a pen ($2.25). What is the total? Show only the final number." }
    ],
    max_tokens: 50,
  },
];

// ============================================================================
// Main
// ============================================================================

async function main() {
  const t0 = Date.now();
  const TRACE_ID = randomUUID();
  const SESSION_ID = randomUUID();

  console.log("=".repeat(56));
  console.log("TRST-3 Multi-Event Trace Demo");
  console.log("=".repeat(56));
  console.log(`Gateway:    ${GATEWAY_URL}`);
  console.log(`Model:      ${MODEL}`);
  console.log(`Trace ID:   ${TRACE_ID}`);
  console.log(`Session ID: ${SESSION_ID}`);
  console.log();

  if (!API_KEY) {
    console.log("ERROR: No API key configured.");
    console.log("  Set TRUSTOS_API_KEY or ensure .env has OPENAI_API_KEY");
    process.exit(1);
  }

  // ── Phase 1: Gateway Health Check ────────────────────────────────────

  console.log("── Phase 1: Gateway Health ──");
  try {
    const hc = await fetch(`${GATEWAY_URL}/health`, { signal: AbortSignal.timeout(5000) });
    check("Gateway healthy", hc.status === 200, `HTTP ${hc.status}`);
  } catch (err) {
    check("Gateway healthy", false, err.message);
    console.log();
    console.log(`  Start gateway: npm run trst1:gateway`);
    process.exit(1);
  }
  console.log();

  // ── Phase 2: Send Multi-Step Trace ───────────────────────────────────

  console.log("── Phase 2: Multi-Step Model Calls (Shared Trace) ──");

  const callResults = [];
  for (let i = 0; i < DEMO_STEPS.length; i++) {
    const { step, agent, messages, max_tokens } = DEMO_STEPS[i];
    const tCall = Date.now();
    try {
      const r = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${API_KEY}`,
          "X-TrustOS-Agent-Id": agent,
          "X-TrustOS-Trace-Id": TRACE_ID,
          "X-TrustOS-Session-Id": SESSION_ID,
        },
        body: JSON.stringify({ model: MODEL, messages, stream: false, max_tokens }),
        signal: AbortSignal.timeout(60000),
      });
      const latency = Date.now() - tCall;
      const body = await r.text();
      const respTraceId = r.headers.get("x-trustos-trace-id");

      let output = "";
      try { output = JSON.parse(body)?.choices?.[0]?.message?.content ?? ""; } catch { /* */ }

      callResults.push({
        stepIndex: i + 1,
        step,
        status: r.status,
        latency_ms: latency,
        traceId: respTraceId,
        output: output.slice(0, 60),
        outputLen: output.length,
      });

      const statusLabel = `HTTP ${r.status} (${latency}ms)`;
      if (r.status === 200) {
        pass++; console.log(`  ${PASS_MARK} ${step} — ${statusLabel}`);
      } else {
        fail++; console.log(`  ${FAIL_MARK} ${step} — ${statusLabel}`);
      }

      console.log(`         trace=${respTraceId?.slice(0, 8)}... output="${output.slice(0, 40)}..."`);
    } catch (err) {
      callResults.push({ stepIndex: i + 1, step, status: 0, latency_ms: 0, traceId: null, output: null, outputLen: 0 });
      fail++; console.log(`  ${FAIL_MARK} ${step} — ERROR: ${err.message}`);
    }

    await new Promise(r => setTimeout(r, 300));
  }

  // Wait for events to be persisted
  await new Promise(r => setTimeout(r, 1500));

  console.log();

  // ── Phase 3: Trace Correlation Verification ──────────────────────────

  console.log("── Phase 3: Trace Correlation ──");

  try {
    const er = await fetch(`${GATEWAY_URL}/events`, { signal: AbortSignal.timeout(5000) });
    const eventsData = await er.json();
    const allEvents = eventsData.events || [];

    // Find events belonging to our trace
    const traceEvents = allEvents.filter(e => e.trace_id === TRACE_ID);

    check("Trace events found in event store", traceEvents.length > 0,
      `${traceEvents.length} events with trace_id=${TRACE_ID.slice(0, 8)}...`);

    if (traceEvents.length > 0) {
      // Check multi-event correlation
      check("Multiple events share same trace_id", traceEvents.length >= 2,
        `${traceEvents.length} events (expected >= 2)`);

      // Verify each event has required hashes
      let hashPass = 0, hashFail = 0;
      for (const ev of traceEvents) {
        const checks = [];
        if (!!ev.event_hash) { checks.push("event_hash"); hashPass++; } else { hashFail++; checks.push("!event_hash"); }
        if (!!ev.trace_id) { checks.push("trace_id"); hashPass++; } else { hashFail++; checks.push("!trace_id"); }

        if (ev.event_type === "model_call") {
          if (!!ev.input_hash) { checks.push("input_hash"); hashPass++; } else { hashFail++; checks.push("!input_hash"); }
          if (ev.status === "success" && !isMissingHash(ev.output_hash)) { checks.push("output_hash"); hashPass++; } else if (ev.status === "success") { hashFail++; checks.push("!output_hash"); }
        }

        console.log(`    ${ev.event_id?.slice(0, 8)}... type=${ev.event_type} status=${ev.status} hashes: ${checks.join(", ")}`);
      }

      check("All trace events have event_hash", traceEvents.every(e => !!e.event_hash));
      const mcInTrace = traceEvents.filter(e => e.event_type === "model_call");
      if (mcInTrace.length > 0) {
        check("All model_calls have input_hash", mcInTrace.every(e => !!e.input_hash));
      }
      const successInTrace = mcInTrace.filter(e => e.status === "success");
      if (successInTrace.length > 0) {
        check("Success model_calls have output_hash", successInTrace.every(e => !isMissingHash(e.output_hash)),
          `${successInTrace.filter(e => !isMissingHash(e.output_hash)).length}/${successInTrace.length} have output_hash`);
      }

      // Show sample trace correlation
      if (traceEvents.length >= 2) {
        console.log();
        console.log("  ── Correlation Timeline ──");
        const sorted = [...traceEvents].sort((a, b) => {
          const ta = a.timestamp ?? "0"; const tb = b.timestamp ?? "0";
          return ta < tb ? -1 : ta > tb ? 1 : 0;
        });
        for (const ev of sorted) {
          const ts = ev.timestamp ? new Date(ev.timestamp).toISOString().slice(11, 19) : "?";
          console.log(`    ${ts}  ${ev.event_type.padEnd(14)} ${ev.event_id.slice(0, 12)}...  status=${ev.status}`);
        }
      }
    } else {
      warnCheck("Multi-event correlation", "no events found for our trace_id — check if event write completed");
    }

    // Also verify sessions
    const sessionEvents = allEvents.filter(e => e.session_id === SESSION_ID);
    if (sessionEvents.length > 0) {
      check("Session correlation works", sessionEvents.length >= 2,
        `${sessionEvents.length} events in session (trace-level correlation via trace_id is the primary mechanism)`);
    }
  } catch (err) {
    check("Trace correlation", false, `events endpoint error: ${err.message}`);
  }

  console.log();

  // ── Phase 4: Correlation Value Explanation ───────────────────────────

  console.log("── Phase 4: Why Correlation Matters ──");
  console.log();
  console.log("  Multi-event traces enable reviewers to:");
  console.log("  1. Follow the full reasoning chain of an agent");
  console.log("  2. Detect unexpected tool calls within a context");
  console.log("  3. Verify hash consistency across related events");
  console.log("  4. Assess risk based on complete context, not isolated events");
  console.log();
  console.log("  In this demo:");
  console.log(`    ${DEMO_STEPS.length} model calls → shared trace_id → reviewer can`);
  console.log("    follow step-by-step AI activity under one governance trace.");
  console.log();

  // ── Summary ──────────────────────────────────────────────────────────

  const elapsed = Date.now() - t0;
  console.log("=".repeat(56));
  const allPass = fail === 0;
  console.log(`TRACE DEMO RESULT: ${allPass ? "PASS" : "FAIL_WITH_ISSUES"}`);
  console.log(`  ${pass} pass / ${fail} fail / ${warn} warn`);
  console.log(`  Trace ID: ${TRACE_ID}`);
  console.log(`  Duration: ${elapsed}ms`);
  console.log();

  if (allPass) {
    console.log("✓ Multi-event trace correlation demo complete.");
    console.log("  Review events in dashboard or events.jsonl to see trace grouping.");
    console.log(`  Trace ID: ${TRACE_ID}`);
  } else {
    console.log("⚠ Some checks failed. See details above.");
  }
  console.log("=".repeat(56));

  process.exit(allPass ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
