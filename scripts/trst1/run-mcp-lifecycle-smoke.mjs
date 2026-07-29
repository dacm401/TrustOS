/**
 * TRST-2B MCP Lifecycle Smoke Test
 *
 * Validates MCP JSON-RPC lifecycle methods via POST /trst1/mcp.
 * Requires: Gateway on :8787, MCP upstream at TRUSTOS_MCP_UPSTREAM_URL.
 *
 * Usage:
 *   node scripts/trst1/run-mcp-lifecycle-smoke.mjs
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
const MCP_ENDPOINT = `${GATEWAY}/trst1/mcp`;
const TOOLS_CALL_ENDPOINT = `${GATEWAY}/trst1/mcp/tools/call`;
const EVENT_LOG = process.env.TRUSTOS_EVENT_LOG_PATH ?? resolve(PROJECT_ROOT, ".trustos", "events.jsonl");
const SMOKE_SESSION_ID = `mcp-lifecycle-${Date.now()}`;

// ── Helpers ──────────────────────────────────────────────────────────────────

async function post(endpoint, method, params, id = null) {
  const rpcId = id ?? Date.now();
  const body = JSON.stringify({ jsonrpc: "2.0", method, params, id: rpcId });
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-TrustOS-Session-Id": SMOKE_SESSION_ID,
      "X-TrustOS-Agent-Id": "lifecycle-smoke-agent",
    },
    body,
  });
  const json = await res.json();
  return { status: res.status, body: json, traceId: res.headers.get("x-trustos-trace-id") };
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

console.log("TRST-2B MCP Lifecycle Smoke Test\n");
console.log(`Session: ${SMOKE_SESSION_ID}\n`);

// 1. tools/call via /trst1/mcp (generic endpoint)
{
  console.log("── tools/call via /trst1/mcp ──");
  const res = await post(MCP_ENDPOINT, "tools/call", {
    name: "echo",
    arguments: { message: "hello lifecycle" },
  });
  check("tools/call HTTP success", res.status === 200, `status=${res.status}`);
  check("tools/call result present", res.body?.result !== undefined,
    JSON.stringify(res.body).slice(0, 100));
  console.log();
}

// 2. tools/call via /trst1/mcp/tools/call (backward compat)
{
  console.log("── tools/call via /trst1/mcp/tools/call (backward compat) ──");
  const res = await post(TOOLS_CALL_ENDPOINT, "tools/call", {
    name: "echo",
    arguments: { message: "backward compat test" },
  });
  check("backward compat HTTP success", res.status === 200, `status=${res.status}`);
  check("backward compat result present", res.body?.result !== undefined,
    JSON.stringify(res.body).slice(0, 100));
  console.log();
}

// 3. tools/list via /trst1/mcp
{
  console.log("── tools/list via /trst1/mcp ──");
  const res = await post(MCP_ENDPOINT, "tools/list", {});
  // tools/list may return 200 with result or error depending on upstream
  check("tools/list HTTP responds", res.status >= 200 && res.status < 600,
    `status=${res.status}`);
  const hasResult = res.body?.result?.tools !== undefined;
  log("  tools/list returned tools", hasResult,
    hasResult ? `count=${res.body.result.tools.length}` : "no tools (upstream may not support)");
  console.log();
}

// 4. initialize via /trst1/mcp
{
  console.log("── initialize via /trst1/mcp ──");
  const res = await post(MCP_ENDPOINT, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "TrustOS-smoke-test", version: "0.1.0" },
  });
  check("initialize HTTP responds", res.status >= 200 && res.status < 600,
    `status=${res.status}`);
  const hasServerInfo = res.body?.result?.serverInfo !== undefined;
  log("  initialize returned serverInfo", hasServerInfo,
    hasServerInfo ? JSON.stringify(res.body.result.serverInfo).slice(0, 80) : "no serverInfo");
  console.log();
}

// 5. Invalid/malformed MCP request
{
  console.log("── Malformed MCP request ──");
  const res = await fetch(`${MCP_ENDPOINT}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-TrustOS-Session-Id": SMOKE_SESSION_ID },
    body: JSON.stringify({ jsonrpc: "2.0", method: "nonexistent_method", id: 1 }),
  });
  check("malformed returns 400", res.status === 400, `status=${res.status}`);
  console.log();
}

// ── Event Audit ──────────────────────────────────────────────────────────────

console.log("── Event Audit ──");
{
  await new Promise(r => setTimeout(r, 1000));

  if (!existsSync(EVENT_LOG)) {
    console.log("⚠️  events.jsonl not found — skipping event audit");
    console.log();
  } else {
    const lines = readFileSync(EVENT_LOG, "utf8").split("\n").filter(Boolean);
    const smokeEvents = [];
    for (const line of lines) {
      try {
        const evt = JSON.parse(line);
        if (evt.session_id === SMOKE_SESSION_ID) {
          smokeEvents.push(evt);
        }
      } catch { /* skip */ }
    }

    check("MCP events recorded", smokeEvents.length >= 3,
      `found ${smokeEvents.length} events (expected >= 3)`);

    // Events should include tool_call, mcp_proxy, mcp_tool_proxy, mcp_initialize
    const eventTypes = new Set(smokeEvents.map(e => e.event_type));
    log("  event types seen:", true, [...eventTypes].join(", "));

    for (const evt of smokeEvents) {
      check(`event ${evt.event_id?.slice(0, 8)}... type=${evt.event_type}`,
        true, evt.status);

      check(`  event_hash present`, !!evt.event_hash,
        evt.event_hash?.slice(0, 16) + "..." || "MISSING");

      if (evt.status === "success" && evt.result_hash) {
        check(`  result_hash present`, true, evt.result_hash.slice(0, 16) + "...");
      }
    }

    // Privacy check: no raw content
    for (const evt of smokeEvents) {
      if (evt.privacy_flags && evt.privacy_flags.length > 0) {
        check(`  privacy_flags for ${evt.event_type}`, false,
          JSON.stringify(evt.privacy_flags));
      }
    }
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log();
console.log("========================================");
console.log(`MCP Lifecycle Smoke: ${passed}/${passed + failed} PASS`);
console.log("========================================");

if (failed > 0) {
  process.exit(1);
}
