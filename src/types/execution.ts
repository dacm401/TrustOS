// SmartRouter Pro — Execution Types (EL-001 / EL-002 / ER-002)
// 依赖：task.ts (StepType, TaskState, CommandStatus), memory.ts (Evidence)

import type { TaskState, CommandStatus } from "./task.js";
import type { Evidence } from "./memory.js";

// ── Execution Plan (EL-002 / EL-003) ──────────────────────────────────────

export type StepType = "reasoning" | "tool_call" | "synthesis" | "unknown";
export type StepStatus = "pending" | "running" | "completed" | "failed" | "blocked";

export interface ExecutionStep {
  id: string;
  title: string;
  type: StepType;
  tool_name?: string;
  tool_args?: Record<string, unknown>;
  depends_on: string[];
  status: StepStatus;
  result?: unknown;
  error?: string;
  /** Optional longer description for step context (e.g. system-prompt generation) */
  description?: string;
}

/**
 * A full execution plan produced by the planner.
 */
export interface ExecutionPlan {
  task_id: string;
  steps: ExecutionStep[];
  current_step_index: number;
}

// ── Execution Result Persistence (ER-002) ────────────────────────────────────

/** Lightweight summary of one execution step (written to execution_results.steps_summary) */
export interface ExecutionStepSummary {
  index: number;
  title: string;
  type: StepType;
  status: "pending" | "in_progress" | "completed" | "failed";
  tool_name?: string;
  error?: string;
}

/** steps_summary JSONB shape stored in execution_results */
export interface ExecutionStepsSummary {
  totalSteps: number;
  completedSteps: number;
  toolCallsExecuted: number;
  steps: ExecutionStepSummary[];
}

/** A completed execution result record */
export interface ExecutionResultRecord {
  id: string;
  task_id: string | null;
  user_id: string;
  session_id: string;
  final_content: string | null;
  steps_summary: ExecutionStepsSummary | null;
  memory_entries_used: string[];
  model_used: string | null;
  tool_count: number;
  duration_ms: number | null;
  reason: string | null;
  created_at: string;
}

/** Input for saving a new execution result */
export interface ExecutionResultInput {
  task_id: string | null;
  user_id: string;
  session_id: string;
  final_content: string;
  steps_summary: ExecutionStepsSummary;
  memory_entries_used?: string[];
  model_used?: string;
  tool_count: number;
  duration_ms?: number;
  reason: string;
}
