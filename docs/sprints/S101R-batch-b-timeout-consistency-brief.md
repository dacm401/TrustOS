# S101R Batch B Timeout Consistency Brief

## 1. Background

Batch B addresses timeout consistency and terminal state reliability from the
[Phase 3 Reliable Polling review](../reviews/phase3-reliable-polling-review.md).

Related issues:

| Issue | Severity | Category | Summary |
|---|---|---|---|
| C3 | Critical | Data Consistency | Poller 180s hard timeout does not update `task_commands` — leaves zombie command rows |
| C4 | Critical | Timeout Semantics | Watchdog writes `timedOutAt`/`stuckSince`, Poller reads `timeoutKind`/`elapsedMs` — field incompatibility |
| H3 | High | Timeout Config | Poller hardcoded 180s timeout vs Worker configurable `TASK_SOFT/HARD_TIMEOUT_MS` |

These three items are grouped together because they all revolve around timeout
semantics and terminal-state consistency. Fixing them in isolation risks one fix
being undermined by another.

---

## 2. Current Timeout Sources

| Component | Location | Source | Value | Configurable? | Notes |
|---|---:|---|---|---|---|
| SSE Poller (local timeout) | `sse-poller.ts:840` | hardcoded literal | `180_000` ms | **No** | Independent of Worker timeout |
| Slow Worker (soft) | `runtime-trace.ts:310` | `TASK_SOFT_TIMEOUT_MS` | `120_000` ms (env override) | **Yes** (`TASK_SOFT_TIMEOUT_MS`) | Throws `TaskTimedOutError("soft")` |
| Slow Worker (hard) | `runtime-trace.ts:313` | `TASK_HARD_TIMEOUT_MS` | `300_000` ms (env override) | **Yes** (`TASK_HARD_TIMEOUT_MS`) | Throws `TaskTimedOutError("hard")` |
| Watchdog stuck threshold | `task-watchdog.ts:14` | `STUCK_THRESHOLD_MS` | `300_000` ms (5 min, env override) | **Yes** (`TASK_WATCHDOG_STUCK_MS`) | Scans every 30s |
| OpenAI API client | `openai.ts:9,84` | hardcoded literal | `180_000` ms | **No** | HTTP-level timeout |

### Timeout hierarchy visualization

```
  0s ────── 120s ────────────── 180s ─────────────────── 300s ────────>
              │                    │                          │
        SOFT_TIMEOUT        POLLER_LOCAL              HARD_TIMEOUT
        (Worker throws)     (Poller yields done)      (Worker throws)
                                                      + WATCHDOG (5min)
```

**Key mismatch**: Poller's local 180s falls between Worker's soft (120s) and
hard (300s) timeouts. This means the Poller may declare timeout before the
Worker has given up — but the Worker (if still running at 180s) is unaware of
this and continues executing.

---

## 3. Current Timeout Payload Shapes

### 3.1 Who writes what to `task_archives.slow_execution`

| Writer | Fields Written | Trigger |
|---|---|---|
| **Slow Worker** (`markTimedOut`) | `timedOutAt`, `timeoutKind`, `thresholdMs`, `elapsedMs`, `errors` | `TaskTimedOutError` caught in catch block (`slow-worker-loop.ts:1208-1214`) |
| **Watchdog** | `timedOutAt`, `previousState`, `stuckSince`, `timeoutReason` | `scanStuckTasks()` — `task-watchdog.ts:81-86` |
| **SSE Poller** (local 180s) | **Nothing** — no `slow_execution` write, no `task_commands` update | `elapsed > 180_000` — `sse-poller.ts:839-862` |

### 3.2 Who reads what from `task_archives.slow_execution`

| Reader | Fields Expected | Location |
|---|---|---|
| **SSE Poller** (timed_out handler) | `timeoutKind`, `elapsedMs`, `thresholdMs` | `sse-poller.ts:587-589` |
| **SSE Poller** (cancelled handler) | `cancelledAt`, `cancelReason` | `sse-poller.ts:606-610` |
| **SSE Poller** (failed handler) | `errors[]` | `sse-poller.ts:806-814` |

