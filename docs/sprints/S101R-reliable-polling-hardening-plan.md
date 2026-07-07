# S101R Reliable Polling Hardening Plan

Sprint: S101R — Reliable Polling Hardening
Date: 2026-07-07
Status: PLANNING CREATED / NOT APPROVED FOR CODE FIXES
Predecessor: S101T (TypeScript Debt Cleanup, in progress)
Input: `docs/reviews/phase3-reliable-polling-review.md`

---

## 1. Background

This plan is based on the Phase 3 "Reliable Polling" code review (`docs/reviews/phase3-reliable-polling-review.md`), which identified 16 issues across 9 files (~3500 lines).

The review covers:
- SSE poller (`sse-poller.ts`)
- Task watchdog (`task-watchdog.ts`)
- Stream v2 (`stream-v2.ts`)
- Slow worker loop (`slow-worker-loop.ts`)
- Execute worker loop (`execute-worker-loop.ts`)
- Task archive repository (`task-archive-repo.ts`)
- Types (`delegation.ts`)
- Entry point (`index.ts`)
- SSE protocol spec (`docs/SSE-EVENT-PROTOCOL-v1.md`)

---

## 2. Goal

Improve reliability of Phase 3 polling, worker lifecycle, timeout consistency, and SSE protocol compliance.

---

## 3. Non-Goals

- No Manager Workspace changes.
- No S100P behavior changes.
- No new UI.
- No Agent Engine / Sandbox / MCP work.
- No broad refactor beyond Reliable Polling scope.
- This is NOT a TypeScript type cleanup — that belongs to S101T.

---

## 4. Issue Triage

### Overview

| ID | Severity | Area | Summary | Proposed Sprint Priority |
|---|---|---|---|---|
| C1 | Critical | SSE Protocol | `done` event carries `stream` field — protocol violation | P0 |
| C4 | Critical | Timeout Semantics | Watchdog writes `timedOutAt`/`stuckSince`, Poller reads `timeoutKind`/`elapsedMs` — field incompatibility | P0 |
| C3 | Critical | Data Consistency | Poller 180s hard timeout does not update `task_commands` — leaves zombie command rows | P1 |
| C5 | Critical | Worker Lifecycle | Worker `workerStarted` flag not reset on stop — cannot restart | P1 |
| C6 | Critical | Execute Worker Safety | `execute-worker-loop.ts` has no cancellation/timeout protection | P1 |
| H1 | High | Cost Accounting | `slow-worker-loop.ts` `estimateCost` uses hardcoded Qwen pricing, shadowing correct `token-counter` implementation | P1 |
| H3 | High | Timeout Config | Poller hardcoded 180s timeout vs Worker configurable `TASK_SOFT/HARD_TIMEOUT_MS` | P2 |
| H4 | High | Polling Efficiency | `getPollInterval` defined but `pollLoop` never calls it — always 1s fixed interval | P2 |
| C2 / M1 | Medium | Dead Code | Duplicated `failed` event handlers and redundant checks | P3 |
| H2 | High | State Mutation | `markDelivered` overwrites status to `completed` unconditionally | P3 |
| M2 | Medium | Resource Usage | Busy-wait sleep pattern in poll loop | P3 |
| M3 | Medium | Type Bypass | `donePayload` typed as `Record<string, unknown>` bypasses protocol type safety | P3 |
| L1 | Low | Cleanup | Minor code style / micro-optimization | P4 |
| L2 | Low | Cleanup | Minor code style / micro-optimization | P4 |

---

## 5. Proposed Fix Batches

### Batch A — Protocol & Timeout Semantics (P0)

**Issues**: C1, C4

**C1 — SSE `done` event `stream` protocol violation**
- All 7 `done` event emissions in `sse-poller.ts` carry a `stream` field
- SSE protocol v1 (`docs/SSE-EVENT-PROTOCOL-v1.md`) explicitly forbids `stream` on `done` events
- **Open Decision**: Fix code to match protocol v1, OR upgrade protocol to v2 to allow `stream` on `done`
- **Risk**: Must verify frontend SSE consumer does not depend on `stream` in `done` events before removing

**C4 — Watchdog/Poller timeout field incompatibility**
- Watchdog writes: `timedOutAt` (ISO timestamp), `stuckSince` (ISO timestamp)
- Poller reads: `timeoutKind` (string enum), `elapsedMs` (number)
- Result: Watchdog-triggered timeouts display as "0s/0s" in diagnostics
- **Fix**: Unify timeout diagnostic fields between Watchdog writer and Poller reader

---

### Batch B — Data Consistency & Lifecycle (P1)

**Issues**: C3, C5, C6

**C3 — Poller timeout doesn't update `task_commands`**
- When Poller hits 180s hard timeout, it does not mark the command row as terminal
- Zombie command rows may be re-picked by Worker after timeout
- **Fix**: On Poller hard timeout, update `task_commands` status to reflect terminal state

**C5 — Worker cannot restart after stop**
- `workerStarted` boolean flag set to `true` on start, never reset to `false` on stop
- Subsequent start attempts silently no-op
- **Fix**: Reset `workerStarted = false` in stop/shutdown path

