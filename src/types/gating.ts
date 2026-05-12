// SmartRouter Pro — Gating Types (Phase 3 G1/G2/G3)
// 本文件为 gating 层专用类型，不依赖其他 types/ 子文件。

// ── Gating: Decision Features (G1) ────────────────────────────────────────────

/**
 * DecisionFeatures — 结构化特征标签，供 system_confidence 计算和 Policy Gate 使用。
 * 由 Manager LLM 在 G1 阶段输出。
 */
export interface DecisionFeatures {
  /** 请求缺少关键信息（目标/范围/格式不明确） */
  missing_info: boolean;
  /** 需要长链推理或多步分析 */
  needs_long_reasoning: boolean;
  /** 需要外部工具（web_search/http_request/代码执行）*/
  needs_external_tool: boolean;
  /** 涉及高风险操作（金融/医疗/安全） */
  high_risk_action: boolean;
  /** 请求过于模糊，无法直接处理 */
  query_too_vague: boolean;
  /** 需要多步骤操作或跨文件处理 */
  requires_multi_step: boolean;
  /** 引用了之前的对话或任务（继续/接着上次的/补充完整） */
  is_continuation: boolean;
}

// ── Gating: GatingConfig ───────────────────────────────────────────────────────

/**
 * GatingConfig — G2 Policy Gate 的可配置参数。
 * 所有阈值/权重可通过 config.ts 覆盖，不写死在代码里。
 */
export interface GatingConfig {
  /** 各动作基础阈值（低于阈值则该动作不可选） */
  thresholds: {
    direct_answer: number;
    ask_clarification: number;
    delegate_to_slow: number;
    execute_task: number;
  };
  /** Clarification 体验成本惩罚权重（降低其 effective score）*/
  clarification_cost_weight: number;
  /** Rerank 触发阈值 */
  rerank: {
    /** top1 - top2 差值小于此值时触发 rerank */
    top_gap_threshold: number;
    /** system_confidence 低于此值时触发 rerank */
    confidence_threshold: number;
    /** 高成本动作在此 confidence 以下触发 rerank */
    high_cost_confidence_floor: number;
  };
  /** 成本惩罚系数 */
  cost_penalty: {
    /** 每 1000 token 额外惩罚系数 */
    delegate_token_penalty: number;
    /** 每 10s latency 额外惩罚系数 */
    latency_penalty: number;
  };
  /** HITL 歧义检测阈值（P2） */
  ambiguity: {
    /** LLM confidence_hint 低于此值则触发 HITL */
    confidence_threshold: number;
    /** top1-top2 分数差低于此值则触发 HITL */
    score_gap_threshold: number;
  };
  /** G1 系统置信度惩罚系数 */
  penalties: {
    execute_task: number;           // 高成本动作惩罚
    delegate_to_slow: number;      // 委托动作惩罚
    missing_info: number;          // 缺信息惩罚
    high_risk_action: number;      // 高风险动作惩罚
    query_too_vague: number;       // 模糊特征惩罚
    needs_long_reasoning: number;  // 长推理惩罚（仅 direct_answer 场景）
    kb_direct_answer: number;      // KB-1: direct_answer 命中知识边界时惩罚
  };
  /** KB-1 知识边界检测 */
  kb: {
    strong_signal_threshold: number;  // 强信号阈值（hasStrongBoundarySignal）
  };
  /** G2 跨会话续写提升量（is_continuation=true 且当前非 slow 时抬升 delegate_to_slow） */
  cross_session_boost: number;
}

// ── Knowledge Boundary Signals (KB-1) ─────────────────────────────────────────

/**
 * KnowledgeBoundarySignalType — 知识边界信号类型。
 *
 * 【设计原则】
 * - 这是信号，不是动作指令
 * - 不直接决定路由，只供 G1/G2/G3 校准使用
 * - 不做 pattern → action 的硬映射
 */
export type KnowledgeBoundarySignalType =
  /** 依赖当前外部事实，而非参数内稳定知识 */
  | "realtime_external_fact"
  /** 依赖当前运行环境才能回答的事实（如今天星期几、现在几点） */
  | "current_environment_fact"
  /** 明确涉及模型训练截止日期之后的事件 */
  | "post_training_event"
  /** 实时天气、温度、降雨、空气质量 */
  | "live_weather_data"
  /** 实时股价、汇率、指数、成交、涨跌 */
  | "live_market_data"
  /** 最新新闻、今日头条、刚发生的事件 */
  | "live_news_data"
  /** 比赛比分、赛果、排名变化 */
  | "live_result_or_score"
  /** 强依赖"今天/现在/最新/本周"等时间语的公共事实 */
  | "time_sensitive_public_fact";

/**
 * KnowledgeBoundarySignal — 知识边界信号输出。
 *
 * 由 detectKnowledgeBoundarySignals() 生成，供 G1/G2/G3 校准使用。
 * 不做动作决定，只做知识边界标记和强度评估。
 */
export interface KnowledgeBoundarySignal {
  /** 规则唯一标识（用于 trace/benchmark/调试） */
  id: string;
  /** 信号类型 */
  type: KnowledgeBoundarySignalType;
  /**
   * 命中强度（0~1）。
   * 表示"系统对该请求命中知识边界的确信程度"，不是动作置信度。
   */
  strength: number;
  /** 命中原因描述（用于 trace/debug） */
  reasons: string[];
  /** 命中的 pattern 片段（用于解释性复盘） */
  matched_patterns: string[];
}

/**
 * KnowledgeBoundaryContext — 信号检测的输入上下文（第一版只依赖 message）。
 */
export interface KnowledgeBoundaryContext {
  locale?: string;
  now?: string;
}
