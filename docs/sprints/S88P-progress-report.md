# Sprint 88P — Runtime Progress & LLM Wait Visibility V0 — Build Report

## Status

**BUILD COMPLETE ✅**

## Baseline

S87P closure baseline: `704d737`

## Goal

Expose safe runtime progress and LLM wait visibility through existing trace/SSE paths without capturing prompt/content.

## Non-goals (all respected)

- No UI dashboard.
- No billing/cost estimate.
- No fast path eligibility expansion.
- No synthesis skip expansion.
- No semantic cache.
- No Human Review / Resume semantic changes.
- No prompt/content/user data capture.

## Key Design

### D1: RuntimeProgressState type

```typescript
export interface RuntimeProgressState {
  stage: string;              // Current execution stage name
  stageStartedAt: number;     // When this stage started
  stageElapsedMs: number;     // Elapsed ms in current stage
  llmWaitKind?: LlmCallKind;  // What kind of LLM call is in-flight
  llmWaitModel?: string;      // Model being waited on
  llmWaitStartedAt?: number;  // When current LLM wait started
  llmWaitElapsedMs?: number;  // Elapsed ms of current LLM wait
  hasSlowCall: boolean;       // Whether any LLM call exceeded threshold
  isWaitingOnSlowCall: boolean; // Whether current wait exceeds threshold
}
```

SAFETY: Only metadata — kind, model name, timestamps, durations. NO prompt, content, tool arguments, messages, or user data.

### D2: Stage-level progress events

- `updateTraceProgress(trace, stage)` — transitions trace to a new stage, clears LLM wait state.
- Progress updated at: `intent_classify`, `cross_session_context`, `manager_view_build`, `manager_routing`, `worker_execution`, `sse_done_prepare`.
- `getCurrentProgress()` — returns snapshot with live elapsed times from `Date.now()`.
- `refreshProgressElapsed()` — called periodically from SSE poller to keep timestamps fresh.

### D3: Current LLM wait visibility

- `beginLlmWait(trace, kind, model)` — marks LLM call as in-flight.
- `endLlmWait(trace)` — clears in-flight state, records elapsed wait time.
- `recordLlmCall()` automatically clears in-flight state when a call completes.
- SSE progress event includes `llmWait: { kind, model, elapsedMs }` when currently waiting.

### D4: Slow-call warning metadata

- Threshold: `SLOW_LLM_CALL_THRESHOLD_MS = 5000` (5 seconds).
- In `recordLlmCall()`: when `durationMs > threshold`, sets `slowCallWarning: true` on the call record.
- Updates `trace.progress.hasSlowCall = true`.
- `getCurrentProgress()` updates `isWaitingOnSlowCall` dynamically for in-flight waits exceeding threshold.
- `RuntimeTraceExtract.slowCallSummary` aggregates: count, slowest kind/model/duration, threshold.

### D5: Backward-compatible SSE

- New event type `"progress"` emitted every 5s during worker execution.
- Progress payload: `{ stage, stageElapsedMs, totalElapsedMs, llmWait?, slowCallDetected?, waitingOnSlowCall? }`.
- All existing event types (`status`, `result`, `error`, `done`, `chunk`, `fast_reply`, `manager_synthesized`, `cycle_event`) unchanged.
- No new required fields for front-end — progress event is optional.
- `RuntimeTraceExtract` in done event gains `progress` and `slowCallSummary` (backward-compatible new fields).

## Deliverables

| ID | Deliverable | Status |
|----|-------------|--------|
| D1 | `RuntimeProgressState` type + `RuntimeSlowCallSummary` | ✅ |
| D2 | Stage-level progress events via trace extract + SSE poller | ✅ |
| D3 | Current LLM wait kind/model visibility | ✅ |
| D4 | Slow-call warning metadata | ✅ |
| D5 | Backward-compatible SSE event shape | ✅ |
| D6 | Privacy & boundary tests (35/35 PASS) | ✅ |
| D7 | S75P–S87P regression | ✅ |
| D8 | Progress visibility report (this document) | ✅ |

## Modified Files

| File | Change |
|------|--------|
| `src/types/runtime-trace.ts` | +90 lines: RuntimeProgressState, RuntimeSlowCallSummary, slowCallWarning, SLOW_LLM_CALL_THRESHOLD_MS, buildRuntimeTraceExtract updates |
| `src/services/runtime-trace.ts` | +130 lines: updateTraceProgress, beginLlmWait, endLlmWait, getCurrentProgress, refreshProgressElapsed, slow-call detection in recordLlmCall |
| `src/api/chat.ts` | +8 lines: progress initialization + stage transitions |
| `src/services/phase3/sse-poller.ts` | +40 lines: progress event emission during polling |

## New Files

| File | Description |
|------|-------------|
| `tests/services/s88p-progress-visibility.test.ts` | 35 tests |
| `vitest.s88p.config.ts` | Test config |
| `docs/sprints/S88P-plan.md` | Sprint plan |
| `docs/sprints/S88P-progress-report.md` | This report |

## Test Coverage

### S88P Targeted: 35/35 PASS

| Group | Tests | Description |
|-------|-------|-------------|
| T1: Progress state construction | 3 | Type initialization, defaults |
| T2: updateTraceProgress transitions | 2 | Stage transitions clear LLM wait |
| T3: beginLlmWait/endLlmWait lifecycle | 5 | In-flight wait management |
| T4: getCurrentProgress snapshots | 5 | Live elapsed times, privacy check, ALS isolation |
| T5: Slow call detection | 6 | Threshold, hasSlowCall, slowest aggregation, wait clearing |
| T6: RuntimeTraceExtract | 4 | Progress + slowCallSummary in extract |
| T7: SSE progress event shape | 3 | Backward-compatible shape |
| T8: Privacy | 3 | No prompt/content/user data in any progress metadata |
| T9: Budget compatibility | 2 | S87P budget + duplicate + slow call coexist |
| T10: AsyncLocalStorage isolation | 2 | Per-request progress isolation |

### Regression

| Sprint | Result | Notes |
|--------|--------|-------|
| S88P | 35/35 PASS | ✅ |
| S87P | 52/52 PASS | ✅ |
| S86P | 33/33 PASS | ✅ |
| S85P | 105/105 PASS | ✅ |
| S84P–S75P | non-DB unit PASS | DB-backed E2E BLOCKED (PostgreSQL) |

**No S88P-introduced regressions.**

## Privacy Verification

All progress metadata verified safe:
- Only kind + model + timestamps + durations exposed.
- No prompt, content, messages, tool arguments, or user data.
- `getCurrentProgress()` and `slowCallSummary` affirmed clean in T8.1–T8.3.
- SSE progress event payload carries only safe fields.
