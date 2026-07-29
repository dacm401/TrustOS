/**
 * TRST-2B MCP HTTP JSON-RPC Passthrough Forwarder
 *
 * Forwards MCP-style JSON-RPC requests to a configured upstream
 * MCP HTTP JSON-RPC server. Supports all MCP lifecycle methods.
 *
 * Shadow Mode: passthrough only — no blocking, no redaction, no modification.
 * TRST-2B: lifecycle + tools/call. HTTP JSON-RPC only. No SSE/stdio.
 */

export interface McpForwardRequest {
  jsonrpc: string;
  method: string;
  params?: Record<string, unknown>;
  id: string | number;
}

export interface McpForwardResult {
  status: number;
  body: unknown;
  headers: Record<string, string>;
  timing: {
    requestSentAt: number;
    responseReceivedAt: number;
  };
}

/** Known MCP JSON-RPC methods we accept. */
const KNOWN_MCP_METHODS = new Set([
  "initialize",
  "notifications/initialized",
  "tools/list",
  "tools/call",
  "resources/list",
  "resources/read",
  "prompts/list",
  "prompts/get",
]);

/** MCP methods that are notifications (no id required). */
const MCP_NOTIFICATION_METHODS = new Set([
  "notifications/initialized",
]);

/**
 * Forward a raw JSON-RPC body to the upstream MCP HTTP JSON-RPC server.
 */
export async function forwardMcpToolCall(
  upstreamMcpUrl: string,
  body: unknown,
): Promise<McpForwardResult> {
  const url = upstreamMcpUrl.replace(/\/$/, "");
  const requestSentAt = Date.now();

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const responseReceivedAt = Date.now();

  const respHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    respHeaders[key] = value;
  });

  let respBody: unknown;
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    respBody = await response.json();
  } else {
    respBody = await response.text();
  }

  return {
    status: response.status,
    body: respBody,
    headers: respHeaders,
    timing: { requestSentAt, responseReceivedAt },
  };
}

/** @deprecated Use forwardMcpToolCall directly (re-exported as forwardMcpRequest). */
export const forwardMcpRequest = forwardMcpToolCall;

/**
 * Validate that the parsed body is a JSON-RPC 2.0 request with a known MCP method.
 * Returns an error string if invalid, null if valid.
 */
export function validateMcpRequest(body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return "Request body must be a JSON-RPC 2.0 object (batch not supported)";
  }

  const req = body as Record<string, unknown>;

  if (req.jsonrpc !== "2.0") {
    return 'jsonrpc must be "2.0"';
  }

  if (typeof req.method !== "string" || req.method.length === 0) {
    return "method is required";
  }

  const method = req.method;
  const isKnown = KNOWN_MCP_METHODS.has(method) ||
    ["tools/", "resources/", "prompts/", "notifications/"].some(p => method.startsWith(p));
  if (!isKnown) {
    return `Unknown MCP method: "${method}"`;
  }

  // Notifications don't require an id
  if (!MCP_NOTIFICATION_METHODS.has(method)) {
    if (req.id === undefined || req.id === null) {
      return "JSON-RPC id is required";
    }
  }

  return null; // valid
}

/**
 * @deprecated Use validateMcpRequest instead.
 */
export function validateMcpToolCallRequest(body: unknown): string | null {
  const result = validateMcpRequest(body);
  if (result) return result;
  const req = body as Record<string, unknown>;
  if (req.method !== "tools/call") {
    return `Unsupported method: "${String(req.method)}". Only "tools/call" is supported.`;
  }
  return null;
}

/**
 * Map MCP method to TrstEventType for evidence recording.
 */
export function mcpMethodToEventType(method: string): "tool_call" | "mcp_initialize" | "mcp_tool_proxy" | "mcp_resource_proxy" | "mcp_prompt_proxy" | "mcp_proxy" {
  if (method === "tools/call") return "tool_call";
  if (method === "initialize") return "mcp_initialize";
  if (method.startsWith("tools/")) return "mcp_tool_proxy";
  if (method.startsWith("resources/")) return "mcp_resource_proxy";
  if (method.startsWith("prompts/")) return "mcp_prompt_proxy";
  return "mcp_proxy";
}

/**
 * Determine if a method requires tool-specific arguments extraction.
 */
export function isToolCallMethod(method: string): boolean {
  return method === "tools/call";
}

/**
 * Extract resource name from MCP request based on method.
 */
export function extractMcpName(method: string, body: Record<string, unknown>): string {
  if (method === "tools/call") {
    const params = body.params as Record<string, unknown> | undefined;
    return String(params?.name ?? "unknown");
  }
  return method;
}

/**
 * Extract tool name from a valid tools/call JSON-RPC request.
 * @deprecated Use extractMcpName instead.
 */
export function extractToolName(body: Record<string, unknown>): string {
  return extractMcpName("tools/call", body);
}

/**
 * Extract arguments from a valid tools/call JSON-RPC request.
 */
export function extractToolArgs(
  body: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const params = body.params as Record<string, unknown> | undefined;
  const args = params?.arguments;
  if (typeof args === "object" && args !== null && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  return undefined;
}
