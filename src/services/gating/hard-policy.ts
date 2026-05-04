/**
 * HardPolicy — 硬编码核心安全/成本规则。
 *
 * 【设计原则】
 * 这些规则无条件执行，LLM 不可覆盖。
 * 仅包含真正涉及安全、成本底线、缺信息风险的场景。
 *
 * 所有其他可配置阈值（如阈值本身、惩罚系数）都在 gating-config.ts 里。
 */

import type { DecisionFeatures, ManagerDecisionType } from "../../types/index.js";

export interface HardPolicyRule {
  id: string;
  description: string;
  /** 触发条件 */
  condition: (features: DecisionFeatures) => boolean;
  /** 修正动作 */
  action: "block" | "penalize" | "boost";
  /** 作用于哪个动作 */
  target: ManagerDecisionType;
  /** 惩罚系数（仅 penalize 时使用）：final_score = score * (1 - penalty) */
  penalty?: number;
}

/** 硬编码规则列表 */
export const HARD_POLICY_RULES: HardPolicyRule[] = [
  {
    id: "execute_requires_info",
    description: "execute_task 在信息缺失时禁止直接通过",
    condition: (f) => f.missing_info || f.query_too_vague,
    action: "block",
    target: "execute_task",
  },
  {
    id: "delegate_penalty_without_goal",
    description: "信息缺失时轻微惩罚 delegate_to_slow（20% 惩罚，原 50% 太激进）",
    condition: (f) => f.missing_info,
    action: "penalize",
    target: "delegate_to_slow",
    penalty: 0.2,
  },
  {
    id: "high_risk_blocks_execute",
    description: "高风险动作禁止 execute_task",
    condition: (f) => f.high_risk_action,
    action: "block",
    target: "execute_task",
  },
  {
    id: "clarification_boost_when_vague",
    description: "请求模糊时 boost ask_clarification（更容易触发）",
    condition: (f) => f.query_too_vague,
    action: "boost",
    target: "ask_clarification",
  },
];
