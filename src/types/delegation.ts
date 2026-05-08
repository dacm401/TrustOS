// SmartRouter Pro — Delegation Types (Phase 3.0+)
// 导出顺序：决策枚举 → 核心决策类型 → 命令 → SSE事件 → DelegationLog
// 依赖：task.ts (TaskState, CommandStatus)

import type { TaskState, CommandStatus } from "./task.js";

// ── 决策枚举 ─────────────────────────────────────────────────────────────────

/** 决策类型枚举（Phase 0 精简版，4 种） */
export type ManagerDecisionType =
  | "direct_answer"
  | "ask_clarification"
  | "delegate_to_slow"
  | "execute_task";

/**
 * 编译期穷尽检查工具（exhaustiveness check）
 *
 * 用法：switch(action) { ... default: assertUnreachable(action) }
 * 当 switch 没有覆盖所有枚举成员时，TypeScript 编译期报错。
 * 运行时抛出 Error 防止静默 fallthrough。
 */
export function assertUnreachable(x: never, context?: string): never {
  throw new Error(`Unhandled case${context ? ` in ${context}` : ""}: ${String(x)}`);
}

/** 路由层（兼容现有 L0/L1/L2/L3） */
export type RoutingLayer = "L0" | "L1" | "L2" | "L3";

/** decision_type ↔ routing_layer 默认映射表 */
export const DECISION_TO_LAYER: Record<ManagerDecisionType, RoutingLayer> = {
  direct_answer: "L0",
  ask_clarification: "L0",
  delegate_to_slow: "L2",
  execute_task: "L3",
};

/** 路由层 → decision_type 反向映射（用于旧 router fallback） */
export const LAYER_TO_DECISION: Record<RoutingLayer, ManagerDecisionType> = {
  L0: "direct_answer",
  L1: "direct_answer",
  L2: "delegate_to_slow",
  L3: "execute_task",
};

// ── ManagerDecision ───────────────────────────────────────────────────────────

/** Fast Manager 直接回答时的回复草稿。仅当 decision_type = "direct_answer" 时出现。 */
export interface DirectResponse {
  style: "concise" | "natural" | "structured";
  content: string;
  max_tokens_hint?: number;
}

/**
 * ManagerDecision — Phase 3.0 Fast Manager 的标准输出协议。
 * 职责：只表达"下一步怎么做"，不包含最终回答内容本身。
 * 流转：Fast Model → Runtime Orchestrator → 各 Worker / Archive
 */
export interface ManagerDecision {
  /** Schema 版本，用于协议演进校验 */
  schema_version: "manager_decision_v1";
  /** 决策类型：Fast Manager 决定的下一步处理路径 */
  decision_type: ManagerDecisionType;
  /** 兼容现有前端/评测体系，与 decision_type 存在逻辑映射 */
  routing_layer: RoutingLayer;
  /** 决策原因，供日志/trace/debug 使用 */
  reason: string;
  /** 决策置信度 0.0 ~ 1.0 */
  confidence: number;
  /** 是否需要写入/更新 Task Archive */
  needs_archive: boolean;
  /** direct_answer 时的回复草稿 */
  direct_response?: DirectResponse;
  /** ask_clarification 时的澄清问题 */
  clarification?: ClarifyQuestion;
  /** delegate_to_slow / execute_task 时的结构化命令 */
  command?: CommandPayload;
}

// ── ClarifyQuestion ────────────────────────────────────────────────────────────

/** 澄清问题结构 */
export interface ClarifyQuestion {
  question_id: string;
  question_text: string;
  options?: ClarifyOption[];
  allow_free_text?: boolean;
  clarification_reason: string;
  missing_fields?: string[];
  /** P2 HITL: 决策歧义信号 */
  ambiguity?: AmbiguitySignal;
}

export interface ClarifyOption {
  label: string;
  value: string;
}

/** P2 HITL: 决策歧义信号 — 当 confidence_hint < 阈值 或 top-2 分数接近时触发 */
export interface AmbiguitySignal {
  /** 触发原因 */
  reason: "low_confidence" | "close_scores" | "both";
  /** LLM 自报置信度 */
  llmConfidenceHint: number;
  /** 最高分 */
  topScore: number;
  /** 第二高分 */
  secondScore: number;
  /** 第二高分对应的动作 */
  secondAction: string;
  /** 中文歧义说明 */
  zhNotice: string;
  /** 英文歧义说明 */
  enNotice: string;
}

