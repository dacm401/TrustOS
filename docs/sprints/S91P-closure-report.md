# Sprint 91P — Timeout Policy & Graceful Timeout V0 — Closure Report

**Status**: BUILD COMPLETE / FUNCTIONALLY APPROVED / PENDING FINAL CLOSURE  
**Baseline**: S90P closure baseline `34ecee3`  
**Date**: 2026-05-28

---

## Goal

Introduce configurable timeout policy for long-running tasks, reusing S90P
cooperative termination semantics to stop future work safely and emit
backward-compatible terminal SSE output.

---

## Scope Clarification

S91P V0 implements **static timeout policy with cooperative checks**. Retry
orchestration is **deferred** from V0. Timeout is distinct from both
`cancelled` (user-requested) and `failed` (unexpected error).

```text
Timeout = policy-driven stop due to elapsed time.
Retry orchestration is deferred from S91P V0.
```

---

## Non-Goals

- No retry orchestration.
- No provider-level hard abort guarantee.
- No destructive rollback.
- No UI dashboard.
- No semantic cache.
- No planner rewrite.
- No Human Review / Resume semantic changes.
- No prompt/content capture.
- No dynamic timeout policy engine (static config in V0).

---

## Timeout Semantics

S91P V0 implements **cooperative checkpoint-based timeout**.

- `timed_out` is distinct from `cancelled` and `failed`.
- `cancelled` means user/runtime requested stop.
- `timed_out` means policy-driven stop due to elapsed time.
- `failed` means unexpected runtime/model/tool failure.
- Cancellation is checked before timeout; if both are observable at a
  checkpoint, cancellation wins.
- S91P V0 does **not** provide provider-level hard abort.
- In-flight LLM/provider calls may complete before timeout is observed.

## Soft / Hard Timeout Behavior

- **Soft timeout threshold**: `TASK_SOFT_TIMEOUT_MS` (default 120s).
- **Hard timeout threshold**: `TASK_HARD_TIMEOUT_MS` (default 300s).
- Both thresholds are **env-configurable** via environment variables.
- **S91P V0 behavior**: The first enforceable threshold that triggers
  throws `TaskTimedOutError`. Hard timeout is checked first (more severe).
  If elapsed exceeds hard, a `"hard"` timeout is thrown. If elapsed exceeds
  soft but not hard, a `"soft"` timeout is thrown.
- Soft timeout is **not** merely a warning — it is the first enforceable
  termination threshold.
- Hard timeout is retained for metadata and as a future stricter policy
  boundary.

## Cancellation Precedence

- `checkCancellation()` executes **before** `checkTimeout()` at all 4 gates.
- If both cancellation and timeout are observable at a checkpoint,
  **cancellation wins** (user intent trumps policy).
- The final recorded state is `cancelled`, not `timed_out`.

## Terminal Guard

`markTimedOut()` only transitions active states to `timed_out`.

It does **not** overwrite:

- `completed`
- `failed`
- `cancelled`
- `timed_out` (idempotent)

```sql
WHERE state NOT IN ('completed', 'failed', 'cancelled', 'timed_out')
```

`markTimedOut()` is idempotent and terminal-safe.

## SSE Compatibility

- **No new SSE event type** in V0.
- `timed_out` is represented with the existing terminal `error`-style event
  followed by `done`.
- Existing `result`, `error`, `done`, `progress`, and `partial_result` shapes
  are unchanged.
- No `progress` or `partial_result` events are emitted after `timed_out`
  terminal state.
- Legacy clients remain compatible.

---

## Key Design

### Timeout State

- Adds `timed_out` final trace status (`RUNTIME_TRACE_FINAL_STATUS.TIMED_OUT`).
- `timed_out` is distinct from `cancelled` and `failed`.
- `TaskTimedOutError` carries `timeoutKind`, `thresholdMs`, `elapsedMs`.
- Command status: `timed_out`; delegation log: `execution_status: "timed_out"`.

### Soft & Hard Thresholds

