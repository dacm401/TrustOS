/**
 * S84P: Runtime Trace Types — Lightweight performance observability
 *
 * Design principles:
 * - Unified envelope: aggregates existing scattered timing (RequestLedger, CycleAudit, CallLedgerEntry)
 * - Non-invasive: only created at SSE entry/exit, no existing code path changes
 * - Pure observation: never affects execution decisions or error handling
 *
 * Stages follow the actual execution order:
 *   intent_classify → cross_session_context → manager_view_build →
 *   manager_routing → worker_execution → cycle_runtime → verification →
 *   sse_done
 */

// ── Stage Types ─────────────────────────────────────────────────────────────

export interface RuntimeTraceStage {
  /** Stage identifier */
  name: string;
  /** Start timestamp (Date.now()) */
  startedAt: number;
  /** End timestamp (Date.now()) — undefined if stage not yet completed */
  endedAt?: number;
  /** Duration in ms — undefined if stage not yet completed */
  durationMs?: number;
}

// ── Counter Types ───────────────────────────────────────────────────────────

export interface RuntimeTraceCounters {
  /** Total model calls (manager + worker) */
  modelCalls: number;
  /** Tool calls (execute worker path only) */
  toolCalls: number;
  /** Verifier calls (cycle runtime) */
  verifierCalls: number;
  /** Cycle iterations completed */
  cycles: number;
  /** Human review requests triggered */
  humanReviewCount: number;
}

// ── Trace Type ──────────────────────────────────────────────────────────────

/**
 * A unified runtime trace for a single /chat request.
 *
 * Populated incrementally:
 * 1. Created at SSE entry (chat.ts line ~60)
 * 2. Stages added as execution progresses
 * 3. Finalized at SSE done event (chat.ts line ~605)
 * 4. Emitted in doneObj.runtimeTrace field
 *
 * Stages are ordered by execution flow. Some stages may be skipped
 * depending on the request type (e.g., direct_answer has no worker stage).
 */
export interface RuntimeTrace {
  /** Unique trace ID (matches RequestLedger.traceId) */
  traceId: string;
  /** Request start timestamp (Date.now()) */
  startedAt: number;
  /** Request end timestamp — undefined until finalized */
  endedAt?: number;
  /** Total request duration in ms — undefined until finalized */
  totalDurationMs?: number;

  /** Ordered execution stages */
  stages: RuntimeTraceStage[];

  /** Execution counters */
  counters: RuntimeTraceCounters;

  /** Final request status — undefined until finalized */
  finalStatus?: string;
  /** Failure reason (if any) */
  failureReason?: string;

  /** Routing decision metadata */
  routing?: {
    decisionType: string;
    policyRoute: string;
    routingLayer: string;
    delegation: boolean;
  };

  /** Cycle runtime summary (if cycle was executed) */
  cycleSummary?: {
    totalCycles: number;
    maxCycles: number;
    finalStatus: string;
    cycleAuditMs: number;
  };

  /** Worker model call summary (if worker was invoked) */
  workerSummary?: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    latencyMs: number;
    modelName: string;
  };

  /** Ledger summary (from RequestLedger) */
  ledgerSummary?: {
    totalLatencyMs: number;
    totalModelCalls: number;
    managerModelCalls: number;
    slowModelCalls: number;
    routerTaxRatio: number;
    estimatedTotalCost: number | null;
  };

  /** S85P: Fast path metadata */
  fastPath?: RuntimeTraceFastPath;

  /** S86P: LLM call records (all calls within this request) */
  llmCalls?: RuntimeTraceLlmCall[];

  /** S87P: Per-request LLM call budget */
  budget?: LlmCallBudget;

  /** S88P: Current progress / LLM wait state */
  progress?: RuntimeProgressState;
}

// ── S86P: LLM Call Observability ────────────────────────────────────────────

/**
 * Classification of an LLM call's role in the system.
 * Used for per-kind counting and observability.
 */
