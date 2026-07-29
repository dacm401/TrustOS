/**
 * TRST-1 OpenAI-Compatible Forwarder
 *
 * Forwards /v1/chat/completions requests to a configured upstream provider.
 * Shadow Mode: passthrough only — no blocking, no redaction, no modification.
 */

interface ForwardRequest {
  model: string;
  messages: unknown[];
  stream?: boolean;
  [key: string]: unknown;
}

interface ForwardResult {
  status: number;
  body: unknown;
  headers: Record<string, string>;
  /** Raw response for latency measurement */
  timing: {
    requestSentAt: number;
    responseReceivedAt: number;
  };
}

/**
 * Forward a chat completion request to the upstream provider.
 * Preserves all request fields; adds Authorization header.
 */
export async function forwardChatCompletion(
  upstreamBaseUrl: string,
  upstreamApiKey: string,
  body: ForwardRequest,
): Promise<ForwardResult> {
  const url = `${upstreamBaseUrl.replace(/\/$/, "")}/chat/completions`;
  const requestSentAt = Date.now();

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${upstreamApiKey}`,
    },
    body: JSON.stringify(body),
  });

  const responseReceivedAt = Date.now();

  // Collect response headers
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
 * Forward a streaming chat completion request to the upstream provider.
 * Returns the raw upstream Response for SSE passthrough.
 */
export async function forwardChatCompletionStream(
  upstreamBaseUrl: string,
  upstreamApiKey: string,
  body: ForwardRequest,
): Promise<Response> {
  const url = `${upstreamBaseUrl.replace(/\/$/, "")}/chat/completions`;
  body.stream = true;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${upstreamApiKey}`,
    },
    body: JSON.stringify(body),
  });

  return response;
}

/**
 * Check if the request has stream=true.
 */
export function isStreamRequest(body: ForwardRequest): boolean {
  return body.stream === true;
}

/**
 * Extract the model name from request body.
 */
export function extractModel(body: ForwardRequest): string {
  return body.model ?? "unknown";
}
