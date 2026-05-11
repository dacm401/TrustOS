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
}
