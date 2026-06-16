/**
 * S84P: Runtime Trace — Lightweight instrumentation helpers
 *
 * Usage pattern:
 *   const trace = createTrace(traceId);
 *   const t = startStage(trace, "some_stage");
 *   // ... do work ...
 *   endStage(trace, "some_stage", t);
 *   // ... more stages ...
 *   finalizeTrace(trace, "success");
 *   const extract = buildRuntimeTraceExtract(trace);
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type {
  RuntimeTrace,
  RuntimeTraceStageName,
  RuntimeTraceCounters,
  RuntimeTraceLlmCall,
  LlmCallKind,
  LlmCallBudget,
  RuntimeProgressState,
} from "../types/runtime-trace.js";
import { buildRuntimeTraceExtract, SLOW_LLM_CALL_THRESHOLD_MS } from "../types/runtime-trace.js";
export { buildRuntimeTraceExtract };

// ── S86P: Request-scoped trace context ──────────────────────────────────────
// Uses AsyncLocalStorage for per-request isolate trace context.
// chat.ts wraps the SSE request handler in runWithRequestTrace().
// model-gateway.ts reads the store via getRequestTrace() to auto-record LLM calls.
//
// Fallback: a module-level store exists for environments where
// AsyncLocalStorage.enterWith() cannot propagate to getStore() (e.g., tests
// without a parent run() context). Production code MUST use runWithRequestTrace().

const runtimeTraceStorage = new AsyncLocalStorage<{
  trace: RuntimeTrace;
  llmCallSeq: number;
}>();

/** Module-level fallback store. Only used when AsyncLocalStorage.getStore() returns null.
 *  Not safe for concurrent requests — production code uses runWithRequestTrace(). */
let _fallbackStore: { trace: RuntimeTrace; llmCallSeq: number } | null = null;

/** Get current store from ALS or fallback. */
function _getStore(): { trace: RuntimeTrace; llmCallSeq: number } | null {
  return runtimeTraceStorage.getStore() ?? _fallbackStore;
}

/**
 * Run an async function with the given trace as the current request trace.
 * This ensures correct trace isolation even under concurrent requests.
 * Preferred over setRequestTrace/clearRequestTrace for production paths.
 */
export function runWithRequestTrace<T>(
  trace: RuntimeTrace,
  fn: () => T | Promise<T>
): T | Promise<T> {
  // Initialize llmCalls array on the trace if not present
  if (!trace.llmCalls) {
    trace.llmCalls = [];
  }
  return runtimeTraceStorage.run({ trace, llmCallSeq: 0 }, fn);
}

/**
 * Get the active trace for the current async context (may be null).
 * Safe to call from any async context — returns null when no trace is active.
 */
export function getRequestTrace(): RuntimeTrace | null {
  return _getStore()?.trace ?? null;
}

/**
 * Legacy API: set the active trace for the current request.
 * Prefer runWithRequestTrace() for production paths.
 * Kept for test compatibility — uses enterWith() + module-level fallback.
 *
 * NOTE: enterWith() binds to the current sync execution context.
 * For async production paths, use runWithRequestTrace() instead.
 */
export function setRequestTrace(trace: RuntimeTrace | null): void {
  if (trace) {
    if (!trace.llmCalls) {
      trace.llmCalls = [];
    }
    const store = { trace, llmCallSeq: 0 };
    _fallbackStore = store;
    // enterWith transitions the current execution context into the store.
    // When called within a run() context, getStore() will see this.
    // When called outside run() (e.g., test root), the fallback covers it.
    runtimeTraceStorage.enterWith(store);
  } else {
    _fallbackStore = null;
  }
}

