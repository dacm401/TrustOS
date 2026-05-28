# S91P Plan — Timeout Policy & Graceful Timeout V0

**Status**: IN PROGRESS  
**Baseline**: S90P closure baseline `34ecee3`  
**Date**: 2026-05-28

---

## Goal

Introduce configurable timeout policy for long-running tasks, reusing S90P cooperative termination semantics to stop future work safely and emit backward-compatible terminal SSE output.

---

## Context

S88P made LLM waits visible. S89P added partial_result previews. S90P added cooperative cancellation. S91P adds policy-driven graceful timeout — the system itself can stop tasks that exceed reasonable duration.

The experience chain is now:

```
S84P: 看见慢 → S85P: 减少慢 → S86P: 调用可测 → S87P: 减少不必要调用
  → S88P: 等待可见 → S89P: 结果提前可见 → S90P: 等待可控 → S91P: 系统超时保护
```

---

## Deliverables

| # | Deliverable | Description |
|---|-------------|-------------|
| D1 | `RUNTIME_TRACE_FINAL_STATUS.TIMED_OUT` | New terminal status distinct from `cancelled`/`failed`/`timeout` |
| D2 | Soft/hard timeout thresholds | `TASK_SOFT_TIMEOUT_MS` / `TASK_HARD_TIMEOUT_MS` env-configurable constants |
| D3 | Timeout checkpoint checks | `checkTimeout()` alongside `checkCancellation()` at all 4 worker gates |
| D4 | `markTimedOut()` with terminal guard | SQL guard `NOT IN ('completed', 'failed', 'cancelled')` |
| D5 | SSE poller `timed_out` terminal handling | `error` + `done`, no progress/partial_result after timeout |
| D6 | Progress/partial_result stop after timeout | Same pattern as S90P cancelled stop |
| D7 | S91P timeout lifecycle/privacy tests | 30+ targeted tests |
| D8 | S75P–S90P regression | Non-DB/unit PASS |
| D9 | S91P timeout report | Closure report |

---

## Non-Goals

- No retry orchestration
- No provider-level hard abort guarantee
- No destructive rollback
- No UI dashboard
- No semantic cache
- No planner rewrite
- No Human Review / Resume semantic changes
- No prompt/content capture
- No dynamic timeout policy engine (static config in V0)

---

## Architecture

```
Task Start
  │
  ├── softTimeoutMs = TASK_SOFT_TIMEOUT_MS (e.g. 120_000)
  ├── hardTimeoutMs = TASK_HARD_TIMEOUT_MS (e.g. 300_000)
  │
  ▼
Slow Worker (polling loop):
  │
  ├── checkTimeout(archiveId, taskId, startedAt, softMs, hardMs)
  │     if elapsed > hardMs → TaskTimedOutError(hard)
  │     if elapsed > softMs → TaskTimedOutError(soft)
  │     (checked at same 4 gates as checkCancellation)
  │
  └── TaskTimedOutError caught → mark timed_out, not failed/cancelled
        ├── Command: "timed_out"
        ├── Archive: "timed_out" (with terminal guard)
        └── slow_execution: timedOutAt, timeoutKind, thresholdMs, elapsedMs

SSE Poller:
  │
  ├── state === "timed_out":
  │     yield cycleEvents (already stored)
  │     yield error: "Task timed out (soft/hard)"
  │     yield done
  │     delegation_log: execution_status = "timed_out"
  │     break (no progress/partial_result after)
  │
  ├── state === "cancelled": (S90P, unchanged)
  ├── state === "completed": (unchanged)
  └── state === "failed": (unchanged)
```

---

## Key Design Decisions

1. **Cooperative timeout, not hard abort** — Same as S90P. In-flight LLM calls may finish before timeout is observed. V0 limit.

2. **Timed_out ≠ cancelled ≠ failed** — Three distinct terminal states:
   - `cancelled` = user/runtime requested stop
   - `timed_out` = policy-driven stop due to elapsed time
   - `failed` = unexpected runtime/model/tool error

3. **Soft vs hard timeout** — Soft timeout triggers first (e.g. 120s), hard timeout later (e.g. 300s). Both use the same `timed_out` state but differ in `timeoutKind` metadata.

4. **Terminal guard extends S90P** — `markTimedOut()` guards against `completed`, `failed`, AND `cancelled` — not overwriting any terminal state.

5. **No new SSE event type** — Uses existing `error` + `done`, same pattern as S90P cancelled.

6. **Static config in V0** — `TASK_SOFT_TIMEOUT_MS` / `TASK_HARD_TIMEOUT_MS` via env vars. No dynamic policy engine.

7. **Check alongside cancellation** — `checkTimeout()` runs at same 4 gates as `checkCancellation()`. Order: cancellation first (user intent trumps policy), then timeout.

---

## Files to Change

| File | Change |
|------|--------|
| `src/types/runtime-trace.ts` | +`TIMED_OUT` in `RUNTIME_TRACE_FINAL_STATUS`, +`TimeoutKind` type |
| `src/db/task-archive-repo.ts` | +`markTimedOut()` with extended terminal guard |
| `src/services/phase3/slow-worker-loop.ts` | +`TaskTimedOutError`, +`checkTimeout()`, timeout gates at all 4 checkpoints |
| `src/services/phase3/sse-poller.ts` | +`timed_out` state in terminal handling, +`timed_out` exclusion from active states |
| `tests/services/s91p-timeout.test.ts` | 30+ targeted tests |
| `vitest.s91p.config.ts` | Test config |
| `docs/sprints/S91P-plan.md` | This plan |
| `docs/sprints/S91P-closure-report.md` | Closure report |

---

## Success Criteria

- Long-running task can be marked `timed_out` safely
- `timed_out` does not overwrite `completed`/`failed`/`cancelled` terminal states
- `timed_out` is distinct from `failed` and `cancelled`
- `progress`/`partial_result` stop after timeout
- Existing SSE event shapes unchanged
- S75P–S90P regression remains green
