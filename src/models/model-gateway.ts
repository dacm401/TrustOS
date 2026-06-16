import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage } from "../types/index.js";
import type { ModelProvider, ModelResponse, ToolParam } from "./providers/base-provider.js";
import type { LlmCallKind } from "../types/runtime-trace.js";
import { openaiProvider } from "./providers/openai.js";
import { callOpenAIWithOptions as _callOpenAIWithOptions } from "./providers/openai.js";
import { anthropicProvider } from "./providers/anthropic.js";
import { getRequestTrace, recordLlmCall } from "../services/runtime-trace.js";
import { config } from "../config.js";

const providers: ModelProvider[] = [openaiProvider, anthropicProvider];

// ── Mock LLM (TRUSTOS_E2E_MOCK_LLM=true) ─────────────────────────────────────
//
// 用于 E2E runtime 验证，不依赖真实 SiliconFlow/OpenAI API。
// 完全绕过网络调用，但 Budget Preflight / Ledger / SSE done.budget 均走真实代码路径。
//
// 开关：TRUSTOS_E2E_MOCK_LLM=true（生产环境无此变量，完全不生效）
// 默认 false。

const MOCK_LLM_ENABLED = process.env.TRUSTOS_E2E_MOCK_LLM === "true";

if (MOCK_LLM_ENABLED) {
  console.warn("[mock-llm] TRUSTOS_E2E_MOCK_LLM=true — all LLM calls will return mock responses. DO NOT use in production.");
}

// S92P-HF2: 诊断日志 — 记录 mock flag 启动状态，用于确认 Docker 容器内环境变量是否生效
// 只打印 true/false，不打印 secrets。
console.log(`[model-gateway] TRUSTOS_E2E_MOCK_LLM=${String(MOCK_LLM_ENABLED)}`);
console.log(`[model-gateway] fastModel=${config.fastModel} slowModel=${config.slowModel}`);

/**
 * 根据对话最后一条用户消息选取 mock 回复。
 * 判断顺序：revision/patch → create artifact → manager decision → generic。
 */