/** Record an LLM call to the current request's trace. Safe to call when no trace is active. */
export function recordLlmCall(
  kind: LlmCallKind,
  model?: string,
  startedAt?: number,
  endedAt?: number,
  success?: boolean,
  errorCode?: string,
): RuntimeTraceLlmCall | null {
  const store = _getStore();
  if (!store) return null;
  const trace = store.trace;
  if (!trace.llmCalls) trace.llmCalls = [];

  const durationMs = startedAt && endedAt ? endedAt - startedAt : undefined;

  // S87P: Duplicate detection — check if previous call has same (kind, model)
  let isDuplicate = false;
  const prevCalls = trace.llmCalls;
  if (prevCalls.length > 0) {
    const prev = prevCalls[prevCalls.length - 1];
    isDuplicate = prev.kind === kind && prev.model === model && prev.success;
  }

  const call: RuntimeTraceLlmCall = {
    id: `${trace.traceId}_llm_${String(store.llmCallSeq++).padStart(3, "0")}`,
    kind,
    model,
    startedAt: startedAt ?? Date.now(),
    endedAt,
    durationMs,
    success: success ?? false,
    errorCode,
  };
  // Only set duplicateWarning when it IS a duplicate (leave undefined otherwise)
  if (isDuplicate) {
    call.duplicateWarning = true;
  }

  trace.llmCalls.push(call);
  // counters.modelCalls always reflects actual llmCalls.length (source of truth)
  trace.counters.modelCalls = trace.llmCalls.length;

  // S88P: Slow call detection — mark calls exceeding threshold
  if (durationMs !== undefined && durationMs > SLOW_LLM_CALL_THRESHOLD_MS) {
    call.slowCallWarning = true;
    if (trace.progress) {
      trace.progress.hasSlowCall = true;
    }
  }

  // S88P: Update wait state — clear in-flight LLM wait
  if (trace.progress && trace.progress.llmWaitKind) {
    trace.progress.llmWaitKind = undefined;
    trace.progress.llmWaitModel = undefined;
    trace.progress.llmWaitStartedAt = undefined;
    trace.progress.llmWaitElapsedMs = undefined;
    trace.progress.isWaitingOnSlowCall = false;
  }

  // S87P: Budget checks
  if (trace.budget) {
    const budget = trace.budget;
    const total = trace.llmCalls.length;
    const callSeq = store.llmCallSeq - 1; // seq was already incremented

    if (total > budget.maxTotalCalls) {
      budget.warnings.push({
        kind: "over_budget",
        message: `LLM call ${total}/${budget.maxTotalCalls} exceeds budget`,
        atCallSeq: callSeq,
      });
    } else if (total >= budget.maxTotalCalls * 0.8) {
      // near_budget: only warn once
      const alreadyWarnedNear = budget.warnings.some(w => w.kind === "near_budget");
      if (!alreadyWarnedNear) {
        budget.warnings.push({
          kind: "near_budget",
          message: `LLM calls approaching budget (${total}/${budget.maxTotalCalls})`,
          atCallSeq: callSeq,
        });
      }
    }

    if (isDuplicate) {
      budget.warnings.push({
        kind: "duplicate_consecutive",
        message: `Consecutive ${kind} calls with same model "${model || "unknown"}" detected`,
        atCallSeq: callSeq,
      });
    }
  }

  return call;
}

// ── Trace lifecycle ────────────────────────────────────────────────────────

/** Create a new empty trace. */
export function createTrace(traceId: string): RuntimeTrace {
  return {
    traceId,
    startedAt: Date.now(),
    stages: [],
    counters: {
      modelCalls: 0,
      toolCalls: 0,
      verifierCalls: 0,
      cycles: 0,
      humanReviewCount: 0,
    },
  };
}

/** Record stage start. Returns the start timestamp for passing to endStage(). */
export function startStage(trace: RuntimeTrace, name: RuntimeTraceStageName | string): number {
  const now = Date.now();
  trace.stages.push({ name, startedAt: now });
  return now;
}

/** Record stage end. Updates the most recent stage with the matching name. */
export function endStage(trace: RuntimeTrace, name: RuntimeTraceStageName | string, startedAt: number): void {
  const now = Date.now();
  // Find the most recent stage with this name
  for (let i = trace.stages.length - 1; i >= 0; i--) {
    if (trace.stages[i].name === name && trace.stages[i].endedAt === undefined) {
      trace.stages[i].endedAt = now;
      trace.stages[i].durationMs = now - startedAt;
      return;
    }
  }
  // Fallback: append if not found (shouldn't happen in normal flow)
  trace.stages.push({ name, startedAt, endedAt: now, durationMs: now - startedAt });
}

