/**
 * TRST-2C Final Validation — uses .env directly, starts gateway, validates BP2.
 * Clean, minimal, no URL construction issues.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createGatewayApp } from "../../src/services/trst1/llm-gateway-server.js";
import { initEventStore, readEvents } from "../../src/services/trst1/jsonl-event-store.js";
import { ModelRegistry } from "../../src/services/trst1/model-registry.js";

const BASE_URL = "https://api.siliconflow.cn/v1";

// Read API key from .env (no dotenv package)
function loadApiKey(): string {
  try {
    const envContent = readFileSync(".env", "utf8");
    const match = envContent.match(/OPENAI_API_KEY\s*=\s*(.+)/);
    return match?.[1]?.trim() ?? "";
  } catch {
    return "";
  }
}
const API_KEY = process.env.OPENAI_API_KEY?.trim() || loadApiKey();

if (!API_KEY) {
  console.error("ERROR: OPENAI_API_KEY required in .env or env");
  process.exit(1);
}

const PORT = 8900;

console.log("TRST-2C Final Validation\n");
console.log("Base:", BASE_URL);
console.log("Key:", API_KEY.slice(0, 8) + "...");
console.log("Port:", PORT);
console.log();

initEventStore(".trustos/events.jsonl");

const registry = new ModelRegistry({
  providers: { default: { name: "SiliconFlow", baseUrl: BASE_URL, apiKey: API_KEY } },
  routing: [{ pattern: "*", provider: "default" }],
  defaultProvider: "default",
});

const honoApp = createGatewayApp({ modelRegistry: registry, projectId: "trst2c-final" });

// Start HTTP server
const server = createServer(async (req, res) => {
  const host = req.headers.host ?? `localhost:${PORT}`;
  const url = `http://${host}${req.url}`;
  const headers = new Headers();
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    headers.set(req.rawHeaders[i], req.rawHeaders[i + 1]);
  }

  let bodyStr: string | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c);
    bodyStr = Buffer.concat(chunks).toString();
  }

  const webReq = new Request(url, {
    method: req.method ?? "GET",
    headers,
    body: bodyStr,
  });

  const webRes = await honoApp.fetch(webReq);
  res.writeHead(webRes.status, Object.fromEntries(webRes.headers.entries()));
  res.end(await webRes.text());
});

// Start
await new Promise<void>((resolve) => server.listen(PORT, resolve));

// Health check
const hc = await fetch(`http://localhost:${PORT}/health`);
console.log("Health:", hc.status, await hc.text().then(x => x.slice(0, 80)));

// Test 1: Non-streaming chat
console.log("\n[Test 1] Non-streaming chat (real upstream)...");
const r1 = await fetch(`http://localhost:${PORT}/v1/chat/completions`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-TrustOS-Agent-Id": "validate" },
  body: JSON.stringify({
    model: "deepseek-ai/DeepSeek-V4-Flash",
    messages: [{ role: "user", content: "Say hello in exactly 5 words." }],
    stream: false,
    max_tokens: 50,
  }),
});
console.log("HTTP:", r1.status);
console.log("Trace:", r1.headers.get("x-trustos-trace-id"));
const r1t = await r1.text();
console.log("Body:", r1t.slice(0, 100));

await new Promise(r => setTimeout(r, 500));

// Inspect
const events = readEvents(5);
const ev = events[events.length - 1];
console.log("\n[Inspect] Last event:");
console.log("  status:", ev.status);
console.log("  event_type:", ev.event_type);
console.log("  output_hash:", ev.output_hash ?? "MISSING");
console.log("  input_hash:", (ev.input_hash as string)?.slice(0, 40) ?? "MISSING");
console.log("  event_hash:", typeof ev.event_hash === "string" ? "OK" : "MISSING");
console.log("  agent_id:", ev.agent_id);

const ok = r1.status >= 200 && r1.status < 300;
const hasOH = typeof ev.output_hash === "string" && /^[a-f0-9]{64}$/.test(ev.output_hash);
const hasIH = typeof ev.input_hash === "string" && ev.input_hash.length > 0;
const hasEH = typeof ev.event_hash === "string" && ev.event_hash.length > 0;

console.log("\nResults:");
console.log("  Upstream OK:", ok ? "PASS" : "FAIL");
console.log("  output_hash:", hasOH ? "PASS" : "FAIL");
console.log("  input_hash:", hasIH ? "PASS" : "FAIL");
console.log("  event_hash:", hasEH ? "PASS" : "FAIL");
console.log("  BP4 agent:", ev.agent_id === "validate" || ev.agent_id === "direct-gateway-call" ? "PASS" : "FAIL (" + ev.agent_id + ")");

const allPass = ok && hasOH && hasIH && hasEH;
console.log("\n" + (allPass ? "ALL PASS" : "SOME FAIL"));

server.close();
process.exit(allPass ? 0 : 1);