// ── CommandPayload ─────────────────────────────────────────────────────────────

/** 命令类型枚举（Phase 0 精简版，4 种） */
export type CommandType =
  | "delegate_analysis"
  | "delegate_summarization"
  | "execute_plan"
  | "execute_research";

/** Worker 类型提示 */
export type WorkerHint =
  | "slow_analyst"
  | "execute_worker"
  | "search_worker";

export type InputMaterialType =
  | "user_query"
  | "excerpt"
  | "evidence_ref"
  | "memory_ref"
  | "archive_fact";

export type OutputFormat =
  | "structured_analysis"
  | "bullet_summary"
  | "answer"
  | "json";

/** Manager → Worker 的结构化任务命令。仅当 decision_type = "delegate_to_slow" 或 "execute_task" 时出现。 */
export interface CommandPayload {
  /** 命令类型（Phase 0 精简版，4 种） */
  command_type: CommandType;
  /** 任务类型描述 */
  task_type: string;
  /** Manager 压缩后的任务摘要 */
  task_brief: string;
  /** 最终目标 */
  goal: string;
  /** 约束条件列表 */
  constraints?: string[];
  /** 输入材料引用 */
  input_materials?: InputMaterial[];
  /** 输出格式要求 */
  required_output?: RequiredOutput;
  /** 允许使用的工具列表（execute_task 时必填） */
  tools_allowed?: string[];
  /** 优先级 */
  priority?: "low" | "normal" | "high";
  /** 超时秒数建议 */
  timeout_sec?: number;
  /** Worker 类型提示 */
  worker_hint?: WorkerHint;
}

/** Command 的输入材料。 */
export interface InputMaterial {
  type: InputMaterialType;
  content?: string;
  ref_id?: string;
  title?: string;
  importance?: number;
}

/** Manager 对 Worker 产出的格式要求。 */
export interface RequiredOutput {
  format: OutputFormat;
  sections?: string[];
  must_include?: string[];
  max_points?: number;
  tone?: "neutral" | "professional" | "concise";
}

// ── WorkerResult ─────────────────────────────────────────────────────────────

/** Worker → Manager 的结构化结果。Worker 完成后写入 Archive，Manager 读取后统一对外表达。 */
export interface WorkerResult {
  task_id: string;
  worker_type: WorkerHint;
  status: WorkerResultStatus;
  summary: string;
  structured_result: Record<string, unknown>;
  confidence: number;
  ask_for_more_context?: string[];
  error_message?: string;
  /** Worker 执行过程详情（由 worker-prompt.ts parseWorkerResult 填充） */
  execution_details?: {
    steps_taken?: string[];
    sources_used?: string[];
    errors_encountered?: string[];
  };
}

export type WorkerResultStatus =
  | "completed"
  | "partial"
  | "failed"
  | "needs_clarification";

// ── ajv 简化校验 Schema ──────────────────────────────────────────────────────

/**
 * ajv 运行时校验用简化 JSON Schema。
 * 用法：ajv.addSchema(managerDecisionJsonSchema, 'ManagerDecision')
 */
