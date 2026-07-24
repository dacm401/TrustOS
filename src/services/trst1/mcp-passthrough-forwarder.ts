/**
 * TRST-1C MCP HTTP JSON-RPC Passthrough Forwarder
 *
 * Forwards MCP-style JSON-RPC tools/call requests to a configured upstream
 * MCP HTTP JSON-RPC server.
 *
 * Shadow Mode: passthrough only — no blocking, no redaction, no modification.
 * TRST-1C spike: HTTP JSON-RPC only. No SSE, no stdio, no MCP lifecycle.
 */

export interface McpForwardRequest {
  jsonrpc: string;
  method: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
    [key: string]: unknown;
  };
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

/**
 * Forward a raw JSON-RPC body to the upstream MCP HTTP JSON-RPC server.
 * Preserves all request fields; does not add Authorization unless configured.
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

/**
 * Validate that the parsed body is a JSON-RPC 2.0 request with method "tools/call".
 * Returns an error string if invalid, null if valid.
 */
export function validateMcpToolCallRequest(
  body: unknown,
): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return "Request body must be a JSON-RPC 2.0 object (batch not supported)";
  }

  const req = body as Record<string, unknown>;

  if (req.jsonrpc !== "2.0") {
    return "jsonrpc must be \"2.0\"";
  }

  if (req.method !== "tools/call") {
    return `Unsupported method: "${String(req.method)}". Only "tools/call" is supported.`;
  }

  if (req.id === undefined || req.id === null) {
    return "JSON-RPC id is required (notifications not supported)";
  }

  const params = req.params;
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    return "params must be a JSON-RPC 2.0 object";
  }

  const p = params as Record<string, unknown>;

  if (typeof p.name !== "string" || p.name.length === 0) {
    return "params.name (tool name) is required";
  }

  return null; // valid
}

/**
 * Extract tool name from a valid tools/call JSON-RPC request.
 */
export function extractToolName(body: Record<string, unknown>): string {
  const params = body.params as Record<string, unknown>;
  return String(params.name ?? "unknown");
}

/**
 * Extract arguments from a valid tools/call JSON-RPC request.
 */
export function extractToolArgs(
  body: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const params = body.params as Record<string, unknown>;
  const args = params.arguments;
  if (typeof args === "object" && args !== null && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  return undefined;
}
