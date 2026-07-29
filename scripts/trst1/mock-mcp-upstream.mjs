/**
 * Mock MCP JSON-RPC upstream server for TRST-2B smoke testing.
 * Usage: node scripts/trst1/mock-mcp-upstream.mjs
 * Default port: 9797 (override with PORT env)
 */

import { createServer } from "node:http";

const PORT = parseInt(process.env.PORT ?? "9797", 10);

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    let request;
    try {
      request = JSON.parse(body);
    } catch {
      res.writeHead(400);
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }));
      return;
    }

    const { method, params, id } = request;

    switch (method) {
      case "initialize":
        res.writeHead(200);
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            serverInfo: { name: "Mock MCP Server", version: "0.1.0" },
            capabilities: { tools: {}, resources: {}, prompts: {} },
          },
        }));
        break;

      case "notifications/initialized":
        res.writeHead(200);
        res.end(JSON.stringify({ jsonrpc: "2.0", id }));
        break;

      case "tools/list":
        res.writeHead(200);
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: {
            tools: [
              { name: "echo", description: "Echo back the input", inputSchema: { type: "object", properties: { message: { type: "string" } } } },
              { name: "add", description: "Add two numbers", inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } } } },
            ],
          },
        }));
        break;

      case "tools/call":
        if (params?.name === "echo") {
          res.writeHead(200);
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: `Echo: ${params.arguments?.message ?? "(empty)"}` }] },
          }));
        } else if (params?.name === "add") {
          const { a, b } = params.arguments ?? {};
          res.writeHead(200);
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: String((a ?? 0) + (b ?? 0)) }] },
          }));
        } else {
          res.writeHead(200);
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: `Unknown tool: ${params?.name}` },
          }));
        }
        break;

      case "resources/list":
        res.writeHead(200);
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: { resources: [{ uri: "mock://hello", name: "Hello", mimeType: "text/plain" }] },
        }));
        break;

      case "resources/read":
        res.writeHead(200);
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: { contents: [{ uri: params?.uri ?? "mock://hello", mimeType: "text/plain", text: "Hello from mock MCP!" }] },
        }));
        break;

      case "prompts/list":
        res.writeHead(200);
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: { prompts: [{ name: "greet", description: "A greeting prompt" }] },
        }));
        break;

      case "prompts/get":
        res.writeHead(200);
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: { messages: [{ role: "user", content: { type: "text", text: "Hello!" } }] },
        }));
        break;

      default:
        res.writeHead(404);
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`Mock MCP upstream listening on http://localhost:${PORT}`);
  // Signal ready to parent via stdout
  if (process.send) process.send({ ready: true, port: PORT });
});