function getMockResponse(messages: ChatMessage[], isManagerRole: boolean, llmCallKind?: string): string {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const content = (lastUser?.content ?? "").toLowerCase();

  // S92P-HF1: Manager Synthesis 路径 — 返回自然语言合成文本，而非 ManagerDecision JSON
  // 这防止内部协议 JSON 通过 SSE chunk 泄漏到前端
  if (llmCallKind === "manager_synthesis") {
    // 从 messages 中提取用户原始问题，生成更相关的 mock 合成文本
    const userMsg = [...messages].reverse().find((m) => m.role === "user");
    const userInput = userMsg?.content ?? "";
    // 尝试从 "用户原始问题：..." 格式中提取原始问题
    const origMatch = userInput.match(/用户原始问题[：:]\s*(.+?)(?:\n|$)/);
    const origQuestion = origMatch ? origMatch[1] : userInput.substring(0, 100);
    return `已完成任务分析。针对"${origQuestion}"的需求，我为您准备了相应的内容。您可以在结果中查看完整的实现，包括代码示例和详细说明。如有需要调整的地方，请随时告诉我。`;
  }

  // Manager 路径：返回 ManagerDecision JSON (manager_decision_v1 格式，带 schema_version)
  if (isManagerRole) {
    // S92P-HF2: 判断是否包含代码/网页生成意图（创建 artifact）
    // 检测逻辑分两层：
    //   1) ASCII 关键词（create/make/code/page/html/register）— 不受编码影响
    //   2) 中文关键词（写/创建/生成/网页/页面/代码/注册）— Docker 环境下可能因编码被损坏为 ?
    //   3) Heuristic: 如果 content 长度 > 10 且全为 ? (ASCII 63)，判定为编码损坏 → 默认当作 code gen
    const isCodeGen = content.includes("写") || content.includes("创建") || content.includes("生成") || content.includes("create") || content.includes("make") || content.includes("网页") || content.includes("页面") || content.includes("代码") || content.includes("code") || content.includes("page") || content.includes("html") || content.includes("注册") || content.includes("register");
    // Heuristic: 检测编码损坏 — 如果 content 长于 4 字符且全是 ? (ASCII 63)，说明中文被损坏
    // Docker 容器在某些 locale 配置下可能导致 HTTP JSON body 中的中文变成 ?
    const looksLikeGarbled = content.length >= 4 && [...content].every((c) => c.charCodeAt(0) === 63);
    // 编码损坏时无法用关键词判断，用长度推断意图：
    //   短输入（≤8 字）→ 大概率是闲聊/天气/简单问答 → 不触发 code gen
    //   长输入（>8 字）→ 大概率是任务/代码生成 → 触发 execute_task
    const effectiveCodeGen = isCodeGen || (looksLikeGarbled && content.length > 8);

    if (content.includes("注册") || content.includes("register")) {
      return JSON.stringify({
        schema_version: "manager_decision_v1",
        decision_type: "execute_task",
        scores: { direct_answer: 0.05, ask_clarification: 0.02, delegate_to_slow: 0.88, execute_task: 0.05 },
        confidence_hint: 0.92,
        features: { missing_info: false, needs_long_reasoning: false, needs_external_tool: false, high_risk_action: false, query_too_vague: false, requires_multi_step: false, is_continuation: false },
        command: {
          task_description: "Create a React register page with username, password, email, and submit button.",
          artifact_type: "code",
          tech_stack: ["react", "typescript"],
        },
      });
    }
    if (content.includes("蓝") || content.includes("blue") || content.includes("标题") || content.includes("title")) {
      return JSON.stringify({
        schema_version: "manager_decision_v1",
        decision_type: "execute_task",
        scores: { direct_answer: 0.05, ask_clarification: 0.02, delegate_to_slow: 0.90, execute_task: 0.03 },
        confidence_hint: 0.95,
        features: { missing_info: false, needs_long_reasoning: false, needs_external_tool: false, high_risk_action: false, query_too_vague: false, requires_multi_step: false, is_continuation: true },
        command: {
          task_description: content.includes("标题") || content.includes("title")
            ? "Make the title text larger (e.g. change text-xl to text-3xl)."
            : "Change the button color to blue (e.g. className bg-blue-500).",
          artifact_type: "code",
          tech_stack: ["react", "typescript"],
        },
      });
    }
    // 代码生成意图（含编码损坏时的长度推断）
    if (effectiveCodeGen) {
      // 代码生成意图 → execute_task
      return JSON.stringify({
        schema_version: "manager_decision_v1",
        decision_type: "execute_task",
        scores: { direct_answer: 0.05, ask_clarification: 0.02, delegate_to_slow: 0.88, execute_task: 0.05 },
        confidence_hint: 0.93,
        features: { missing_info: false, needs_long_reasoning: false, needs_external_tool: false, high_risk_action: false, query_too_vague: false, requires_multi_step: false, is_continuation: false },
        command: {
          task_description: `[mock] ${lastUser?.content?.substring(0, 80) ?? "User request"}`,
          artifact_type: "code",
          tech_stack: ["html", "css", "javascript"],
        },
      });
    }
    // Default: 普通问答 → direct_answer
    return JSON.stringify({
      schema_version: "manager_decision_v1",
      decision_type: "direct_answer",
      scores: { direct_answer: 0.90, ask_clarification: 0.05, delegate_to_slow: 0.03, execute_task: 0.02 },
      confidence_hint: 0.95,
      features: { missing_info: false, needs_long_reasoning: false, needs_external_tool: false, high_risk_action: false, query_too_vague: false, requires_multi_step: false, is_continuation: false },
    });
  }

  // Worker 路径：返回 React 组件代码
  // S92P-HF2: 只有 login/register 返回 LoginPage；其他意图返回主题感知页面
  if (content.includes("注册") || content.includes("register") || content.includes("登录") || content.includes("login") || content.includes("signup") || content.includes("signin")) {
    return `import React, { useState } from 'react';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password || !email) { setError('All fields required'); return; }
    setError('');
    console.log('Register:', { username, email });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md p-8 bg-white rounded-xl shadow">
        <h1 className="text-2xl font-bold mb-6 text-center">Create Account</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input className="w-full border rounded px-3 py-2" placeholder="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
          <input className="w-full border rounded px-3 py-2" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} />
          <input className="w-full border rounded px-3 py-2" placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} />
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button className="w-full bg-blue-500 text-white py-2 rounded hover:bg-blue-600" type="submit">Register</button>
        </form>
      </div>
    </div>
  );
}`;
  }

  // S92P-HF2: "标题"/"title" 是 continuation/edit 请求，不是 LoginPage
  // 返回一个表示修改的通用页面
  if (content.includes("标题") || content.includes("title")) {
    const topic = extractTopic(lastUser?.content ?? "Page Title Update");
    return `import React from 'react';

export default function UpdatedPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 p-8">
      <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-lg p-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-4">${escapeHtml(topic)} — Updated</h1>
        <p className="text-gray-600 mb-6 leading-relaxed">
          标题已根据您的反馈更新为更大字号。页面其他内容保持不变。
        </p>
        <section className="bg-gray-50 rounded-xl p-6">
          <h2 className="text-xl font-semibold text-gray-700 mb-2">修改摘要</h2>
          <p className="text-gray-600">标题字号已从 text-xl 调整为 text-3xl。</p>
        </section>
      </div>
    </main>
  );
}`;
  }

  // S92P-HF2: "蓝"/"blue" 是颜色修改请求，不是 LoginPage
  if (content.includes("蓝") || content.includes("blue")) {
    return `import React from 'react';

export default function BlueThemedPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-400 to-blue-600 p-8">
      <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-lg p-8">
        <h1 className="text-3xl font-bold text-blue-700 mb-4">蓝色主题页面</h1>
        <p className="text-blue-600 mb-6 leading-relaxed">
          按钮颜色已更新为蓝色（bg-blue-500）。页面采用蓝色渐变背景。
        </p>
        <div className="flex gap-4">
          <button className="bg-blue-500 text-white px-6 py-3 rounded-lg hover:bg-blue-600 transition-colors">
            Blue Button
          </button>
          <button className="bg-blue-300 text-blue-900 px-6 py-3 rounded-lg hover:bg-blue-400 transition-colors">
            Light Blue
          </button>
        </div>
      </div>
    </main>
  );
}`;
  }

  // Default: 从 user prompt 提取主题，生成匹配的 mock 页面
  // 提取用户原始输入中的主题词（取任务描述中的关键部分）
  const topic = extractTopic(lastUser?.content ?? "Demo Page");
  return `import React from 'react';

export default function TopicPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-lg p-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-4">${escapeHtml(topic)}</h1>
        <p className="text-gray-600 mb-6 leading-relaxed">
          这是一个关于 <strong>${escapeHtml(topic)}</strong> 的演示页面。在实际环境中，AI 会生成完整的内容和交互组件。
        </p>
        <section className="bg-gray-50 rounded-xl p-6 mb-4">
          <h2 className="text-xl font-semibold text-gray-700 mb-2">概述</h2>
          <p className="text-gray-600">这里将展示 ${escapeHtml(topic)} 的核心概念和详细说明。</p>
        </section>
        <section className="bg-gray-50 rounded-xl p-6 mb-4">
          <h2 className="text-xl font-semibold text-gray-700 mb-2">详情</h2>
          <p className="text-gray-600">这部分包含 ${escapeHtml(topic)} 的技术细节和示例。</p>
        </section>
        <section className="bg-gray-50 rounded-xl p-6">
          <h2 className="text-xl font-semibold text-gray-700 mb-2">总结</h2>
          <p className="text-gray-600">以上是 ${escapeHtml(topic)} 的主要内容。在实际部署中，此处会有完整的科普内容。</p>
        </section>
        <footer className="mt-8 pt-4 border-t border-gray-200 text-center text-sm text-gray-400">
          Mock 页面 — 主题：${escapeHtml(topic)}
        </footer>
      </div>
    </main>
  );
}`;
}

