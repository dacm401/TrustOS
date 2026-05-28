# S90P Plan — Cancel / Timeout / Retry Control V0

**Status**: BUILD COMPLETE ✅  
**Baseline**: S89P closure baseline `6f42dcc`  
**Date**: 2026-05-28  

---

## Goal

Allow users to safely cancel long-running tasks via `PATCH /v1/tasks/:id cancel`, with:
- Trace-visible cancellation state
- Worker loop polling for cancellation signal
- Backward-compatible SSE completion semantics
- Progress/partial_result events stopping after cancellation

---

## Deliverables

| # | Deliverable | Status |
|---|------------|--------|
| D1 | `RUNTIME_TRACE_FINAL_STATUS.CANCELLED` constant | ✅ |
| D2 | `TaskArchiveRepo.isCancelled()` + `markCancelled()` | ✅ |
| D3 | `checkCancellation()` in worker execution paths | ✅ |
| D4 | SSE poller cancelled state handling (distinct from completed/failed) | ✅ |
| D5 | `PATCH /v1/tasks/:id cancel` syncs to `task_archives.state` | ✅ |
| D6 | Progress/partial_result stop after cancellation | ✅ |
| D7 | S90P tests + S75P–S89P regression | ✅ |
| D8 | Plan + closure report | ✅ |

---

## Non-Goals

- No UI dashboard
- No semantic cache
- No fast path expansion
- No planner rewrite
- No Human Review / Resume semantic changes
- No destructive rollback of committed side effects
- No AbortSignal threading (V0 is cooperative polling)
- No prompt/content capture

---

## Architecture

```
User: PATCH /v1/tasks/:id { action: "cancel" }
  │
  ├── TaskRepo.setStatus(taskId, "cancelled")        // tasks table
  ├── TaskArchiveRepo.updateState(taskId, "cancelled") // task_archives table
  └── TaskArchiveRepo.setSlowExecution(taskId, {      // slow_execution metadata
        cancelledAt, cancelReason
      })

Slow Worker (polling loop):
  │
  ├── executeDelegateCommand entry: isCancelled()? → skip
  ├── checkCancellation() before each LLM call:
  │     fast path callModelFull()
  │     legacy path callModelFull()
  │     cycle executeWorker callback
  └── TaskCancelledError caught → mark cancelled, not failed

SSE Poller:
  │
  ├── state === "cancelled":
  │     yield cycleEvents (already stored)
  │     yield error: "Task cancelled"
  │     yield done
  │     markDelivered + break
  │
  ├── state === "completed": (unchanged)
  └── state === "failed": (unchanged)
```

---

## Key Design Decisions

1. **Cooperative polling, not AbortSignal** — V0 uses `TaskArchiveRepo.isCancelled()` polling before each LLM call. AbortSignal threading is deferred to V1.

2. **Cancellation is non-destructive** — `markCancelled()` only adds `cancelledAt`/`cancelReason` fields. Does NOT delete `partialResults[]`, `cycleEvents[]`, or `result`.

3. **Cancelled ≠ failed** — Worker marks commands as `cancelled` (not `failed`). SSE emits error message with "cancelled" semantics. Delegation logs record `execution_status: "cancelled"`.

4. **PATCH cancel → task_archives sync** — The existing PATCH handler only wrote to `tasks` table. S90P adds parallel writes to `task_archives` so both the slow-worker and SSE poller detect cancellation.

5. **No new SSE event type** — Cancelled uses existing `error` + `done` events. No `cancelled` event type needed.

---

## Files Changed

| File | Change |
|------|--------|
| `src/types/runtime-trace.ts` | +`CANCELLED` in `RUNTIME_TRACE_FINAL_STATUS` |
| `src/db/task-archive-repo.ts` | +`isCancelled()`, +`markCancelled()` |
| `src/services/phase3/slow-worker-loop.ts` | +`TaskCancelledError`, +`checkCancellation()`, cancellation gates in all paths |
| `src/services/phase3/sse-poller.ts` | Split `cancelled` from `completed` in state machine |
| `src/api/tasks.ts` | PATCH cancel → sync to `task_archives` |
| `tests/services/s90p-cancel-timeout.test.ts` | 32 targeted tests |
