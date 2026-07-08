// 简化的 Token 计数器
export function countTokens(text: string): number {
  if (!text) return 0;
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars * 1.5 + otherChars / 4);
}

export function estimateCost(inputTokens: number, outputTokens: number, model: string): number {
  const pricing: Record<string, { input: number; output: number }> = {
    // OpenAI
    "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
    "gpt-4o": { input: 0.0025, output: 0.01 },
    "gpt-3.5-turbo": { input: 0.0005, output: 0.0015 },
    // Anthropic
    "claude-3-5-sonnet-20241022": { input: 0.003, output: 0.015 },
    "claude-3-5-haiku-20241022": { input: 0.0008, output: 0.004 },
    "claude-3-haiku-20240307": { input: 0.00025, output: 0.00125 },
    // SiliconFlow / DeepSeek (per-1M prices from config/pricing.ts, converted to per-1K)
    "deepseek-ai/DeepSeek-V3": { input: 0.00027, output: 0.0011 },
    "deepseek-ai/DeepSeek-R1": { input: 0.00055, output: 0.00219 },
    "deepseek-ai/DeepSeek-V4-Flash": { input: 0.00007, output: 0.00028 },
    // Qwen (SiliconFlow pricing)
    "Qwen/Qwen2.5-7B-Instruct": { input: 0.0005, output: 0.001 },
    "Qwen/Qwen2.5-72B-Instruct": { input: 0.0004, output: 0.0004 },
  };
  const p = pricing[model] || pricing["gpt-4o-mini"];
  return (inputTokens / 1000) * p.input + (outputTokens / 1000) * p.output;
}
