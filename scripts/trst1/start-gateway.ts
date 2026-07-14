/**
 * TRST-1 LLM Gateway — Start Script
 *
 * Usage:
 *   npx tsx scripts/trst1/start-gateway.ts
 *
 * Environment variables:
 *   TRUSTOS_GATEWAY_PORT          — default: 8787
 *   TRUSTOS_UPSTREAM_BASE_URL     — required (e.g. https://api.openai.com)
 *   TRUSTOS_UPSTREAM_API_KEY      — required
 *   TRUSTOS_EVENT_LOG_PATH        — default: .trustos/events.jsonl
 *   TRUSTOS_PROJECT_ID            — default: local-dev
 */

import { serve } from "@hono/node-server";
import { createGatewayApp } from "../../src/services/trst1/llm-gateway-server.js";
import { initEventStore } from "../../src/services/trst1/jsonl-event-store.js";

const PORT = parseInt(process.env.TRUSTOS_GATEWAY_PORT ?? "8787", 10);
const UPSTREAM_BASE_URL = process.env.TRUSTOS_UPSTREAM_BASE_URL;
const UPSTREAM_API_KEY = process.env.TRUSTOS_UPSTREAM_API_KEY;
const EVENT_LOG_PATH = process.env.TRUSTOS_EVENT_LOG_PATH ?? ".trustos/events.jsonl";
const PROJECT_ID = process.env.TRUSTOS_PROJECT_ID ?? "local-dev";

// ── Validate ────────────────────────────────────────────────────────────────

if (!UPSTREAM_BASE_URL) {
  console.error("ERROR: TRUSTOS_UPSTREAM_BASE_URL is required.");
  console.error("  Example: https://api.openai.com");
  console.error("  Example: https://api.siliconflow.cn");
  process.exit(1);
}

if (!UPSTREAM_API_KEY) {
  console.error("ERROR: TRUSTOS_UPSTREAM_API_KEY is required.");
  process.exit(1);
}

// ── Init ────────────────────────────────────────────────────────────────────

initEventStore(EVENT_LOG_PATH);

const app = createGatewayApp({
  upstreamBaseUrl: UPSTREAM_BASE_URL,
  upstreamApiKey: UPSTREAM_API_KEY,
  projectId: PROJECT_ID,
});

// ── Start ───────────────────────────────────────────────────────────────────

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`\nTrustOS TRST-1 Gateway`);
  console.log(`  Listening:  http://localhost:${info.port}`);
  console.log(`  Mode:       Shadow`);
  console.log(`  Streaming:  unsupported (stream=false only)`);
  console.log(`  Upstream:   ${UPSTREAM_BASE_URL}`);
  console.log(`  Event log:  ${EVENT_LOG_PATH}`);
  console.log(`  Project:    ${PROJECT_ID}`);
  console.log(`\nReady. Press Ctrl+C to stop.\n`);
});
