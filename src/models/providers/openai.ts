import OpenAI from "openai";
import { AsyncLocalStorage } from "async_hooks";
import type { ChatMessage } from "../../types/index.js";
import type { ModelProvider, ModelResponse, ToolCallParam, ToolParam } from "./base-provider.js";
import { config } from "../../config.js";

// ── TRST-2: Gateway Trace Headers (AsyncLocalStorage) ──────────────────────────
// Per-request gateway identity propagated via OpenAI SDK request options.
// Set by chat.ts at the start of each /api/chat request.

export interface GatewayTraceHeaders {
  traceId: string;
  sessionId: string;
  runId: string;
  agentId: string;
  [key: string]: string;
}

export const gatewayTraceStore = new AsyncLocalStorage<GatewayTraceHeaders>();

/**
 * Run a function with Gateway trace headers in AsyncLocalStorage.
 * When TRUSTOS_GATEWAY_URL is configured, callChat injects these headers.
 */
export function runWithGatewayTrace(
  headers: GatewayTraceHeaders | undefined,
  fn: () => any
): any {
  if (!headers) return fn();
  return gatewayTraceStore.run(headers, fn);
}

/**
 * TRST-2: Module-level fallback for Worker async boundary.
 *
 * ALS context does not reliably propagate through Worker setInterval → 
 * Promise.race → provider.chat in Node.js v24. This fallback allows the Worker
 * to set explicit trace headers before model calls, and callChat will pick them
 * up when gatewayTraceStore.getStore() returns undefined.
 *
 * Only stores IDs (traceId, sessionId, runId). No raw content.
 */
let _explicitGatewayTraceHeaders: GatewayTraceHeaders | undefined;

export function setExplicitGatewayTraceHeaders(
  headers: GatewayTraceHeaders | undefined
): void {
  _explicitGatewayTraceHeaders = headers;
}

// ── Default client ────────────────────────────────────────────────────────────

// 默认 client（使用环境变量配置）
const defaultClientOptions: ConstructorParameters<typeof OpenAI>[0] = {
  apiKey: config.openaiApiKey,
  timeout: 180_000, // 180s timeout（DeepSeek-V4-Flash/Qwen2.5-72B API 有时需要 120s+）
};

// TRST-2: When TRUSTOS_GATEWAY_URL is set, route through TrustOS Gateway.
// Gateway is an OpenAI-compatible proxy that captures model_call events.
if (config.trustosGatewayUrl) {
  defaultClientOptions.baseURL = `${config.trustosGatewayUrl}/v1`;
} else if (config.openaiBaseUrl) {
  defaultClientOptions.baseURL = config.openaiBaseUrl;
}

const defaultClient = new OpenAI(defaultClientOptions);

// 判断是否是 OpenAI 兼容的模型（支持 gpt- 前缀及第三方 provider/model 格式）
function isOpenAICompatible(model: string): boolean {
  if (model.startsWith("gpt-")) return true;
  if (model.startsWith("o1") || model.startsWith("o3")) return true;
  // 硅基流动 / 其他兼容平台格式：provider/model-name 或纯 model-name
  if (model.includes("/")) return true;
  // Ollama 本地模型格式：gemma4:e4b, qwen3:4b, deepseek-v3:671b 等
  if (model.includes(":")) return true;
  return false;
}

async function callChat(
  client: OpenAI,
  model: string,
  messages: ChatMessage[],
  tools?: ToolParam[]
): Promise<ModelResponse> {
  // TRST-2: Propagate Gateway trace headers for real caller correlation.
  // ALS-based context (primary) + module-level fallback for Worker async boundary.
  const storeVal = gatewayTraceStore.getStore();
  const rawHeaders = config.trustosGatewayUrl
    ? (storeVal ?? _explicitGatewayTraceHeaders as Record<string, string> | undefined)
    : undefined;

  // Resolve trace headers — supports both key conventions (traceId / X-TrustOS-Trace-Id)
  // for forward/backward compatibility across ALS and DB-stored paths.
  const resolveTrace = (h: Record<string, string>) => h.traceId ?? h["X-TrustOS-Trace-Id"];
  const resolveSession = (h: Record<string, string>) => h.sessionId ?? h["X-TrustOS-Session-Id"];
  const resolveRun = (h: Record<string, string>) => h.runId ?? h["X-TrustOS-Run-Id"];
  const resolveAgent = (h: Record<string, string>) => h.agentId ?? h["X-TrustOS-Agent-Id"];

  const traceId = rawHeaders ? resolveTrace(rawHeaders) : undefined;
  const sessionId = rawHeaders ? resolveSession(rawHeaders) : undefined;
  const runId = rawHeaders ? resolveRun(rawHeaders) : undefined;
  const agentId = rawHeaders ? resolveAgent(rawHeaders) : undefined;
  const hasGatewayTrace = !!(traceId && sessionId && runId);

  const response = await client.chat.completions.create(
    {
      model,
      messages: messages.map((m) => ({
        role: m.role as "system" | "user" | "assistant",
        content: m.content,
      })),
      temperature: 0.3,
      max_tokens: 4096,
      ...(tools ? { tools, tool_choice: "auto" } : {}),
    },
    hasGatewayTrace ? {
      headers: {
        "X-TrustOS-Trace-Id": traceId!,
        "X-TrustOS-Session-Id": sessionId!,
        "X-TrustOS-Run-Id": runId!,
        ...(agentId ? { "X-TrustOS-Agent-Id": agentId } : {}),
      },
    } : undefined
  );

  const choice = response.choices[0]?.message;

  const tool_calls: ToolCallParam[] | undefined = choice?.tool_calls?.map((tc, i) => ({
    index: i,
    id: tc.id,
    type: "function" as const,
    function: { name: tc.function.name, arguments: tc.function.arguments },
  }));

  return {
    content: choice?.content || "",
    input_tokens: response.usage?.prompt_tokens || 0,
    output_tokens: response.usage?.completion_tokens || 0,
    model: response.model,
    ...(tool_calls?.length ? { tool_calls } : {}),
  };
}

export const openaiProvider: ModelProvider = {
  name: "openai",
  supports(model: string): boolean {
    return isOpenAICompatible(model);
  },
  async chat(
    model: string,
    messages: ChatMessage[],
    tools?: ToolParam[]
  ): Promise<ModelResponse> {
    return callChat(defaultClient, model, messages, tools);
  },
};

/** 使用请求级自定义 apiKey / baseURL 调用，不影响全局 client */
export async function callOpenAIWithOptions(
  model: string,
  messages: ChatMessage[],
  apiKey: string,
  baseURL?: string,
  tools?: ToolParam[]
): Promise<ModelResponse> {
  const opts: ConstructorParameters<typeof OpenAI>[0] = { apiKey, timeout: 180_000 };
  // TRST-2: When Gateway is enabled, route through Gateway instead of custom baseURL
  if (config.trustosGatewayUrl) {
    opts.baseURL = `${config.trustosGatewayUrl}/v1`;
  } else if (baseURL) {
    opts.baseURL = baseURL;
  }
  const client = new OpenAI(opts);
  return callChat(client, model, messages, tools);
}
