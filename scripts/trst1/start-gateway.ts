/**
 * TrustOS Gateway — Canonical Private Beta Startup Script
 *
 * Usage:
 *   npx tsx scripts/trst1/start-gateway.ts
 *   npm run trst1:gateway
 *
 * Environment variables:
 *   TRUSTOS_GATEWAY_PORT          — default: 8787
 *   TRUSTOS_UPSTREAM_BASE_URL     — required (e.g. https://api.openai.com)
 *   TRUSTOS_UPSTREAM_API_KEY      — required
 *   TRUSTOS_EVENT_LOG_PATH        — default: .trustos/events.jsonl
 *   TRUSTOS_PROJECT_ID            — default: local-dev
 *   TRUSTOS_MCP_UPSTREAM_URL      — optional
 *
 * This is the canonical single-provider gateway startup path for Private Beta.
 * For multi-provider routing, use ModelRegistry directly.
 */

import { serve } from "@hono/node-server";
import { createGatewayApp } from "../../src/services/trst1/llm-gateway-server.js";
import { initEventStore } from "../../src/services/trst1/jsonl-event-store.js";
import { ModelRegistry } from "../../src/services/trst1/model-registry.js";

const PORT = parseInt(process.env.TRUSTOS_GATEWAY_PORT ?? "8787", 10);
const UPSTREAM_BASE_URL = process.env.TRUSTOS_UPSTREAM_BASE_URL;
const UPSTREAM_API_KEY = process.env.TRUSTOS_UPSTREAM_API_KEY;
const MCP_UPSTREAM_URL = process.env.TRUSTOS_MCP_UPSTREAM_URL;
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

// Build single-provider ModelRegistry from environment variables.
// This is the canonical Private Beta path — no multi-provider routing needed.
const registry = ModelRegistry.fromSingleProvider(UPSTREAM_BASE_URL, UPSTREAM_API_KEY);

const app = createGatewayApp({
  modelRegistry: registry,
  projectId: PROJECT_ID,
  mcpUpstreamUrl: MCP_UPSTREAM_URL ?? undefined,
});

// ── Start ───────────────────────────────────────────────────────────────────

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`\nTrustOS Gateway — Private Beta`);
  console.log(`  Listening:    http://localhost:${info.port}`);
  console.log(`  Mode:         Shadow (dry-run control only)`);
  console.log(`  Streaming:    supported (SSE passthrough, validated for completed streams — TRST-4B)`);
  console.log(`  LLM Upstream: ${UPSTREAM_BASE_URL}`);
  console.log(`  MCP Upstream: ${MCP_UPSTREAM_URL ?? "(not configured)"}`);
  console.log(`  Event log:    ${EVENT_LOG_PATH}`);
  console.log(`  Project:      ${PROJECT_ID}`);
  console.log(`  Evidence:     Privacy-safe, hash-based verification only`);
  console.log(`\nReady. Press Ctrl+C to stop.\n`);
});
