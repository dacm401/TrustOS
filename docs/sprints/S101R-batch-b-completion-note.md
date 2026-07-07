# S101R Batch B Completion Note — Timeout Consistency

## 1. Summary

Batch B resolved timeout payload compatibility between Watchdog/Poller, replaced the
hardcoded 180s Poller timeout with the system `TASK_HARD_TIMEOUT_MS` constant, and
added `task_commands` terminal status update to the Poller's own timeout path.

## 2. Issues Addressed

| Issue | Status | Summary |
|---|---|---|
| C3 | Resolved | Poller timeout now updates `task_archives` state (via `markTimedOut`) and `task_commands.status` to `timed_out` |
| C4 | Resolved | Watchdog now writes `timeoutKind`, `elapsedMs`, `thresholdMs` alongside legacy fields |
| H3 | Resolved | Poller timeout uses `TASK_HARD_TIMEOUT_MS` (300s) instead of hardcoded `180_000` (180s) |

## 3. Files Changed

| File | Change | Issue(s) |
|---|---|---|
| `src/services/phase3/task-watchdog.ts` | Added `timeoutKind`, `elapsedMs`, `thresholdMs` to `setSlowExecution` payload | C4 |
| `src/services/phase3/sse-poller.ts` | Imported `TASK_HARD_TIMEOUT_MS`; replaced `180_000` ; added `markTimedOut` + `task_commands` status update in Poller timeout path | H3, C3 |
| `docs/sprints/S101R-batch-b-completion-note.md` | This file | — |

## 4. Timeout Shape

After Batch B, all timeout sources write a unified set of fields:

| Source | `timeoutKind` | `elapsedMs` | `thresholdMs` | Notes |
|---|---|---|---|---|
| Slow Worker (S91P) | `"soft"` / `"hard"` | ✅ | ✅ | Existing, unchanged |
| Watchdog (S96P) | `"watchdog"` | ✅ (new) | `STUCK_THRESHOLD_MS` (new) | C4 |
| Poller (local) | `"poller"` (new) | ✅ (new) | `TASK_HARD_TIMEOUT_MS` (new) | C3 + H3 |

Legacy fields (`previousState`, `stuckSince`, `timeoutReason`, `timedOutAt`) are
retained for backward compatibility. No readers were removed.

## 5. Terminal Status Decision

| Target | Value Written | Reason |
|---|---|---|
| `task_archives.state` | `timed_out` | Matches existing table CHECK constraint and `markTimedOut` method |
| `task_commands.status` | `timed_out` | Matches existing CHECK constraint (`queued` / `running` / `completed` / `failed` / `cancelled` / `timed_out`) |
| `delegation_logs.execution_status` | `timeout` | Pre-existing convention; not changed (separate table, different enum) |

The dual spelling `timed_out` vs `timeout` is a pre-existing cross-table convention:
- `task_archives` and `task_commands` use `timed_out` (snake_case, DB CHECK constraint)
- `delegation_logs` uses `timeout` (plain word, application-level enum)

Batch B does not introduce or resolve this duality; it follows the existing convention
for each table.

## 6. Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | PASS (0 errors) |
| `180_000` grep in `sse-poller.ts` | PASS (0 matches) |
| `timeoutKind` / `elapsedMs` / `thresholdMs` in `task-watchdog.ts` | PASS (all 3 present) |
| `timed_out` / `timeout` status grep across `phase3/` | PASS (no inconsistency introduced) |
| `TASK_HARD_TIMEOUT_MS` import in `sse-poller.ts` | PASS |
| Timeout payload unit/smoke | Not available; verified by typecheck and static audit |

## 7. Scope Guard

Not changed in this batch:

| Issue | Description | Status |
|---|---|---|
| C5 | Worker stop/start lifecycle | Not touched |
| C6 | execute-worker cancellation/timeout protection | Not touched |
| H1 | estimateCost hardcoded pricing | Not touched |
| H4 | adaptive polling unused | Not touched |
| C2/M1 | failed handler dead code cleanup | Not touched |
| H2 | markDelivered state overwrite | Not touched |
| M2 | busy-wait sleep | Not touched |

Also not changed:
- Database schema
- State machine transitions (except adding Poller → `timed_out` which was missing)
- SSE protocol
- Frontend/UI
- S100P behavior

## 8. Behavior Change Note

The Poller timeout threshold changed from **180s (3 min)** to **300s (5 min)**, matching
`TASK_HARD_TIMEOUT_MS`. This means SSE connections may now stay alive up to 5 minutes
before the Poller declares a local timeout, instead of the previous 3 minutes.

Rationale: Using `TASK_HARD_TIMEOUT_MS` aligns the Poller timeout with the Worker's
hard timeout. If a task is still within the Worker's hard timeout window (5 min), the
Poller should not prematurely give up. The Poller's role is to detect *SSE/client-side*
failures, not to enforce a tighter timeout than the Worker itself.

## 9. Final Status

```text
S101R Batch B: READY FOR PM REVIEW
```
