# Sprint 05 Review

**Name:** Execution Loop / Tool Actions
**Status:** ✅ Completed — 2026-04-08
**Duration:** Single session (2026-04-08 afternoon)

---

## Delivery Verdict

**Completed ✅**

All 4 task cards delivered, all commits pushed to remote, documentation complete.

---

## Task Cards Delivered

| Task Card | Description | Commit | Pushed |
|---|---|---|---|
| EL-001 | Tool Definition + Registry | `8d1079d` | ✅ |
| EL-002 | Task Planner | `e491917` | ✅ |
| EL-003 | Execution Loop | `086b937` | ✅ |
| EL-004 | Tool Guardrails + External API Safety | `07ad803` | ✅ |

Documentation commits:
- `3894c3a` — Sprint 05 proposal + current-sprint update

---

## What Was Built

### Architecture

```
Chat Request (body.execute=true)
    └── TaskPlanner.plan()
            └── ExecutionLoop.run()
                    ├── Step: tool_call → ToolRegistry → ToolExecutor
                    ├── Step: reasoning → callModelFull()
                    └── Step: synthesis → callModelFull() → final response
```

### Core Modules

| File | Responsibility |
|---|---|
| `services/tool-registry.ts` | Tool definitions, handler registry |
| `services/task-planner.ts` | `plan_task` Function Calling, structured plan output |
| `services/execution-loop.ts` | Sequential state machine, step accumulator |
| `services/tool-executor.ts` | Handler invocation, GuardrailRejection propagation |
| `services/tool-guardrail.ts` | HTTP allowlist, HTTPS-only, header blocks, size/timeout limits |
| `api/chat.ts` | `body.execute=true` branch, existing path unchanged |

### Execution Loop State Machine

Three step types:
- **`tool_call`**: model emits `tool_calls[]` → execute each tool → append results to messages → continue
- **`reasoning`**: model generates intermediate conclusions without tool calls
- **`synthesis`**: model produces final answer

Hard guards:
- Step cap (default 10)
- Tool call cap (default 20)
- No-progress abort (3 consecutive reasoning steps with no new tool_call)

### Guardrail Policy

| Rule | Value |
|---|---|
| HTTP allowlist | Fail-closed: empty = deny all |
| Protocol | HTTPS-only |
| Auth headers blocked | authorization, cookie, set-cookie, x-api-key, x-auth-token, x-session-token |
| Response size limit | 1 MB |
| Timeout | 10 seconds |
| web_search query | max 500 chars |
| web_search results | max 10 |

### GuardrailRejection Propagation Chain

```
Guardrail.validate() → allowed:false
    ↓
ToolHandler throws GuardrailRejection
    ↓
ToolExecutor.execute() catches → re-throws GuardrailRejection
    ↓
ExecutionLoop.step try/catch → step marked failed → loop aborts
```

This chain is intentional: GuardrailRejection is a *signal* that must propagate, not a routine error to swallow.

---

## Key Design Decisions

1. **Sequential loop, not concurrent.** Simpler to reason about, easier to trace, sufficient for v1.
2. **GuardrailRejection as a special error.** Re-thrown by executor, caught by loop. Distinguishes "policy rejection" from "tool failure."
3. **Function Calling for planning.** Reuses the primary model, no extra LLM call.
4. **Real HTTP, not stub.** `http_request` makes actual `fetch()` calls after guardrail passes.
5. **Existing single-turn path unaffected.** `body.execute=true` gates the new execution path.

---

## What Went Well

- **Scope discipline.** 4 cards, all completed within sprint. No feature creep.
- **GuardrailRejection propagation fix.** Caught mid-implementation that swallowed rejections would create silent security boundaries.
- **Full trace coverage.** Every loop event (loop_start/step_*/step_failed/loop_end/guardrail) is recorded.
- **All commits pushed.** Remote and local fully aligned on sprint close.
- **docs/runtime-flow.md + repo-map.md kept current.** New modules registered immediately.

---

## Known Limitations / Deferred Work

- No step-level retry or model fallback yet (catch errors → abort for now)
- web_search requires `WEB_SEARCH_ENDPOINT` env var — stub returns empty results if not set
- No execution trace UI (traces exist in DB, not surfaced to humans yet)
- No execution result memory persistence
- `http_request` is GET-only (no POST/body/payload)

---

## Technical Debt Noted

- decision-logger.ts SQL placeholder bug (27 fields, $1-$26 only) — low priority, non-blocking
- `chat.ts` is getting heavy; future sprint may want a dedicated execution controller

---

## Retrospective

**What to preserve:**
- Controlled scope per sprint — finish before adding
- GuardrailRejection propagation discipline — security failures must be signals, not background noise
- Full remote sync before sprint close

**What to improve:**
- sprint-05-review.md should have been created during the sprint, not after — better alignment of doc cadence
- The `WEB_SEARCH_ENDPOINT` env var should have been documented in the review doc earlier

---

## Files Changed

### New Files
- `backend/src/services/tool-registry.ts`
- `backend/src/services/task-planner.ts`
- `backend/src/services/execution-loop.ts`
- `backend/src/services/tool-executor.ts`
- `backend/src/services/tool-guardrail.ts`
- `docs/task-cards/001-tool-definition-and-registry-review.md`
- `docs/task-cards/002-task-planner-review.md`
- `docs/task-cards/003-execution-loop-review.md`
- `docs/task-cards/004-tool-guardrails-review.md`

### Modified Files
- `backend/src/types/index.ts` — ChatMessage.tool_calls, tool_call_id, role="tool"; ChatRequest.execute
- `backend/src/api/chat.ts` — body.execute branch
- `backend/src/config.ts` — guardrail config section
- `docs/runtime-flow.md` — Execution Loop section added
- `docs/repo-map.md` — new modules registered
- `docs/current-sprint.md` — Sprint 05 closed
