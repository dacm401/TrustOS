/**
 * TRST-2 LLM Gateway Server
 *
 * Local HTTP Gateway for:
 *   POST /v1/chat/completions — OpenAI-compatible LLM passthrough (streaming OK)
 *   POST /trst1/mcp — MCP JSON-RPC passthrough (all lifecycle methods: TRST-2B)
 *   POST /trst1/mcp/tools/call — backward compat (TRST-1C)
 *
 * Shadow Mode: forwards to upstream, records events, returns response unchanged.
 *
 * Stream support: full SSE passthrough with accumulated evidence recording.
 *
 * Identity headers (all optional, defaults generated):
 *   X-TrustOS-Session-Id
 *   X-TrustOS-Trace-Id
 *   X-TrustOS-Agent-Id
 *   X-TrustOS-Actor-Id
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Context } from "hono";
import { v4 as uuidv4 } from "uuid";
import { createHash } from "node:crypto";

import { createEventId, extractTaskId, type TrstEventEnvelope } from "./event-envelope.js";
import { appendEvent, countEvents, getStorePath } from "./jsonl-event-store.js";
import { getJsonlEventIndex } from "./jsonl-event-index.js";
import { getEventIndex, type EventIndex } from "./event-index.js";
import { extractContextBlocks } from "./context-trace-lite.js";
import { estimateCost } from "./cost-ledger-lite.js";
import { generateEvidenceReport } from "./evidence-report.js";
import {
  forwardChatCompletion,
  forwardChatCompletionStream,
} from "./openai-compatible-forwarder.js";
import {
  forwardMcpRequest,
  validateMcpRequest,
  mcpMethodToEventType,
  isToolCallMethod,
  extractMcpName,
  extractToolArgs,
} from "./mcp-passthrough-forwarder.js";
import type { McpForwardResult } from "./mcp-passthrough-forwarder.js";
import { ModelRegistry } from "./model-registry.js";

// ── Gateway runtime metrics ─────────────────────────────────────────────────
const GATEWAY_STARTED_AT_MS = Date.now();

// ── Event indexing (TRST-4C) ────────────────────────────────────────────────
let _eventIndexInstance: EventIndex | null = null;
let _eventIndexDisabled = false;

/**
 * Event index resolution (2026-08-28).
 *
 * The SQLite index needs better-sqlite3 (native). When its binding is broken
 * it SIGSEGVs (exit 139) on `require()` — try/catch CANNOT recover from that.
 * So we never load it: the JSONL index serves the same contract in pure JS
 * (see jsonl-event-index.ts), since JSONL is the source of truth anyway.
 *
 * Set TRUSTOS_EVENT_INDEX=sqlite to opt into the native index (requires a
 * correctly built better-sqlite3). Default is the safe pure-JS path.
 */

/** Which index backend is actually serving requests. */
let _indexBackend: "jsonl" | "sqlite" | "none" = "none";

function eventIndexEnabled(): boolean {
  return process.env.TRUSTOS_EVENT_INDEX !== "off";
}

/** Returns the index, or null when indexing is disabled. */
function initEventIndex(): EventIndex | null {
  if (_eventIndexDisabled) return null;
  if (!_eventIndexInstance) {
    if (!eventIndexEnabled()) {
      _eventIndexDisabled = true;
      _indexBackend = "none";
      return null;
    }
    _eventIndexInstance = resolveIndex();
  }
  return _eventIndexInstance;
}

function resolveIndex(): EventIndex {
  // Opt-in native backend (only if the operator explicitly asks for it).
  if (process.env.TRUSTOS_EVENT_INDEX === "sqlite") {
    try {
      const idx = getEventIndex(getStorePath());
      idx.syncFromJsonl();
      _indexBackend = "sqlite";
      return idx;
    } catch (err) {
      process.stderr.write(
        `[gateway] SQLite index unavailable, falling back to JSONL: ${
          err instanceof Error ? err.message : String(err)
        }\n`,
      );
    }
  }
  // Default: pure JS, zero native dependencies, cannot segfault.
  _indexBackend = "jsonl";
  const storePath = getStorePath();
  if (!storePath) {
    // Store not initialised — report "none" rather than indexing a bogus path.
    _indexBackend = "none";
    return null as unknown as EventIndex;
  }
  return getJsonlEventIndex(storePath) as unknown as EventIndex;
}