export const managerDecisionJsonSchema = {
  $id: "https://smartrouter.pro/schemas/manager-decision-v1.json",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "decision_type",
    "routing_layer",
    "reason",
    "confidence",
    "needs_archive",
  ],
  properties: {
    schema_version: { type: "string", const: "manager_decision_v1" },
    decision_type: {
      type: "string",
      enum: ["direct_answer", "ask_clarification", "delegate_to_slow", "execute_task"],
    },
    routing_layer: { type: "string", enum: ["L0", "L1", "L2", "L3"] },
    reason: { type: "string", minLength: 1, maxLength: 300 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    needs_archive: { type: "boolean" },
    direct_response: {
      type: "object",
      additionalProperties: false,
      required: ["style", "content"],
      properties: {
        style: { type: "string", enum: ["concise", "natural", "structured"] },
        content: { type: "string", minLength: 1, maxLength: 2000 },
        max_tokens_hint: { type: "integer", minimum: 1, maximum: 2000 },
      },
    },
    clarification: {
      type: "object",
      additionalProperties: false,
      required: ["question_id", "question_text", "clarification_reason"],
      properties: {
        question_id: { type: "string", minLength: 1, maxLength: 100 },
        question_text: { type: "string", minLength: 1, maxLength: 500 },
        options: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "value"],
            properties: {
              label: { type: "string", minLength: 1, maxLength: 200 },
              value: { type: "string", minLength: 1, maxLength: 100 },
            },
          },
          maxItems: 10,
        },
        allow_free_text: { type: "boolean" },
        clarification_reason: { type: "string", minLength: 1, maxLength: 300 },
        missing_fields: {
          type: "array",
          items: { type: "string" },
          maxItems: 20,
        },
      },
    },
    command: {
      type: "object",
      additionalProperties: false,
      required: ["command_type", "task_type", "task_brief", "goal"],
      properties: {
        command_type: {
          type: "string",
          enum: ["delegate_analysis", "delegate_summarization", "execute_plan", "execute_research"],
        },
        task_type: { type: "string", minLength: 1, maxLength: 100 },
        task_brief: { type: "string", minLength: 1, maxLength: 4000 },
        goal: { type: "string", minLength: 1, maxLength: 1000 },
        constraints: {
          type: "array",
          items: { type: "string", maxLength: 300 },
          maxItems: 20,
        },
        input_materials: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["type"],
            properties: {
              type: {
                type: "string",
                enum: ["user_query", "excerpt", "evidence_ref", "memory_ref", "archive_fact"],
              },
              content: { type: "string", maxLength: 4000 },
              ref_id: { type: "string", maxLength: 100 },
              title: { type: "string", maxLength: 200 },
              importance: { type: "number", minimum: 0, maximum: 1 },
            },
          },
          maxItems: 30,
        },
        required_output: {
          type: "object",
          additionalProperties: false,
          properties: {
            format: {
              type: "string",
              enum: ["structured_analysis", "bullet_summary", "answer", "json"],
            },
            sections: { type: "array", items: { type: "string" }, maxItems: 20 },
            must_include: { type: "array", items: { type: "string" }, maxItems: 20 },
            max_points: { type: "integer", minimum: 1, maximum: 20 },
            tone: { type: "string", enum: ["neutral", "professional", "concise"] },
          },
        },
        tools_allowed: { type: "array", items: { type: "string" }, maxItems: 20 },
        priority: { type: "string", enum: ["low", "normal", "high"] },
        timeout_sec: { type: "integer", minimum: 1, maximum: 3600 },
        worker_hint: { type: "string", enum: ["slow_analyst", "execute_worker", "search_worker"] },
      },
    },
  },
  allOf: [
    {
      if: { properties: { decision_type: { const: "direct_answer" } } },
      then: { required: ["direct_response"] },
    },
    {
      if: { properties: { decision_type: { const: "ask_clarification" } } },
      then: { required: ["clarification"] },
    },
    {
      if: { properties: { decision_type: { enum: ["delegate_to_slow", "execute_task"] } } },
      then: { required: ["command"] },
    },
  ],
};

// ── SSE Phase 3.0 事件 ────────────────────────────────────────────────────────

export type SSEEventTypePhase3 =
  | "manager_decision"
  | "clarifying_needed"
  | "command_issued"
  | "archive_written"
  | "worker_started"
  | "worker_progress"
  | "worker_completed"
  | "manager_synthesized"
  | "done"
  | "result"
  | "error"
  | "status"
  | "chunk"
  | "fast_reply";

export interface SSEManagerDecisionEvent {
  type: "manager_decision";
  decision: ManagerDecision;
  timestamp: string;
}

export interface SSECommandIssuedEvent {
  type: "command_issued";
  command_id: string;
  delegated_to: WorkerHint;
  task_id: string;
  timestamp: string;
}

export interface SSEArchiveWrittenEvent {
  type: "archive_written";
  task_id: string;
  archive_id: string;
  decision_type: string;
  routing_layer: string;
  timestamp: string;
}

export interface SSEWorkerStartedEvent {
  type: "worker_started";
  task_id: string;
  command_id: string;
  worker_role: string;
  routing_layer: string;
  timestamp: string;
}

export interface SSEWorkerCompletedEvent {
  type: "worker_completed";
  task_id: string;
  command_id: string;
  worker_type: WorkerHint;
  summary: string;
  timestamp: string;
}

