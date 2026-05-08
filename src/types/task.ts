// SmartRouter Pro — Task + Base Types
// 导出顺序：IntentType → Routing → Chat → Memory → Task → Trace
// ClarifyQuestion/AmbiguitySignal 从 delegation.ts 导入（task.ts 和 delegation.ts 共享）

import type { ClarifyQuestion, AmbiguitySignal } from "./delegation.js";

// ── Intent & Routing ─────────────────────────────────────────────────────────

export type IntentType =
  | "simple_qa"
  | "reasoning"
  | "creative"
  | "code"
  | "math"
  | "translation"
  | "summarization"
  | "chat"
  | "research"
  | "general"   // LLM-native routing: Fast model self-judges, no hardcoded intent
  | "unknown";

export type CompressionLevel = "L0" | "L1" | "L2" | "L3";

export type ModelRole = "fast" | "slow" | "compressor";

export type FeedbackType =
  | "accepted"
  | "regenerated"
  | "edited"
  | "thumbs_up"
  | "thumbs_down"
  | "follow_up_doubt"
  | "follow_up_thanks";

export interface InputFeatures {
  raw_query: string;
  token_count: number;
  intent: IntentType;
  complexity_score: number;
  has_code: boolean;
  has_math: boolean;
  requires_reasoning: boolean;
  conversation_depth: number;
  context_token_count: number;
  language: string;
}

export interface RoutingDecision {
  router_version: string;
  scores: { fast: number; slow: number };
  confidence: number;
  selected_model: string;
  selected_role: ModelRole;
  selection_reason: string;
  fallback_model: string;
  /** Phase 2.0: 显式路由分层（L0/L1/L2/L3） */
  routing_layer?: "L0" | "L1" | "L2" | "L3";
}

export interface CompressionDetail {
  turn_index: number;
  role: "user" | "assistant";
  action: "kept" | "summarized" | "structured" | "removed";
  original_tokens: number;
  compressed_tokens: number;
  summary?: string;
}

export interface ContextResult {
  original_tokens: number;
  compressed_tokens: number;
  compression_level: CompressionLevel;
  compression_ratio: number;
  memory_items_retrieved: number;
  final_messages: ChatMessage[];
  compression_details: CompressionDetail[];
}

/**
 * LLM 执行结果（Fast/Slow 模型输出）。
 * 注意：DB 层对应 ExecutionResultRecord，不要混淆。
 */
export interface ExecutionResponse {
  model_used: string;
  input_tokens: number;
  output_tokens: number;
  total_cost_usd: number;
  latency_ms: number;
  did_fallback: boolean;
  fallback_reason?: string;
  response_text: string;
  quality_score?: number;
}

export interface DecisionRecord {
  id: string;
  user_id: string;
  session_id: string;
  timestamp: number;
  input_features: InputFeatures;
  routing: RoutingDecision;
  context: ContextResult;
  execution: ExecutionResponse;
  feedback?: { type: FeedbackType; score: number; timestamp: number };
  learning_signal?: {
    routing_correct: boolean;
    cost_saved_vs_always_slow: number;
    quality_delta: number;
  };
}

// ── Chat ─────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  metadata?: { tokens?: number; compressed?: boolean; original_content?: string };
  /** Tool calls emitted by the model (assistant messages with Function Calling) */
  tool_calls?: ToolCall[];
  /** ID of the tool call this message is responding to (tool messages only) */
  tool_call_id?: string;
  /** P4: ID of the routing DecisionRecord this message is responding to, used for implicit feedback detection */
  decision_id?: string;
}

export interface ChatRequest {
  user_id: string;
  session_id: string;
  message: string;
  history: ChatMessage[];
  preferences?: { mode: "quality" | "balanced" | "cost"; compression_level?: CompressionLevel };
  /** 前端设置透传：可覆盖后端环境变量 */
  api_key?: string;
  /** 前端设置透传：LLM API 地址，优先于 OPENAI_BASE_URL 环境变量 */
  llm_base_url?: string;
  /** 前端设置透传：优先于 FAST_MODEL 环境变量 */
  fast_model?: string;
  /** 前端设置透传：优先于 SLOW_MODEL 环境变量 */
  slow_model?: string;
  /** EL-003: If true, route this request through TaskPlanner + ExecutionLoop (multi-step execution). */
  execute?: boolean;
  /** T1: Explicit task resumption. If provided, system validates ownership and resumes the task. */
  task_id?: string;
  /** S1: If true, return SSE stream instead of a single JSON response. */
  stream?: boolean;
  /** Phase 3.0: If true, use LLM-Native Manager-Worker routing instead of orchestrator. */
  use_llm_native_routing?: boolean;
}