/**
 * 从用户输入中提取主题词，用于 Worker mock 默认页面。
 * 移除常见的请求前缀/后缀，返回精简的主题描述。
 */
function extractTopic(rawContent: string): string {
  // 检测编码损坏（全部是 ? ASCII 63）
  const allQuestionMarks = rawContent.length > 5 && [...rawContent].every((c) => c.charCodeAt(0) === 63);
  if (allQuestionMarks) return "Demo Page";
  // 去掉常见前缀
  let topic = rawContent
    .replace(/^(帮我|请|请帮我|帮我写一个?|写一个?|创建一个?|生成一个?|做一个?|弄一个?)\s*/i, "")
    .replace(/\s*(的科普网页|的网页|网页|页面|代码|的代码|组件|的组件|网站|的网站|的)\s*$/i, "")
    .trim();
  // 如果去掉后为空，用原内容
  if (!topic || topic.length < 2) topic = rawContent.trim();
  // 截断过长内容
  if (topic.length > 60) topic = topic.substring(0, 57) + "...";
  return topic || "Demo Page";
}

/**
 * 简易 HTML 转义，防止 mock 输出中的用户内容破坏 JSX。
 */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

/**
 * Mock ModelResponse — 用于 E2E runtime 验证。
 * 模拟真实 token 数量（非 0）确保 pricing 计算有效。
 */
