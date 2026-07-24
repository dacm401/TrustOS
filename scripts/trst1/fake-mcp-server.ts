/**
 * TRST-1C Fake MCP HTTP JSON-RPC Server
 *
 * A minimal JSON-RPC 2.0 server for local validation of MCP passthrough.
 * Supports two tools: "echo" (returns received args) and "read_file"
 * (returns mock file content).
 *
 * Usage:
 *   npx tsx scripts/trst1/fake-mcp-server.ts
 *
 * Environment:
 *   TRUSTOS_FAKE_MCP_PORT — default: 8788
 */

import { createServer } from "node:http";

const PORT = parseInt(process.env.TRUSTOS_FAKE_MCP_PORT ?? "8788", 10);

function jsonRpcError(id: unknown, code: number, message: string) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message },
  };
}

function jsonRpcResult(id: unknown, result: unknown) {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function handleToolCall(
  name: string,
  args: Record<string, unknown> | undefined,
) {
  switch (name) {
    case "echo":
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ tool: "echo", received: args ?? {}, timestamp: Date.now() }),
          },
        ],
      };
    case "read_file":
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              tool: "read_file",
              path: args?.path ?? "unknown",
              content: "[mock file content for TRST-1C smoke validation]",
              line_count: 1,
            }),
          },
        ],
      };
    default:
      return null; // unknown tool
  }
}

const server = createServer((req, res) => {
  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        service: "trst1c-fake-mcp-server",
        tools: ["echo", "read_file"],
      }),
    );
    return;
  }

  // Only accept POST
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  // Read body
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
  });

  req.on("end", () => {
    let body: Record<string, unknown>;

    try {
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          jsonRpcError(null, -32700, "Parse error: invalid JSON"),
        ),
      );
      return;
    }

    // Validate JSON-RPC
    if (body.jsonrpc !== "2.0") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          jsonRpcError(
            body.id ?? null,
            -32600,
            "Invalid Request: jsonrpc must be 2.0",
          ),
        ),
      );
      return;
    }

    if (body.method !== "tools/call") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          jsonRpcError(
            body.id ?? null,
            -32601,
            `Method not found: ${String(body.method)}`,
          ),
        ),
      );
      return;
    }

    const params = body.params as Record<string, unknown> | undefined;
    const toolName = typeof params?.name === "string" ? params.name : "";
    const toolArgs =
      params?.arguments &&
      typeof params.arguments === "object" &&
      !Array.isArray(params.arguments)
        ? (params.arguments as Record<string, unknown>)
        : undefined;

    const result = handleToolCall(toolName, toolArgs);

    if (result === null) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          jsonRpcError(body.id, -32602, `Unknown tool: ${toolName}`),
        ),
      );
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(jsonRpcResult(body.id, result)));
  });
});

server.listen(PORT, () => {
  console.log(`\nTRST-1C Fake MCP JSON-RPC Server`);
  console.log(`  Listening: http://localhost:${PORT}`);
  console.log(`  Tools:     echo, read_file`);
  console.log(`\nReady. Press Ctrl+C to stop.\n`);
});
