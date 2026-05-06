/**
 * GatingConfig — G2 Policy Gate 的可配置参数默认值。
 * 所有阈值/权重可通过 config.ts 覆盖。
 *
 * 【配置原则】
 * - delegate_to_slow / execute_task 阈值更高（代价更大）
 * - clarification 不是零成本，clarification_cost_weight 计入体验惩罚
 * - 高成本动作（delegate/execute）需要更高 confidence 才能放行
 */

import type { GatingConfig } from "../../types/index.js";

export const DEFAULT_GATING_CONFIG: GatingConfig = {
  // 各动作基础阈值（低于阈值则该动作不可选）
  thresholds: {
    direct_answer: 0.55,
    ask_clarification: 0.60, // 来源：Sprint 75，经验值（clarification 打断用户，适当提高门槛）
    delegate_to_slow: 0.65, // 来源：Sprint 75，0.75→0.65（原阈值太高，模型很少打到，委托从未发生）
    execute_task: 0.80,     // 来源：Sprint 75，经验值（工具执行风险最大，阈值最高）
  },

  // Clarification 体验成本惩罚（打断用户 / 增加对话轮次）
  // effective_score = raw_score * (1 - clarification_cost_weight)
  clarification_cost_weight: 0.15,

  // Rerank 触发阈值
  rerank: {
    top_gap_threshold: 0.08,     // 来源：Sprint 75，经验值（top1-top2 差值小，说明置信度接近）
    confidence_threshold: 0.60,   // 来源：2026-05-06，53 条样本回放（grayZone 下界，左闭）
    high_cost_confidence_floor: 0.70, // 来源：2026-05-06，Phase 5.2，0.75→0.70 对齐 base threshold 0.65 梯度
  },

  // 成本惩罚系数（用于后续 latency/token 预算校准）
  cost_penalty: {
    delegate_token_penalty: 0.02, // 每 1000 token 额外惩罚
    latency_penalty: 0.01,       // 每 10s latency 额外惩罚
  },
};
