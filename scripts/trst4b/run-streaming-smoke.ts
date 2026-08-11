/**
 * TRST-4B Smoke Test — Streaming Support Validation & Hardening
 * Run: npx tsx scripts/trst4b/run-streaming-smoke.mjs
 */
import http from "node:http";

const GATEWAY = "http://localhost:8787";
const MODEL = process.env["MODEL"] || "deepseek-ai/DeepSeek-V3";
const API_KEY = process.env["OPENAI_API_KEY"] || process.env["GATEWAY_API_KEY"] || "";

// ── Helpers ──────────────────────────────────────────────────────────

function request(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string; body: unknown }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, GATEWAY);
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`,
      ...extraHeaders,
    };
    if (bodyStr) headers["Content-Length"] = String(Buffer.byteLength(bodyStr));

    const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf-8");
        let parsedBody: unknown = text;
        if (res.headers["content-type"]?.includes("application/json")) {
          try { parsedBody = JSON.parse(text); } catch { /* keep text */ }
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, text, body: parsedBody });
      });
    });
    req.on("error", reject);
    req.setTimeout(60_000, () => { req.destroy(); reject(new Error("Request timeout")); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function streamRequest(path: string, body: unknown): Promise<{ status: number; fullText: string; event?: string[] }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, GATEWAY);
    const bodyStr = JSON.stringify(body);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`,
    };
    const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: "POST", headers }, (res) => {
      let fullText = "";
      const sseEvents: string[] = [];
      res.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf-8");
        fullText += text;
        for (const line of text.split("\n")) {
          if (line.startsWith("data: ")) {
            sseEvents.push(line.slice(6).trim());
          }
        }
      });
      res.on("end", () => {
        resolve({ status: res.statusCode ?? 0, fullText, event: sseEvents.filter(e => e !== "[DONE]") });
      });
    });
    req.on("error", reject);
    req.setTimeout(60_000, () => { req.destroy(); reject(new Error("Request timeout")); });
    req.write(bodyStr);
    req.end();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface Validation {
  name: string;
  pass: boolean;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("=== TRST-4B Streaming Smoke Test ===\n");
  const validations: Validation[] = [];
  let pass = 0, fail = 0;

  function v(name: string, p: boolean) {
    validations.push({ name, pass: p });
    console.log(`${p ? "✅" : "❌"} ${name}`);
    if (p) pass++; else fail++;
  }

  // ── Phase 0: Gateway Health ──────────────────────────────────────
  console.log("--- Phase 0: Gateway Health ---");
  let healthOk = false;
  try {
    const h = await request("GET", "/health");
    v("Gateway health returns 200", h.status === 200);
    const hb = h.body as Record<string, unknown>;
    v("Health reports streaming=sse_passthrough", hb.streaming === "sse_passthrough");
    v("Health reports status=ok", hb.status === "ok");
    healthOk = h.status === 200;
  } catch (err) {
    v("Gateway reachable", false);
    console.error(`  Gateway unreachable: ${err}`);
    console.error("  Start gateway: cd trustos && npm run gateway");
    process.exit(1);
  }

  if (!healthOk) {
    console.error("Gateway not healthy, aborting.");
    process.exit(1);
  }

  // Capture baseline stats before creating fresh events
  const baselineResp = await request("GET", "/report/summary");
  const baselineStats = ((baselineResp.body as Record<string, unknown>).stats ?? {}) as Record<string, unknown>;
  const baseline = {
    total: (baselineStats.model_calls as number) ?? 0,
    streaming: (baselineStats.streaming_model_calls as number) ?? 0,
    nonStreaming: (baselineStats.non_streaming_model_calls as number) ?? 0,
  };
  const baselineUnknown = baseline.total - baseline.streaming - baseline.nonStreaming;
  console.log(`  Baseline: ${baseline.total} model_calls, ${baselineUnknown} unknown-mode (pre-existing) events`);

  // ── Phase 1: Basic Streaming Calls ────────────────────────────────
  console.log("\n--- Phase 1: Basic Streaming Calls ---");
  const payloads = [
    { model: MODEL, messages: [{ role: "user", content: "Say hello in exactly 3 words." }], stream: true },
    { model: MODEL, messages: [{ role: "user", content: "What is 2+2? Reply with only the number." }], stream: true },
    { model: MODEL, messages: [{ role: "user", content: "Write a one-sentence definition of trust." }], stream: true },
  ];

  const streamResults: Array<{ status: number; fullText: string; events: string[] }> = [];
  for (let i = 0; i < payloads.length; i++) {
    try {
      const r = await streamRequest("/v1/chat/completions", payloads[i]);
      streamResults.push({ status: r.status, fullText: r.fullText, events: r.event ?? [] });
      v(`Streaming call #${i + 1} HTTP ${r.status}`, r.status === 200);
      v(`Streaming call #${i + 1} has SSE data`, r.fullText.includes("data:"));
      v(`Streaming call #${i + 1} has [DONE] marker`, r.fullText.includes("[DONE]"));
    } catch (err) {
      streamResults.push({ status: 0, fullText: "", events: [] });
      v(`Streaming call #${i + 1} completed`, false);
    }
  }

  // ── Phase 2: Event Verification ───────────────────────────────────
  console.log("\n--- Phase 2: Event Verification ---");
  // Wait for events to be written
  await sleep(2000);

  try {
    const eventsResp = await request("GET", "/report/summary");
    const summary = eventsResp.body as Record<string, unknown>;
    const stats = (summary.stats ?? {}) as Record<string, unknown>;

    v("/report/summary returns 200", eventsResp.status === 200);
    v("Summary has streaming_model_calls", typeof stats.streaming_model_calls === "number");
    v("Summary has non_streaming_model_calls", typeof stats.non_streaming_model_calls === "number");
    v("Streaming model calls > 0", (stats.streaming_model_calls as number) > 0);
    v("Model calls >= streaming calls", (stats.model_calls as number) >= (stats.streaming_model_calls as number));

    console.log(`  stream=${stats.streaming_model_calls} non-stream=${stats.non_streaming_model_calls} hash_cov=${stats.hash_coverage_pct}%`);
  } catch (err) {
    v("/report/summary accessible", false);
  }

  // ── Phase 3: Evidence Report Verification ─────────────────────────
  console.log("\n--- Phase 3: Evidence Report Accuracy ---");
  try {
    const reportResp = await request("GET", "/report?format=md");
    const md = reportResp.text;

    v("/report returns 200", reportResp.status === 200);
    // TRST-4B: streaming is now supported. Report should reflect this (not claim "not supported").
    // 'supported (SSE)' or 'supported and validated' confirms 4B completion.
    v('Report claims streaming is supported', md.includes("supported (SSE)") || md.includes("supported and validated"));
    v("Report includes streaming count", md.includes("streaming:"));
    v("Report includes non-streaming count", md.includes("non-streaming:"));
    v("Report has Known Limitations", md.includes("Known Limitations"));
    v("Report has Shadow Mode", md.includes("Shadow Mode"));

    // Overclaim scan
    v("No tamper-proof claim", !md.includes("tamper-proof"));
    v("No notarized claim", !md.includes("notarized"));
    v("No production-grade claim for streaming", !md.includes("production-grade streaming"));
    v("No chunk-level evidence claim", !md.includes("chunk-level evidence"));

    // Raw content scan
    // Check that the report markdown doesn't contain raw AI output (e.g., "hello" from our test prompts)
    // Our test prompts include simple queries — the response text should NOT appear in the report
    const potentiallyRaw = ["definition of trust", "Say hello"];
    const rawLeaks = potentiallyRaw.filter(w => md.includes(w));
    v("No raw content in report", rawLeaks.length === 0);
    if (rawLeaks.length > 0) {
      console.log(`  ⚠️ Potential raw content found: ${rawLeaks.join(", ")}`);
    }
  } catch (err) {
    v("/report accessible", false);
  }

  // ── Phase 4: output_hash Semantics ─────────────────────────────────
  console.log("\n--- Phase 4: output_hash Semantics ---");
  try {
    // Non-streaming call to verify hash is still computed
    const nsResult = await request("POST", "/v1/chat/completions", {
      model: MODEL,
      messages: [{ role: "user", content: "Say 'test' and nothing else." }],
      stream: false,
    });
    v("Non-streaming call HTTP 200", nsResult.status === 200);
    const nsBody = nsResult.body as Record<string, unknown>;
    v("Non-streaming response has choices", Array.isArray(nsBody.choices) && nsBody.choices.length > 0);

    // Wait for event
    await sleep(1000);

    // Re-check summary for hash coverage
    const summary2Resp = await request("GET", "/report/summary");
    const summary2 = summary2Resp.body as Record<string, unknown>;
    const stats2 = (summary2.stats ?? {}) as Record<string, unknown>;
    // TRST-4B: aggregate hash_coverage_pct is served by /report/summary
    v("Hash coverage > 0%", (stats2.hash_coverage_pct as number) > 0);
    console.log(`  Hash coverage: ${stats2.hash_coverage_pct}% (model_calls=${stats2.model_calls})`);
  } catch (err) {
    v("Non-streaming call works", false);
  }

  // ── Phase 5: regression ───────────────────────────────────────────
  console.log("\n--- Phase 5: Non-Streaming Regression ---");
  try {
    const r1 = await request("POST", "/v1/chat/completions", {
      model: MODEL,
      messages: [{ role: "user", content: "Hi" }],
      stream: false,
    });
    v("Non-streaming regression call HTTP 200", r1.status === 200);

    const r2 = await request("POST", "/v1/chat/completions", {
      model: MODEL,
      messages: [{ role: "user", content: "1+1=?" }],
      stream: false,
    });
    v("Non-streaming regression call #2 HTTP 200", r2.status === 200);

    await sleep(1000);
    const summary3Resp = await request("GET", "/report/summary");
    const summary3 = summary3Resp.body as Record<string, unknown>;
    const stats3 = (summary3.stats ?? {}) as Record<string, unknown>;
    v("Non-streaming model calls recorded", (stats3.non_streaming_model_calls as number) > 0);
  } catch (err) {
    v("Non-streaming regression", false);
  }

  // ── Phase 6: request_mode field ────────────────────────────────────
  console.log("\n--- Phase 6: request_mode Field ---");
  try {
    const reportResp2 = await request("GET", "/report?format=md");
    const md2 = reportResp2.text;
    v("Report Markdown has request mode info", md2.includes("streaming") && md2.includes("non-streaming"));
    // Check delta: fresh events created in this run should all have request_mode set.
    // Pre-existing unknown-mode events are excluded by comparing against baseline.
    const summaryFinalResp = await request("GET", "/report/summary");
    const statsFinal = ((summaryFinalResp.body as Record<string, unknown>).stats ?? {}) as Record<string, unknown>;
    const finalUnknown = (statsFinal.model_calls as number) - (statsFinal.streaming_model_calls as number) - (statsFinal.non_streaming_model_calls as number);
    const deltaUnknown = finalUnknown - baselineUnknown;
    v("No unknown-mode model calls in fresh events (delta)", deltaUnknown === 0);
    if (baselineUnknown > 0) {
      console.log(`  Pre-existing unknown-mode: ${baselineUnknown} (excluded from delta check)`);
    }
    if (deltaUnknown > 0) {
      console.log(`  ⚠️ ${deltaUnknown} new unknown-mode events in this run`);
    }
  } catch (err) {
    v("Report accessible", false);
  }

  // ── Results ────────────────────────────────────────────────────────
  console.log(`\n=== Results: ${pass}/${validations.length} PASS, ${fail} FAIL ===\n`);
  if (fail > 0) {
    console.log("Failed:");
    for (const v of validations) {
      if (!v.pass) console.log(`  ❌ ${v.name}`);
    }
    console.log("\n❌ SOME VALIDATIONS FAILED");
    process.exit(1);
  } else {
    console.log("✅ ALL VALIDATIONS PASSED — TRST-4B Streaming Support Validated\n");
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(2);
});