export interface ChatResponse {
  message: string;
  decision: DecisionRecord;
  /** T1: The task_id associated with this response. Present when a task was created or resumed. */
  task_id?: string;
  /**
   * O-001/O-006: Delegation info — present when slow model is triggered in background.
   * The fast model gives an immediate acknowledgment; the slow result comes via polling
   * as a separate message (wrapped by the fast model with its humanized prompt).
   */
  delegation?: {
    task_id: string;
    status: "triggered";
  };
  /** Phase 3.0: Clarifying info — present when Manager requests user clarification. */
  clarifying?: ClarifyQuestion;
}

// ClarifyQuestion, ClarifyOption, AmbiguitySignal 从 delegation.ts 导入（见文件头部 import）

// ── Identity & Growth ────────────────────────────────────────────────────────

export interface IdentityMemory {
  user_id: string;
  response_style: "concise" | "detailed" | "balanced";
  expertise_level: "beginner" | "intermediate" | "expert";
  domains: string[];
  quality_sensitivity: number;
  cost_sensitivity: number;
  preferred_fast_model: string;
  preferred_slow_model: string;
  updated_at: number;
}

export interface BehavioralMemory {
  id: string;
  user_id: string;
  trigger_pattern: string;
  observation: string;
  learned_action: string;
  strength: number;
  reinforcement_count: number;
  last_activated: number;
  source_decision_ids: string[];
  created_at: number;
}

export interface GrowthProfile {
  user_id: string;
  level: number;
  level_name: string;
  level_progress: number;
  /** @deprecated Use satisfaction_rate. This field previously reflected fake routing_correct data. */
  routing_accuracy: number;
  /**
   * Daily satisfaction rate history (positive feedback / all feedback).
   * Renamed from routing_accuracy_history which was based on routing_correct = always-null.
   */
  satisfaction_history: { date: string; value: number }[];
  cost_saving_rate: number;
  total_saved_usd: number;
  satisfaction_rate: number;
  total_interactions: number;
  behavioral_memories_count: number;
  milestones: { date: string; event: string }[];
  recent_learnings: { date: string; learning: string }[];
}

export interface DashboardData {
  today: {
    total_requests: number;
    fast_count: number;
    slow_count: number;
    fallback_count: number;
    total_tokens: number;
    total_cost: number;
    saved_cost: number;
    saving_rate: number;
    avg_latency_ms: number;
    /**
     * Proxy metric for routing quality: satisfaction rate (positive feedback / all feedback).
     * Renamed from routing_accuracy which was a pseudo-metric backed by always-null routing_correct.
     */
    satisfaction_proxy: number;
  };
  token_flow: { fast_tokens: number; slow_tokens: number; compressed_tokens: number; fallback_tokens: number };
  recent_decisions: DecisionRecord[];
  growth: GrowthProfile;
}

export interface ModelPricing {
  model: string;
  input_per_1k: number;
  output_per_1k: number;
}

// ── Memory entries (MC-001) ──────────────────────────────────────────────────

export type MemoryCategory = "preference" | "fact" | "context" | "instruction" | "skill" | "behavioral";
export type MemorySource = "manual" | "extracted" | "feedback" | "auto_learn";

export interface MemoryEntry {
  id: string;
  user_id: string;
  category: MemoryCategory;
  content: string;
  importance: number;   // 1–5
  tags: string[];
  source: MemorySource;
  relevance_score: number; // 0.0–1.0, defaults to 0.5
  created_at: string;   // ISO 8601 string (outward API)
  updated_at: string;
}

export interface MemoryEntryInput {
  user_id: string;
  category: MemoryCategory;
  content: string;
  importance?: number;   // defaults to 3
  tags?: string[];
  source?: MemorySource;
  relevance_score?: number; // defaults based on source (manual=0.5, auto_learn=0.3)
}

export interface MemoryEntryUpdate {
  content?: string;
  importance?: number;
  tags?: string[];
  category?: MemoryCategory;
}

// ── Task Entities ─────────────────────────────────────────────────────────────

export type TaskMode = "direct" | "research" | "execute";
export type TaskStatus = "pending" | "running" | "waiting_subagent" | "completed" | "failed" | "blocked";
export type ComplexityLevel = "low" | "medium" | "high";
export type RiskLevel = "low" | "medium" | "high";

