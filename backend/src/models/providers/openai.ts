import OpenAI from "openai";
import type { ChatMessage } from "../../types/index.js";
import type { ModelProvider, ModelResponse } from "./base-provider.js";
import { config } from "../../config.js";

// 默认 client（使用环境变量配置）
const defaultClientOptions: ConstructorParameters<typeof OpenAI>[0] = {
  apiKey: config.openaiApiKey,
};
if (config.openaiBaseUrl) {
  defaultClientOptions.baseURL = config.openaiBaseUrl;
}
const defaultClient = new OpenAI(defaultClientOptions);

// 判断是否是 OpenAI 兼容的模型（支持 gpt- 前缀及第三方 provider/model 格式）
function isOpenAICompatible(model: string): boolean {
  if (model.startsWith("gpt-")) return true;
  if (model.startsWith("o1") || model.startsWith("o3")) return true;
  // 硅基流动 / 其他兼容平台格式：provider/model-name 或纯 model-name
  if (model.includes("/")) return true;
  return false;
}

async function callChat(
  client: OpenAI,
  model: string,
  messages: ChatMessage[]
): Promise<ModelResponse> {
  const response = await client.chat.completions.create({
    model,
    messages: messages.map((m) => ({
      role: m.role as "system" | "user" | "assistant",
      content: m.content,
    })),
    temperature: 0.7,
    max_tokens: 4096,
  });
  return {
    content: response.choices[0]?.message?.content || "",
    input_tokens: response.usage?.prompt_tokens || 0,
    output_tokens: response.usage?.completion_tokens || 0,
    model: response.model,
  };
}

export const openaiProvider: ModelProvider = {
  name: "openai",
  supports(model: string): boolean {
    return isOpenAICompatible(model);
  },
  async chat(model: string, messages: ChatMessage[]): Promise<ModelResponse> {
    return callChat(defaultClient, model, messages);
  },
};

/** 使用请求级自定义 apiKey / baseURL 调用，不影响全局 client */
export async function callOpenAIWithOptions(
  model: string,
  messages: ChatMessage[],
  apiKey: string,
  baseURL?: string
): Promise<ModelResponse> {
  const opts: ConstructorParameters<typeof OpenAI>[0] = { apiKey };
  if (baseURL) opts.baseURL = baseURL;
  const client = new OpenAI(opts);
  return callChat(client, model, messages);
}
