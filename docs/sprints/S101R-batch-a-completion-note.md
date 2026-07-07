# S101R Batch A Completion Note — SSE done.stream Removal

## 1. Summary

Removed `stream` field from all SSE `done` events to comply with SSE protocol v1 (`docs/SSE-EVENT-PROTOCOL-v1.md`).

**Decision doc**: `docs/sprints/S101R-batch-a-protocol-decision.md`

## 2. Files Changed

| File | Change | Violations Fixed |
|---|---|---|
| `src/api/chat.ts` | Removed `stream:` from 5 `done` events | 5 → 0 |
| `src/services/phase3/sse-poller.ts` | Removed `stream:` from 7 `done` events | 7 → 0 |

### chat.ts — 5 locations

| Line | Context before | Removed |
|---|---|---|
| ~232 | Quick intent (date/time) | `stream: "已返回答案" / "Answer ready"` |
| ~265 | Quick intent (variant) | `stream: "已返回答案" / "Answer ready"` |
| ~379 | LLM direct answer (no delegation) | `stream: "已返回答案" / "Answer ready"` |
| ~495 | Delegation trigger failed | `stream: "任务失败" / "Task failed"` |
| ~769 | Primary done payload | `stream: doneMsg` (保留 ledger, budget, verification, qualityRouting, contextPackage, cost, runtimeTrace) |

### sse-poller.ts — 7 locations

| Line | Context before | Removed |
|---|---|---|
| ~396 | DB error state | `stream: "执行失败" / "Execution failed"` |
| ~529 | Worker failed + terminalSummary | `stream: "执行失败" / "Execution failed"` |
| ~565 | Cancelled + terminalSummary | `stream: "已取消" / "Cancelled"` |
| ~609 | Timed out + terminalSummary | `stream: "已超时" / "Timed out"` |
| ~792 | Completed + terminalSummary + usage | `stream: "分析完成" / "Analysis complete"` |
| ~818 | Archive with errors | `stream: "执行失败" / "Execution failed"` |
| ~857 | Poller timeout | `stream: "任务超时" / "Task timed out"` |

## 3. Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | PASS — 0 errors |
| `rg 'type:\s*"done".*stream:' src/` | PASS — 0 matches |
| Frontend consumer audit (`ChatInterface.tsx`) | PASS — no `done.stream` dependency |
| Tests/scripts audit | PASS — no `done.stream` references |

## 4. Scope Guard

**Only `done.stream` removed.** No other behavior changed:

| Deferred Issue | Status |
|---|---|
| C3 — Poller timeout `task_commands` update | NOT TOUCHED |
| C4 — Watchdog/Poller timeout field compatibility | NOT TOUCHED |
| C5 — Worker stop/start lifecycle | NOT TOUCHED |
| C6 — execute-worker cancellation/timeout | NOT TOUCHED |
| H1 — `estimateCost` hardcoded pricing | NOT TOUCHED |
| H3 — Poller hardcoded 180s | NOT TOUCHED |
| H4 — adaptive polling unused | NOT TOUCHED |
| C2/M1 — failed handler dead code | NOT TOUCHED |
| H2 — `markDelivered` state overwrite | NOT TOUCHED |
| M2 — busy-wait sleep | NOT TOUCHED |

## 5. Final Status

```text
S101R Batch A: READY FOR PM REVIEW
Protocol Compliance: done event conforms to SSE protocol v1 ✅
TypeScript: 0 errors ✅
```

---

*Batch A completed 2026-07-07.*