**C6 — Execute worker missing cancellation/timeout**
- `execute-worker-loop.ts` has no abort mechanism for user cancellation
- No timeout guard — execute tasks can hang indefinitely
- **Fix**: Add cancellation signal propagation and configurable timeout to execute worker loop

---

### Batch C — Cost/Config Alignment (P2)

**Issues**: H1, H3, H4

**H1 — `estimateCost` hardcoded pricing**
- `slow-worker-loop.ts` has a local `estimateCost` function with hardcoded Qwen pricing
- `token-counter` service has the correct implementation but is unused here
- **Fix**: Replace local `estimateCost` with `token-counter` service call, or centralize pricing config

**H3 — Poller timeout hardcoded 180s**
- SSE Poller uses hardcoded 180s timeout
- Worker uses env-configurable `TASK_SOFT_TIMEOUT_MS` / `TASK_HARD_TIMEOUT_MS`
- **Open Decision**: Should Poller use `TASK_HARD_TIMEOUT_MS` or a dedicated `SSE_CLIENT_TIMEOUT_MS`?

**H4 — Adaptive polling unused**
- `getPollInterval()` defined with adaptive backoff logic
- `pollLoop()` never calls it — always polls at 1s fixed interval
- **Fix**: Integrate `getPollInterval()` into `pollLoop()`, or remove dead code

---

### Batch D — Dead Code / Cleanup (P3-P4)

**Issues**: C2, M1, H2, M2, M3, L1, L2

**C2 / M1 — Duplicated `failed` handlers**
- Two `failed` event handling paths with overlapping logic
- One path is unreachable / dead code
- **Fix**: Consolidate to single `failed` handler path

**H2 — `markDelivered` state overwrite**
- `markDelivered` unconditionally sets status to `completed`
- Should only set `delivered = true`, preserving actual terminal status
- **Fix**: Narrow `markDelivered` to only mutate the `delivered` flag

**M2 — Busy-wait sleep**
- Poll loop uses tight spin-wait without proper sleep
- **Fix**: Use `setTimeout`-based or `sleep()`-based polling interval

**M3 — `donePayload` type bypass**
- `donePayload` typed as `Record<string, unknown>` circumvents protocol type checking
- **Fix**: Define proper `DoneEventPayload` type from the SSE protocol spec

**L1/L2 — Micro cleanups**
- Minor code style, logging, and documentation improvements
- Low priority, can be addressed opportunistically

---

## 6. Required Verification

For each batch, verify:

| Check | Batch A | Batch B | Batch C | Batch D |
|---|---|---|---|---|
| SSE protocol smoke (done events) | ✅ | | | |
| Timeout diagnostics smoke | ✅ | | ✅ | |
| Worker stop/start lifecycle | | ✅ | | |
| `task_commands` terminal status correctness | | ✅ | | |
| Execute worker cancellation smoke | | ✅ | | |
| Cost estimation accuracy | | | ✅ | |
| Poll interval behavior | | | | ✅ |
| TypeScript check (`tsc --noEmit`) | ✅ | ✅ | ✅ | ✅ |
| Existing S100P smoke not impacted | ✅ | ✅ | ✅ | ✅ |

---

## 7. Open Decisions

| # | Decision | Options | Blocking |
|---|---|---|---|
| D1 | SSE protocol: remove `done.stream` or upgrade to v2? | (A) Remove `stream` from `done` events (match v1) / (B) Upgrade protocol to v2 to allow `stream` on `done` | Batch A |
| D2 | Poller timeout: reuse `TASK_HARD_TIMEOUT_MS` or dedicated `SSE_CLIENT_TIMEOUT_MS`? | (A) Reuse Worker env var / (B) New dedicated env var | Batch C (H3) |
| D3 | `markDelivered`: only set `delivered=true`, or also assert status consistency? | (A) Narrow to `delivered` only / (B) Assert terminal status matches before setting `delivered` | Batch D (H2) |
| D4 | Adaptive polling: integrate or remove? | (A) Integrate `getPollInterval` into `pollLoop` / (B) Remove dead code, keep 1s fixed | Batch C (H4) |

---

## 8. Relationship to S101T

S101T is TypeScript debt cleanup only. S101R is reliability/behavior hardening.

**Files touched by both sprints**:

| File | S101T touch | S101R touch | Risk |
|---|---|---|---|
| `src/services/phase3/sse-poller.ts` | Type casts, union extensions, typo fix | C1, C4, C3, M3 | **High** — must sequence carefully |

**Rule**: S101T fixes in `sse-poller.ts` must be type-only. S101R behavior fixes must not be mixed into S101T commits.

---

## 9. Status

```text
S100P: CLOSED / ACCEPTED
S101T: APPROVED — type-only fix phase (in progress)
S101R: PLANNING CREATED / NOT APPROVED FOR CODE FIXES
S101I: NOT STARTED
S101P: NOT STARTED
```

---

## 10. References

- `docs/reviews/phase3-reliable-polling-review.md` — source review
- `docs/SSE-EVENT-PROTOCOL-v1.md` — SSE protocol spec
- `src/services/phase3/` — Reliable Polling implementation
- `tests/services/phase3-workers.test.ts` — existing test suite