function buildMockModelResponse(messages: ChatMessage[], isManagerRole: boolean, model: string, llmCallKind?: string): ModelResponse {
  const content = getMockResponse(messages, isManagerRole, llmCallKind);
  // 模拟合理的 token 计数（约 300 input + 400 output）
  return {
    content,
    input_tokens: 312,
    output_tokens: 428,
    model,
  };
}

export async function callModel(
  model: string,
  messages: ChatMessage[],
  llmCallKind?: LlmCallKind
): Promise<string> {
  const response = await callModelFull(model, messages, undefined, llmCallKind);
  return response.content;
}

export async function callModelFull(
  model: string,
  messages: ChatMessage[],
  tools?: ToolParam[],
  llmCallKind?: LlmCallKind
): Promise<ModelResponse> {
  // S86P: Record LLM call if trace context is active
  const trace = getRequestTrace();
  const startedAt = Date.now();

  // Mock LLM intercept (TRUSTOS_E2E_MOCK_LLM=true)
  if (MOCK_LLM_ENABLED) {
    const isManager = model === config.fastModel;
    console.log(`[mock-llm] callModelFull intercepted: model=${model} isManager=${isManager} kind=${llmCallKind ?? "none"}`);
    const mockResp = buildMockModelResponse(messages, isManager, model, llmCallKind);
    // Record mock call too (for E2E test observability)
    recordLlmCall(llmCallKind ?? "unknown", model, startedAt, Date.now(), true);
    return mockResp;
  }
  const provider = providers.find((p) => p.supports(model));
  if (!provider) {
    recordLlmCall(llmCallKind ?? "unknown", model, startedAt, Date.now(), false, "no_provider");
    throw new Error(`No provider found for model: ${model}`);
  }
  // S92P-HF2: 如果 mock 模式开启但执行到此处，说明有 bypass bug
  // 此时拒绝真实调用，避免泄漏真实 API 请求。
  if (MOCK_LLM_ENABLED) {
    recordLlmCall(llmCallKind ?? "unknown", model, startedAt, Date.now(), false, "mock_bypass_blocked");
    throw new Error(`[mock-llm] BLOCKED external provider call for ${model} — MOCK_LLM_ENABLED is true but mock gate was bypassed`);
  }
  try {
    const response = await provider.chat(model, messages, tools);
    recordLlmCall(llmCallKind ?? "unknown", model, startedAt, Date.now(), true);
    return response;
  } catch (error: any) {
    const errorCode = error?.status ? `http_${error.status}` : (error?.name === "AbortError" ? "timeout" : "provider_error");
    recordLlmCall(llmCallKind ?? "unknown", model, startedAt, Date.now(), false, errorCode);
    console.error(`Model call failed [${model}]:`, error.message);
    throw error;
  }
}

/**
 * Call the model with Function Calling tools enabled.
 * Returns the full ModelResponse (may contain tool_calls).
 */
