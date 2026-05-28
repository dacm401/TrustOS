# Sprint 90P — Cancel / Timeout / Retry Control V0 — Closure Report

**Status**: BUILD COMPLETE / PENDING FINAL SIGN-OFF  
**Baseline**: S89P closure baseline `6f42dcc`  
**Date**: 2026-05-28

---

## Goal

Allow users/runtime to safely cancel long-running tasks with trace-visible
cancellation state and backward-compatible SSE terminal semantics.

## Scope Clarification

S90P V0 implements **cooperative cancellation**. Timeout and retry controls are
**deferred** from V0.

```text
Timeout and Retry are non-goals / deferred from S90P V0.
```

---

## Non-Goals

- No UI dashboard.
- No semantic cache.
- No fast path expansion.
- No planner rewrite.
- No Human Review / Resume semantic changes.
- No destructive rollback of already committed side effects.
- No provider-level hard abort guarantee.
- No timeout enforcement in V0.
- No retry orchestration in V0.
- No prompt/content capture.

---

## Key Design

### Cancellation State

- Adds `cancelled` final trace status (`RUNTIME_TRACE_FINAL_STATUS.CANCELLED`).
- `cancelled` is distinct from `failed`.
- `TaskCancelledError` is used internally to unwind execution.
- Command status and delegation log record `cancelled`.

### Cooperative Checkpoints

- Runtime checks `TaskArchiveRepo.isCancelled()` at safe checkpoints:
  - Before fast path LLM call
  - Before cycle runtime worker execution
  - Before legacy execution path
  - At entry to `executeDelegateCommand` (skip already-cancelled tasks)
- In-flight provider calls are **not** forcibly interrupted in V0.
- Cancellation is observed before subsequent work.

> **V0 limitation**: S90P V0 does not guarantee interruption of an in-flight
> model/provider call. Cancellation is observed at safe checkpoints before
> subsequent work.

### Persistence

- `PATCH /v1/tasks/:id cancel` marks task cancellation request.
- Best-effort sync to `task_archives.state = 'cancelled'`:
  - Archive write is wrapped in try/catch; task cancel succeeds even if archive
    row is missing or update fails.
- `markCancelled()` is non-destructive:
  - Adds `cancelledAt` + `cancelReason` via JSONB `||` merge.
  - Existing `partialResults[]`, `cycleEvents[]`, and slow execution metadata
    are preserved.
- Terminal guard: `markCancelled()` WHERE clause prevents overwriting
  `completed` or `failed` archives:
  ```sql
  WHERE state NOT IN ('completed', 'failed')
  ```

### SSE Compatibility

- **No new SSE event type** in V0.
- Cancelled terminal state is represented by existing `error` event followed
  by `done`.
- Stored `cycleEvents` are emitted before the error event.
- No `result`, `manager_synthesized`, `chunk`, `fast_reply`, `progress`, or
  `partial_result` events after cancelled terminal state.
- Existing event shapes unchanged.
- Legacy clients treating `error` as terminal remain compatible.

> In S90P V0, cancelled is represented as a terminal SSE error-style event
> followed by done for backward compatibility.

### Cancelled ≠ Failed

- Command status: `cancelled` (not `failed`).
- Archive state: `cancelled` (not `failed`).
- Delegation log: `execution_status: "cancelled"`, `execution_correct: false`.
- SSE events: `error` + `done` (no Manager Synthesis).
- Cancelled command is **not** considered a model/tool failure.
- Cancellation is a user/runtime-requested stop.

### Non-Destructive Cancellation

- `markCancelled()` only marks state/metadata.
- Does not delete `partialResults[]`.
- Does not delete `cycleEvents[]`.
- Does not rollback completed side effects.
- Completed/failed terminal archives are not overwritten.

> S90P does not attempt destructive rollback of already committed side effects.

---

## Privacy

- Cancellation metadata does **not** include prompts, messages, tool args, API
  keys, or user content.
- `cancelReason` is a fixed string (`"Task cancelled by user"`), not derived
  from user input.
- No prompt/content capture added.

---

## Validation

- **S90P targeted**: 46/46 PASS
- **S89P**: 58/58 PASS
- **S88P**: 44/44 PASS
- **S87P**: 52/52 PASS
- **S86P non-DB subset**: 27/27 PASS
- **S85P non-DB/unit**: 55/55 PASS
- **S75P–S84P non-DB/unit regression**: PASS
- **DB-backed E2E**: BLOCKED by PostgreSQL unavailable
- **No S90P-introduced regressions**
- **Lint**: 0 errors

### Test Detail

| Group | Tests | Content |
|-------|-------|---------|
| T1 | 7 | `RUNTIME_TRACE_FINAL_STATUS.CANCELLED` constant |
| T2 | 2 | `TaskArchiveRepo.isCancelled` / `markCancelled` methods |
| T3 | 5 | `TaskCancelledError` class shape |
| T4 | 3 | SSE poller cancelled state handling |
| T5 | 5 | Progress/partial_result stop after cancellation |
| T6 | 1 | PATCH cancel → task_archives sync |
| T7 | 6 | Non-destructive cancellation + terminal guard |
| T8 | 4 | Backward compatibility |
| T9 | 4 | Cancellation signal propagation |
| T10 | 3 | Cancellation vs error distinction |
| T11 | 3 | Privacy in cancellation metadata |
| T12 | 3 | Timeout vs cancel distinction |
| T13 | 6 | SSE cancelled event flow |
| T14 | 4 | markCancelled terminal guard |

---

## Known Limitations

1. **Cooperative only** — No AbortSignal. In-flight LLM calls continue until
   completion before checking cancellation.
2. **No timeout enforcement V0** — 180s hard timeout already exists in poller
   but is not user-configurable.
3. **No retry** — Cancelled tasks require manual re-submission.
4. **SSE reconnect** — May replay cancellation event if no cursor exists.
5. **DB-backed E2E blocked** — PostgreSQL unavailable.
6. **No new SSE event type** — Cancelled uses `error` + `done`; a dedicated
   `cancelled` SSE event type is deferred to S91P.

---

## Files Changed

| File | Change |
|------|--------|
| `src/types/runtime-trace.ts` | `CANCELLED` constant |
| `src/db/task-archive-repo.ts` | `isCancelled()`, `markCancelled()` with terminal guard |
| `src/services/phase3/slow-worker-loop.ts` | `TaskCancelledError`, `checkCancellation()`, 4 cancellation gates |
| `src/services/phase3/sse-poller.ts` | Split `cancelled` from `completed` state handling |
| `src/api/tasks.ts` | PATCH cancel best-effort sync to `task_archives` |
| `tests/services/s90p-cancel-timeout.test.ts` | 46 targeted tests |
| `docs/sprints/S90P-plan.md` | Sprint plan |
| `docs/sprints/S90P-closure-report.md` | This report |

---

## PM Sign-Off Checklist

- [x] Build complete
- [x] Functional acceptance
- [x] Targeted tests passing (46/46)
- [x] Non-DB regression passing
- [x] Cancellation compatibility reviewed
- [x] Privacy boundary reviewed
- [x] markCancelled terminal guard (no overwrite completed/failed)
- [x] PATCH cancel best-effort archive sync
- [x] SSE cancelled semantics documented
- [x] Timeout/retry scope explicitly deferred
- [ ] Commit / push / three-end sync
- [ ] PM final closure sign-off