export type LlmCallKind =
  | "worker"
  | "manager"
  | "manager_synthesis"
  | "execution_loop"
  | "planner"
  | "compressor"
  | "unknown";

/**
 * A single LLM call record.
 * SAFETY: never records prompt, completion content, tool arguments, or user data.
 * Only metadata: timing, provider, model, success/failure.
 */
export interface RuntimeTraceLlmCall {
  /** Unique call ID within the trace */
  id: string;
  /** What kind of system role triggered this call */
  kind: LlmCallKind;
  /** Provider name (e.g. "openai", "anthropic") */
  provider?: string;
  /** Model name used for this call */
  model?: string;
  /** Call start timestamp (Date.now()) */
  startedAt: number;
  /** Call end timestamp — undefined if still in-flight */
  endedAt?: number;
  /** Call duration in ms — undefined if still in-flight */
  durationMs?: number;
  /** Whether the call completed successfully */
  success: boolean;
  /** Error code if the call failed (short string, not the full error message) */
  errorCode?: string;
  /** S87P: True if this call has same (kind, model) as the immediately preceding call */
  duplicateWarning?: boolean;
  /** S88P: True if this call's duration exceeded the slow threshold */
  slowCallWarning?: boolean;
}

/**
 * Summary of all LLM calls in a trace.
 * Included in RuntimeTraceExtract for SSE done event.
 */
export interface RuntimeTraceLlmCallSummary {
  /** Total number of LLM calls */
  total: number;
  /** Counts grouped by kind */
  byKind: Record<string, number>;
}

// ── S88P: Progress & Wait Visibility Types ────────────────────────────────────

/** Threshold for flagging an LLM call as "slow" (milliseconds). */
export const SLOW_LLM_CALL_THRESHOLD_MS = 5000;

/**
 * Safe snapshot of the current runtime progress state.
 * NO prompt, content, tool arguments, or user data.
 */
export interface RuntimeProgressState {
  /** Current execution stage name */
  stage: string;
  /** When this stage started (timestamp) */
  stageStartedAt: number;
  /** Elapsed ms in the current stage */
  stageElapsedMs: number;
  /** What kind of LLM call is currently in-flight (null if idle) */
  llmWaitKind?: LlmCallKind;
  /** Model being waited on (null if idle) */
  llmWaitModel?: string;
  /** When the current LLM wait started (timestamp) */
  llmWaitStartedAt?: number;
  /** Elapsed ms of current LLM wait (0 if idle) */
  llmWaitElapsedMs?: number;
  /** Whether any LLM call in this request has been slow */
  hasSlowCall: boolean;
  /** Whether currently waiting on an LLM call that has already exceeded the slow threshold */
  isWaitingOnSlowCall: boolean;
}

/**
 * Summary of slow LLM calls in a trace.
 * Only populated when at least one call exceeds the threshold.
 */
export interface RuntimeSlowCallSummary {
  /** Number of LLM calls that exceeded the slow threshold */
  count: number;
  /** Kind of the slowest call */
  slowestKind: string;
  /** Model of the slowest call */
  slowestModel?: string;
  /** Duration of the slowest call (ms) */
  slowestDurationMs: number;
  /** Threshold used for slow detection (ms) */
  thresholdMs: number;
}

// ── S87P: LLM Call Budget Types ──────────────────────────────────────────────

export type LlmCallBudgetWarningKind = "over_budget" | "near_budget" | "duplicate_consecutive";

export interface LlmCallBudgetWarning {
  kind: LlmCallBudgetWarningKind;
  message: string;
  /** The llmCallSeq at which this warning was generated */
  atCallSeq: number;
}

export interface LlmCallBudget {
  /** Maximum allowed LLM calls for this request */
  maxTotalCalls: number;
  /** Warnings generated during execution */
  warnings: LlmCallBudgetWarning[];
}