export async function callModelWithTools(
  model: string,
  messages: ChatMessage[],
  tools: ToolParam[],
  llmCallKind?: LlmCallKind
): Promise<ModelResponse> {
  // S86P: Record LLM call if trace context is active
  const startedAt = Date.now();

  // Mock LLM intercept (TRUSTOS_E2E_MOCK_LLM=true)
  if (MOCK_LLM_ENABLED) {
    const isManager = model === config.fastModel;
    console.log(`[mock-llm] callModelWithTools intercepted: model=${model} isManager=${isManager} kind=${llmCallKind ?? "none"}`);
    const mockResp = buildMockModelResponse(messages, isManager, model, llmCallKind);
    recordLlmCall(llmCallKind ?? "unknown", model, startedAt, Date.now(), true);
    return mockResp;
  }
  const provider = providers.find((p) => p.supports(model));
  if (!provider) {
    recordLlmCall(llmCallKind ?? "unknown", model, startedAt, Date.now(), false, "no_provider");
    throw new Error(`No provider found for model: ${model}`);
  }
  // S92P-HF2: mock bypass guard (same as callModelFull)
  if (MOCK_LLM_ENABLED) {
    recordLlmCall(llmCallKind ?? "unknown", model, startedAt, Date.now(), false, "mock_bypass_blocked");
    throw new Error(`[mock-llm] BLOCKED external provider call for ${model} (callModelWithTools) — mock gate was bypassed`);
  }
  try {
    const response = await provider.chat(model, messages, tools);
    recordLlmCall(llmCallKind ?? "unknown", model, startedAt, Date.now(), true);
    return response;
  } catch (error: any) {
    const errorCode = error?.status ? `http_${error.status}` : (error?.name === "AbortError" ? "timeout" : "provider_error");
    recordLlmCall(llmCallKind ?? "unknown", model, startedAt, Date.now(), false, errorCode);
    console.error(`Model call failed with tools [${model}]:`, error.message);
    throw error;
  }
}

export function getAvailableModels(): string[] {
  const configured = [config.fastModel, config.slowModel, config.compressorModel];
  const hardcoded = ["gpt-4o-mini", "gpt-4o", "claude-3-5-haiku-20241022", "claude-3-5-sonnet-20241022"];
  return [...new Set([...configured, ...hardcoded])];
}

// ── S86P: Traced callOpenAIWithOptions wrapper ───────────────────────────────
// callOpenAIWithOptions bypasses callModelFull (and thus the standard S86P counter).
// This wrapper adds trace recording so auth override paths are counted.

/**
 * S86P: Traced version of callOpenAIWithOptions.
 * Records the LLM call to the current trace context (if any), then delegates to
 * the underlying callOpenAIWithOptions.
 * 
 * Use this in auth-override paths (e.g., custom API key / base URL) to ensure
 * those calls are counted in RuntimeTrace.llmCalls.
 */
export async function callOpenAIWithOptionsTraced(
  model: string,
  messages: ChatMessage[],
  apiKey: string,
  baseURL?: string,
  tools?: ToolParam[],
  llmCallKind: LlmCallKind = "unknown",
): Promise<ModelResponse> {
  const startedAt = Date.now();

  // Mock LLM intercept (TRUSTOS_E2E_MOCK_LLM=true)
  // Auth override 路径（callOpenAIWithOptionsTraced）也需要 mock 拦截，
  // 否则 _callFastModel 的 hasAuthOverride 分支会绕过 mock 调真实 API。
  if (MOCK_LLM_ENABLED) {
    const isManager = model === config.fastModel;
    console.log(`[mock-llm] callOpenAIWithOptionsTraced intercepted: model=${model} isManager=${isManager} kind=${llmCallKind ?? "none"}`);
    const mockResp = buildMockModelResponse(messages, isManager, model, llmCallKind);
    recordLlmCall(llmCallKind ?? "unknown", model, startedAt, Date.now(), true);
    return mockResp;
  }

  // S92P-HF2: mock bypass guard (same pattern)
  if (MOCK_LLM_ENABLED) {
    recordLlmCall(llmCallKind, model, startedAt, Date.now(), false, "mock_bypass_blocked");
    throw new Error(`[mock-llm] BLOCKED external provider call for ${model} (callOpenAIWithOptionsTraced) — mock gate was bypassed`);
  }

  try {
    const resp = await _callOpenAIWithOptions(model, messages, apiKey, baseURL, tools);
    recordLlmCall(llmCallKind, model, startedAt, Date.now(), true);
    return resp;
  } catch (err: any) {
    const errorCode = err?.status ? `http_${err.status}` : (err?.name === "AbortError" ? "timeout" : "provider_error");
    recordLlmCall(llmCallKind, model, startedAt, Date.now(), false, errorCode);
    throw err;
  }
}