export interface Task {
  task_id: string;
  user_id: string;
  session_id: string;
  title: string;
  mode: TaskMode;
  status: TaskStatus;
  complexity: ComplexityLevel;
  risk: RiskLevel;
  goal: string | null;
  budget_profile: Record<string, any>;
  tokens_used: number;
  tool_calls_used: number;
  steps_used: number;
  summary_ref: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskListItem {
  task_id: string;
  title: string;
  mode: TaskMode;
  status: TaskStatus;
  complexity: ComplexityLevel;
  risk: RiskLevel;
  updated_at: string;
  session_id: string;
}

export interface TaskSummary {
  task_id: string;
  summary_id: string;
  goal: string | null;
  confirmed_facts: string[];
  completed_steps: string[];
  blocked_by: string[];
  next_step: string | null;
  summary_text: string | null;
  version: number;
  updated_at: string;
}

export type TraceType =
  | "classification"
  | "routing"
  | "response"
  | "planning"
  | "guardrail"
  | "step_start"
  | "step_complete"
  | "step_failed"
  | "loop_start"
  | "loop_end"
  | "error"
  // O-001: Orchestrator trace types
  | "orchestrator_delegated"
  | "orchestrator_delegation_failed";

export interface TaskTrace {
  trace_id: string;
  task_id: string;
  type: TraceType;
  detail: Record<string, any> | null;
  created_at: string;
}

/** Human-readable summary of a trace */
export interface TraceSummary {
  trace_id: string;
  type: TraceType;
  summary: string;
  created_at: string;
}

// ── Tool System (EL-001) ─────────────────────────────────────────────────────

export type ToolScope = "internal" | "external";

export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required: boolean;
  enum?: string[];
}

/**
 * Tool definition — the contract between the model and the execution layer.
 * Used for both Function Calling schema injection and lightweight parse validation.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
  scope: ToolScope;
}

/**
 * A tool invocation issued by the model.
 */
export interface ToolCall {
  id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
}

/**
 * Result of executing a single tool call.
 */
export interface ToolResult {
  call_id: string;
  tool_name: string;
  success: boolean;
  result: unknown;
  error?: string;
  latency_ms: number;
}

// ── Task Archive Repository Types ───────────────────────────────────────────

/** Phase 3.1: task_archives.state 枚举（写入侧强类型） */
export type TaskState =
  | "new"
  | "clarifying"
  | "delegated"
  | "executing"
  | "waiting_result"
  | "synthesizing"
  | "completed"
  | "failed"
  | "cancelled";

export type CommandStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** task_archives 表记录（Phase 3.0 扩展版） */
export interface TaskArchiveRecord {
  id: string;
  session_id: string;
  turn_id: number;
  command: Record<string, unknown> | null;
  user_input: string;
  constraints: string[];
  task_type: string;
  task_brief: Record<string, unknown> | null;
  /** Phase 3.0: Manager 决策 JSONB */
  manager_decision: Record<string, unknown> | null;
  fast_observations: Record<string, unknown>[];
  slow_execution: Record<string, unknown> | null;
  state: TaskState;
  status: CommandStatus;
  delivered: boolean;
  created_at: string;
  updated_at: string;
}

/** task_commands 表记录（Phase 3.0 新表） */
export interface TaskCommandRecord {
  id: string;
  task_id: string;
  archive_id: string;
  user_id: string;
  issuer_role: string;
  command_type: string;
  worker_hint: string | null;
  priority: string;
  status: CommandStatus;
  payload_json: Record<string, unknown>;
  idempotency_key: string | null;
  timeout_sec: number | null;
  issued_at: string;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
}

/** task_worker_results 表记录（Phase 3.0 新表） */
export interface TaskWorkerResultRecord {
  id: string;
  task_id: string;
  archive_id: string;
  command_id: string;
  user_id: string;
  worker_role: string;
  result_type: string;
  status: string;
  summary: string;
  result_json: Record<string, unknown>;
  confidence: number | null;
  tokens_input: number | null;
  tokens_output: number | null;
  cost_usd: number | null;
  started_at: string | null;
  completed_at: string;
  error_message: string | null;
}

// ── Prompt Template System (Sprint 62) ───────────────────────────────────────

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  version: number;
  content: PromptTemplateContent;
  scope: "global" | "user_id" | "session_id";
  is_active: boolean;
  created_by: string;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface PromptTemplateContent {
  /** 核心规则列表 */
  core_rules: string[];
  /** 场景策略映射 */
  mode_policy: Record<string, string>;
  /** 决策 JSON Schema 描述 */
  decision_schema: {
    fields: string[];
    format: "json" | "yaml";
    example?: string;
  };
  /** 授权规则 */
  authorization_rules: {
    fast: string[];
    slow: string[];
  };
  /** Sprint 65: 信息安全规则（Fast 守门人 PII 管控） */
  security_and_permissions?: {
    blocked?: string[];
    important?: string[];
    necessary?: string[];
    principle?: string;
  };
  /** Sprint 65: Worker 委托规则 */
  worker_delegation?: string[];
  /** Hook 钩子映射 */
  hooks?: Record<string, string>;
  /** 变量定义 */
  variable_definitions?: PromptVariable[];
}

export interface PromptVariable {
  name: string;
  source: "memory" | "context" | "session" | "user" | "computed";
  description: string;
  required?: boolean;
}

export interface PromptTemplateInput {
  name: string;
  description?: string;
  content: PromptTemplateContent;
  scope?: "global" | "user_id" | "session_id";
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface PromptTemplateUpdate {
  name?: string;
  description?: string;
  content?: PromptTemplateContent;
  is_active?: boolean;
  tags?: string[];
  metadata?: Record<string, unknown>;
}