/** Convenience: wrap an async operation in a stage. */
export async function traceStage<T>(
  trace: RuntimeTrace,
  name: RuntimeTraceStageName | string,
  fn: () => Promise<T>
): Promise<T> {
  const t = startStage(trace, name);
  try {
    return await fn();
  } finally {
    endStage(trace, name, t);
  }
}

// ── Trace finalization ─────────────────────────────────────────────────────

/** Finalize trace with status and optional failure reason. */
export function finalizeTrace(
  trace: RuntimeTrace,
  finalStatus: string,
  failureReason?: string
): RuntimeTrace {
  trace.endedAt = Date.now();
  trace.totalDurationMs = trace.endedAt - trace.startedAt;
  trace.finalStatus = finalStatus;
  if (failureReason) {
    trace.failureReason = failureReason;
  }
  return trace;
}

// ── Counter helpers ────────────────────────────────────────────────────────

/** Update trace counters from external data. */
export function updateTraceCounters(
  trace: RuntimeTrace,
  updates: Partial<RuntimeTraceCounters>
): void {
  Object.assign(trace.counters, updates);
}

/** Update routing metadata. */
export function updateTraceRouting(
  trace: RuntimeTrace,
  routing: RuntimeTrace["routing"]
): void {
  trace.routing = routing;
}

/** Update cycle summary. */
export function updateTraceCycleSummary(
  trace: RuntimeTrace,
  summary: NonNullable<RuntimeTrace["cycleSummary"]>
): void {
  trace.cycleSummary = summary;
}

/** Update worker summary. */
export function updateTraceWorkerSummary(
  trace: RuntimeTrace,
  summary: NonNullable<RuntimeTrace["workerSummary"]>
): void {
  trace.workerSummary = summary;
}

/** Update ledger summary. */
export function updateTraceLedgerSummary(
  trace: RuntimeTrace,
  summary: NonNullable<RuntimeTrace["ledgerSummary"]>
): void {
  trace.ledgerSummary = summary;
}

/** S85P: Update fast path metadata. */
export function updateTraceFastPath(
  trace: RuntimeTrace,
  fastPath: NonNullable<RuntimeTrace["fastPath"]>
): void {
  trace.fastPath = fastPath;
}

// ── S87P: LLM Call Budget ───────────────────────────────────────────────────

/**
 * Set a per-request LLM call budget on the trace.
 * Call once at SSE entry, before any LLM calls are made.
 */
export function setTraceBudget(trace: RuntimeTrace, maxTotalCalls: number): void {
  trace.budget = {
    maxTotalCalls,
    warnings: [],
  };
}

// ── S88P: Progress & LLM Wait Visibility ──────────────────────────────────────

/**
 * Update the trace's progress state to a new stage.
 * Clears any previous LLM wait state since we're starting a new stage.
 */
export function updateTraceProgress(
  trace: RuntimeTrace,
  stage: string,
): void {
  const now = Date.now();
  if (!trace.progress) {
    trace.progress = {
      stage,
      stageStartedAt: now,
      stageElapsedMs: 0,
      hasSlowCall: false,
      isWaitingOnSlowCall: false,
    };
  } else {
    trace.progress.stage = stage;
    trace.progress.stageStartedAt = now;
    trace.progress.stageElapsedMs = 0;
    // Clear previous LLM wait state on stage transition
    trace.progress.llmWaitKind = undefined;
    trace.progress.llmWaitModel = undefined;
    trace.progress.llmWaitStartedAt = undefined;
    trace.progress.llmWaitElapsedMs = undefined;
    trace.progress.isWaitingOnSlowCall = false;
  }
}

