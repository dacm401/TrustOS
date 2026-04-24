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
    ask_clarification: 0.60,  // 稍高：clarification 打断用户
    delegate_to_slow: 0.75,  // Sprint 51: 0.72→0.75（更保守，减少不必要 slow 调用）
    execute_task: 0.80,       // 最高：工具执行风险最大
  },

  // Clarification 体验成本惩罚（打断用户 / 增加对话轮次）
  // effective_score = raw_score * (1 - clarification_cost_weight)
  clarification_cost_weight: 0.15,

  // Rerank 触发阈值
  rerank: {
    top_gap_threshold: 0.08,     // top1 - top2 < 此值时触发 rerank
    confidence_threshold: 0.60,   // system_confidence < 此值时触发 rerank
    high_cost_confidence_floor: 0.75, // delegate/execute 在此 confidence 以下触发 rerank
  },

  // 成本惩罚系数（用于后续 latency/token 预算校准）
  cost_penalty: {
    delegate_token_penalty: 0.02, // 每 1000 token 额外惩罚
    latency_penalty: 0.01,       // 每 10s latency 额外惩罚
  },
};
