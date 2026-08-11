/**
 * TRST-1 Tool Trace Lite
 *
 * Records tool_call events into the event store.
 * Used by the Tool Trace CLI (simulate-tool-call.ts).
 *
 * This is NOT an MCP Broker. It's a minimal CLI tool-call path
 * that validates the tool_call event envelope.
 */

import { createHash } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import { createEventId, sealEvent, type TrstEventEnvelope } from "./event-envelope.js";
import { appendEvent } from "./jsonl-event-store.js";

export interface ToolCallOptions {
  toolName: string;
  args: unknown;
  sessionId?: string;
  traceId?: string;
  agentId?: string;
  actorId?: string;
  projectId: string;
}

export interface ToolCallResult {
  event: TrstEventEnvelope;
  argsHash: string;
  resultHash: string;
}

function hashData(data: unknown): string {
  const normalized = typeof data === "string" ? data : JSON.stringify(data);
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

/**
 * Simulate a tool call — actually executes the tool function and records the event.
 *
 * For TRST-1B, the only supported tool is `read_file`.
 * Additional tools can be added by extending the executor.
 */
export async function executeAndRecordToolCall(
  options: ToolCallOptions,
  executor: (toolName: string, args: unknown) => Promise<{ output: unknown; error?: string }>,
): Promise<ToolCallResult> {
  const t0 = Date.now();
  const argsHash = hashData(options.args);

  const sessionId = options.sessionId ?? uuidv4();
  const traceId = options.traceId ?? uuidv4();
  const runId = uuidv4();

  let output: unknown;
  let errorMsg: string | undefined;
  let status: "success" | "failure" = "success";

  try {
    const result = await executor(options.toolName, options.args);
    output = result.output;
    if (result.error) {
      errorMsg = result.error;
      status = "failure";
    }
  } catch (err) {
    output = null;
    errorMsg = err instanceof Error ? err.message : String(err);
    status = "failure";
  }

  const latencyMs = Date.now() - t0;
  const resultHash = hashData(output);

  const event: Omit<TrstEventEnvelope, "event_hash"> = {
    event_id: createEventId(),
    event_type: "tool_call",
    timestamp: new Date().toISOString(),
    trace_id: traceId,
    session_id: sessionId,
    run_id: runId,
    project_id: options.projectId,
    task_id: null,
    agent_id: options.agentId ?? "unknown-agent",
    actor_id: options.actorId ?? "local-user",

    source: "cli-tool-simulator",
    destination: "local",
    resource_type: "tool",
    resource_ref: options.toolName,
    tool_name: options.toolName,

    args_hash: argsHash,
    result_hash: resultHash,
    latency_ms: latencyMs,
    gateway_overhead_ms: 0, // CLI executor: no network overhead

    privacy_flags: [],
    status,
    ...(errorMsg ? { error_code: "TOOL_EXECUTION_ERROR", error_message: errorMsg.slice(0, 500) } : {}),
  };

  appendEvent(event);

  return {
    event: sealEvent(event),
    argsHash,
    resultHash,
  };
}
