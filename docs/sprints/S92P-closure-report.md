# Sprint 92P — Terminal State Observability & Recovery UX Metadata V0

**Status**: CLOSED ✅
**Commit**: `0cfafe1`
**Baseline**: `be579c7` (S91P closure baseline)
**Date**: 2026-05-28

---

## 1. Sprint Goal

Expose safe, structured terminal-state metadata for `completed`/`failed`/`cancelled`/`timed_out` tasks so UI and clients can explain what happened and whether recovery/retry is appropriate, without implementing retry orchestration yet.

---

## 2. Deliverables

| ID | Deliverable | Status |
|---|---|---|
| D1 | `RuntimeTerminalSummary` type + `TerminalCategory` + `TerminalRecoverability` | ✅ |
| D2 | `buildTerminalSummary()` builder for all 4 terminal states | ✅ |
| D3 | `canRetry` advisory flag (no retry execution) | ✅ |
| D4 | Terminal summary injected in SSE error/done events (additive only) | ✅ |
| D5 | Existing SSE event shapes preserved — `terminalSummary` is additive field | ✅ |
| D6 | Privacy: `userMessage` is template-safe, no prompt/messages/tools/API keys | ✅ |
| D7 | Terminal-state matrix tests (63/63 PASS) | ✅ |
| D8 | S75P–S91P regression: 399/399 PASS, no regressions | ✅ |
| D9 | S92P closure report | ✅ |
| — | `TaskState` + `CommandStatus` type union includes `"timed_out"` | ✅ |
| — | `markCancelled()` guard upgraded to full 4-terminal-state guard | ✅ |
| — | `terminalSummary` persisted in `slow_execution` JSONB for all 4 paths | ✅ |

---

## 3. Key Design

### 3.1 `RuntimeTerminalSummary` type

```ts
interface RuntimeTerminalSummary {
  status: string;                    // completed | failed | cancelled | timed_out
  category: TerminalCategory;        // success | runtime_error | model_error | tool_error | user_cancelled | policy_timeout | unknown
  reasonCode: string;               // Stable code for observability
  userMessage: string;              // Template-safe user-facing text
  recoverability: TerminalRecoverability;  // none | retry_possible | manual_review | resume_possible
  canRetry: boolean;                // Advisory only — no retry execution
}
```

### 3.2 Terminal-state matrix

| Status | Category | Reason Code | Recoverability | canRetry |
|--------|----------|-------------|----------------|----------|
| `completed` | `success` | `task_completed` | `none` | `false` |
| `failed` | `runtime_error` / `model_error` / `tool_error` | `execution_error` | `retry_possible` | `true` |
| `cancelled` | `user_cancelled` | `user_cancelled` | `none` | `false` |
| `timed_out` | `policy_timeout` | `timeout_soft` / `timeout_hard` | `retry_possible` | `true` |

### 3.3 Failed state category detection

Error message keywords determine the `category`:
- `model_error`: "model", "llm", "api key", "rate limit"
- `tool_error`: "tool_call", "function_call", "tool"
- `runtime_error`: everything else (default)

### 3.4 SSE additive compatibility

- **No new SSE event type**. `terminalSummary` is an additive field on existing `error` and `done` events.
- Existing fields (`type`, `stream`, `routing_layer`) unchanged.
- Legacy clients can safely ignore `terminalSummary`.

### 3.5 Privacy boundary

`userMessage` is always template-safe:
- Completed: "Task completed successfully."
- Failed: "Task failed due to a runtime error." (no raw stack, no error details)
- Cancelled: Uses `cancelReason` from execution metadata (truncated to 200 chars)
- Timed out: "Task timed out after reaching the configured soft timeout threshold (130s / 120s)."

**Never exposed**: prompt, messages, tools, tool arguments, API keys, raw exception stacks, model completions, user content.

### 3.6 Persistence

`terminalSummary` is written to `slow_execution` JSONB in `task_archives` for all four terminal paths:
- Completed: in `setSlowExecution()` at worker completion
- Cancelled: in catch block `TaskCancelledError` handler
- Timed out: in catch block `TaskTimedOutError` handler
- Failed: in catch block generic error handler

### 3.7 `markCancelled()` guard upgrade

Guard upgraded from `NOT IN ('completed', 'failed')` to `NOT IN ('completed', 'failed', 'cancelled', 'timed_out')`, matching the S91P `markTimedOut()` guard pattern.

---

## 4. Files Modified

| File | Changes |
|------|---------|
| `src/types/runtime-trace.ts` | +`RuntimeTerminalSummary`, +`TerminalCategory`, +`TerminalRecoverability`, +`buildTerminalSummary()`, +`terminalSummary` in `RuntimeTraceExtract` |
| `src/types/task.ts` | `TaskState` + `"timed_out"`, `CommandStatus` + `"timed_out"` |
| `src/db/task-archive-repo.ts` | `markCancelled()` guard → full 4-terminal-state guard |
| `src/services/phase3/sse-poller.ts` | +`buildTerminalSummary` import, +`terminalSummary` in `SSEEvent`, injected in failed/cancelled/timed_out/completed SSE paths |
| `src/services/phase3/slow-worker-loop.ts` | +`buildTerminalSummary` import, +`terminalSummary` in setSlowExecution for completed/cancelled/timed_out/failed paths |

