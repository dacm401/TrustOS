/**
 * H1: Runtime Health Dashboard — GET /health endpoint
 *
 * Returns structured system health information:
 *   - status: "ok" | "degraded" | "error"
 *   - uptime_seconds, version, timestamp
 *   - services: database / model_router / web_search
 *   - stats: task counts, memory entries, evidence
 *
 * No identity middleware — this endpoint is public.
 * Stats queries degrade gracefully: failure → null, does not affect status.
 */

import { Hono } from "hono";
import { query } from "../db/connection.js";
import { config } from "../config.js";
import {
  countEvents,
  getStorePath,
  getChainTail,
  verifyStoredChain,
} from "../services/trst1/jsonl-event-store.js";
import { currentEnforcementMode } from "../trust/policy-enforcement.js";

export const healthRouter = new Hono();

const START_TIME = Date.now();

/**
 * Event Backbone status — honest reporting:
 * `not_initialised` when the store was never wired into this process
 * (the pre-2026-08-28 bug: enforcement events were silently dropped).
 */
function getEventBackboneStatus() {
  const path = getStorePath();
  if (!path) {
    return {
      status: "not_initialised" as const,
      note: "initEventStore() was never called — events are NOT persisted",
    };
  }
  const chain = verifyStoredChain();
  return {
    status: chain.valid ? ("ok" as const) : ("chain_broken" as const),
    path,
    events: countEvents(),
    chain_valid: chain.valid,
    ...(chain.brokenAtIndex !== null ? { broken_at_index: chain.brokenAtIndex } : {}),
    ...(chain.reason ? { reason: chain.reason } : {}),
    chain_tail: getChainTail()?.slice(0, 16) ?? null,
  };
}

/**
 * Policy / Control status. `deny_rules_count` is the honest signal for
 * "can this system ever block anything?" — zero means Control is a no-op.
 */
function getPolicyStatus() {
  const mode = currentEnforcementMode();
  const denyEnabled = config.permission.denyRulesEnabled !== false;
  return {
    mode, // "dry_run" (shadow, default) | "live" (actually blocks)
    deny_rules_enabled: denyEnabled,
    deny_rules_count: denyEnabled ? 1 : 0,
    can_block: mode === "live" && denyEnabled,
    dlp_enabled: config.permission.dlpEnabled,
  };
}

function getProviders(): string[] {
  const providers: string[] = [];
  if (config.openaiApiKey) providers.push("openai");
  if (config.anthropicApiKey) providers.push("anthropic");
  return providers;
}

async function getDbLatencyMs(): Promise<number | null> {
  try {
    const start = Date.now();
    await query("SELECT 1");
    return Date.now() - start;
  } catch {
    return null;
  }
}

async function getStats(): Promise<{
  tasks_total: number;
  tasks_active: number;
  memory_entries: number;
  evidence_total: number;
} | null> {
  try {
    const [tasksResult, memoryResult, evidenceResult] = await Promise.all([
      query(`SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status NOT IN ('completed','failed','cancelled'))::int as active
       FROM tasks`),
      query(`SELECT COUNT(*)::int as count FROM memory_entries`),
      query(`SELECT COUNT(*)::int as count FROM evidence`),
    ]);

    return {
      tasks_total: tasksResult.rows[0]?.total ?? 0,
      tasks_active: tasksResult.rows[0]?.active ?? 0,
      memory_entries: memoryResult.rows[0]?.count ?? 0,
      evidence_total: evidenceResult.rows[0]?.count ?? 0,
    };
  } catch {
    return null;
  }
}

healthRouter.get("/", async (c) => {
  const [dbLatency, stats] = await Promise.all([
    getDbLatencyMs(),
    getStats(),
  ]);

  const dbStatus: "ok" | "error" = dbLatency !== null ? "ok" : "error";
  const webSearchStatus: "configured" | "not_configured" =
    config.webSearch.endpoint ? "configured" : "not_configured";

  const overallStatus: "ok" | "degraded" | "error" =
    dbStatus === "error" ? "degraded" : "ok";

  return c.json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor((Date.now() - START_TIME) / 1000),
    version: "1.0.0",
    services: {
      database: {
        status: dbStatus,
        latency_ms: dbLatency,
      },
      model_router: {
        status: "ok",
        providers: getProviders(),
      },
      web_search: {
        status: webSearchStatus,
      },
      // ── Event Backbone (hash-chained, append-only) ──
      event_backbone: getEventBackboneStatus(),
      // ── Policy / Control ──
      policy_enforcement: getPolicyStatus(),
    },
    stats: stats,
  });
});
