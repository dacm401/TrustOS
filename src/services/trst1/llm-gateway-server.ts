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

import { createEventId, type TrstEventEnvelope } from "./event-envelope.js";
import { appendEvent } from "./jsonl-event-store.js";
import { extractContextBlocks } from "./context-trace-lite.js";
import { estimateCost } from "./cost-ledger-lite.js";
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

function buildIdentity(c: Context, projectId: string) {
  return {
    sessionId: getHeader(c, "X-TrustOS-Session-Id") ?? uuidv4(),
    traceId: getHeader(c, "X-TrustOS-Trace-Id") ?? uuidv4(),
    agentId: getHeader(c, "X-TrustOS-Agent-Id") ?? "unknown-agent",
    actorId: getHeader(c, "X-TrustOS-Actor-Id") ?? "local-user",
    runId: uuidv4(),
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
    return c.json({
      status: "ok",
      service: "trst2-gateway",
      mode: "shadow",
      streaming: "sse_passthrough",
      mcp_lifecycle: "enabled",
      providers: config.modelRegistry.getProviderIds(),
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
          agent_id: identity.agentId,
          actor_id: identity.actorId,
          source: "gateway",
          destination: provider.baseUrl,
          resource_type: "model",
          model,
          input_hash: inputHash ?? undefined,
          context_block_refs: blocks.map((b) => b.block_id),
          latency_ms: Date.now() - t0,
          privacy_flags: [],
          status: "failure",
          error_code: "STREAM_UPSTREAM_ERROR",
          error_message: errorMsg.slice(0, 500),
        };
        appendEvent(event);
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
          agent_id: identity.agentId,
          actor_id: identity.actorId,
          source: "gateway",
          destination: provider.baseUrl,
          resource_type: "model",
          model,
          input_hash: inputHash ?? undefined,
          context_block_refs: blocks.map((b) => b.block_id),
          latency_ms: Date.now() - t0,
          privacy_flags: [],
          status: "failure",
          error_code: `STREAM_HTTP_${streamResponse.status}`,
          error_message: errText.slice(0, 500),
        };
        appendEvent(event);
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

            const outputHash = fullText.length > 0
              ? createHash("sha256").update(fullText).digest("hex")
              : undefined;

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
              source: "gateway",
              destination: provider.baseUrl,
              resource_type: "model",
              resource_ref: model,
              model,
              provider: new URL(provider.baseUrl).hostname,
              context_block_refs: blocks.map((b) => b.block_id),
              input_hash: inputHash ?? undefined,
              output_hash: outputHash,
              token_count: cost.totalTokens,
              cost_estimate: cost.estimatedCostUsd,
              latency_ms: totalLatencyMs,
              gateway_overhead_ms: gatewayOverheadMs,
              privacy_flags: [],
              status: "success",
            };
            appendEvent(event);

            controller.close();
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
              agent_id: identity.agentId,
              actor_id: identity.actorId,
              source: "gateway",
              destination: provider.baseUrl,
              resource_type: "model",
              model,
              input_hash: inputHash ?? undefined,
              context_block_refs: blocks.map((b) => b.block_id),
              latency_ms: Date.now() - t0,
              privacy_flags: [],
              status: "failure",
              error_code: "STREAM_ERROR",
              error_message: errorMsg.slice(0, 500),
            };
            appendEvent(event);
            controller.error(err);
          }
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
        agent_id: identity.agentId,
        actor_id: identity.actorId,
        source: "gateway",
        destination: provider.baseUrl,
        resource_type: "model",
        model,
        input_hash: inputHash,
        context_block_refs: blocks.map((b) => b.block_id),
        latency_ms: Date.now() - t0,
        privacy_flags: [],
        status: "failure",
        error_code: "UPSTREAM_ERROR",
        error_message: errorMsg.slice(0, 500),
      };

      appendEvent(event);

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

      source: "gateway",
      destination: provider.baseUrl,
      resource_type: "model",
      resource_ref: model,
      model,
      provider: new URL(provider.baseUrl).hostname,

      context_block_refs: blocks.map((b) => b.block_id),
      input_hash: inputHash,
      token_count: cost.totalTokens,
      cost_estimate: cost.estimatedCostUsd,
      latency_ms: latencyMs,
      gateway_overhead_ms: Math.max(0, gatewayOverheadMs),

      privacy_flags: [],
      status: result.status >= 200 && result.status < 300 ? "success" : "failure",
    };

    // If upstream returned error status, add error info
    if (result.status >= 400) {
      const errBody = result.body as Record<string, unknown>;
      event.error_code = `UPSTREAM_${result.status}`;
      event.error_message = JSON.stringify(errBody).slice(0, 500);
    }

    appendEvent(event);

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
      appendEvent(event);
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
      appendEvent(failEvent);
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

    appendEvent(event);

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


