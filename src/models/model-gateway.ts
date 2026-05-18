import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage } from "../types/index.js";
import type { ModelProvider, ModelResponse, ToolParam } from "./providers/base-provider.js";
import { openaiProvider } from "./providers/openai.js";
import { anthropicProvider } from "./providers/anthropic.js";
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

/**
 * 根据对话最后一条用户消息选取 mock 回复。
 * 判断顺序：revision/patch → create artifact → manager decision → generic。
 */
function getMockResponse(messages: ChatMessage[], isManagerRole: boolean): string {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const content = (lastUser?.content ?? "").toLowerCase();

  // Manager 路径：返回 ManagerDecision JSON
  if (isManagerRole) {
    if (content.includes("注册") || content.includes("register")) {
      return JSON.stringify({
        decision_type: "execute_task",
        confidence: 0.92,
        reasoning: "[mock] New artifact request: register page",
        direct_response: null,
        clarify_question: null,
        command: {
          task_description: "Create a React register page with username, password, email, and submit button.",
          artifact_type: "code",
          tech_stack: ["react", "typescript"],
        },
      });
    }
    if (content.includes("蓝") || content.includes("blue") || content.includes("标题") || content.includes("title")) {
      return JSON.stringify({
        decision_type: "execute_task",
        confidence: 0.95,
        reasoning: "[mock] Artifact revision request detected",
        direct_response: null,
        clarify_question: null,
        command: {
          task_description: content.includes("标题") || content.includes("title")
            ? "Make the title text larger (e.g. change text-xl to text-3xl)."
            : "Change the button color to blue (e.g. className bg-blue-500).",
          artifact_type: "code",
          tech_stack: ["react", "typescript"],
        },
      });
    }
    // Default manager: create login page
    return JSON.stringify({
      decision_type: "execute_task",
      confidence: 0.93,
      reasoning: "[mock] Artifact creation request detected",
      direct_response: null,
      clarify_question: null,
      command: {
        task_description: "Create a React login page with username, password, validation, and submit button.",
        artifact_type: "code",
        tech_stack: ["react", "typescript"],
      },
    });
  }

  // Worker 路径：返回 React 组件代码
  if (content.includes("注册") || content.includes("register")) {
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

  if (content.includes("标题") || content.includes("title")) {
    return `import React, { useState } from 'react';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) { setError('Username and password required'); return; }
    setError('');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md p-8 bg-white rounded-xl shadow">
        <h1 className="text-3xl font-bold mb-6 text-center">Login</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input className="w-full border rounded px-3 py-2" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} />
          <input className="w-full border rounded px-3 py-2" placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} />
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button className="w-full bg-blue-500 text-white py-2 rounded hover:bg-blue-600" type="submit">Login</button>
        </form>
      </div>
    </div>
  );
}`;
  }

  if (content.includes("蓝") || content.includes("blue")) {
    return `import React, { useState } from 'react';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) { setError('Username and password required'); return; }
    setError('');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md p-8 bg-white rounded-xl shadow">
        <h1 className="text-xl font-bold mb-6 text-center">Login</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input className="w-full border rounded px-3 py-2" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} />
          <input className="w-full border rounded px-3 py-2" placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} />
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button className="w-full bg-blue-500 text-white py-2 rounded hover:bg-blue-600" type="submit">Login</button>
        </form>
      </div>
    </div>
  );
}`;
  }

  // Default: login page
  return `import React, { useState } from 'react';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) { setError('Username and password required'); return; }
    setError('');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md p-8 bg-white rounded-xl shadow">
        <h1 className="text-xl font-bold mb-6 text-center">Login</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input className="w-full border rounded px-3 py-2" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} />
          <input className="w-full border rounded px-3 py-2" placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} />
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button className="w-full bg-green-500 text-white py-2 rounded hover:bg-green-600" type="submit">Login</button>
        </form>
      </div>
    </div>
  );
}`;
}

/**
 * Mock ModelResponse — 用于 E2E runtime 验证。
 * 模拟真实 token 数量（非 0）确保 pricing 计算有效。
 */
function buildMockModelResponse(messages: ChatMessage[], isManagerRole: boolean, model: string): ModelResponse {
  const content = getMockResponse(messages, isManagerRole);
  // 模拟合理的 token 计数（约 300 input + 400 output）
  return {
    content,
    input_tokens: 312,
    output_tokens: 428,
    model,
  };
}

export async function callModel(model: string, messages: ChatMessage[]): Promise<string> {
  const response = await callModelFull(model, messages);
  return response.content;
}

export async function callModelFull(
  model: string,
  messages: ChatMessage[],
  tools?: ToolParam[]
): Promise<ModelResponse> {
  // Mock LLM intercept (TRUSTOS_E2E_MOCK_LLM=true)
  if (MOCK_LLM_ENABLED) {
    const isManager = model === config.fastModel;
    console.log(`[mock-llm] callModelFull intercepted: model=${model} isManager=${isManager}`);
    return buildMockModelResponse(messages, isManager, model);
  }
  const provider = providers.find((p) => p.supports(model));
  if (!provider) throw new Error(`No provider found for model: ${model}`);
  try { return await provider.chat(model, messages, tools); }
  catch (error: any) { console.error(`Model call failed [${model}]:`, error.message); throw error; }
}

/**
 * Call the model with Function Calling tools enabled.
 * Returns the full ModelResponse (may contain tool_calls).
 */
export async function callModelWithTools(
  model: string,
  messages: ChatMessage[],
  tools: ToolParam[]
): Promise<ModelResponse> {
  // Mock LLM intercept (TRUSTOS_E2E_MOCK_LLM=true)
  if (MOCK_LLM_ENABLED) {
    const isManager = model === config.fastModel;
    console.log(`[mock-llm] callModelWithTools intercepted: model=${model} isManager=${isManager}`);
    return buildMockModelResponse(messages, isManager, model);
  }
  const provider = providers.find((p) => p.supports(model));
  if (!provider) throw new Error(`No provider found for model: ${model}`);
  try { return await provider.chat(model, messages, tools); }
  catch (error: any) { console.error(`Model call failed with tools [${model}]:`, error.message); throw error; }
}

export function getAvailableModels(): string[] {
  const configured = [config.fastModel, config.slowModel, config.compressorModel];
  const hardcoded = ["gpt-4o-mini", "gpt-4o", "claude-3-5-haiku-20241022", "claude-3-5-sonnet-20241022"];
  return [...new Set([...configured, ...hardcoded])];
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
  reqApiKey?: string
): AsyncGenerator<string> {
  // Mock LLM intercept (TRUSTOS_E2E_MOCK_LLM=true)
  if (MOCK_LLM_ENABLED) {
    const isManager = model === config.fastModel;
    console.log(`[mock-llm] callModelStream intercepted: model=${model} isManager=${isManager}`);
    const mockContent = getMockResponse(messages, isManager);
    // 分块 yield，模拟真实 streaming（每 50 字符一块）
    const chunkSize = 50;
    for (let i = 0; i < mockContent.length; i += chunkSize) {
      yield mockContent.slice(i, i + chunkSize);
    }
    return;
  }

  if (model.startsWith("claude-")) {
    // Anthropic streaming path
    const anthropicClient = new Anthropic({ apiKey: config.anthropicApiKey });
    const systemMsg = messages.find((m) => m.role === "system");
    const nonSystemMsgs = messages.filter((m) => m.role !== "system");

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
  }
}