### 3.3 Compatibility matrix

| Writer → Reader | Poller reads `timeoutKind`/`elapsedMs`/`thresholdMs` |
|---|---|
| Slow Worker `markTimedOut` | ✅ **Compatible** — writes `timeoutKind`, `elapsedMs`, `thresholdMs` |
| Watchdog `setSlowExecution` | ❌ **Incompatible** — writes `previousState`, `stuckSince`, `timeoutReason` |
| Poller local 180s timeout | ❌ **Does not write** — no slow_execution write at all |

**Result of C4**: When Watchdog triggers timeout and Poller later reads
`slow_execution`, it sees `undefined` for `timeoutKind`/`elapsedMs`/`thresholdMs`,
defaulting to `"soft"` / `0` / `0` — showing the user "⏰ 任务超时 (软超时,
0s / 0s)", which is semantically wrong.

---

## 4. `task_commands` Terminal Status Audit

### 4.1 Status values in use

| Status | Writer | When | Reader |
|---|---|---|---|
| `queued` | Fast Manager (INSERT) | Command created | Slow Worker (pickup query) |
| `running` | Slow Worker / Execute Worker | `updateStatus(id, "running")` | Poller (line 829), Watchdog (WHERE clause) |
| `completed` | Slow Worker / Execute Worker | Normal completion | Poller |
| `failed` | Slow Worker / Execute Worker | Error caught | Poller (line 829) |
| `cancelled` | Slow Worker | `TaskCancelledError` caught | Poller |
| `timed_out` | Slow Worker, Watchdog | `TaskTimedOutError` / `scanStuckTasks` | Poller |

### 4.2 C3 gap: Poller local 180s timeout does NOT write `task_commands`

```typescript
// sse-poller.ts:839-862 — Poller's timeout path
if (elapsed > 180_000 && (...)) {
  // ✅ Writes to delegation_logs
  DelegationLogRepo.updateExecution(delegation_log_id, {
    execution_status: "timeout", ...
  });
  // ✅ Yields SSE error + done events
  yield { type: "error", stream: "⏱ 任务执行超时..." };
  yield { type: "done", routing_layer: "L2" };
  // ✅ Calls markDelivered
  await TaskArchiveRepo.markDelivered(taskId);
  // ❌ Does NOT update task_commands.status
  // ❌ Does NOT write to task_archives.slow_execution
  // ❌ Does NOT call TaskArchiveRepo.updateState(taskId, "timed_out")
  break;
}
```

**Impact**: If the SSE connection drops after the Poller's 180s timeout fires,
the `task_commands` row remains in `queued`/`running` permanently. The Slow
Worker's polling loop may re-pick up this command. Only the Watchdog
(5-minute threshold) eventually cleans it up.

### 4.3 `timed_out` vs `timeout` spelling inconsistency audit

| Location | Spelling | Context |
|---|---|---|
| `task_commands.status` | `timed_out` | DB column — used by Watchdog (line 90), Slow Worker (line 164, 1204) |
| `task_archives.state` | `timed_out` | DB column — used by Watchdog (line 78), Slow Worker via `markTimedOut` |
| `delegation_logs.execution_status` | `timeout` | DB column — used by Poller (line 843), Watchdog (line 103) |
| `DelegationLogExecutionUpdate` | `"timeout"` | TypeScript type — `delegation.ts:542` |
| Timed-out summary status | `"timed_out"` | `buildTerminalSummary({ status: "timed_out" })` — `slow-worker-loop.ts:1197` |

**Finding**: `task_commands` and `task_archives` consistently use `timed_out`;
`delegation_logs` consistently uses `timeout`. This is a **known dual-spelling**
situation across different tables, not a bug within a single table. However,
it creates confusion when cross-referencing across tables.

