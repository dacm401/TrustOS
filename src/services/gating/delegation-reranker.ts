/**
 * Delegation Reranker — G3 Rerank-on-Uncertainty
 *
 * 【设计原则】
 * 第一版采用规则式 rerank，不引入第二个复杂模型。
 * 当 top1-top2 差值过小、或 confidence 过低时，
 * 用规则判断替代 LLM 原始选择，倾向于更保守的动作。
 *
 * 【触发条件】
 * - top1 - top2 gap < 阈值
 * - system_confidence < 阈值
 * - 高成本动作（delegate/execute）被选中且 confidence < high_cost_confidence_floor
 */

import type {
  ManagerDecisionType,
  DecisionFeatures,
  GatingConfig,
} from "../../types/index.js";
import { DEFAULT_GATING_CONFIG } from "./gating-config.js";

export interface RerankResult {
  /** 是否触发了 rerank */
  reranked: boolean;
  /** rerank 原因（供 trace/debug） */
  reason?: string;
  /** rerank 后的最终动作 */
  finalAction: ManagerDecisionType;
}

export interface ShouldRerankResult {
  should: boolean;
  /** top1 - top2 score gap（用于日志记录） */
  gap: number;
  /** grayZone 短路原因（当 should=false 且由 grayZone 触发时返回，供 delegation_logs 埋点） */
  grayzone_shortcut?: string;
}

/**
 * 判断是否需要 rerank
 */
export function shouldRerank(
  scores: Record<ManagerDecisionType, number>,
  systemConfidence: number,
  selectedAction: ManagerDecisionType,
  config: GatingConfig = DEFAULT_GATING_CONFIG
): ShouldRerankResult {
  const sorted = Object.values(scores).sort((a, b) => b - a);
  const gap = (sorted[0] ?? 0) - (sorted[1] ?? 0);
  const isHighCostAction =
    selectedAction === "delegate_to_slow" || selectedAction === "execute_task";

  // 【短路条件 B】灰色地带跳过 rerank（语义优先于阈值）
  // 来源：Phase 5.4 grayZone 短路（2026-05-06，53 条历史样本回放，v2 grayZone 切掉 14 次 rerank，全部 change=0）
  // 若 G2 已选 delegate_to_slow 或 execute_task，且 conf 处于"灰区"（0.60 ≤ conf < 0.70），
  // 则不 rerank：灰区任务本身不贵，rerank 负 ROI（87.8% 走默认分支，保持原选）。
  // 边界：conf=0.60 属于灰区（low 触发线），conf=0.70 属于灰区外（high_cost_floor 线）。
  const grayZone =
    (selectedAction === "delegate_to_slow" || selectedAction === "execute_task") &&
    systemConfidence >= config.rerank.confidence_threshold &&         // ≥ 0.60（灰区下界）
    systemConfidence < config.rerank.high_cost_confidence_floor;       // < 0.70（灰区上界，左闭右开）
  if (grayZone) {
    return {
      should: false,
      gap,
      grayzone_shortcut: `grayZone: ${selectedAction} conf∈[${config.rerank.confidence_threshold}, ${config.rerank.high_cost_confidence_floor})`
    };
  }

  const should =
    gap < config.rerank.top_gap_threshold ||
    systemConfidence < config.rerank.confidence_threshold ||
    (isHighCostAction && systemConfidence < config.rerank.high_cost_confidence_floor);

  return { should, gap };
}

/**
 * 规则式 rerank（第一版）
 *
 * 不调用第二个模型，用规则判断替代 LLM 原始选择。
 * 当不确定时，倾向于更保守/更低成本的动作。
 */
export function ruleBasedRerank(
  scores: Record<ManagerDecisionType, number>,
  features: DecisionFeatures,
  selectedAction: ManagerDecisionType
): RerankResult {
  // 规则 1：delegate 和 clarification 接近，且缺信息 → clarification
  if (
    features.missing_info &&
    Math.abs(scores.delegate_to_slow - scores.ask_clarification) < 0.1
  ) {
    return {
      reranked: true,
      reason: "delegate与clarification接近，信息缺失，rerank至clarification",
      finalAction: "ask_clarification",
    };
  }

  // 规则 2：delegate 和 direct_answer 接近，且问题简短明确 → direct_answer
  // 注意：如果 selectedAction 是 execute_task，由规则 1/默认规则接管，此处不拦截
  if (
    selectedAction !== "execute_task" &&
    !features.missing_info &&
    !features.needs_long_reasoning &&
    Math.abs(scores.delegate_to_slow - scores.direct_answer) < 0.1
  ) {
    return {
      reranked: true,
      reason: "delegate与direct接近，问题明确，rerank至direct_answer",
      finalAction: "direct_answer",
    };
  }

  // 规则 3：删除了（Rule 3 过于激进：所有无工具的 execute_task 都被降级，
  // 导致写快排这种复杂代码任务也被 rerank 成 direct_answer。
  // 复杂代码任务应保持 execute_task，由阈值过滤来控制）

  // 规则 4：clarification 和 direct 接近，且问题模糊 → clarification
  if (
    features.query_too_vague &&
    Math.abs(scores.ask_clarification - scores.direct_answer) < 0.08
  ) {
    return {
      reranked: true,
      reason: "clarification与direct接近，请求模糊，rerank至clarification",
      finalAction: "ask_clarification",
    };
  }

  // 默认：保持原选（rerank 触发但不改变结果，只记录 reason）
  return {
    reranked: true,
    reason: "rerank触发，但无匹配降级规则，保持原选",
    finalAction: selectedAction,
  };
}