- `TASK_SOFT_TIMEOUT_MS` (default 120s): first enforceable threshold.
- `TASK_HARD_TIMEOUT_MS` (default 300s): stricter threshold, checked first.
- Both configurable via environment variables.
- Hard timeout is checked first (more severe).

### Cooperative Timeout Checkpoints

- `checkTimeout()` runs at same 4 gates as `checkCancellation()`:
  1. `executeDelegateCommand` entry — skip already-timed-out tasks
  2. Before fast path LLM call
  3. Before cycle worker callback
  4. Before legacy LLM call
- Order: `checkCancellation()` first, then `checkTimeout()` — user intent
  trumps policy.
- In-flight provider calls are **not** forcibly interrupted in V0.

> **V0 limitation**: S91P V0 does not guarantee interruption of an in-flight
> model/provider call. Timeout is observed at safe checkpoints before
> subsequent work.

### Persistence

- `markTimedOut()` writes to `task_archives`:
  - State: `timed_out`
  - Metadata: `timedOutAt`, `timeoutKind`, `thresholdMs`, `elapsedMs`
  - Uses JSONB `||` merge (non-destructive, additive)
- Full terminal guard: prevents overwriting `completed`, `failed`, `cancelled`,
  **and** `timed_out`:
  ```sql
  WHERE state NOT IN ('completed', 'failed', 'cancelled', 'timed_out')
  ```
- `markTimedOut()` is separate from `markCancelled()` — distinct method,
  distinct guard set.
- `markTimedOut()` is idempotent: calling it on an already-`timed_out` archive
  is a no-op.

### SSE Compatibility

- **No new SSE event type** in V0.
- Timed_out terminal state uses existing `error` + `done` events.
- Error message includes timeout kind ("软超时" / "硬超时") and elapsed/threshold.
- Stored `cycleEvents` are emitted before the error event.
- No `result`, `manager_synthesized`, `chunk`, `fast_reply`, `progress`, or
  `partial_result` events after timed_out terminal state.
- Existing event shapes unchanged.
- `timed_out` excluded from active state checks alongside `completed`/`failed`/`cancelled`.

### Timed_out ≠ Cancelled ≠ Failed

- Command status: `timed_out` (not `cancelled`, not `failed`).
- Archive state: `timed_out` (not `cancelled`, not `failed`).
- Delegation log: `execution_status: "timed_out"`, `execution_correct: false`.
- SSE events: `error` + `done` (no Manager Synthesis).
- `timed_out` = policy-driven stop due to elapsed time.
- `cancelled` = user/runtime requested stop.
- `failed` = unexpected runtime/model/tool error.

### Non-Destructive Timeout

- `markTimedOut()` only marks state/metadata.
- Does not delete `partialResults[]`.
- Does not delete `cycleEvents[]`.
- Does not rollback completed side effects.
- Completed/failed/cancelled/timed_out terminal archives are not overwritten.

---

## Privacy

- Timeout metadata does **not** include prompts, messages, tool args, API
  keys, or user content.
- Metadata fields are purely time-based: `timedOutAt`, `timeoutKind`,
  `thresholdMs`, `elapsedMs`.
- No prompt/content capture added.

---

## Validation

- **S91P targeted**: 61/61 PASS
- **S90P**: 46/46 PASS
- **S89P**: 58/58 PASS
- **S88P**: 44/44 PASS
- **S87P**: 52/52 PASS
- **S86P non-DB subset**: 27/27 PASS
- **S85P non-DB/unit**: 105/105 PASS
- **S75P–S84P non-DB/unit regression**: PASS (113 tests)
- **S75P–S90P non-DB/unit regression total**: 395 PASS
- **S91P targeted total**: 61 PASS
- **Total including S91P targeted**: 456 PASS
- **DB-backed E2E**: BLOCKED, PostgreSQL unavailable
- **No S91P-introduced regressions**
- **Lint**: 0 errors

### Test Detail