/**
 * Mark the beginning of an LLM wait — the system is now waiting on an LLM call.
 * Safe: only records kind + model, no prompt/content.
 */
export function beginLlmWait(
  trace: RuntimeTrace,
  kind: LlmCallKind,
  model?: string,
): void {
  const now = Date.now();
  if (!trace.progress) {
    trace.progress = {
      stage: "unknown",
      stageStartedAt: now,
      stageElapsedMs: 0,
      llmWaitKind: kind,
      llmWaitModel: model,
      llmWaitStartedAt: now,
      llmWaitElapsedMs: 0,
      hasSlowCall: false,
      isWaitingOnSlowCall: false,
    };
  } else {
    trace.progress.llmWaitKind = kind;
    trace.progress.llmWaitModel = model;
    trace.progress.llmWaitStartedAt = now;
    trace.progress.llmWaitElapsedMs = 0;
  }
  // Also refresh stage elapsed
  trace.progress.stageElapsedMs = now - trace.progress.stageStartedAt;
}

/**
 * End the current LLM wait (called when an LLM call completes).
 */
export function endLlmWait(trace: RuntimeTrace): void {
  if (!trace.progress) return;
  const now = Date.now();
  if (trace.progress.llmWaitStartedAt) {
    trace.progress.llmWaitElapsedMs = now - trace.progress.llmWaitStartedAt;
  }
  trace.progress.llmWaitKind = undefined;
  trace.progress.llmWaitModel = undefined;
  trace.progress.llmWaitStartedAt = undefined;
  trace.progress.isWaitingOnSlowCall = false;
  // Refresh stage elapsed
  trace.progress.stageElapsedMs = now - trace.progress.stageStartedAt;
}

/**
 * Get a snapshot of the current progress state for the active trace.
 * Returns null if no trace is active.
 * Does NOT copy or snapshot prompts/content — only metadata.
 */
export function getCurrentProgress(): RuntimeProgressState | null {
  const store = _getStore();
  if (!store?.trace) return null;
  const trace = store.trace;
  if (!trace.progress) return null;

  const now = Date.now();
  const progress: RuntimeProgressState = {
    stage: trace.progress.stage,
    stageStartedAt: trace.progress.stageStartedAt,
    stageElapsedMs: now - trace.progress.stageStartedAt,
    hasSlowCall: trace.progress.hasSlowCall,
    isWaitingOnSlowCall: trace.progress.isWaitingOnSlowCall,
  };

  // If currently waiting on an LLM call, include the elapsed wait time
  if (trace.progress.llmWaitStartedAt && trace.progress.llmWaitKind) {
    const waitElapsed = now - trace.progress.llmWaitStartedAt;
    progress.llmWaitKind = trace.progress.llmWaitKind;
    progress.llmWaitModel = trace.progress.llmWaitModel;
    progress.llmWaitStartedAt = trace.progress.llmWaitStartedAt;
    progress.llmWaitElapsedMs = waitElapsed;
    progress.isWaitingOnSlowCall = waitElapsed > SLOW_LLM_CALL_THRESHOLD_MS;
    if (progress.isWaitingOnSlowCall) {
      progress.hasSlowCall = true;
    }
  }

  return progress;
}

/**
 * Refresh stage elapsed time for the active trace (call periodically).
 * Safe for polling loops — just updates timestamps.
 */
export function refreshProgressElapsed(): void {
  const store = _getStore();
  if (!store?.trace?.progress) return;
  const now = Date.now();
  store.trace.progress.stageElapsedMs = now - store.trace.progress.stageStartedAt;
  if (store.trace.progress.llmWaitStartedAt && store.trace.progress.llmWaitKind) {
    const elapsed = now - store.trace.progress.llmWaitStartedAt;
    store.trace.progress.llmWaitElapsedMs = elapsed;
    store.trace.progress.isWaitingOnSlowCall = elapsed > SLOW_LLM_CALL_THRESHOLD_MS;
    if (store.trace.progress.isWaitingOnSlowCall) {
      store.trace.progress.hasSlowCall = true;
    }
  }
}
