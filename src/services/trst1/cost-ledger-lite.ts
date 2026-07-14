/**
 * TRST-1 Cost Ledger Lite
 *
 * Estimates cost from OpenAI-compatible response usage.
 * Uses a static price table. Unknown models return null.
 * This is APPROXIMATE and MANUAL — no live pricing API.
 */

// USD per 1M tokens (input, output)
const PRICE_TABLE: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  // OpenAI
  "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10.0 },
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gpt-3.5-turbo": { inputPer1M: 0.5, outputPer1M: 1.5 },
  // Anthropic
  "claude-3-5-sonnet-20241022": { inputPer1M: 3.0, outputPer1M: 15.0 },
  "claude-3-haiku-20240307": { inputPer1M: 0.25, outputPer1M: 1.25 },
  // SiliconFlow / DeepSeek
  "deepseek-ai/DeepSeek-V3": { inputPer1M: 0.27, outputPer1M: 1.1 },
  "deepseek-ai/DeepSeek-R1": { inputPer1M: 0.55, outputPer1M: 2.19 },
  "deepseek-ai/DeepSeek-V4-Flash": { inputPer1M: 0.07, outputPer1M: 0.28 },
  "Qwen/Qwen2.5-7B-Instruct": { inputPer1M: 0.07, outputPer1M: 0.07 },
  "Qwen/Qwen2.5-72B-Instruct": { inputPer1M: 0.35, outputPer1M: 0.35 },
};

export interface CostEstimate {
  /** Estimated cost in USD, or null if pricing unknown */
  estimatedCostUsd: number | null;
  /** Whether the model was found in the price table */
  pricingKnown: boolean;
  /** Input tokens (from response.usage) */
  promptTokens: number;
  /** Output tokens (from response.usage) */
  completionTokens: number;
  /** Total tokens */
  totalTokens: number;
}

/**
 * Estimate cost from OpenAI-compatible response usage.
 *
 * @param model - Model name (e.g. "gpt-4o-mini")
 * @param usage - response.usage object with prompt_tokens, completion_tokens
 * @returns CostEstimate with estimated cost or null if model unknown
 */
export function estimateCost(
  model: string,
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined,
): CostEstimate {
  const promptTokens = usage?.prompt_tokens ?? 0;
  const completionTokens = usage?.completion_tokens ?? 0;
  const totalTokens = usage?.total_tokens ?? (promptTokens + completionTokens);

  const pricing = PRICE_TABLE[model];
  if (pricing) {
    const cost =
      (promptTokens * pricing.inputPer1M + completionTokens * pricing.outputPer1M) / 1_000_000;
    return {
      estimatedCostUsd: Math.round(cost * 1_000_000) / 1_000_000, // round to 6 decimal places
      pricingKnown: true,
      promptTokens,
      completionTokens,
      totalTokens,
    };
  }

  return {
    estimatedCostUsd: null,
    pricingKnown: false,
    promptTokens,
    completionTokens,
    totalTokens,
  };
}

/**
 * Check if a model is known in the price table.
 */
export function isModelPriced(model: string): boolean {
  return model in PRICE_TABLE;
}
