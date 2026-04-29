/**
 * Gating Module — Delegation Gate v2
 *
 * G1: system-confidence   — 双轨置信度计算
 * G2: hard-policy         — 硬编码安全规则
 * G2: gating-config       — 可配置阈值/权重
 * G2: policy-calibrator   — Policy 校准核心逻辑
 * G3: delegation-reranker — 规则式 rerank
 */

export { calculateSystemConfidence, getSelectedAction } from "./system-confidence.js";
export { HARD_POLICY_RULES } from "./hard-policy.js";
export type { HardPolicyRule } from "./hard-policy.js";
export { DEFAULT_GATING_CONFIG } from "./gating-config.js";
export type { GatingConfig } from "../../types/index.js";
export { calibrateWithPolicy } from "./policy-calibrator.js";
export type { CalibratedDecision } from "./policy-calibrator.js";
export { shouldRerank, ruleBasedRerank } from "./delegation-reranker.js";
export type { RerankResult } from "./delegation-reranker.js";
export { detectSensitiveData } from "./sensitive-data-rule.js";
export type { SensitiveDataResult } from "./sensitive-data-rule.js";
