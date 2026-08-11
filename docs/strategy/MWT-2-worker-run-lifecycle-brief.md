# MWT-2: Worker Run Lifecycle — Implementation Brief

**Date**: 2026-08-09  
**Status**: BRIEF APPROVED WITH REVISIONS ✅⚠️ — IMPLEMENTATION AUTHORIZED AFTER PATCH  
**Prerequisite gates**: (1) MWT-1 SEALED ✅, (2) AD-8 CONFIRMED ✅, (3) Brief approved ✅ (with 5 revisions), (4) PM greenlight — PENDING PATCH

## Problem Statement

Worker is TrustOS's primary unit of productive work. But its lifecycle is a black box today.

A Worker run goes through 10 `TaskState` transitions and 6 `CommandStatus` statuses across multiple backend files (slow-worker-loop, execute-worker-loop, sse-poller). The frontend receives only a subset of lifecycle events — enough to show "thinking" and "done," but not enough to show **how** or **why**.

**The gap**: Between `worker_started` and `cycle_completed`, the Worker cycles silently. Users see a spinner and occasional cycle results, but not the lifecycle structure that produces those results. When a Worker fails, cancels, or times out, the failure path is invisible — the user sees "task execution failed" with no explanation of what stage it was in or what went wrong.

## Current Lifecycle

### Visible Events (SSE to frontend)

| Event | When | Visibility |
|-------|------|-----------|
| `thinking_started` | Manager begins analysis | ✅ Visible |
| `worker_started` | Worker task begins | ✅ Visible |
| `cycle_completed` | One LLM cycle done (results included) | ✅ Visible |
| `tool_call` | Tool call during cycle | ✅ Visible |
| `worker_completed` | All cycles done, success | ✅ Visible |
| `terminal_summary` | Final usage/stats | ✅ Visible (via ExecutionMetadata) |

### Invisible Transitions

| Transition | Where | Visibility |
|-----------|-------|-----------|
| Cycle lifecycle: `cycle_started`, `cycle_iteration`, `cycle_cancelled` | cycle-events.ts | ❌ Not emitted to SSE |
| Cancellation/timeout path | slow-worker-loop.ts | ❌ Silent termination |
| Patch-first revision iterations | slow-worker-loop.ts | ❌ Internal only |
| Error/failure at any stage | slow-worker-loop.ts, execute-worker-loop.ts | ❌ Generic "task execution failed" |
| `total_cycles` / `max_cycles` context | slow-worker-loop.ts | ❌ Not in SSE payload |
| Running-tasks watchdog | (nonexistent) | ❌ No mechanism |
| Cycle Runtime `passed` vs `max_cycles_exceeded` | runtime-trace.ts | ❌ Not distinguished in stream |

### 10 TaskState transitions

```
new → clarifying → working → worker_delegating → slow_worker_running
  → slow_worker_decision → synthesize → synthesize_streaming → done → failed
```

Of these 10, only ∼3 produce visible events.

## Architecture Rules (Frozen)

1. **Lifecycle events must reflect real lifecycle transitions** — not synthetic events created only for UI/report completeness.
   - `cycle_started` = actual loop iteration begins
   - `cycle_completed` = actual loop iteration completes
   - `worker_cancelled` = actual cancellation path taken
   - `worker_timed_out` = actual timeout condition reached
   - `worker_error` = actual caught error/failure path
2. **No synthetic worker lifecycle events** may be emitted for UI/report completeness.
3. **No `task_id` / `run_id` introduction in MWT-2** — those belong to MWT-3.
4. **No Session → Task → Run object model changes** in MWT-2.
5. **No database schema changes** in MWT-2.
6. **No navigation changes** in MWT-2.

## Proposed Scope

### Must-Have (MWT-2 Core)

| # | Item | Rationale |
|---|------|-----------|
| 1 | **Cycle progress in SSE**: `cycle_started`(cycle_index N/M) → `cycle_iteration` → `cycle_completed`(cycle_index N) | Transforms black box into visible progress bar |
| 2 | **Terminal state differentiation**: `terminal_status` field with strict enum: `success` \| `cancelled` \| `timeout` \| `max_cycles_exceeded` \| `error`, with reason | Replaces generic "task execution failed" |
| 3 | **Error-path events**: emit `worker_error`(error_stage, error_message) / `worker_cancelled`(reason) / `worker_timed_out`(at_cycle_index) to SSE with structured reason | Makes failure visible |
| 4 | **`max_cycles` / `total_cycles` in `worker_started` payload** | Frontend can show "Cycle 2/3" |
| 5 | **Frontend cycle progress display** in ChatInterface/ExecutionMetadata | User sees progress, not just a spinner |

