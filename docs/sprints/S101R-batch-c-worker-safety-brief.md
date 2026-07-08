# S101R Batch C Worker Safety Brief

## 1. Background

Batch C addresses worker lifecycle safety, execute-worker protection gaps, and
cost estimation accuracy from the Phase 3 Reliable Polling review.

Related issues:

| Issue | Severity | Category | Summary |
|---|---|---|---|
| C5 | Critical | Worker Lifecycle | Worker stop/start — stop blocks restart |
| C6 | Critical | Execute Worker | execute-worker-loop lacks cancellation & timeout protection |
| H1 | High | Pricing | estimateCost has 3 conflicting pricing systems, local shadow ignores model |

These three issues share a common theme: **worker execution safety**. They cover
what happens before execution (start/stop lifecycle), during execution (cancellation/timeout),
and after execution (cost accounting).

## 2. Current State Audit

### 2.1 C5 — Worker Stop/Start Lifecycle

**Files**: `slow-worker-loop.ts` (1320–1360), `execute-worker-loop.ts` (209–245), `index.ts` (189–222)

**Problem**: `stopSlowWorker()` sets `workerStopped = true` but does **not** reset
`workerStarted = false`. Result: `startSlowWorker()` sees `workerStarted === true`
and returns immediately — Worker cannot be restarted after graceful shutdown.

```typescript
// slow-worker-loop.ts:1325
export function startSlowWorker(): void {
  if (workerStarted) {          // ← still true after stop
    console.log("[slow-worker] Already started, skipping");
    return;                     // ← never reaches pollLoop
  }
  workerStarted = true;
  workerStopped = false;
  pollLoop().catch(...);
}

// slow-worker-loop.ts:1341
export function stopSlowWorker(): void {
  if (!workerStarted) return;
  workerStopped = true;        // ← sets stopped, but...
  // ❌ workerStarted NOT reset to false
}
```

**Contrast with Watchdog** (`task-watchdog.ts`):
- `startTaskWatchdog()` checks `watchdogTimer` (timer handle, not a boolean)
- `stopTaskWatchdog()` sets `watchdogTimer = null`
- This design naturally allows restart — no boolean flag deadlock

**Additional C5 concerns (informational, not in this batch scope)**:
- `stopSlowWorker()` only sets a flag; in-flight LLM calls are not aborted
- `gracefulShutdown()` waits 500ms before force-exit, insufficient for active LLM calls

### 2.2 C6 — Execute Worker Lacks Cancellation & Timeout Protection

**Files**: `execute-worker-loop.ts` (full file, 246 lines), `slow-worker-loop.ts` (72–133)

**Slow Worker has 5 protection checkpoints**:
| Line | Stage | Check |
|------|-------|-------|
| 149 | Entry | `checkCancellation` + `checkTimeout` |
| 430 | Fast Path LLM | `checkCancellation` + `checkTimeout` |
| 598 | Cycle Pre-gen | `checkCancellation` + `checkTimeout` |
| 660 | Cycle per-iteration | `checkCancellation` + `checkTimeout` |
| 887 | Legacy Path LLM | `checkCancellation` + `checkTimeout` |

**Execute Worker has 0 protection checkpoints**. The `executePlanCommand()`
function in `execute-worker-loop.ts` processes `execute_plan` commands without
any cancellation or timeout checks.

**What's needed**:
- `TaskCancelledError` and `TaskTimedOutError` classes (already defined in `slow-worker-loop.ts`)
- `checkCancellation()` and `checkTimeout()` functions (already defined in `slow-worker-loop.ts`)
- These need to be **extracted to a shared module** or duplicated in `execute-worker-loop.ts`

### 2.3 H1 — Three Conflicting Pricing Systems

**Files**: `models/token-counter.ts` (9–17), `slow-worker-loop.ts` (1262–1267), `config/pricing.ts` (1–83)

**Three systems, three different sets of prices**:

| System | File | Unit | Model Coverage | Qwen2.5-72B (input/output) |
|---|---|---|---|---|
| A | `token-counter.ts` | USD/1K | 4 models (gpt, claude) | Not listed → fallback to gpt-4o-mini |
| B | `slow-worker-loop.ts` (local) | USD/1K | **None** (model ignored) | $0.001/$0.002 per 1K |
| C | `config/pricing.ts` | **USD/1M** | 10 models | $0.4/$0.4 per 1M = $0.0004/$0.0004 per 1K |

**System B (local shadow) is 2.5×–5× higher than System C for Qwen**:

```
slow-worker-loop.ts: input=$0.001/1K,  output=$0.002/1K
pricing.ts:         input=$0.0004/1K, output=$0.0004/1K
                     ↑ 2.5× diff      ↑ 5× diff
```

**System A vs C for GPT-4o**:

```
token-counter.ts: input=$0.0025/1K, output=$0.01/1K
pricing.ts:       input=$0.005/1K,  output=$0.015/1K
                   ↑ 2× diff         ↑ 1.5× diff
```

**Root cause**: `slow-worker-loop.ts` does **not** import `estimateCost` from
`token-counter.ts` (its import on line 14 only takes `callModelFull` and `callOpenAIWithOptions`).
Instead it defines a local function on line 1262 that uses hardcoded Qwen prices and
**completely ignores the `model` parameter**.

