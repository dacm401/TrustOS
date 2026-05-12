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

  // 惩罚衰减下限：避免链式惩罚叠加导致分数过度衰减
  // 效果：penalized_score = Math.max(penalized_score, score * min_score_ratio)
  // 保护场景：missing_info + query_too_vague + KB 边界时，delegate_to_slow 不会低于 30%
  min_score_ratio: 0.30,

  // 成本惩罚系数（用于后续 latency/token 预算校准）
  cost_penalty: {
    delegate_token_penalty: 0.02, // 每 1000 token 额外惩罚
    latency_penalty: 0.01,       // 每 10s latency 额外惩罚
  },

  // HITL 歧义检测阈值（P2）
  ambiguity: {
    confidence_threshold: 0.5,   // LLM confidence_hint 低于此值则触发 HITL
    score_gap_threshold: 0.15,   // top1-top2 分数差低于此值则触发 HITL
  },

  // G1 系统置信度惩罚系数（统一从此读取，不再散落各处）
  penalties: {
    execute_task: 0.85,       // 高成本动作惩罚
    delegate_to_slow: 0.92,  // 委托动作惩罚
    missing_info: 0.80,      // 缺信息惩罚
    high_risk_action: 0.80,  // 高风险动作惩罚
    query_too_vague: 0.85,   // 模糊特征惩罚
    needs_long_reasoning: 0.90,  // 长推理惩罚（仅 direct_answer 场景）
    kb_direct_answer: 0.75,  // KB-1: direct_answer 命中知识边界时惩罚
  },

  // KB-1 知识边界检测
  kb: {
    strong_signal_threshold: 0.80,  // hasStrongBoundarySignal 的强信号阈值
  },

  // G2 跨会话续写提升量（is_continuation=true 且当前非 slow 时抬升 delegate_to_slow）
  cross_session_boost: 0.30,  // 来源：Sprint 58 benchmark，LLM cross-session 准确率 50% → 规则 75%
};
