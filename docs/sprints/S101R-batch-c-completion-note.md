# S101R Batch C Completion Note — Worker Safety

## 1. Summary

Batch C resolved worker lifecycle deadlock, added cancellation/timeout protection to execute-worker, and centralized cost estimation.

## 2. Issues Addressed

| Issue | Status | Summary |
|---|---|---|
| C5 | Resolved | `stopSlowWorker()` / `stopExecuteWorker()` now reset `workerStarted=false`, enabling restart after stop |
| C6 | Resolved | `executePlanCommand` now has cancellation/timeout checks at 3 points + error handling |
| H1 | Resolved | `slow-worker-loop` imports `estimateCost` from centralized `token-counter.ts` instead of local hardcoded pricing |

## 3. Files Changed

| File | Change |
|---|---|
| `src/services/phase3/slow-worker-loop.ts` | C5: `stopSlowWorker` resets `workerStarted=false` before setting `workerStopped=true` |
| `src/services/phase3/slow-worker-loop.ts` | H1: Removed local `estimateCost` (6 lines), added import from `../../models/token-counter.js` |
| `src/services/phase3/slow-worker-loop.ts` | C6: Exported `checkCancellation`, `checkTimeout`, `TaskCancelledError`, `TaskTimedOutError` |
| `src/services/phase3/execute-worker-loop.ts` | C5: `stopExecuteWorker` resets `workerStarted=false` before setting `workerStopped=true` |
| `src/services/phase3/execute-worker-loop.ts` | C6: Added import + 3 check points (entry/plan/run) + cancellation/timeout error handlers |
| `src/models/token-counter.ts` | H1: Added pricing entries for gpt-3.5-turbo, claude-3-haiku, DeepSeek-V3/R1/V4-Flash, Qwen2.5-7B/72B |

## 4. Pricing Model Addition

token-counter.ts now includes models that slow/execute workers may use:

| Model | Input (per 1K) | Output (per 1K) | Source |
|---|---|---|---|
| Qwen/Qwen2.5-72B-Instruct | $0.0004 | $0.0004 | config/pricing.ts |
| deepseek-ai/DeepSeek-V3 | $0.00027 | $0.0011 | config/pricing.ts |
| deepseek-ai/DeepSeek-R1 | $0.00055 | $0.00219 | config/pricing.ts |
| deepseek-ai/DeepSeek-V4-Flash | $0.00007 | $0.00028 | config/pricing.ts |

Previously these models fell back to `gpt-4o-mini` pricing.

## 5. execute-worker Check Points (C6)

```
executePlanCommand()
├── Entry: checkCancellation() + checkTimeout()        ← NEW
├── TaskPlanner.plan()
│   └── Before: checkCancellation() + checkTimeout()   ← NEW
├── ExecutionLoop.run()
│   └── Before: checkCancellation() + checkTimeout()   ← NEW
└── Catch: TaskCancelledError → cancelled status        ← NEW
           TaskTimedOutError  → timed_out status        ← NEW
```

Previously: **0 protection checkpoints** in the entire function.

## 6. Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | PASS (0 errors) |
| Local `estimateCost` definition in slow-worker-loop | PASS (0 matches — removed) |
| Centralized `estimateCost` import in slow-worker-loop | PASS (1 import from token-counter.ts) |
| `checkCancellation`/`checkTimeout` in execute-worker | PASS (1 import + 4 usages) |
| `workerStarted = false` in both stop functions | PASS (slow-worker:1, execute-worker:1) |

## 7. Scope Guard

Not changed:
- Worker start logic (only modified stop path)
- Poll loop internals
- TaskPlanner / ExecutionLoop core logic
- SSE poller / watchdog
- Frontend / UI
- Database schema

## 8. Final Status

```text
S101R Batch C: READY FOR PM REVIEW
```
