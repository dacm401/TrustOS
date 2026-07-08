// Shared types for dashboard components — replaces `any` throughout the codebase

/** Dashboard today stats */
export interface TodayStats {
  saved_cost: number;
  saving_rate: number;
  satisfaction_proxy: number;
  routing_accuracy: number;
  total_requests: number;
  fast_count: number;
  slow_count: number;
  fallback_count: number;
  avg_latency_ms: number;
  total_tokens: number;
}

/** Growth / learning system */
export interface GrowthData {
  level: number;
  level_name: string;
  level_progress: number;
  satisfaction_rate: number;
  routing_accuracy: number;
  total_saved_usd: number;
  behavioral_memories_count: number;
  milestones: Array<{ event: string; date: string }>;
  recent_learnings: Array<{ learning: string; date: string }>;
  satisfaction_history: Array<{ date: string; value: number }>;
  routing_accuracy_history: Array<{ date: string; value: number }>;
}

/** Token flow for sankey diagram */
export interface TokenFlow {
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  compressed_tokens: number;
  fast_tokens: number;
  slow_tokens: number;
}

/** Dashboard root data */
export interface DashboardData {
  today: TodayStats;
  growth: GrowthData;
  recent_decisions: DecisionRecord[];
  token_flow: TokenFlow;
}

/** Routing sub-object inside a decision */
export interface DecisionRouting {
  selected_role: "fast" | "slow";
  selected_model: string;
  confidence: number;
  scores?: { fast: number; slow: number };
  selection_reason?: string;
  intent?: string;
  routing_layer?: "L0" | "L1" | "L2" | "L3";
}

/** Execution sub-object inside a decision */
export interface DecisionExecution {
  did_fallback: boolean;
  fallback_reason?: string;
  model_used: string;
  input_tokens: number;
  output_tokens: number;
  total_cost_usd: number;
  latency_ms: number;
}

/** Context sub-object inside a decision */
export interface DecisionContext {
  original_tokens?: number;
  compressed_tokens?: number;
  compression_ratio?: number;
}

/** Full decision record (full structure from SSE "done" events) */
export interface DecisionRecord {
  id: string;
  timestamp: number | string;
  routing: DecisionRouting;
  execution: DecisionExecution;
  context?: DecisionContext;
  input_features?: {
    raw_query?: string;
    intent?: string;
    complexity_score?: number;
  };
}

/** Flat decision (from "done" events with simplified structure) */
export interface DecisionFlat {
  id?: string;
  intent?: string;
  selected_model?: string;
  selected_role?: "fast" | "slow";
  confidence?: number;
  routing?: DecisionRouting;
  execution?: DecisionExecution;
  context?: DecisionContext;
}

/** Union type for both full and flat decision shapes */
export type Decision = DecisionRecord | DecisionFlat;

/** Provenance meta — origin and content kind for Context Boundary */
export type ContextOrigin = "user" | "manager" | "worker" | "system" | "tool";
export type ContextContentKind = "chat" | "status" | "thinking" | "artifact" | "brief" | "decision" | "permission" | "unknown";
export interface ProvenanceMeta {
  origin?: ContextOrigin;
  contentKind?: ContextContentKind;
  taskId?: string;
  artifactId?: string;
  summaryForManager?: string;
  routingLayer?: string;
  /** Sprint 58: 当 artifact 是 revision 时，记录它从哪个旧 artifact 修订而来 */
  revisionOfArtifactId?: string;
  revisionOfTaskId?: string;
}

/** S101I: Usage info from worker execution — token/cost metadata */
export interface UsageInfo {
  tokens: { input: number; output: number; total: number };
  cost: { estimated_usd: number; provider: string; model: string };
}

/** SSE stream event — union of all event types emitted by /api/chat */
export interface StreamEvent {
  type?: string;
  stream?: string;
  routing_layer?: "L0" | "L1" | "L2" | "L3";
  thinking_state?: string;
  state?: string;
  content?: string;
  question_id?: string;
  options?: string[];
  decision?: Decision;
  task_id?: string;
  status?: string;
  slowMessage?: string;
  error?: string;
  message?: string;
  /** Context Boundary V0.1: provenance meta */
  meta?: ProvenanceMeta;
  /** S88P: progress event payload */
  progress?: Record<string, unknown>;
  /** S89P: partial result payload */
  partialResult?: Record<string, unknown>;
  /** S92P: terminal summary payload */
  terminalSummary?: Record<string, unknown>;
  /** S97P: token/cost usage */
  usage?: UsageInfo;
}

// ── S100P: Manager Workspace types ─────────────────────────────────────────────

export type SessionStatus =
  | "planning" | "delegated" | "running" | "waiting_approval"
  | "paused" | "completed" | "failed" | "cancelled" | "rolled_back";

export interface AgentSession {
  id: string;
  user_id: string;
  title: string;
  goal?: string;
  status: SessionStatus;
  worker_id?: string;
  delegation_contract?: Record<string, unknown>;
  risk_level?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export type MessageRole = "user" | "manager" | "system";

export interface ManagerMessage {
  id: string;
  user_id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  related_session_id?: string;
  created_at: string;
}

export type RouteType =
  | "normal_conversation"
  | "new_delegated_task"
  | "update_existing_session"
  | "ambiguous_session_reference"
  | "explicit_target_session";

export interface RouteMessageRequest {
  conversationId: string;
  message: string;
  targetSessionId?: string;
}

export interface RouteMessageResponse {
  routeType: RouteType;
  targetSessionId: string | null;
  clarificationRequired: boolean;
  reason: string;
  managerMessage: ManagerMessage;
  createdSession: AgentSession | null;
  sessionEvent: SessionEvent | null;
}

export type SessionEventType =
  | "session_created" | "session_started" | "session_completed"
  | "session_failed" | "session_cancelled" | "session_paused"
  | "session_resumed" | "delegation_created" | "delegation_accepted"
  | "delegation_rejected" | "delegation_failed" | "worker_assigned"
  | "worker_started" | "worker_completed" | "worker_failed"
  | "worker_paused" | "worker_resumed" | "tool_execution_started"
  | "tool_execution_completed" | "tool_execution_failed"
  | "permission_requested" | "permission_granted" | "permission_denied"
  | "permission_expired" | "message_received" | "message_sent"
  | "user_input_required" | "user_input_received" | "plan_created"
  | "plan_updated" | "plan_executed" | "plan_failed"
  | "decision_made" | "decision_reviewed" | "decision_reversed"
  | "risk_assessment" | "risk_mitigated" | "error_occurred"
  | "warning_raised" | "info_logged";

export type SessionEventVisibility =
  | "silent_audit" | "session_timeline" | "approval_required"
  | "manager_chat_summary" | "trust_report_only" | "critical_alert";

export type SessionEventSeverity = "debug" | "info" | "warn" | "error" | "critical";

export interface SessionEvent {
  id: string;
  session_id: string;
  type: SessionEventType;
  summary: string;
  severity: SessionEventSeverity;
  visibility: SessionEventVisibility;
  raw_ref?: string;
  created_at: string;
}
