/**
 * TRST-1C MCP Passthrough Smoke Test
 *
 * Validates the POST /trst1/mcp/tools/call endpoint.
 * Requires: fake MCP server on :8788, Gateway on :8787.
 *
 * Usage:
 *   node scripts/trst1/run-mcp-smoke.mjs
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const GATEWAY = process.env.TRUSTOS_GATEWAY_URL ?? "http://localhost:8787";
const MCP_ENDPOINT = `${GATEWAY}/trst1/mcp/tools/call`;
const EVENT_LOG = ".trustos/events.jsonl";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function post(url, body) {
  const payload = JSON.stringify(body);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-TrustOS-Session-Id": "mcp-smoke-session",
      "X-TrustOS-Agent-Id": "mcp-smoke-agent",
      "X-TrustOS-Actor-Id": "mcp-smoke-tester",
    },
    body: payload,
  });
  let data;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    data = await res.json();
  } else {
    data = await res.text();
  }
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body: data,
  };
}

function hash(obj) {
  const canonical = JSON.stringify(obj, Object.keys(obj).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

function readEvents() {
  try {
    const raw = readFileSync(EVENT_LOG, "utf8");
    return raw
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

function check(raw, field) {
  if (JSON.stringify(raw).includes(field)) {
    return `${field} found in raw data — LEAK!`;
  }
  return null;
}

// ── Test Harness ─────────────────────────────────────────────────────────────

const results = [];
let passed = 0;
let failed = 0;

function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  if (pass) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name} — ${detail}`);
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

console.log("\n═══ TRST-1C MCP Passthrough Smoke Test ═══\n");

// --- 1. Fake server health ---
console.log("─ Fake MCP Server ─\n");
try {
  const h = await fetch("http://localhost:8788/health");
  const hb = await h.json();
  record("Fake MCP server health", hb.status === "ok", JSON.stringify(hb));
} catch (e) {
  record("Fake MCP server health", false, e.message);
}

// --- 2. Successful tools/call passthrough (echo) ---
console.log("\n─ Successful Passthrough ─\n");

const echoRequest = {
  jsonrpc: "2.0",
  method: "tools/call",
  params: {
    name: "echo",
    arguments: { message: "hello-tr1c", ts: Date.now() },
  },
  id: 1,
};

const echoRes = await post(MCP_ENDPOINT, echoRequest);
record(
  "HTTP 200 on success",
  echoRes.status === 200,
  `status=${echoRes.status}`,
);
record(
  "X-TrustOS-Trace-Id present",
  !!echoRes.headers["x-trustos-trace-id"],
  echoRes.headers["x-trustos-trace-id"] ?? "missing",
);
record(
  "JSON-RPC result returned",
  echoRes.body?.result !== undefined,
  JSON.stringify(echoRes.body).slice(0, 100),
);
record(
  "Response is valid JSON-RPC 2.0",
  echoRes.body?.jsonrpc === "2.0" && echoRes.body?.id === 1,
  `jsonrpc=${echoRes.body?.jsonrpc}, id=${echoRes.body?.id}`,
);

// --- 3. Upstream error passthrough ---
console.log("\n─ Upstream Error Passthrough ─\n");

const badToolRequest = {
  jsonrpc: "2.0",
  method: "tools/call",
  params: {
    name: "nonexistent_tool",
    arguments: {},
  },
  id: 2,
};

const badToolRes = await post(MCP_ENDPOINT, badToolRequest);
record(
  "HTTP 200 on upstream tool error",
  badToolRes.status === 200,
  `status=${badToolRes.status}`,
);
record(
  "JSON-RPC error returned from upstream",
  badToolRes.body?.error !== undefined,
  JSON.stringify(badToolRes.body).slice(0, 150),
);

// --- 4. Malformed request returns 400 ---
console.log("\n─ Malformed Request ─\n");

const malformedBody = { not: "jsonrpc" };
const malformedRes = await post(MCP_ENDPOINT, malformedBody);
record(
  "HTTP 400 on malformed body",
  malformedRes.status === 400,
  `status=${malformedRes.status}`,
);

const batchBody = [{ jsonrpc: "2.0", method: "tools/call", params: { name: "echo" }, id: 3 }];
const batchRes = await post(MCP_ENDPOINT, batchBody);
record(
  "HTTP 400 on batch request",
  batchRes.status === 400,
  `status=${batchRes.status}`,
);

const noIdBody = { jsonrpc: "2.0", method: "tools/call", params: { name: "echo" } };
const noIdRes = await post(MCP_ENDPOINT, noIdBody);
record(
  "HTTP 400 on missing id",
  noIdRes.status === 400,
  `status=${noIdRes.status}`,
);

// --- 5. Event Audit ---
console.log("\n─ Event Audit ─\n");

const events = readEvents();
const mcpEvents = events.filter((e) => e.event_type === "tool_call");

record(
  "At least 2 tool_call events written",
  mcpEvents.length >= 2,
  `found ${mcpEvents.length}`,
);

for (const e of mcpEvents) {
  const prefix = `[${e.tool_name ?? "?"}]`;

  record(
    `${prefix} event_hash present`,
    !!e.event_hash,
  );
  record(
    `${prefix} args_hash present`,
    !!e.args_hash,
    e.args_hash?.slice(0, 16) + "..." ?? "missing",
  );
  record(
    `${prefix} result_hash present`,
    !!e.result_hash,
    e.result_hash?.slice(0, 16) + "..." ?? "missing",
  );
  record(
    `${prefix} privacy_flags empty`,
    Array.isArray(e.privacy_flags) && e.privacy_flags.length === 0,
    JSON.stringify(e.privacy_flags),
  );
  record(
    `${prefix} status set`,
    e.status === "success" || e.status === "failure",
    e.status,
  );

  // Privacy: no raw args/result
  const raw = JSON.stringify(e);
  const argsLeak = check(raw, "hello-tr1c");
  const argsLeak2 = check(raw, "nonexistent_tool");
  if (argsLeak) {
    record(`${prefix} no raw args stored`, false, argsLeak);
  } else {
    record(`${prefix} no raw args stored`, true);
  }
}

// --- 6. success/failure status ---
const successEvents = mcpEvents.filter((e) => e.status === "success");
const failureEvents = mcpEvents.filter((e) => e.status === "failure");
record("At least 1 success event", successEvents.length >= 1, `found ${successEvents.length}`);
record("At least 1 failure event", failureEvents.length >= 1, `found ${failureEvents.length}`);

// --- 7. Gateway overhead ---
console.log("\n─ Performance ─\n");
const overheadHeader = echoRes.headers["x-trustos-gateway-overhead-ms"];
const overhead = overheadHeader ? parseInt(overheadHeader, 10) : null;
record(
  "Gateway overhead header present",
  overhead !== null && !isNaN(overhead),
  `overhead=${overheadHeader}`,
);
if (overhead !== null && !isNaN(overhead) && overhead < 100) {
  record("Gateway overhead < 100ms", true, `${overhead}ms`);
} else if (overhead !== null) {
  record("Gateway overhead < 100ms", false, `${overhead}ms (above threshold)`);
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log("\n─── Results ───\n");
console.log(`  Passed: ${passed}/${results.length}`);
console.log(`  Failed: ${failed}/${results.length}`);
console.log("");

if (failed > 0) {
  console.log("Failed tests:");
  for (const r of results) {
    if (!r.pass) {
      console.log(`  ❌ ${r.name}: ${r.detail}`);
    }
  }
  console.log("");
}

// Let fetch handles settle before exit (avoids UV_HANDLE_CLOSING on Node 22+)
setTimeout(() => process.exit(failed > 0 ? 1 : 0), 100);