export interface RuntimeTraceBudgetStatus {
  /** Actual total LLM calls made */
  total: number;
  /** Budget cap */
  max: number;
  /** Whether budget was exceeded */
  overBudget: boolean;
}

// ── S85P: Fast Path Types ──────────────────────────────────────────────────

export interface RuntimeTraceFastPath {
  /** Whether the task was eligible for fast path */
  eligible: boolean;
  /** Whether the fast path was actually used */
  used: boolean;
  /** Reason code from classifier */
  reasonCode: string;
  /** Stages that were skipped by the fast path */
  skippedStages: string[];
  /**
   * Estimated additional cycle-driven Worker LLM calls prevented.
   * 1 = fast path bypassed cycle runtime; actual saved calls may be 0
   *     if normal cycle would not trigger revise/rewrite.
   * This is a conservative estimate, not measured live LLM call counts.
   */
  estimatedRoundTripsSaved: number;
}

// ── Well-known stage names ──────────────────────────────────────────────────

export const RUNTIME_TRACE_STAGES = {
  INTENT_CLASSIFY: "intent_classify",
  CROSS_SESSION_CONTEXT: "cross_session_context",
  MANAGER_VIEW_BUILD: "manager_view_build",
  MANAGER_ROUTING: "manager_routing",
  WORKER_EXECUTION: "worker_execution",
  CYCLE_RUNTIME: "cycle_runtime",
  VERIFICATION: "verification",
  SSE_DONE_PREPARE: "sse_done_prepare",
} as const;

export type RuntimeTraceStageName = typeof RUNTIME_TRACE_STAGES[keyof typeof RUNTIME_TRACE_STAGES];

// ── Well-known final statuses ───────────────────────────────────────────────

export const RUNTIME_TRACE_FINAL_STATUS = {
  SUCCESS: "success",
  QUICK_REPLY: "quick_reply",
  DIRECT_ANSWER: "direct_answer",
  DELEGATION_COMPLETE: "delegation_complete",
  FAILED: "failed",
  TIMEOUT: "timeout",
  /** S90P: Task was cancelled by user via PATCH /v1/tasks/:id cancel */
  CANCELLED: "cancelled",
  /** S91P: Task was stopped by timeout policy (soft or hard threshold exceeded) */
  TIMED_OUT: "timed_out",
} as const;

// ── S91P: Timeout Policy Types ──────────────────────────────────────────────────

/** Default soft timeout threshold in milliseconds (2 minutes). */
export const TASK_SOFT_TIMEOUT_MS = Number(process.env["TASK_SOFT_TIMEOUT_MS"]) || 120_000;

/** Default hard timeout threshold in milliseconds (5 minutes). */
export const TASK_HARD_TIMEOUT_MS = Number(process.env["TASK_HARD_TIMEOUT_MS"]) || 300_000;

/** Kind of timeout that triggered the stop. */
export type TimeoutKind = "soft" | "hard";

// ── Ledger Extract (safe subset for SSE done payload) ───────────────────────

/**
 * Minimal extract of RuntimeTrace for SSE done event.
 * Excludes raw stages array to keep payload small.
 */
export interface RuntimeTraceExtract {
  traceId: string;
  totalDurationMs: number;
  finalStatus: string;
  failureReason?: string;
  stageCount: number;
  /** Stage name → duration map (only completed stages) */
  stageTimings: Record<string, number>;
  counters: RuntimeTraceCounters;
  cycleSummary?: RuntimeTrace["cycleSummary"];
  workerSummary?: RuntimeTrace["workerSummary"];
  ledgerSummary?: RuntimeTrace["ledgerSummary"];
  routing?: RuntimeTrace["routing"];
  fastPath?: RuntimeTrace["fastPath"];
  /** S86P: LLM call summary (by-kind counts only, no per-call details in extract) */
  llmCallSummary?: RuntimeTraceLlmCallSummary;
  /** S87P: Budget status (only when budget is set) */
  budgetStatus?: RuntimeTraceBudgetStatus;
  /** S87P: Number of calls flagged as duplicate */
  duplicateCount: number;
  /** S88P: Final progress state snapshot */
  progress?: RuntimeProgressState;
  /** S88P: Slow LLM calls summary (only when slow calls detected) */
  slowCallSummary?: RuntimeSlowCallSummary;
}