/** Append event to JSONL + (optional) SQLite index */
function persistEvent(e: TrstEventEnvelope): void {
  appendEvent(e);
  try {
    initEventIndex()?.appendEvent(e);
  } catch {
    /* index failure is non-fatal — JSONL is the source of truth */
  }
}

// ── Gateway Config ──────────────────────────────────────────────────────────

export interface GatewayConfig {
  modelRegistry: ModelRegistry;
  projectId: string;
  mcpUpstreamUrl?: string;
}

// ── Identity Helpers ────────────────────────────────────────────────────────

function getHeader(c: Context, name: string): string | undefined {
  return c.req.header(name) ?? undefined;
}

/**
 * MWT-3B1: Normalize the `task_id` query param.
 * - "null" → null (filter unassigned events)
 * - "" → null (treat empty as unassigned, never a valid task_id)
 * - non-empty trimmed string → exact task_id
 * Empty/whitespace is never a valid task_id, matching ingestion semantics (R2).
 */
function normalizeTaskIdFilter(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "null") return null;
  return trimmed;
}

function buildIdentity(c: Context, projectId: string) {
  // Gateway NEVER fabricates task_id — extractTaskId returns null when absent/empty.
  return {
    sessionId: getHeader(c, "X-TrustOS-Session-Id") ?? uuidv4(),
    traceId: getHeader(c, "X-TrustOS-Trace-Id") ?? uuidv4(),
    agentId: getHeader(c, "X-TrustOS-Agent-Id") ?? "direct-gateway-call",
    actorId: getHeader(c, "X-TrustOS-Actor-Id") ?? "local-user",
    runId: getHeader(c, "X-TrustOS-Run-Id") ?? uuidv4(),
    taskId: extractTaskId(getHeader(c, "X-TrustOS-Task-Id")),
    projectId,
  };
}

// ── Gateway App ─────────────────────────────────────────────────────────────

