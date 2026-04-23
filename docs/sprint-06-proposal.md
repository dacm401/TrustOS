# Sprint 06 Proposal

## Recommended Sprint Name

**Testing and Observability for Execution**

---

## Problem Statement

Sprint 05 delivered a functional Execution Loop system with guardrails and full trace coverage. The system is now in a state where:

- **The execution engine exists but has no regression protection.** Any future change risks breaking the loop's state machine without early detection.
- **Trace data is stored in the database but not surfaced.** Engineers cannot inspect an execution path without writing raw SQL.
- **Tool handlers are integration points with external services.** http_request and web_search have real network calls — these need test doubles.

---

## Recommended Goal

Establish the minimum viable test suite and observability layer for the Execution Loop system, before expanding functionality further.

---

## Task Cards

### TA-001: ExecutionLoop Unit Tests

**Goal:** Verify loop state machine logic in isolation.

Scope:
- Sequential step transitions: tool_call → reasoning → synthesis
- Hard guards: step cap, tool cap, no-progress abort
- GuardrailRejection propagation through step catch block
- Accumulator correctness: each step's output is correctly appended to messages

Mock out:
- `callModelWithTools()` and `callModelFull()`
- `TaskPlanner.plan()`
- `ToolRegistry.getTool()` and `ToolExecutor.execute()`

Use: Vitest or Jest (same test runner as project)

---

### TA-002: ToolExecutor Integration Tests

**Goal:** Verify tool handlers behave correctly against realistic inputs.

Scope:
- `memory_search` handler: returns correct structured result
- `task_get` handler: returns correct task shape
- `task_list` handler: returns array of tasks
- GuardrailRejection thrown when http_request fails allowlist
- GuardrailRejection thrown when web_search exceeds query length

Do not test actual HTTP calls — use mocked fetch or a local HTTP server mock.

---

### TA-003: Guardrail Policy Tests

**Goal:** Ensure security boundaries are enforceable and deterministic.

Scope:
- HTTP allowlist: empty list denies all, populated list allows only those hosts
- HTTPS downgrade: http:// blocked even if host is in allowlist
- Blocked headers: request with authorization header is rejected
- Response size: >1MB response is truncated/rejected
- web_search: query >500 chars rejected, max_results capped at 10

These are pure unit tests on `ToolGuardrail.validate()` — no network required.

---

### TA-004: Execution Trace API Endpoint

**Goal:** Make execution traces human-readable without raw SQL.

Scope:
- `GET /v1/executions/:execution_id/steps` — returns structured step timeline
- `GET /v1/executions/:execution_id/guardrails` — returns guardrail decisions
- Step timeline includes: step_type, tool_name (if tool_call), duration_ms, outcome, error (if failed)
- Guardrail decisions include: rule_checked, input, decision, reason

Reuse existing `task_traces` storage. New endpoints, new repo method if needed.

---

## Architecture Preview

```
Sprint 06
├── TA-001  ExecutionLoop unit tests    (tests/services/execution-loop.test.ts)
├── TA-002  ToolExecutor integration    (tests/services/tool-executor.test.ts)
├── TA-003  Guardrail policy tests      (tests/services/tool-guardrail.test.ts)
├── TA-004  Execution trace API         (api/execution-traces.ts + repo method)
└── docs: task-cards/  + sprint-06-proposal.md
```

---

## Design Decisions

1. **No real HTTP in tests.** `fetch()` calls are mocked. Real network integration tested manually or in a separate e2e suite.
2. **Trace API reuses task_traces table.** No new schema needed for TA-004. Execution ID maps to task_id in traces.
3. **Test runner: Vitest.** Fast, TypeScript-native, compatible with the existing setup.
4. **Test doubles replace real LLM calls.** callModelWithTools/callModelFull are mocked — no API cost in tests.
5. **TA-004 scope: read-only.** No new write operations, just structured read of existing trace data.

---

## Out of Scope

- E2e tests (require running backend + model API + external services)
- Execution result memory persistence
- Retry/fallback logic
- New tool types
- Frontend execution trace viewer

---

## Success Criteria

- [ ] ExecutionLoop state machine has ≥80% branch coverage in unit tests
- [ ] Guardrail policies have 100% coverage of each rule (allowlist/deny/HTTPS/blocked-header/size/timeout)
- [ ] All 3 tool handlers (memory_search, task_get, task_list) have at least one passing integration test
- [ ] Trace API returns structured step timeline for a known execution_id
- [ ] `npm run test` passes with zero failures in CI simulation
- [ ] No regression in existing `npm run build` or `/api/chat` path

---

## Priority Rationale

The Sprint 05 deliverable is a system that *can run* but is not yet *safe to change*. Adding tests now protects the investment in the execution engine and makes the next set of features (result persistence, retry logic, tool expansion) much safer to implement.

Observability (TA-004) is co-elevated because trace data exists but is inaccessible. Making it readable unlocks debugging and demo value immediately, with minimal new code.

---

## Files Reference

Existing modules to be tested:
- `backend/src/services/execution-loop.ts`
- `backend/src/services/tool-executor.ts`
- `backend/src/services/tool-guardrail.ts`
- `backend/src/services/tool-registry.ts`

New files:
- `backend/src/api/execution-traces.ts` (TA-004)
- `backend/tests/services/*.test.ts` (TA-001/002/003)
- `docs/task-cards/00*-execution-testing-review.md`
