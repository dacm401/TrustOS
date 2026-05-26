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

import type {
  RuntimeTrace,
  RuntimeTraceStageName,
  RuntimeTraceCounters,
} from "../types/runtime-trace.js";
import { buildRuntimeTraceExtract } from "../types/runtime-trace.js";
export { buildRuntimeTraceExtract };

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