export interface SSEManagerSynthesizedEvent {
  type: "manager_synthesized";
  task_id: string;
  final_content: string;
  confidence: number;
  routing_layer: string;
  timestamp: string;
}

export interface SSEDoneEvent {
  type: "done";
  stream?: string;
  routing_layer?: RoutingLayer;
  archive_id?: string;
  task_id?: string;
}

export interface SSEResultEvent {
  type: "result";
  stream: string;
  routing_layer?: RoutingLayer;
}

export interface SSEErrorEvent {
  type: "error";
  stream?: string;
  routing_layer?: RoutingLayer;
}

export interface SSEStatusEvent {
  type: "status";
  stream: string;
  routing_layer?: RoutingLayer;
}

// ── G4: Delegation Learning Loop ─────────────────────────────────────────────

/**
 * DelegationLog — Gated Delegation v2 的完整决策事实表。
 * G0(LLM原始输出) → G1(系统置信度) → G2(Policy校准) → G3(Rerank) → 执行结果
 */
export interface DelegationLog {
  id: string;
  user_id: string;
  session_id: string;
  turn_id: number;
  task_id?: string;
  routing_version: string;

  // G0: LLM 原始输出
  llm_scores: Record<ManagerDecisionType, number>;
  llm_confidence: number;

  // G1: System Confidence
  system_confidence: number;

  // G2: Policy Calibration
  calibrated_scores: Record<ManagerDecisionType, number>;
  policy_overrides: PolicyOverride[];
  g2_final_action: ManagerDecisionType;

  // G3: Rerank
  did_rerank: boolean;
  rerank_gap?: number;
  rerank_rules: string[];
  g3_final_action?: ManagerDecisionType;
  grayzone_shortcut?: string;

  // 最终路由决策
  routed_action: ManagerDecisionType;
  routing_reason?: string;
  routing_layer?: RoutingLayer;

  // 执行结果（异步回写）
  execution_status?: "pending" | "success" | "failed" | "timeout";
  execution_correct?: boolean;
  error_message?: string;
  model_used?: string;
  latency_ms?: number;
  cost_usd?: number;

  // 统计字段
  selected_role?: "fast" | "slow";
  exec_input_tokens?: number;
  cost_saved_vs_slow?: number;

  // G4: 四层成功标准（异步回填）
  routing_success?: boolean;
  value_success?: "better" | "same" | "worse";
  user_success?: boolean;

  created_at: string;
  executed_at?: string;
}

/** DelegationLog 写入输入（不含 generated 字段） */
export interface DelegationLogInput {
  id?: string;
  user_id: string;
  session_id: string;
  turn_id: number;
  task_id?: string;
  routing_version?: string;
  llm_scores: Record<ManagerDecisionType, number>;
  llm_confidence: number;
  system_confidence: number;
  calibrated_scores: Record<ManagerDecisionType, number>;
  policy_overrides: PolicyOverride[];
  g2_final_action: ManagerDecisionType;
  did_rerank: boolean;
  rerank_gap?: number;
  rerank_rules: string[];
  g3_final_action?: ManagerDecisionType;
  grayzone_shortcut?: string;
  routed_action: ManagerDecisionType;
  routing_reason?: string;
  routing_layer?: RoutingLayer;
  selected_role?: "fast" | "slow";
  routing_success?: boolean;
  value_success?: "better" | "same" | "worse";
  user_success?: boolean;
}

/** DelegationLog 执行结果回写 */
export interface DelegationLogExecutionUpdate {
  execution_status: "success" | "failed" | "timeout";
  execution_correct?: boolean;
  error_message?: string;
  model_used?: string;
  latency_ms?: number;
  cost_usd?: number;
  routing_success?: boolean;
  value_success?: "better" | "same" | "worse";
  user_success?: boolean;
  exec_input_tokens?: number;
  cost_saved_vs_slow?: number;
}

// ── G2: Policy Override ───────────────────────────────────────────────────────

/**
 * PolicyOverride — G2 Policy-Calibrated Gate 对某个动作的修正记录。
 */
export interface PolicyOverride {
  rule: string;
  action: "penalize" | "block" | "boost" | "force";
  target: ManagerDecisionType;
  original_score: number;
  adjusted_score: number;
  reason: string;
}