export function createGatewayApp(config: GatewayConfig): Hono {
  const app = new Hono();

  // CORS — allow TrustOS Dashboard to poll Gateway health directly
  app.use("*", cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-TrustOS-Session-Id", "X-TrustOS-Trace-Id", "X-TrustOS-Agent-Id", "X-TrustOS-Actor-Id"],
    exposeHeaders: ["X-TrustOS-Trace-Id", "X-TrustOS-Session-Id", "X-TrustOS-Gateway-Overhead-Ms"],
    maxAge: 86400,
  }));

  // Health check
  app.get("/health", (c) => {
    const uptimeSeconds = Math.floor((Date.now() - GATEWAY_STARTED_AT_MS) / 1000);
    const eventsCount = initEventIndex()?.getEventCount() ?? countEvents();
    return c.json({
      status: "ok",
      service: "trst2-gateway",
      mode: "shadow",
      streaming: "sse_passthrough",
      mcp_lifecycle: "enabled",
      providers: config.modelRegistry.getProviderIds(),
      uptime_seconds: uptimeSeconds,
      events_count: eventsCount,
      gateway_overhead_ms: null,
      // Honest: report the backend actually serving index queries.
      index: (initEventIndex() ? _indexBackend : "none"), // TRST-4C
    });
  });

  // ── Whitelist Sanitizer ──────────────────────────────────────────────────
  const ALLOWED_EVENT_FIELDS = new Set([
    "event_id", "event_type", "timestamp", "status",
    "trace_id", "session_id", "run_id", "task_id",
    "source", "destination",
    "resource_type", "resource_ref",
    "provider", "model", "tool_name", "tool_id",
    "event_hash", "input_hash", "output_hash", "args_hash", "result_hash",
    "latency_ms", "gateway_overhead_ms",
    "privacy_flags",
    "token_count", "cost_estimate",
    "actor_id", "agent_id", "project_id",
  ]);

  const FORBIDDEN_KEYS = new Set([
    "prompt", "response", "input", "output", "args", "result",
    "content", "messages",
    "body", "headers",
    "authorization", "api_key", "apiKey", "secret", "token", "password",
    "raw", "raw_body", "raw_response",
    "env", "environment",
  ]);

  function toSafeEventMetadata(rawEvent: Record<string, unknown>): Record<string, unknown> {
    const safe: Record<string, unknown> = {};
    for (const key of ALLOWED_EVENT_FIELDS) {
      if (key in rawEvent) {
        const value = rawEvent[key];
        // Ensure forbidden keys are never copied even if they match allowed set
        if (FORBIDDEN_KEYS.has(key)) continue;
        safe[key] = value ?? null;
      }
    }
    return safe;
  }

  // GET /events — paginated event metadata viewer (TRST-4C: SQLite-backed)
  app.get("/events", (c) => {
    const idx = initEventIndex();
    if (!idx) {
      return c.json(
        {
          status: "degraded",
          service: "trst2-gateway",
          mode: "shadow",
          reason:
            "event_index_disabled (JSONL-only mode); use GET /report for the hash-chained event log",
          events: [],
        },
        503,
      );
    }
    const q: Record<string, string> = {};
    for (const k of ["page", "limit", "session_id", "event_type", "agent_id", "from", "to", "request_mode"]) {
      const v = c.req.query(k);
      if (v) q[k] = v;
    }

    // MWT-3B1: task_id filter — exact match (string) or unassigned (null literal).
    // `task_id=null` or `unassigned=true` → filter unassigned events (task_id IS NULL).
    let taskIdFilter: string | null | undefined = undefined;
    const rawTaskId = c.req.query("task_id");
    if (rawTaskId !== undefined) {
      taskIdFilter = normalizeTaskIdFilter(rawTaskId);
    } else if (c.req.query("unassigned") === "true") {
      taskIdFilter = null;
    }

    const page = Math.max(1, parseInt(q.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(q.limit) || 50));

    const result = idx.queryEvents({ page, limit, session_id: q.session_id, event_type: q.event_type, agent_id: q.agent_id, from: q.from, to: q.to, request_mode: q.request_mode, task_id: taskIdFilter });
    const safeEvents = result.events.map(e => {
      const r: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(e)) {
        if (ALLOWED_EVENT_FIELDS.has(k) && !FORBIDDEN_KEYS.has(k)) r[k] = v ?? null;
      }
      return r;
    });

    return c.json({
      status: "ok",
      service: "trst2-gateway",
      mode: "shadow",
      page: result.page,
      limit: result.limit,
      total: result.total,
      has_more: result.hasMore,
      returned_count: safeEvents.length,
      events: safeEvents,
    });
  });

  // GET /sessions — session listing with summary stats (TRST-4C)
  app.get("/sessions", (c) => {
    const idx = initEventIndex();
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "") || 50));
    if (!idx) {
      return c.json(
        {
          status: "degraded",
          service: "trst2-gateway",
          mode: "shadow",
          reason: "event_index_disabled (JSONL-only mode); session listing unavailable",
          sessions: [],
        },
        503,
      );
    }
    const sessions = idx.listSessions(limit);
    return c.json({
      status: "ok",
      service: "trst2-gateway",
      mode: "shadow",
      limit,
      returned_count: sessions.length,
      sessions,
    });
  });

  // GET /report — human-readable evidence report (HTML)
  app.get("/report", (c) => {
    const fmt = c.req.query("format") ?? "html";
    const eventLogPath = getStorePath();

    if (!eventLogPath) {
      return c.json({
        error: "Event store not initialized. Start the gateway with an event log path first.",
        type: "not_initialized",
      }, 503);
    }

    const report = generateEvidenceReport({ eventLogPath });

    if (fmt === "md" || fmt === "markdown") {
      return new Response(report.markdown, {
        status: 200,
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "X-TrustOS-Report-Events": String(report.eventCount),
          "X-TrustOS-Report-Generated": report.generatedAt,
        },
      });
    }

    if (fmt === "download" || fmt === "export") {
      return new Response(report.html, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": `attachment; filename="trustos-evidence-report-${new Date().toISOString().slice(0, 10)}.html"`,
          "X-TrustOS-Report-Events": String(report.eventCount),
          "X-TrustOS-Report-Generated": report.generatedAt,
        },
      });
    }

    // Default: inline HTML
    return new Response(report.html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-TrustOS-Report-Events": String(report.eventCount),
        "X-TrustOS-Report-Generated": report.generatedAt,
      },
    });
  });

  // GET /report/summary — aggregated stats from SQLite index (TRST-4C: fast, no full scan)
  app.get("/report/summary", (c) => {
    const idx = initEventIndex();
    if (!idx) {
      return c.json(
        {
          status: "degraded",
          service: "trst2-gateway",
          mode: "shadow",
          reason: "event_index_disabled (JSONL-only mode); aggregate stats unavailable",
          event_count: countEvents(),
        },
        503,
      );
    }
    const s = idx.getStats();
    return c.json({
      status: "ok",
      generated_at: new Date().toISOString(),
      event_count: s.total_events,
      stats: {
        model_calls: s.model_calls,
        streaming_model_calls: s.streaming_calls,
        non_streaming_model_calls: s.non_streaming_calls,
        tool_calls: s.tool_calls,
        success_count: s.success_count,
        failure_count: s.failure_count,
        total_tokens: s.total_tokens,
        estimated_cost: s.total_cost,
        unique_sessions: s.unique_sessions,
        unique_agents: s.unique_agents,
        hash_coverage_pct: s.hash_coverage_pct,
      },
      source: "sqlite_index", // TRST-4C: signals fast path
    });
  });

  // Main endpoint
  app.post("/v1/chat/completions", async (c) => {
    const t0 = Date.now();
    const identity = buildIdentity(c, config.projectId);

    // Parse request
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { error: { message: "Invalid JSON body", type: "invalid_request" } },
        400,
      );
    }

    // ── Streaming SSE Passthrough ──────────────────────────────────────────
    if (body.stream === true) {
      const model = typeof body.model === "string" ? body.model : "unknown";
      const provider = config.modelRegistry.resolveProvider(model);

      // Extract context blocks (before forwarding)
      const messagesInput = Array.isArray(body.messages)
        ? (body.messages as Array<{ role: string; content?: string | unknown[] | null }>)
        : undefined;
      const { blocks } = extractContextBlocks(messagesInput);
      const inputHash = blocks.length > 0
        ? blocks.map((b) => b.content_hash).join(":")
        : undefined;

      let streamResponse: Response;
      try {
        streamResponse = await forwardChatCompletionStream(
          provider.baseUrl,
          provider.apiKey,
          body as { model: string; messages: unknown[]; stream?: boolean },
        );
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const event: Omit<TrstEventEnvelope, "event_hash"> = {
          event_id: createEventId(),
          event_type: "model_call",
          timestamp: new Date().toISOString(),
          trace_id: identity.traceId,
          session_id: identity.sessionId,
          run_id: identity.runId,
          project_id: identity.projectId,
          task_id: identity.taskId,
          agent_id: identity.agentId,
          actor_id: identity.actorId,
          source: "gateway",
          destination: provider.baseUrl,
          resource_type: "model",
          model,
          request_mode: "streaming",
          input_hash: inputHash ?? undefined,
          context_block_refs: blocks.map((b) => b.block_id),
          latency_ms: Date.now() - t0,
          privacy_flags: [],
          status: "failure",
          error_code: "STREAM_UPSTREAM_ERROR",
          error_message: errorMsg.slice(0, 500),
        };
        persistEvent(event);
        return new Response(
          JSON.stringify({ error: { message: `Stream upstream error: ${errorMsg.slice(0, 200)}`, type: "upstream_error" } }),
          { status: 502, headers: { "Content-Type": "application/json" } },
        );
      }

      if (!streamResponse.ok || !streamResponse.body) {
        const errText = await streamResponse.text().catch(() => "");
        const event: Omit<TrstEventEnvelope, "event_hash"> = {
          event_id: createEventId(),
          event_type: "model_call",
          timestamp: new Date().toISOString(),
          trace_id: identity.traceId,
          session_id: identity.sessionId,
          run_id: identity.runId,
          project_id: identity.projectId,
          task_id: identity.taskId,
          agent_id: identity.agentId,
          actor_id: identity.actorId,
          source: "gateway",
          destination: provider.baseUrl,
          resource_type: "model",
          model,
          request_mode: "streaming",
          input_hash: inputHash ?? undefined,
          context_block_refs: blocks.map((b) => b.block_id),
          latency_ms: Date.now() - t0,
          privacy_flags: [],
          status: "failure",
          error_code: `STREAM_HTTP_${streamResponse.status}`,
          error_message: errText.slice(0, 500),
        };
        persistEvent(event);
        return new Response(
          errText || JSON.stringify({ error: { message: "Upstream stream error", type: "upstream_error" } }),
          { status: 502, headers: { "Content-Type": "application/json" } },
        );
      }

      // Create SSE passthrough stream with accumulation for evidence
      const reader = streamResponse.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      let streamUsage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null = null;
      let firstChunkAt = 0;
      let cancelled = false;

      const passthroughStream = new ReadableStream({
        async start(controller) {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              if (firstChunkAt === 0) firstChunkAt = Date.now();

              // Passthrough raw bytes to client
              controller.enqueue(value);

              // Parse SSE for accumulation
              const text = decoder.decode(value, { stream: true });
              for (const line of text.split("\n")) {
                const trimmed = line.trim();
                if (!trimmed.startsWith("data: ")) continue;
                const data = trimmed.slice(6);
                if (data === "[DONE]") continue;
                try {
                  const parsed = JSON.parse(data);
                  const delta = parsed.choices?.[0]?.delta?.content;
                  if (delta) fullText += delta;
                  if (parsed.usage) streamUsage = parsed.usage;
                } catch {
                  // skip unparseable SSE data lines
                }
              }
            }

            // Stream complete — record evidence event
            const totalLatencyMs = Date.now() - t0;
            const upstreamLatencyMs = firstChunkAt > 0 ? firstChunkAt - t0 : totalLatencyMs;
            const gatewayOverheadMs = Math.max(0, totalLatencyMs - upstreamLatencyMs);
            const cost = estimateCost(model, streamUsage ?? undefined);

            // Per PM TRST-4B Decision 1: output_hash absent on cancelled/incomplete streams
            const outputHash = (!cancelled && fullText.length > 0)
              ? createHash("sha256").update(fullText).digest("hex")
              : undefined;

            // Privacy hardening: clear accumulated text after hashing
            fullText = "";

            const isCancelled = cancelled;
            const event: Omit<TrstEventEnvelope, "event_hash"> = {
              event_id: createEventId(),
              event_type: "model_call",
              timestamp: new Date().toISOString(),
              trace_id: identity.traceId,
              session_id: identity.sessionId,
              run_id: identity.runId,
              project_id: identity.projectId,
              agent_id: identity.agentId,
              actor_id: identity.actorId,
              task_id: identity.taskId,
              source: "gateway",
              destination: provider.baseUrl,
              resource_type: "model",
              resource_ref: model,
              model,
              provider: new URL(provider.baseUrl).hostname,
              request_mode: "streaming",
              context_block_refs: blocks.map((b) => b.block_id),
              input_hash: inputHash ?? undefined,
              output_hash: outputHash,
              token_count: isCancelled ? undefined : cost.totalTokens,
              cost_estimate: isCancelled ? null : cost.estimatedCostUsd,
              latency_ms: totalLatencyMs,
              gateway_overhead_ms: isCancelled ? undefined : gatewayOverheadMs,
              privacy_flags: [],
              status: isCancelled ? "failure" : "success",
              ...(isCancelled ? {
                error_code: "STREAM_CANCELLED" as const,
                error_message: "Client disconnected before stream completion",
              } : {}),
            };
            persistEvent(event);

            controller.close();
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            // Privacy hardening: clear accumulated text on error
            fullText = "";
            const event: Omit<TrstEventEnvelope, "event_hash"> = {
              event_id: createEventId(),
              event_type: "model_call",
              timestamp: new Date().toISOString(),
              trace_id: identity.traceId,
              session_id: identity.sessionId,
              run_id: identity.runId,
              project_id: identity.projectId,
              agent_id: identity.agentId,
              actor_id: identity.actorId,
              task_id: identity.taskId,
              source: "gateway",
              destination: provider.baseUrl,
              resource_type: "model",
              model,
              request_mode: "streaming",
              input_hash: inputHash ?? undefined,
              context_block_refs: blocks.map((b) => b.block_id),
              latency_ms: Date.now() - t0,
              privacy_flags: [],
              status: "failure",
              error_code: "STREAM_ERROR",
              error_message: errorMsg.slice(0, 500),
            };
            persistEvent(event);
            controller.error(err);
          }
        },
        cancel(reason) {
          cancelled = true;
          reader.cancel(reason).catch(() => {
            // Upstream reader cancellation is best-effort
          });
        },
      });

      return new Response(passthroughStream, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-TrustOS-Session-Id": identity.sessionId,
          "X-TrustOS-Trace-Id": identity.traceId,
        },
      });
    }

    // ── Non-streaming (existing path) ─────────────────────────────────────
    const model = typeof body.model === "string" ? body.model : "unknown";
    const provider = config.modelRegistry.resolveProvider(model);

    // Extract context metadata (before forwarding)
    const messagesInput = Array.isArray(body.messages)
      ? (body.messages as Array<{ role: string; content?: string | unknown[] | null }>)
      : undefined;
    const { blocks } = extractContextBlocks(messagesInput);

    const inputHash = blocks.length > 0
      ? blocks.map((b) => b.content_hash).join(":")
      : undefined;

    // Forward to upstream
    let result;
    try {
      result = await forwardChatCompletion(
        provider.baseUrl,
        provider.apiKey,
        body as { model: string; messages: unknown[]; stream?: boolean },
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const event: Omit<TrstEventEnvelope, "event_hash"> = {
        event_id: createEventId(),
        event_type: "model_call",
        timestamp: new Date().toISOString(),
        trace_id: identity.traceId,
        session_id: identity.sessionId,
        run_id: identity.runId,
        project_id: identity.projectId,
        task_id: identity.taskId,
        agent_id: identity.agentId,
        actor_id: identity.actorId,
        source: "gateway",
        destination: provider.baseUrl,
        resource_type: "model",
        model,
        request_mode: "non_streaming",
        input_hash: inputHash,
        context_block_refs: blocks.map((b) => b.block_id),
        latency_ms: Date.now() - t0,
        privacy_flags: [],
        status: "failure",
        error_code: "UPSTREAM_ERROR",
        error_message: errorMsg.slice(0, 500),
      };

      persistEvent(event);

      return new Response(
        JSON.stringify({
          error: {
            message: `Gateway upstream error: ${errorMsg.slice(0, 200)}`,
            type: "upstream_error",
          },
        }),
        {
          status: 502,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const latencyMs = Date.now() - t0;
    const upstreamLatencyMs =
      result.timing.responseReceivedAt - result.timing.requestSentAt;
    const gatewayOverheadMs = latencyMs - upstreamLatencyMs;

    // Estimate cost
    const usage = (result.body as Record<string, unknown>)?.usage as
      | { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
      | undefined;
    const cost = estimateCost(model, usage);

    // Build event
    const event: Omit<TrstEventEnvelope, "event_hash"> = {
      event_id: createEventId(),
      event_type: "model_call",
      timestamp: new Date().toISOString(),
      trace_id: identity.traceId,
      session_id: identity.sessionId,
      run_id: identity.runId,
      project_id: identity.projectId,
      agent_id: identity.agentId,
      actor_id: identity.actorId,
      task_id: identity.taskId,

      source: "gateway",
      destination: provider.baseUrl,
      resource_type: "model",
      resource_ref: model,
      model,
      provider: new URL(provider.baseUrl).hostname,
      request_mode: "non_streaming",

      context_block_refs: blocks.map((b) => b.block_id),
      input_hash: inputHash,
      token_count: cost.totalTokens,
      cost_estimate: cost.estimatedCostUsd,
      latency_ms: latencyMs,
      gateway_overhead_ms: Math.max(0, gatewayOverheadMs),

      privacy_flags: [],
      status: result.status >= 200 && result.status < 300 ? "success" : "failure",
    };

    // Compute output_hash for successful non-streaming model calls
    if (event.status === "success") {
      const choices = (result.body as Record<string, unknown>)?.choices as
        Array<{ message?: { content?: string } }> | undefined;
      const responseContent = choices?.[0]?.message?.content;
      if (typeof responseContent === "string") {
        event.output_hash = createHash("sha256").update(responseContent).digest("hex");
      }
    }

    // If upstream returned error status, add error info
    if (result.status >= 400) {
      const errBody = result.body as Record<string, unknown>;
      event.error_code = `UPSTREAM_${result.status}`;
      event.error_message = JSON.stringify(errBody).slice(0, 500);
    }

    persistEvent(event);

    // Return upstream response as-is
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: {
        "Content-Type": "application/json",
        "X-TrustOS-Session-Id": identity.sessionId,
        "X-TrustOS-Trace-Id": identity.traceId,
        "X-TrustOS-Gateway-Overhead-Ms": String(Math.max(0, gatewayOverheadMs)),
      },
    });
  });

  // ── TRST-2B MCP JSON-RPC passthrough (lifecycle + tools/call) ─────────────

  /**
   * Shared MCP request handler. Validates, forwards, records event, returns.
   * Works for any known MCP JSON-RPC method (initialize, tools/list, tools/call, etc.)
   */
  async function handleMcpRequest(c: Context, routePath: string) {
    const t0 = Date.now();

    const mcpUpstreamUrl = config.mcpUpstreamUrl;
    if (!mcpUpstreamUrl) {
      return c.json(
        { error: { message: "MCP passthrough not configured. Set TRUSTOS_MCP_UPSTREAM_URL.", type: "not_configured" } },
        503,
      );
    }

    const identity = buildIdentity(c, config.projectId);

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { message: "Invalid JSON body", type: "invalid_request" } }, 400);
    }

    const validationError = validateMcpRequest(body);
    if (validationError) {
      const event: Omit<TrstEventEnvelope, "event_hash"> = {
        event_id: createEventId(),
        event_type: "tool_call",
        timestamp: new Date().toISOString(),
        trace_id: identity.traceId,
        session_id: identity.sessionId,
        run_id: identity.runId,
        project_id: identity.projectId,
        task_id: identity.taskId,
        agent_id: identity.agentId,
        actor_id: identity.actorId,
        source: "gateway",
        destination: mcpUpstreamUrl,
        resource_type: "tool",
        latency_ms: Date.now() - t0,
        privacy_flags: [],
        status: "failure",
        error_code: "INVALID_REQUEST",
        error_message: validationError,
      };
      persistEvent(event);
      return c.json({ error: { message: validationError, type: "invalid_request" } }, 400);
    }

    const method = body.method as string;
    const eventType = mcpMethodToEventType(method);
    const name = extractMcpName(method, body);
    const toolArgs = isToolCallMethod(method) ? extractToolArgs(body) : undefined;

    // Hash args (for tools/call) or params (for other methods)
    const hashTarget = toolArgs ?? body.params;
    const argsHash = hashTarget
      ? createHash("sha256").update(JSON.stringify(hashTarget, Object.keys(hashTarget as object).sort())).digest("hex")
      : undefined;

    // Forward to upstream
    let fwdResult: McpForwardResult;
    try {
      fwdResult = await forwardMcpRequest(mcpUpstreamUrl, body);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const failEvent: Omit<TrstEventEnvelope, "event_hash"> = {
        event_id: createEventId(),
        event_type: eventType,
        timestamp: new Date().toISOString(),
        trace_id: identity.traceId,
        session_id: identity.sessionId,
        run_id: identity.runId,
        project_id: identity.projectId,
        task_id: identity.taskId,
        agent_id: identity.agentId,
        actor_id: identity.actorId,
        source: "gateway",
        destination: mcpUpstreamUrl,
        resource_type: "tool",
        resource_ref: name,
        args_hash: argsHash,
        latency_ms: Date.now() - t0,
        privacy_flags: [],
        status: "failure",
        error_code: "UPSTREAM_ERROR",
        error_message: errorMsg.slice(0, 500),
      };
      persistEvent(failEvent);
      return new Response(
        JSON.stringify({ error: { message: `MCP upstream error: ${errorMsg.slice(0, 200)}`, type: "upstream_error" } }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }

    const latencyMs = Date.now() - t0;
    const upstreamLatencyMs = fwdResult.timing.responseReceivedAt - fwdResult.timing.requestSentAt;
    const gatewayOverheadMs = Math.max(0, latencyMs - upstreamLatencyMs);

    // Hash result
    const upstreamBody = fwdResult.body as Record<string, unknown>;
    const hasResult = upstreamBody?.result !== undefined;
    const hasError = upstreamBody?.error !== undefined;
    const resultPayload = hasResult ? upstreamBody.result : (hasError ? upstreamBody.error : upstreamBody);
    const resultHash = createHash("sha256")
      .update(JSON.stringify(resultPayload, Object.keys(resultPayload as object).sort()))
      .digest("hex");

    const event: Omit<TrstEventEnvelope, "event_hash"> = {
      event_id: createEventId(),
      event_type: eventType,
      timestamp: new Date().toISOString(),
      trace_id: identity.traceId,
      session_id: identity.sessionId,
      run_id: identity.runId,
      project_id: identity.projectId,
      task_id: identity.taskId,
      agent_id: identity.agentId,
      actor_id: identity.actorId,
      source: "gateway",
      destination: mcpUpstreamUrl,
      resource_type: "tool",
      resource_ref: name,
      args_hash: argsHash,
      result_hash: resultHash,
      latency_ms: latencyMs,
      gateway_overhead_ms: gatewayOverheadMs,
      privacy_flags: [],
      status: hasResult ? "success" : "failure",
    };

    if (hasError) {
      const errPayload = upstreamBody.error as Record<string, unknown>;
      event.error_code = String(errPayload?.code ?? "MCP_ERROR");
      event.error_message = JSON.stringify(errPayload).slice(0, 500);
    }

    persistEvent(event);

    return new Response(JSON.stringify(fwdResult.body), {
      status: fwdResult.status,
      headers: {
        "Content-Type": "application/json",
        "X-TrustOS-Session-Id": identity.sessionId,
        "X-TrustOS-Trace-Id": identity.traceId,
        "X-TrustOS-Gateway-Overhead-Ms": String(gatewayOverheadMs),
      },
    });
  }

  // POST /trst1/mcp - generic MCP JSON-RPC endpoint (all methods)
  app.post("/trst1/mcp", async (c) => handleMcpRequest(c, "/trst1/mcp"));

  // POST /trst1/mcp/tools/call - backward compat (TRST-1C)
  app.post("/trst1/mcp/tools/call", async (c) => handleMcpRequest(c, "/trst1/mcp/tools/call"));

  return app;
}


