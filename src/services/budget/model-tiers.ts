// Sprint 64P: Budget Manager V0 — Model Tier Map
// 用于 Budget Manager 的降级策略查找。
// V0 重点不是真实切很多模型，而是让 ledger 能记录 originalModel/selectedModel/downgraded。

export type ModelRole = "manager" | "worker" | "either";
export type ModelTierLevel = "cheap" | "standard" | "reasoning";

export interface ModelTier {
  model: string;
  role: ModelRole;
  tier: ModelTierLevel;
  /** 如果超预算，降级到哪个模型（仅当 fallbackModel 比当前 tier 更便宜时） */
  fallbackModel?: string;
}

/**
 * Model Tier Map — V0 简化版
 *
 * 原则：
 * - cheap tier 不再降级（已是最便宜）
 * - reasoning tier 可降级到 standard 或 cheap
 * - standard tier 可降级到 cheap
 */
export const MODEL_TIERS: ModelTier[] = [
  // ─── DeepSeek ──────────────────────────────────────────────────────────────
  {
    model: "deepseek-ai/DeepSeek-V4-Flash",
    role: "either",
    tier: "cheap",
    // cheap 不再降级
  },
  {
    model: "deepseek-ai/DeepSeek-V3",
    role: "worker",
    tier: "standard",
    fallbackModel: "deepseek-ai/DeepSeek-V4-Flash",
  },
  {
    model: "deepseek-ai/DeepSeek-R1",
    role: "manager",
    tier: "reasoning",
    fallbackModel: "deepseek-ai/DeepSeek-V3",
  },
  // ─── OpenAI ────────────────────────────────────────────────────────────────
  {
    model: "gpt-4o",
    role: "manager",
    tier: "reasoning",
    fallbackModel: "gpt-4o-mini",
  },
  {
    model: "gpt-4o-mini",
    role: "either",
    tier: "standard",
    fallbackModel: "deepseek-ai/DeepSeek-V4-Flash",
  },
  {
    model: "gpt-3.5-turbo",
    role: "either",
    tier: "cheap",
    // cheap 不再降级
  },
  // ─── Anthropic ─────────────────────────────────────────────────────────────
  {
    model: "claude-3-5-sonnet-20241022",
    role: "manager",
    tier: "reasoning",
    fallbackModel: "claude-3-haiku-20240307",
  },
  {
    model: "claude-3-haiku-20240307",
    role: "either",
    tier: "standard",
    fallbackModel: "deepseek-ai/DeepSeek-V4-Flash",
  },
  // ─── Qwen ──────────────────────────────────────────────────────────────────
  {
    model: "Qwen/Qwen2.5-72B-Instruct",
    role: "manager",
    tier: "standard",
    fallbackModel: "deepseek-ai/DeepSeek-V4-Flash",
  },
  {
    model: "Qwen/Qwen2.5-7B-Instruct",
    role: "either",
    tier: "cheap",
    // cheap 不再降级
  },
];

/**
 * 查找模型的 Tier 信息。
 * 大小写不敏感匹配。
 */
export function findModelTier(model: string): ModelTier | undefined {
  const lower = model.toLowerCase();
  return MODEL_TIERS.find((t) => t.model.toLowerCase() === lower);
}

/**
 * 查找该模型的降级目标。
 * - cheap tier → undefined（无可降级目标）
 * - 有 fallbackModel → 返回 fallbackModel
 * - 无 fallbackModel → undefined
 */
export function findFallbackModel(model: string): string | undefined {
  const tier = findModelTier(model);
  if (!tier) return undefined;
  if (tier.tier === "cheap") return undefined;
  return tier.fallbackModel;
}

/**
 * 判断两个模型中哪个更便宜（tier 比较）。
 * cheap < standard < reasoning
 */
export function isCheaperThan(a: string, b: string): boolean {
  const TIER_ORDER: Record<ModelTierLevel, number> = {
    cheap: 0,
    standard: 1,
    reasoning: 2,
  };
  const tierA = findModelTier(a)?.tier ?? "standard";
  const tierB = findModelTier(b)?.tier ?? "standard";
  return TIER_ORDER[tierA] < TIER_ORDER[tierB];
}
