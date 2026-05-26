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
} as const;

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
}

export function buildRuntimeTraceExtract(trace: RuntimeTrace): RuntimeTraceExtract {
  const stageTimings: Record<string, number> = {};
  for (const stage of trace.stages) {
    if (stage.durationMs !== undefined) {
      stageTimings[stage.name] = stage.durationMs;
    }
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
  };
}
