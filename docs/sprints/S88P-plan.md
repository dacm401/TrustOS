# Sprint 88P — Runtime Progress & LLM Wait Visibility V0 — Plan

## Status

**READY TO START ✅**

Starting baseline: `704d737` (S87P closure)

## Background

S84P–S87P performance chain:
- S84P: Identified LLM/external I/O as the main bottleneck (70-90% latency).
- S85P: Added conservative simple-task fast path (criteriaCount===0).
- S86P: Added RuntimeTrace.llmCalls counting (15 call sites, 7 call kinds).
- S87P: Added call budget, duplicate warnings, and safe synthesis skip.

When LLM waits cannot be safely reduced further, the next most valuable thing is: **let the user know what the system is waiting on, how long it's been, and what's next.**

## Goal

Expose safe runtime progress and LLM wait visibility through existing trace/SSE paths without capturing prompt/content.

## Non-goals

- No UI dashboard.
- No billing/cost estimate.
- No fast path eligibility expansion.
- No synthesis skip expansion.
- No semantic cache.
- No Human Review / Resume semantic changes.
- No prompt/content/user data capture.

## Deliverables

| ID | Deliverable | Description |
|----|-------------|-------------|
| D1 | `RuntimeProgressState` type | Define progress state structure for trace extract |
| D2 | Stage-level progress events | Emit progress metadata via trace/SSE path |
| D3 | Current LLM wait visibility | Surface kind/model of in-flight LLM call safely |
| D4 | Slow-call warning metadata | Warn when LLM call exceeds threshold |
| D5 | Backward-compatible SSE shape | Preserve existing event structure |
| D6 | Privacy & boundary tests | Verify no prompt/content/user data leaked |
| D7 | S75P–S87P regression | Full non-DB unit regression |
| D8 | S88P progress visibility report | Measurement and design report |

## Success Criteria

1. Long-running LLM-bound task can expose current safe wait state.
2. Progress metadata includes kind/stage/duration but no prompt/content.
3. SSE payload remains backward-compatible.
4. Slow-call warning appears after threshold.
5. S75P–S87P regression remains green.

## Design Constraints

- **Safe metadata only**: kind, model, stage name, elapsed duration. No prompt, no content, no tool arguments, no user data.
- **Backward-compatible SSE**: new fields added to existing events, not new event types.
- **Observational only**: progress/wait metadata does not change execution paths.
- **Uses existing infrastructure**: RuntimeTrace + AsyncLocalStorage + trace extract pattern from S86P/S87P.

## Modified / New Files (expected)

| File | Type |
|------|------|
| `src/types/runtime-trace.ts` | Modified — add progress types |
| `src/services/runtime-trace.ts` | Modified — progress state management |
| `src/api/chat.ts` | Modified — emit progress in SSE path |
| `tests/services/s88p-progress-visibility.test.ts` | New — targeted tests |
| `vitest.s88p.config.ts` | New — test config |
| `docs/sprints/S88P-plan.md` | New (this file) |
| `docs/sprints/S88P-progress-report.md` | New — measurement report |
| `docs/sprints/S88P-closure-report.md` | New — closure report |
