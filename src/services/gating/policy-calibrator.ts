/**
 * Policy Calibrator — G2 Policy-Calibrated Gate 核心逻辑
 *
 * 职责：
 * 1. 应用硬编码安全规则（HARD_POLICY_RULES）
 * 2. 应用 clarification 体验成本惩罚
 * 3. KB-1: 应用知识边界校准（降低 direct_answer，轻抬 delegate/execute）
 * 4. 应用配置化阈值过滤
 * 5. 返回修正后的分数 + policy overrides 记录
 */

import type {
  ManagerDecisionType,
  DecisionFeatures,
  PolicyOverride,
  GatingConfig,
  KnowledgeBoundarySignal,
} from "../../types/index.js";
import { HARD_POLICY_RULES } from "./hard-policy.js";
import { DEFAULT_GATING_CONFIG } from "./gating-config.js";
import { getSelectedAction } from "./system-confidence.js";
import {
  hasStrongBoundarySignal,
  isCalibratableSignal,
} from "./knowledge-boundary-signals.js";

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
 * @param llmScores                 LLM 输出的各动作原始分数
 * @param features                  LLM 输出的结构化特征
 * @param config                    可配置参数（默认 DEFAULT_GATING_CONFIG）
 * @param knowledgeBoundarySignals   KB-1: 知识边界信号数组（可选）
 * @param estimatedTokens           GF-02: 预估 token 数，用于 cost_penalty 计算（可选）
 * @returns 校准后的分数和最终动作
 */