### Should-Have

| # | Item | Rationale |
|---|------|-----------|
| 6 | **Running-tasks watchdog** (optional, in-memory/session-scoped only). Must not introduce durable Worker state or queue semantics. | Prevents orphaned Workers. Does not block core lifecycle. |
| 7 | **Cancellation completeness**: ensure `worker_cancelled` event always emitted (no partial SSE termination) | Clean cancellation UX |

### Won't-Have (for MWT-7 Productionization)

| # | Item | Deferred To |
|---|------|-----------|
| - | Worker pooling / queue | MWT-7 |
| - | Persistent Worker state (DB) | MWT-7 |
| - | Worker retry on transient failure | MWT-7 |
| - | Durable Worker results schema | TRST-4D (backend assessment API) |

## Architecture Impact

### Backend Changes (~3 files)

| File | Change |
|------|--------|
| `slow-worker-loop.ts` | Emit `cycle_started` before each loop iteration, emit structured failure/error/cancel events, include `total_cycles` in initial event |
| `execute-worker-loop.ts` | Same: cycle lifecycle events + terminal state differentiation |
| `sse-poller.ts` | Forward new `cycle_started` events to SSE stream |

### Frontend Changes (~2 files)

| File | Change |
|------|--------|
| `ChatInterface.tsx` | Parse new SSE event types (`cycle_started`, `worker_error`, etc.), surface cycle progress |
| `ExecutionMetadata.tsx` | Display cycle progress bar (N/M), terminal state badge (success/cancelled/timeout/error) |

### No Changes To

- SSE protocol core (additive events only, no breaking changes)
- Gateway / `openai.ts` / Manager routing / Evidence Report
- Database schema
- Admin panel
- Authentication / authorization
- **No `task_id` / `run_id` introduction** (deferred to MWT-3)
- **No Session → Task → Run object model changes**
- **No navigation changes** (sidebar, page.tsx, view routing)
- **No ManagerWorkspace integration**

## Acceptance Criteria (10 AC)

1. `cycle_started` event emitted and visible in SSE: `{ type: "cycle_started", cycle_index: N, max_cycles?: M, total_cycles?: M }`  
2. `cycle_completed` includes cycle index: `{ type: "cycle_completed", cycle_index: N }`  
3. `worker_started` includes `max_cycles` (when known as upper bound) or `total_cycles`
4. Terminal state events include `terminal_status` with strict enum:
   ```ts
   terminal_status: "success" | "cancelled" | "timeout" | "max_cycles_exceeded" | "error"
   ```
5. `worker_error` event emitted on failure: `{ type: "worker_error", error_stage: string, error_message: string, terminal_status: "error" }`  
6. `worker_cancelled` event emitted on cancellation: `{ type: "worker_cancelled", reason: string, terminal_status: "cancelled" }`  
7. `worker_timed_out` event emitted on timeout: `{ type: "worker_timed_out", at_cycle_index: N, terminal_status: "timeout" }`  
8. Frontend displays cycle progress: "Cycle 2/5" in ChatInterface during Worker run  
9. Frontend displays terminal state badge: success/cancelled/timeout/error/max_cycles_exceeded in ExecutionMetadata  
10. No regression: existing SSE events unchanged, smoke tests PASS

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| `max_cycles` / `total_cycles` unknown at `worker_started` (depends on Manager decision) | Medium | Low — can emit `max_cycles` (upper bound) as fallback | Use `max_cycles` from Manager, label as "up to N" |
| SSE event format expansion breaks older frontend | Low | Medium | Additive only; older frontend ignores unknown events silently |
| `execute-worker-loop` and `slow-worker-loop` have different event shapes | Medium | Medium | Unify behind shared worker lifecycle event emitter |
| Cancellation path inconsistency | High | Low | Both loops already have cancellation guards; just need to ensure event is always emitted before return |

## Estimation

- Backend: ∼200 lines across 3 files
- Frontend: ∼80 lines across 2 files
- Smoke test: scripts/mwt2/run-smoke.mjs (new)
- Total: 4-6 files, ∼300 lines

## Next Decision

PM approval of this brief → MWT-2 implementation authorization.