// ── S89P: Partial Result Types ──────────────────────────────────────────────

/**
 * A single partial worker result captured during Cycle Runtime execution.
 * SAFETY: content is worker-presentable text only — no prompt, messages,
 * tool arguments, or API keys.
 */
export interface PartialResult {
  /** Sequential index within this request (0-based) */
  index: number;
  /** Worker-presentable content (truncated for SSE, full content in archive) */
  content: string;
  /** Which cycle iteration produced this result (undefined for non-cycle) */
  cycleIndex?: number;
  /** When this partial result was captured (Date.now()) */
  timestamp: number;
}

/** Max characters for partial_result content in SSE events (privacy + payload size). */
export const PARTIAL_RESULT_MAX_LENGTH = 500;

/**
 * Truncate worker content to a safe preview length for SSE partial_result events.
 * Ensures we never emit full-length content in progress events.
 */
export function truncatePartialContent(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= PARTIAL_RESULT_MAX_LENGTH) return trimmed;
  return trimmed.substring(0, PARTIAL_RESULT_MAX_LENGTH) + "…";
}

export function buildRuntimeTraceExtract(trace: RuntimeTrace): RuntimeTraceExtract {
  const stageTimings: Record<string, number> = {};
  for (const stage of trace.stages) {
    if (stage.durationMs !== undefined) {
      stageTimings[stage.name] = stage.durationMs;
    }
  }

  const llmCalls = trace.llmCalls ?? [];

  // S88P: Build slow call summary
  let slowCallSummary: RuntimeSlowCallSummary | undefined;
  const slowCalls = llmCalls.filter(c => c.slowCallWarning);
  if (slowCalls.length > 0) {
    let slowest = slowCalls[0];
    for (const c of slowCalls) {
      if ((c.durationMs ?? 0) > (slowest.durationMs ?? 0)) {
        slowest = c;
      }
    }
    slowCallSummary = {
      count: slowCalls.length,
      slowestKind: slowest.kind,
      slowestModel: slowest.model,
      slowestDurationMs: slowest.durationMs ?? 0,
      thresholdMs: SLOW_LLM_CALL_THRESHOLD_MS,
    };
  }

  return {
    traceId: trace.traceId,
    totalDurationMs: trace.totalDurationMs ?? 0,
    finalStatus: trace.finalStatus ?? "unknown",
    failureReason: trace.failureReason,
    stageCount: trace.stages.length,
    stageTimings,
    counters: { ...trace.counters },
    cycleSummary: trace.cycleSummary,
    workerSummary: trace.workerSummary,
    ledgerSummary: trace.ledgerSummary,
    routing: trace.routing,
    fastPath: trace.fastPath,
    llmCallSummary: llmCalls.length > 0
      ? {
          total: llmCalls.length,
          byKind: llmCalls.reduce(
            (acc, c) => {
              acc[c.kind] = (acc[c.kind] || 0) + 1;
              return acc;
            },
            {} as Record<string, number>
          ),
        }
      : undefined,
    // S87P: Budget status
    budgetStatus: trace.budget
      ? {
          total: llmCalls.length,
          max: trace.budget.maxTotalCalls,
          overBudget: llmCalls.length > trace.budget.maxTotalCalls,
        }
      : undefined,
    // S87P: Duplicate count
    duplicateCount: llmCalls.filter(c => c.duplicateWarning).length,
    // S88P: Progress state (snapshot at extract time)
    progress: trace.progress ? { ...trace.progress } : undefined,
    // S88P: Slow call summary
    slowCallSummary,
  };
}