| Group | Tests | Content |
|-------|-------|---------|
| T1 | 5 | `RUNTIME_TRACE_FINAL_STATUS.TIMED_OUT` constant + distinction from CANCELLED/FAILED/TIMEOUT |
| T2 | 4 | `TASK_SOFT_TIMEOUT_MS` / `TASK_HARD_TIMEOUT_MS` thresholds + reasonableness |
| T3 | 2 | `TaskArchiveRepo.markTimedOut` method existence + co-existence with S90P methods |
| T4 | 3 | `TaskTimedOutError` class shape (soft, hard, name distinction) |
| T5 | 4 | `checkTimeout` threshold logic (no throw, soft, hard, priority) |
| T6 | 5 | Timeout checkpoint gates at all 4 locations + cancellation-before-timeout order |
| T7 | 6 | SSE poller `timed_out` state (error+done, no result, cycleEvents, timeoutKind in msg, delegation_log, no new event type) |
| T8 | 5 | Progress/partial_result stop after timeout |
| T9 | 4 | Non-destructive timeout (preserve fields, no delete, no rollback) |
| T10 | 7 | `markTimedOut` terminal guard (not override completed/failed/cancelled/timed_out, still update running/created) |
| T11 | 4 | Timeout vs cancelled vs failed distinction |
| T12 | 4 | Privacy in timeout metadata (no prompt/user data/model output, time-only fields) |
| T13 | 3 | `TaskTimedOutError` catch handler (separate from cancelled, separate from generic, no integrity violation) |
| T14 | 5 | Backward compatibility (existing SSE types, no change to completed/failed/cancelled, delegation log interface, done shape) |

---

## Known Limitations

1. **Cooperative only** — No AbortSignal. In-flight LLM calls continue until
   completion before timeout is observed.
2. **Static thresholds only** — No per-task or per-user timeout customization
   in V0.
3. **No retry** — Timed-out tasks require manual re-submission.
4. **SSE reconnect** — May replay timeout event if no cursor exists.
5. **DB-backed E2E blocked** — PostgreSQL unavailable.
6. **No new SSE event type** — Timed_out uses `error` + `done`; a dedicated
   `timed_out` SSE event type is deferred.
7. **No provider-level hard abort guarantee** — Timeout is cooperative and
   checkpoint-based. In-flight LLM calls may complete before timeout is
   observed. Timeout does not rollback committed side effects.

---

## Files Changed

| File | Change |
|------|--------|
| `src/types/runtime-trace.ts` | `TIMED_OUT` constant, `TASK_SOFT_TIMEOUT_MS`/`TASK_HARD_TIMEOUT_MS`, `TimeoutKind` type |
| `src/db/task-archive-repo.ts` | `markTimedOut()` with full terminal guard (completed/failed/cancelled/timed_out) |
| `src/services/phase3/slow-worker-loop.ts` | `TaskTimedOutError`, `checkTimeout()`, 4 timeout gates + catch handler |
| `src/services/phase3/sse-poller.ts` | `timed_out` state handler, `timed_out` exclusion from active states |
| `tests/services/s91p-timeout.test.ts` | 61 targeted tests (T1–T14) |
| `vitest.s91p.config.ts` | Test config |
| `docs/sprints/S91P-plan.md` | Sprint plan |
| `docs/sprints/S91P-closure-report.md` | This report |

---

## PM Sign-Off Checklist

- [x] Build complete
- [x] Functional acceptance
- [x] Targeted tests passing (61/61)
- [x] Non-DB regression passing (S75P–S90P: 395 PASS)
- [x] Soft vs hard timeout behavior documented
- [x] Cancellation precedence documented
- [x] Terminal guard includes timed_out (idempotent)
- [x] Timeout compatibility reviewed
- [x] Privacy boundary reviewed
- [x] markTimedOut full terminal guard (no overwrite completed/failed/cancelled/timed_out)
- [x] SSE timed_out semantics documented
- [x] Cooperative limitation documented
- [x] Retry orchestration explicitly deferred
- [x] Timed_out distinct from cancelled and failed
- [x] Commit / push / three-end sync
- [x] PM final closure sign-off
