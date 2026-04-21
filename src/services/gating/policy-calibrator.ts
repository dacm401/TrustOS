/**
 * Policy Calibrator — G2 Policy-Calibrated Gate 核心逻辑
 *
 * 职责：
 * 1. 应用硬编码安全规则（HARD_POLICY_RULES）
 * 2. 应用 clarification 体验成本惩罚
 * 3. 应用配置化阈值过滤
 * 4. 返回修正后的分数 + policy overrides 记录
 */

import type {
  ManagerDecisionType,
  DecisionFeatures,
  PolicyOverride,
  GatingConfig,
} from "../../types/index.js";
import { HARD_POLICY_RULES } from "./hard-policy.js";
import { DEFAULT_GATING_CONFIG } from "./gating-config.js";
import { getSelectedAction } from "./system-confidence.js";

export interface CalibratedDecision {
  /** 修正后的各动作分数 */
  adjustedScores: Record<ManagerDecisionType, number>;
  /** Policy 修正记录（用于 trace/debug） */
  policyOverrides: PolicyOverride[];
  /** 最终选中的动作 */
  finalAction: ManagerDecisionType;
}

/**
 * 对 LLM 输出的原始分数进行 Policy 校准
 *
 * @param llmScores   LLM 输出的各动作原始分数
 * @param features    LLM 输出的结构化特征
 * @param config      可配置参数（默认 DEFAULT_GATING_CONFIG）
 * @returns 校准后的分数和最终动作
 */
export function calibrateWithPolicy(
  llmScores: Record<ManagerDecisionType, number>,
  features: DecisionFeatures,
  config: GatingConfig = DEFAULT_GATING_CONFIG
): CalibratedDecision {
  let scores = { ...llmScores };
  const policyOverrides: PolicyOverride[] = [];

  // 1. 应用 clarification 体验成本惩罚（先扣再补，避免 boost 被 penalty 吞掉）
  const clarScore = scores.ask_clarification;
  const penalizedClarScore = clarScore * (1 - config.clarification_cost_weight);
  if (penalizedClarScore !== clarScore) {
    policyOverrides.push({
      rule: "clarification_cost_penalty",
      action: "penalize",
      target: "ask_clarification",
      original_score: clarScore,
      adjusted_score: penalizedClarScore,
      reason: `clarification 体验成本惩罚（weight=${config.clarification_cost_weight}）`,
    });
    scores.ask_clarification = penalizedClarScore;
  }

  // 2. 应用硬编码规则（boost/penalize/block）
  for (const rule of HARD_POLICY_RULES) {
    if (!rule.condition(features)) continue;

    const originalScore = scores[rule.target] ?? 0;

    if (rule.action === "block") {
      scores[rule.target] = 0;
      policyOverrides.push({
        rule: rule.id,
        action: "block",
        target: rule.target,
        original_score: originalScore,
        adjusted_score: 0,
        reason: rule.description,
      });
    } else if (rule.action === "penalize" && rule.penalty !== undefined) {
      const newScore = originalScore * (1 - rule.penalty);
      scores[rule.target] = newScore;
      policyOverrides.push({
        rule: rule.id,
        action: "penalize",
        target: rule.target,
        original_score: originalScore,
        adjusted_score: newScore,
        reason: rule.description,
      });
    } else if (rule.action === "boost") {
      // boost: 在原分数基础上加一个小的固定值（0.15），而不是乘系数
      // boost 在 penalty 之后应用，确保 boost 能补偿 penalty 并通过阈值
      const newScore = Math.min(1, originalScore + 0.15);
      scores[rule.target] = newScore;
      policyOverrides.push({
        rule: rule.id,
        action: "boost",
        target: rule.target,
        original_score: originalScore,
        adjusted_score: newScore,
        reason: rule.description,
      });
    }
  }

  // 3. 应用配置化阈值（低于阈值 → 置零，等效于否决该动作）
  for (const [action, threshold] of Object.entries(config.thresholds)) {
    const act = action as ManagerDecisionType;
    if (scores[act] < threshold) {
      const prevScore = scores[act];
      if (prevScore > 0) {
        policyOverrides.push({
          rule: `threshold_${action}`,
          action: "block",
          target: act,
          original_score: prevScore,
          adjusted_score: 0,
          reason: `低于阈值 ${threshold}`,
        });
      }
      scores[act] = 0;
    }
  }

  // 4. 选取得分最高的有效动作
  const finalAction = getSelectedAction(scores);

  return { adjustedScores: scores, policyOverrides, finalAction };
}