**The `sse-poller.ts` correctly imports** from `token-counter.ts` (line 14).

## 3. Proposed Implementation Scope

### 3.1 C5 — Worker Lifecycle Fix

| File | Change | Risk |
|---|---|---|
| `slow-worker-loop.ts` | `stopSlowWorker()`: add `workerStarted = false` | Low — one line |
| `execute-worker-loop.ts` | `stopExecuteWorker()`: add `execWorkerStarted = false` | Low — one line |
| `index.ts` | No change needed (gracefulShutdown calls stop functions in sequence) | — |

**Minimal fix**: One boolean reset per worker stop function. No structural changes.

**Explicitly NOT in scope** (see Section 4):
- AbortController for in-flight LLM calls
- gracefulShutdown timeout tuning
- Worker restart coordination with HTTP server lifecycle

### 3.2 C6 — Execute Worker Protection

| File | Change | Risk |
|---|---|---|
| `execute-worker-loop.ts` | Import or duplicate `checkCancellation` / `checkTimeout` / error classes | Medium — adds DB queries per execution |
| Possibly: new shared file `services/phase3/worker-safety.ts` | Extract shared cancellation/timeout helpers | Low — pure extraction |

**Protection points to add** (parallel to slow worker):
1. Entry: `checkCancellation(archive_id, task_id)` + `checkTimeout(archive_id, task_id, startTime, ...)`
2. Before each LLM call in the execute plan loop

**Dependencies**: `TaskArchiveRepo.isCancelled()`, `TaskArchiveRepo.updateState()`, `TASK_SOFT_TIMEOUT_MS` / `TASK_HARD_TIMEOUT_MS` — all already exist.

### 3.3 H1 — Pricing Unification

| File | Change | Risk |
|---|---|---|
| `slow-worker-loop.ts` | Remove local `estimateCost()` (line 1262–1267), add `estimateCost` to import from `../../models/token-counter` | Low — import swap |
| `models/token-counter.ts` | Optionally expand pricing table to cover models used in slow worker (Qwen, DeepSeek) | Medium — adds new models |

**Preferred approach**: Delete local shadow, import from `token-counter.ts`.
If `token-counter.ts` doesn't cover the models used by slow worker, add them.

**Open question**: Should `token-counter.ts` also be aligned with `config/pricing.ts`?
Both have different prices for the same models. This is a broader pricing audit that
may exceed Batch C scope.

**Recommendation**: Batch C should at minimum **consolidate to one pricing source**
within the Phase 3 path (worker cost tracking). Full pricing audit across the entire
codebase (token-counter vs pricing.ts vs real cloud pricing) can be a separate task.

## 4. Explicitly Out of Scope

Batch C does **not** address:

| Issue | Reason |
|---|---|
| AbortController for in-flight LLM calls | Major architectural change; needs separate design |
| gracefulShutdown timeout tuning | Operations concern, not Phase 3 reliability |
| Full pricing.ts ↔ token-counter.ts alignment | Cross-cutting pricing audit; exceeds worker scope |
| C2/M1 — failed handler dead code | Batch D cleanup candidate |
| H2 — markDelivered state overwrite | Batch D cleanup candidate |
| H4 — adaptive polling unused | Batch D candidate |
| M2 — busy-wait sleep | Low priority micro-optimization |
| Database schema changes | Not needed for these fixes |
| Frontend/UI changes | Not in Phase 3 scope |

## 5. Open Decisions

| # | Question | Recommendation |
|---|---|---|
| 1 | Extract shared worker-safety.ts or duplicate in execute-worker? | Extract to shared module — cleaner, single source of truth |
| 2 | Should execute-worker also get S91P timeout handling (markTimedOut)? | Yes — same pattern as slow worker (line 1191–1217) |
| 3 | Should `token-counter.ts` pricing be expanded to cover Qwen/DeepSeek? | Yes — minimum viable: add the models used by slow worker |
| 4 | Should `token-counter.ts` pricing be aligned with `config/pricing.ts`? | Defer to separate pricing audit — note the discrepancy in completion |
| 5 | Single commit or split by issue? | Single commit — all three are small, related worker safety fixes |

## 6. Verification Plan

| Check | Method |
|---|---|
| TypeScript | `npx tsc --noEmit` |
| Worker lifecycle | Verify `startSlowWorker()` after `stopSlowWorker()` re-enters `pollLoop` |
| estimateCost import | grep slow-worker-loop.ts for `function estimateCost` → 0 matches |
| Cancellation in execute-worker | grep execute-worker-loop.ts for `checkCancellation` → at least 1 match |
| Timeout in execute-worker | grep execute-worker-loop.ts for `checkTimeout` → at least 1 match |
| No S100P regression | Run existing smoke if available |

## 7. Files Likely Affected

```text
src/services/phase3/slow-worker-loop.ts        — C5 (1 line), H1 (remove local estimateCost)
src/services/phase3/execute-worker-loop.ts      — C5 (1 line), C6 (add protection checkpoints)
src/services/phase3/worker-safety.ts            — (possible NEW) shared helpers
src/models/token-counter.ts                     — H1 (possibly expand pricing table)
docs/sprints/S101R-batch-c-completion-note.md   — required artifact
```

## 8. Status

```text
S101R Batch C: PLANNING READY / PENDING PM APPROVAL
```