export function calibrateWithPolicy(
  llmScores: Record<ManagerDecisionType, number>,
  features: DecisionFeatures,
  config: GatingConfig = DEFAULT_GATING_CONFIG,
  knowledgeBoundarySignals?: KnowledgeBoundarySignal[],
  estimatedTokens?: number
): CalibratedDecision {
  let scores = { ...llmScores };
  const policyOverrides: PolicyOverride[] = [];
  // G2-02: 缓存 LLM 原始分数，用于 policyOverrides.original_score
  // 确保记录的是 LLM 输出值，而非 KB 调整后的中间值
  const originalLlmScores = { ...llmScores };

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

  // 2. GF-02: cost_penalty — 按预估 token 数对 delegate_to_slow 施加成本惩罚
  // 公式：score *= (1 - (tokens/1000) * delegate_token_penalty)
  // 默认 delegate_token_penalty=0.02，1000 tokens 惩罚 2%，不影响小消息路由
  if (estimatedTokens != null && estimatedTokens > 0 && config.cost_penalty) {
    const rawDelegateScore = scores.delegate_to_slow;
    const penaltyRate = (estimatedTokens / 1000) * config.cost_penalty.delegate_token_penalty;
    const penalizedDelegateScore = rawDelegateScore * (1 - penaltyRate);
    if (Math.abs(penalizedDelegateScore - rawDelegateScore) > 0.001) {
      scores.delegate_to_slow = Math.max(0, penalizedDelegateScore);
      policyOverrides.push({
        rule: "cost_penalty_delegate_tokens",
        action: "penalize",
        target: "delegate_to_slow",
        original_score: rawDelegateScore,
        adjusted_score: scores.delegate_to_slow,
        reason: `GF-02 cost_penalty: estimatedTokens=${estimatedTokens}, penaltyRate=${penaltyRate.toFixed(4)}`,
      });
    }
  }

  // 3. 应用 KB-1 知识边界校准（位于硬规则之后，阈值之前）
  // KB-1 校准原则：
  // - 压低 direct_answer（因为参数内不可靠回答不应该高置信直答）
  // - 轻抬 delegate_to_slow（让知识边界问题更容易进入深度处理）
  // - 不抬 ask_clarification（用户意图清晰，缺的是系统知识，不是用户信息）
  if (knowledgeBoundarySignals && knowledgeBoundarySignals.length > 0) {
    const strongSignals = knowledgeBoundarySignals.filter((s) => isCalibratableSignal(s));
    if (strongSignals.length > 0) {
      const strongestSignal = strongSignals.reduce((best, s) =>
        s.strength > best.strength ? s : best
      );

      // Rule KB-1: 强 knowledge boundary signal → 压低 direct_answer (-0.20)
      const directScore = scores.direct_answer;
      const newDirectScore = Math.max(0, directScore - 0.20);
      if (newDirectScore !== directScore) {
        scores.direct_answer = newDirectScore;
        policyOverrides.push({
          rule: "kb-strong-boundary-penalty",
          action: "penalize",
          target: "direct_answer",
          original_score: originalLlmScores.direct_answer, // G2-02: 用 LLM 原始分记录
          adjusted_score: newDirectScore,
          reason: `KB signal="${strongestSignal.type}"(strength=${strongestSignal.strength.toFixed(2)})，知识边界问题不应高置信直答`,
        });
      }

      // Rule KB-2: 轻抬 delegate_to_slow (+0.10)，提高其竞争力
      const delegateScore = scores.delegate_to_slow;
      const newDelegateScore = Math.min(1, delegateScore + 0.10);
      if (newDelegateScore !== delegateScore) {
        scores.delegate_to_slow = newDelegateScore;
        policyOverrides.push({
          rule: "kb-delegate-boost",
          action: "boost",
          target: "delegate_to_slow",
          original_score: originalLlmScores.delegate_to_slow, // G2-02: 用 LLM 原始分记录
          adjusted_score: newDelegateScore,
          reason: `KB signal="${strongestSignal.type}" 提示问题需要深度处理`,
        });
      }
    }
  }

  // 2b. Cross-session 兜底 AND 规则
  // Sprint 58 benchmark: LLM 在 cross-session 场景仅 50%，而离线规则 75%，
  // 根因：规则同时检查"继续/接着"关键词 AND "动作不是 slow"。
  // LLM 输出 is_continuation=true 时，如果当前动作不是 slow，强制抬升 delegate_to_slow。
  if (features.is_continuation) {
    const currentAction = getSelectedAction(llmScores);
    if (currentAction !== "delegate_to_slow" && currentAction !== "execute_task") {
      const newDelegateScore = Math.min(1, scores.delegate_to_slow + (config.cross_session_boost ?? DEFAULT_GATING_CONFIG.cross_session_boost));
      if (newDelegateScore !== scores.delegate_to_slow) {
        scores.delegate_to_slow = newDelegateScore;
        policyOverrides.push({
          rule: "cross-session-continuation-boost",
          action: "boost",
          target: "delegate_to_slow",
          original_score: scores.delegate_to_slow,
          adjusted_score: newDelegateScore,
          reason: "is_continuation=true 且当前非 slow 动作，cross-session 任务需要历史上下文，抬升 delegate_to_slow",
        });
      }
    }
  }

  // 4. 应用硬编码规则（boost/penalize/block）
  for (const rule of HARD_POLICY_RULES) {
    if (!rule.condition(features)) continue;

    // G2-02: original_score 记录 LLM 原始分，而非 KB 调整后的中间值
    const originalScore = originalLlmScores[rule.target] ?? scores[rule.target] ?? 0;

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

  // G1-02: 惩罚衰减下限 — 避免链式惩罚（missing_info + query_too_vague + KB）
  // 导致 high conf 分数被压至 0.544×，过度惩罚。高置信 LLM 输出应有保底。
  // 公式：final = max(penalized, original * min_score_ratio)
  const floorRatio = config.min_score_ratio ?? 0;
  if (floorRatio > 0) {
    for (const action of Object.keys(scores) as ManagerDecisionType[]) {
      const rawScore = originalLlmScores[action] ?? 0;
      const floor = rawScore * floorRatio;
      if (scores[action] < floor && scores[action] > 0) {
        policyOverrides.push({
          rule: "g1-02-penalty-decay-floor",
          action: "boost",
          target: action,
          original_score: scores[action],
          adjusted_score: floor,
          reason: `G1-02 decay floor: penalized=${scores[action].toFixed(3)} < floor=${floor.toFixed(3)}（原始分×${floorRatio}），强制恢复`,
        });
        scores[action] = floor;
      }
    }
  }

  // 5. 应用配置化阈值（低于阈值 → 置零，等效于否决该动作）
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

  // 6. 选取得分最高的有效动作
  const finalAction = getSelectedAction(scores);

  return { adjustedScores: scores, policyOverrides, finalAction };
}