---

## 5. Proposed Unified Timeout Payload Shape

```typescript
/**
 * Unified timeout payload written to task_archives.slow_execution.
 * All timeout sources (Worker, Watchdog, Poller) write this shape.
 */
interface TimeoutPayload {
  /** Kind of timeout: soft/hard/watchdog/poller */
  timeoutKind: "soft" | "hard" | "watchdog" | "poller";

  /** Elapsed wall time in milliseconds */
  elapsedMs: number;

  /** Timeout threshold in milliseconds */
  thresholdMs: number;

  /** ISO 8601 timestamp when timeout was detected */
  timedOutAt: string;

  /** Human-readable reason (optional) */
  timeoutReason?: string;
}
```

This is a superset of the current Slow Worker's `markTimedOut` payload and the
Watchdog's `setSlowExecution` payload. It keeps all existing fields and adds
none that are not already used by at least one writer.

**Migration strategy**: Each writer adds the fields it currently omits:

| Writer | Currently Writes | Must Add |
|---|---|---|
| Slow Worker `markTimedOut` | `timedOutAt`, `timeoutKind`, `thresholdMs`, `elapsedMs` | `timeoutReason` (optional) |
| Watchdog `scanStuckTasks` | `timedOutAt`, `previousState`, `stuckSince`, `timeoutReason` | `timeoutKind: "watchdog"`, `elapsedMs`, `thresholdMs` |
| Poller (currently writes nothing) | *(none)* | `timeoutKind: "poller"`, `elapsedMs`, `thresholdMs: 180_000`, `timedOutAt`, `timeoutReason` |

---

## 6. Proposed Implementation Scope

### 6.1 Files likely affected

| File | Change | Issue |
|---|---|---|
| `src/services/phase3/sse-poller.ts` | Add `task_commands` update in 180s timeout path; add `slow_execution` write with unified payload | C3, partial C4 |
| `src/services/phase3/task-watchdog.ts` | Add `timeoutKind`, `elapsedMs`, `thresholdMs` to `setSlowExecution` call | C4 |
| `src/types/runtime-trace.ts` | Possibly export `SSE_CLIENT_TIMEOUT_MS` constant | H3 |

### 6.2 Changes NOT in scope (deferred to Batch C/D)

- C5: Worker stop/start lifecycle
- C6: execute-worker cancellation/timeout
- H1: `estimateCost` hardcoded pricing
- H4: adaptive polling usage
- C2/M1: failed handler dead code
- H2: `markDelivered` state overwrite
- M2: busy-wait sleep

### 6.3 Detailed C3 fix plan

In `sse-poller.ts:839-862`, the 180s timeout path should additionally:

1. Look up the `task_commands` row for this task (the command ID is not
   currently tracked in the Poller — may need to add a `commandId` parameter
   or derive it from `TaskRepo.getById(taskId)` as done at line 828)
2. Call `TaskCommandRepo.updateStatus(commandId, "timed_out", { finished_at,
   error_message })` — mirroring the Slow Worker's timeout handling at
   `slow-worker-loop.ts:1204-1207`
3. Call `TaskArchiveRepo.markTimedOut(taskId, { timeoutKind: "poller",
   thresholdMs: 180_000, elapsedMs })` — mirroring the Slow Worker's
   timeout handling at `slow-worker-loop.ts:1208-1212`

### 6.4 Detailed C4 fix plan

In `task-watchdog.ts:81-86`, update the `setSlowExecution` call from:

```typescript
await TaskArchiveRepo.setSlowExecution(row.id, {
  timedOutAt: new Date().toISOString(),
  previousState: row.state,
  stuckSince: row.updated_at,
  timeoutReason: `Task stuck in "${row.state}" for >...`,
});
```

To:

```typescript
const now = Date.now();
const stuckMs = now - new Date(row.updated_at).getTime();
await TaskArchiveRepo.setSlowExecution(row.id, {
  timeoutKind: "watchdog",
  elapsedMs: stuckMs,
  thresholdMs: STUCK_THRESHOLD_MS,
  timedOutAt: new Date().toISOString(),
  previousState: row.state,       // preserve for diagnostics
  stuckSince: row.updated_at,      // preserve for diagnostics
  timeoutReason: `Task stuck in "${row.state}" for >${Math.floor(STUCK_THRESHOLD_MS / 60000)}min`,
});
```

This adds `timeoutKind`, `elapsedMs`, `thresholdMs` (the three fields the
Poller expects) while preserving the existing diagnostic fields.

### 6.5 Detailed H3 fix plan

Extract the Poller's timeout threshold to a named constant in
`runtime-trace.ts`, alongside `TASK_SOFT_TIMEOUT_MS` / `TASK_HARD_TIMEOUT_MS`:

```typescript
/** SSE client-side timeout in milliseconds (180s).
 *  Independent of Worker timeouts — the Poller is a client observing the task,
 *  not the Worker executing it. */
export const SSE_CLIENT_TIMEOUT_MS =
  Number(process.env["SSE_CLIENT_TIMEOUT_MS"]) || TASK_HARD_TIMEOUT_MS;
```

**Open decision**: Should Poller use `TASK_HARD_TIMEOUT_MS` as its default
(recommended by review), or a dedicated `SSE_CLIENT_TIMEOUT_MS`?

- **Using `TASK_HARD_TIMEOUT_MS`**: Matches Worker semantics; Poller won't
  time out before Worker finishes. But 300s may be too long for end-user UX.
- **Using dedicated `SSE_CLIENT_TIMEOUT_MS`**: Independent tuning; can be
  shorter than Worker timeout (180s) for better UX. But may cause Poller
  timeout while Worker is still running.

**Recommendation**: Use a dedicated `SSE_CLIENT_TIMEOUT_MS` defaulting to
180s (current behavior preserved), with env override. This decouples client
UX timeout from Worker execution timeout.

---

## 7. Open Decisions for PM

| # | Question | Options | Recommendation |
|---|---|---|---|
| D1 | Poller timeout default value | A: Use `TASK_HARD_TIMEOUT_MS` (300s) — per review | B: Dedicated `SSE_CLIENT_TIMEOUT_MS` (180s) — preserves current UX but short of Worker hard timeout |
| D2 | Should Poller also update `task_archives.state = "timed_out"`? | A: Yes — full consistency with Watchdog/Worker | **B: No** — Poller is an observer not an executor; keep `markDelivered` but don't change `state` |
| D3 | Command ID required for `task_commands` update — how to obtain? | A: Pass `commandId` as parameter to `pollArchiveAndYield` | **B: Query via `TaskRepo.getById(taskId)` in timeout path** — same pattern as line 828 |

**PM note**: These decisions are recorded for PM review. They do not block the
brief. Implementation will follow the chosen options.

---

## 8. Verification Plan

| Step | Command / Check | Expected |
|---|---|---|
| 1 | `npx tsc --noEmit` | 0 errors |
| 2 | `rg 'timed_out' src/services/phase3/sse-poller.ts` | Confirm Poller writes `timed_out` to `task_commands` |
| 3 | `rg 'timeoutKind' src/services/phase3/task-watchdog.ts` | Confirm Watchdog writes `timeoutKind: "watchdog"` |
| 4 | `rg 'timeoutKind.*elapsedMs.*thresholdMs' src/services/phase3/` | All timeout writers emit the unified shape |
| 5 | `rg 'timeoutKind.*elapsedMs.*thresholdMs' src/db/task-archive-repo.ts` | `markTimedOut` accepts unified payload |
| 6 | S100P smoke (if available) | No regression |

---

## 9. Final Status

```text
S101R Batch B: PLANNING READY / PENDING PM APPROVAL
C3/C4/H3: Analyzed — implementation brief complete
No code changed — planning only
```