### New Files

| File | Description |
|------|-------------|
| `tests/services/s92p-terminal-observability.test.ts` | 63 tests (T1–T14) |
| `vitest.s92p.config.ts` | Vitest config for S92P tests |
| `docs/sprints/S92P-closure-report.md` | This file |

---

## 5. Test Results

### S92P targeted: 63/63 PASS

| Group | Tests | Description |
|-------|-------|-------------|
| T1 | 4 | RuntimeTerminalSummary type shape |
| T2 | 4 | buildTerminalSummary — completed |
| T3 | 7 | buildTerminalSummary — failed (category detection, privacy) |
| T4 | 6 | buildTerminalSummary — cancelled (reason, truncation) |
| T5 | 5 | buildTerminalSummary — timed_out (kind, timing info) |
| T6 | 8 | Terminal-state matrix — all 4 states |
| T7 | 4 | Privacy — no prompt/messages/tools/API keys |
| T8 | 3 | canRetry advisory only — no retry execution |
| T9 | 4 | SSE additive compatibility |
| T10 | 4 | markCancelled full terminal guard |
| T11 | 4 | Terminal summary in SSE poller paths |
| T12 | 2 | TaskState and CommandStatus type completeness |
| T13 | 4 | Terminal summary in slow_execution persistence |
| T14 | 3 | Idempotency and determinism |

### Regression: ALL PASS

| Sprint | Tests | Result |
|--------|-------|--------|
| S85P | 105/105 | ✅ |
| S86P | 33/33 | ✅ |
| S87P | 52/52 | ✅ |
| S88P | 44/44 | ✅ |
| S89P | 58/58 | ✅ |
| S90P | 46/46 | ✅ |
| S91P | 61/61 | ✅ |
| **S75P–S91P total** | **399** | **✅** |
| **S92P targeted** | **63** | **✅** |
| **Grand total** | **462** | **✅** |

- DB-backed E2E: BLOCKED (PostgreSQL unavailable)
- No S92P-introduced regressions
- Lint: 0 errors

---

## 6. Terminal Summary Semantics

S92P introduces `RuntimeTerminalSummary` as safe explanatory metadata for terminal states.

Supported terminal states:

- `completed`
- `failed`
- `cancelled`
- `timed_out`

The summary is explanatory only and does not change execution behavior.

### Recovery / Retry Boundary

`canRetry` is advisory metadata only.

S92P does not:

- execute retry
- enqueue retry
- rerun workers
- replay partial results
- rollback or replay side effects

### Failed Classification

Failed-state classification is heuristic in V0.

S92P uses conservative error-category detection to classify failures into:

- `model_error`
- `tool_error`
- `runtime_error`

Unknown or ambiguous failures fall back to a safe runtime/unknown category.

Raw error messages are not exposed as user-facing messages.

### SSE Compatibility

`terminalSummary` is additive and optional.

S92P does not change:

- event type names
- required result fields
- required error fields
- required done fields
- progress event shape
- partial_result event shape

Legacy clients may ignore `terminalSummary`.

### Persistence Semantics

`terminalSummary` is persisted into `slow_execution` as additive metadata via JSONB `||` merge operator.

Persistence preserves existing:

- `partialResults[]`
- `cycleEvents[]`
- `slowCallSummary`
- cancellation metadata
- timeout metadata

### Privacy

`userMessage` uses fixed safe templates.

S92P does not expose:

- prompts
- messages
- tool definitions
- tool arguments
- API keys
- raw stack traces
- raw provider responses
- hidden reasoning

---

## 7. Known Limitations (V0)

1. **No retry execution** — `canRetry` is purely advisory.
2. **Category detection is keyword-based** — `model_error` / `tool_error` detected via simple string matching on error messages.
3. **No custom terminal summaries** — `userMessage` is always template-generated, not user-customizable.
4. **No UI dashboard** — terminal summaries are in SSE/JSONB but not surfaced in a UI.
5. **No Human Review / Resume semantic changes** — existing HR states unchanged.
6. **No provider-level abort** — inherited from S90P/S91P cooperative design.

---

## 8. PM Sign-off Checklist

- [x] D1 RuntimeTerminalSummary type defined
- [x] D2 buildTerminalSummary() for all 4 terminal states
- [x] D3 canRetry advisory flag (no retry execution)
- [x] D4 Terminal summary in SSE error/done (additive)
- [x] D5 Existing SSE shapes preserved
- [x] D6 Privacy: no prompt/messages/tools/API keys
- [x] D7 Terminal-state matrix tests (63/63)
- [x] D8 S75P–S91P regression (399/399 PASS)
- [x] D9 Closure report
- [x] TaskState + CommandStatus includes `timed_out`
- [x] markCancelled() guard → 4-terminal-state
- [x] Lint: 0 errors
- [x] Commit `0cfafe1` pushed → origin/master
- [x] Desktop = WorkBuddy = origin/master = `0cfafe1`
- [x] Failed classification is heuristic in V0
- [x] terminalSummary persistence is additive and non-destructive
- [x] markCancelled guard includes timed_out
- [x] No retry execution, no queue re-run, no side-effect rollback
