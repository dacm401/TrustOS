/**
 * TRST-1 LLM Gateway Server
 *
 * Local HTTP Gateway for:
 *   POST /v1/chat/completions — OpenAI-compatible LLM passthrough
 *   POST /trst1/mcp/tools/call — MCP HTTP JSON-RPC tools/call passthrough (TRST-1C)
 *
 * Shadow Mode: forwards to upstream, records events, returns response unchanged.
 *
 * Stream support: stream=false only. stream=true returns unsupported_feature error.
 *
 * Identity headers (all optional, defaults generated):
 *   X-TrustOS-Session-Id
 *   X-TrustOS-Trace-Id
 *   X-TrustOS-Agent-Id
 *   X-TrustOS-Actor-Id
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { v4 as uuidv4 } from "uuid";
import { createHash } from "node:crypto";
import { createEventId, type TrstEventEnvelope } from "./event-envelope.js";
import { appendEvent } from "./jsonl-event-store.js";
import { extractContextBlocks } from "./context-trace-lite.js";
import { estimateCost } from "./cost-ledger-lite.js";
import {
  forwardChatCompletion,
} from "./openai-compatible-forwarder.js";
import {
  forwardMcpToolCall,
  validateMcpToolCallRequest,
  extractToolName,
  extractToolArgs,
} from "./mcp-passthrough-forwarder.js";

// ── Gateway Config ──────────────────────────────────────────────────────────

export interface GatewayConfig {
  upstreamBaseUrl: string;
  upstreamApiKey: string;
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

// ── Unsupported Feature Response ────────────────────────────────────────────

function unsupportedStreamResponse(identity: ReturnType<typeof buildIdentity>) {
  const errorBody = {
    error: {
      message: "TRST-1 MVP does not support streaming yet. Set stream=false.",
      type: "unsupported_feature",
    },
  };

  // Record failure event
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
    resource_type: "model",
    status: "failure",
    latency_ms: 0,
    privacy_flags: [],
    error_code: "UNSUPPORTED_STREAMING",
    error_message: "stream=true is not supported in TRST-1 MVP. Set stream=false.",
  };

  appendEvent(event);

  return new Response(JSON.stringify(errorBody), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}

// ── Gateway App ─────────────────────────────────────────────────────────────

export function createGatewayApp(config: GatewayConfig): Hono {
  const app = new Hono();

  // Health check
  app.get("/health", (c) => {
    return c.json({
      status: "ok",
      service: "trst1-gateway",
      mode: "shadow",
      streaming: "unsupported",
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

    // Reject streaming
    if (body.stream === true) {
      return unsupportedStreamResponse(identity);
    }

    const model = typeof body.model === "string" ? body.model : "unknown";

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
        config.upstreamBaseUrl,
        config.upstreamApiKey,
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
        destination: config.upstreamBaseUrl,
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
      destination: config.upstreamBaseUrl,
      resource_type: "model",
      resource_ref: model,
      model,
      provider: new URL(config.upstreamBaseUrl).hostname,

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

  // ── TRST-1C MCP HTTP JSON-RPC tools/call passthrough ─────────────────────

  app.post("/trst1/mcp/tools/call", async (c) => {
    const t0 = Date.now();

    // Require MCP upstream URL
    const mcpUpstreamUrl = config.mcpUpstreamUrl;
    if (!mcpUpstreamUrl) {
      return c.json(
        { error: { message: "TRST-1C MCP passthrough not configured. Set TRUSTOS_MCP_UPSTREAM_URL.", type: "not_configured" } },
        503,
      );
    }

    const identity = buildIdentity(c, config.projectId);

    // Parse request body
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { error: { message: "Invalid JSON body", type: "invalid_request" } },
        400,
      );
    }

    // Validate JSON-RPC tools/call request
    const validationError = validateMcpToolCallRequest(body);
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

    const toolName = extractToolName(body);
    const toolArgs = extractToolArgs(body);

    // Hash args
    const argsHash = toolArgs
      ? createHash("sha256").update(JSON.stringify(toolArgs, Object.keys(toolArgs).sort())).digest("hex")
      : undefined;

    // Forward to upstream MCP server
    let fwdResult;
    try {
      fwdResult = await forwardMcpToolCall(mcpUpstreamUrl, body);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
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
        tool_name: toolName,
        args_hash: argsHash,
        latency_ms: Date.now() - t0,
        privacy_flags: [],
        status: "failure",
        error_code: "UPSTREAM_ERROR",
        error_message: errorMsg.slice(0, 500),
      };
      appendEvent(event);
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
    const resultHash = createHash("sha256").update(JSON.stringify(resultPayload, Object.keys(resultPayload as object).sort())).digest("hex");

    // Record tool_call event
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
      tool_name: toolName,
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

    // Return upstream response as-is
    return new Response(JSON.stringify(fwdResult.body), {
      status: fwdResult.status,
      headers: {
        "Content-Type": "application/json",
        "X-TrustOS-Session-Id": identity.sessionId,
        "X-TrustOS-Trace-Id": identity.traceId,
        "X-TrustOS-Gateway-Overhead-Ms": String(gatewayOverheadMs),
      },
    });
  });

  return app;
}