// Re-export callOpenAIWithOptions from the OpenAI provider for use by other modules
export { callOpenAIWithOptions } from "./providers/openai.js";

/**
 * Streaming model call — yields content chunks as they arrive from the provider.
 * OpenAI-compatible models use the OpenAI streaming API.
 * Anthropic (claude-*) models use the Anthropic streaming API.
 *
 * Usage:
 *   for await (const chunk of callModelStream(model, messages)) {
 *     // chunk is a string (may be empty string for empty deltas)
 *   }
 */
export async function* callModelStream(
  model: string,
  messages: ChatMessage[],
  reqApiKey?: string,
  llmCallKind?: LlmCallKind
): AsyncGenerator<string> {
  const startedAt = Date.now();

  // Mock LLM intercept (TRUSTOS_E2E_MOCK_LLM=true)
  if (MOCK_LLM_ENABLED) {
    const isManager = model === config.fastModel;
    console.log(`[mock-llm] callModelStream intercepted: model=${model} isManager=${isManager} kind=${llmCallKind ?? "none"}`);
    const mockContent = getMockResponse(messages, isManager, llmCallKind);
    // 分块 yield，模拟真实 streaming（每 50 字符一块）
    const chunkSize = 50;
    for (let i = 0; i < mockContent.length; i += chunkSize) {
      yield mockContent.slice(i, i + chunkSize);
    }
    recordLlmCall(llmCallKind ?? "unknown", model, startedAt, Date.now(), true);
    return;
  }

  // S92P-HF2: mock bypass guard
  if (MOCK_LLM_ENABLED) {
    recordLlmCall(llmCallKind ?? "unknown", model, startedAt, Date.now(), false, "mock_bypass_blocked");
    throw new Error(`[mock-llm] BLOCKED external provider call for ${model} (callModelStream) — mock gate was bypassed`);
  }

  if (model.startsWith("claude-")) {
    // Anthropic streaming path
    const anthropicClient = new Anthropic({ apiKey: config.anthropicApiKey });
    const systemMsg = messages.find((m) => m.role === "system");
    const nonSystemMsgs = messages.filter((m) => m.role !== "system");

    try {
      const stream = anthropicClient.messages.stream({
        model,
        max_tokens: 4096,
        system: systemMsg?.content || "",
        messages: nonSystemMsgs.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      });

      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          yield event.delta.text;
        }
      }
      recordLlmCall(llmCallKind ?? "unknown", model, startedAt, Date.now(), true);
    } catch (err: any) {
      recordLlmCall(llmCallKind ?? "unknown", model, startedAt, Date.now(), false, "stream_error");
      throw err;
    }
  } else {
    // OpenAI-compatible streaming path (gpt-*, o1, o3, provider/model, etc.)
    const clientOptions: ConstructorParameters<typeof OpenAI>[0] = {
      apiKey: reqApiKey || config.openaiApiKey,
    };
    if (!reqApiKey && config.openaiBaseUrl) {
      clientOptions.baseURL = config.openaiBaseUrl;
    } else if (reqApiKey && config.openaiBaseUrl) {
      // When using a custom key, still use the configured base URL
      // (e.g. SiliconFlow gateway). Only override if key is from the same gateway.
      clientOptions.baseURL = config.openaiBaseUrl;
    }
    const openaiClient = new OpenAI(clientOptions);

    try {
      const stream = await openaiClient.chat.completions.create({
        model,
        messages: messages.map((m) => ({
          role: m.role as "system" | "user" | "assistant",
          content: m.content,
        })),
        temperature: 0.3,
        max_tokens: 4096,
        stream: true,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) yield delta;
      }
      recordLlmCall(llmCallKind ?? "unknown", model, startedAt, Date.now(), true);
    } catch (err: any) {
      recordLlmCall(llmCallKind ?? "unknown", model, startedAt, Date.now(), false, "stream_error");
      throw err;
    }
  }
}
