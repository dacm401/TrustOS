# Sprint 87P — LLM Call Budget & Duplicate Call Reduction V0 — Closure Report

## Status

**CLOSED ✅**

Closure baseline: `704d737`
Date: 2026-05-26

## Baseline

S86P closure baseline: `adc53a5`

## Goal

Use RuntimeTrace.llmCalls to add per-task call budget reporting and identify/reduce one safe duplicate or avoidable LLM call pattern.

## Non-goals

- No S85P fast path eligibility expansion.
- No semantic cache.
- No planner rewrite.
- No Human Review / Resume semantic changes.
- No UI dashboard.
- No prompt/content capture.
- No billing/cost estimate.

## Key Design

### Budget (D1–D2)

- `setTraceBudget(trace, 10)` at SSE entry.
- `budgetStatus` added to trace extract.
- Warnings: `near_budget`, `over_budget`, `duplicate_consecutive`.
- **Budget warnings are non-blocking metadata.** They never interrupt or change execution paths.

### Duplicate Detection (D3)

- Metadata-only detection.
- Consecutive same `kind + model`.
- No prompt/content/tool args are inspected.
- `duplicateWarning` flag on `RuntimeTraceLlmCall` (only set when `true`).
- `duplicateCount` in `RuntimeTraceExtract`.

### Synthesis Skip (D4–D5)

`shouldSkipSynthesis()` skips manager synthesis only when ALL conditions are met:

- Worker result exists and is non-empty
- Content < 200 chars
- No error keywords in content
- No tool indicators in content
- No errors array in execution metadata
- No verification V0 failure
- No contract verification failure
- No contract security failure / blocking issues / block
- No human_review required (contract or cycle)
- No revise / rewrite / patch state
- No cycles ran (totalCycles = 0)
- No blocked state

This saves one `manager_synthesis` LLM call for trivially short, clean, directly presentable worker results.

## Deliverables

| ID | Deliverable | Status |
|----|-------------|--------|
| D1 | LlmCallBudget type + warnings | ✅ |
| D2 | Budget check + budgetStatus extract | ✅ |
| D3 | duplicate_consecutive metadata detection | ✅ |
| D4 | Avoidable pattern: manager_synthesis after short worker result | ✅ |
| D5 | shouldSkipSynthesis gating with full semantic boundary | ✅ |
| D6 | Targeted tests: 52/52 PASS | ✅ |
| D7 | S75P–S86P regression: non-DB unit PASS; DB-backed E2E blocked | ✅ |
| D8 | Measurement report (docs/sprints/S87P-measurement-report.md) | ✅ |
| D9 | Closure report (this document) | ✅ |

## Modified Files

| File | Change |
|------|--------|
| `src/types/runtime-trace.ts` | +54/-2: LlmCallBudget, budgetStatus, duplicateWarning, duplicateCount |
| `src/services/runtime-trace.ts` | +63/-1: setTraceBudget, recordLlmCall duplicate/budget logic |
| `src/api/chat.ts` | +4/-1: setTraceBudget(trace, 10) at SSE entry |
| `src/services/phase3/sse-poller.ts` | +100/-25: shouldSkipSynthesis with full semantic veto |
| `tests/services/s87p-budget-duplicate.test.ts` | +280 lines: 52 tests |
| `vitest.s87p.config.ts` | new file |
| `docs/sprints/S87P-plan.md` | new file |
| `docs/sprints/S87P-measurement-report.md` | new file |
| `docs/sprints/S87P-closure-report.md` | new file (this document) |

## Validation

### Targeted Tests

```
S87P targeted: 52/52 PASS
  - Budget metadata: 2 tests
  - Budget checks: 5 tests
  - Duplicate detection: 7 tests
  - RuntimeTraceExtract budget + duplicate fields: 5 tests
  - Safe metadata: 2 tests
  - AsyncLocalStorage isolation: 1 test
  - shouldSkipSynthesis safe skip: 4 tests
  - shouldSkipSynthesis content-level no-skip: 4 tests
  - shouldSkipSynthesis execution errors: 2 tests
  - shouldSkipSynthesis verification failure: 3 tests
  - shouldSkipSynthesis contract violation/security: 3 tests
  - shouldSkipSynthesis human_review: 5 tests
  - shouldSkipSynthesis patch/rewrite/revise: 6 tests
  - shouldSkipSynthesis blocked/suspended: 3 tests
```

### Full Regression

| Sprint | Result | Notes |
|--------|--------|-------|
| S87P | 52/52 PASS | ✅ |
| S86P | 33/33 PASS | ✅ |
| S85P | 105/105 PASS | ✅ |
| S84P | 157/187 (30 DB E2E) | PASS non-DB |
| S83P | 128/158 (30 DB E2E) | PASS non-DB |
| S82P | 99/124 (25 DB E2E) | PASS non-DB |
| S81P | 100/121 (21 DB E2E) | PASS non-DB |
| S80P | 81/96 (15 DB E2E) | PASS non-DB |
| S79P | unit PASS (11 DB E2E) | PASS non-DB |
| S78P | 54/61 (7 DB E2E) | PASS non-DB |
| S77P | 17/19 (2 DB E2E) | PASS non-DB |
| S76P | 9/9 PASS | ✅ |
| S75P | 16/16 PASS | ✅ |

**All non-DB/unit tests PASS. All failures are DB-backed E2E blocked by PostgreSQL unavailable.**
**No S87P-introduced regressions detected across S75P–S86P.**

## Semantic Boundary Review (shouldSkipSynthesis)

PM-approved veto conditions verified:

| Boundary | Veto Source | Tested |
|----------|-------------|--------|
| Empty content | content-level | T8.1 ✅ |
| Long content ≥ 200 chars | content-level | T8.2 ✅ |
| Error keyword in content | content-level | T8.3 ✅ |
| Tool indicator in content | content-level | T8.4 ✅ |
| Errors array in execution | execution-level | T9.1 ✅ |
| V0 verification failed | execution.verification | T10.1 ✅ |
| Contract verification failed | execution.contractVerification | T10.3 ✅ |
| Security failure | execution.contractVerification | T11.1 ✅ |
| Blocking issues | execution.contractVerification | T11.2 ✅ |
| recommendedAction = block | execution.contractVerification | T11.3 ✅ |
| human_review (contract) | execution.contractVerification | T12.1 ✅ |
| hasHumanReviewRequired | execution.contractVerification | T12.2 ✅ |
| human_review (cycle status) | execution.cycleAudit | T12.3 ✅ |
| human_review (cycle action) | execution.cycleAudit | T12.4 ✅ |
| blocked (cycle) | execution.cycleAudit | T12.5, T14.1–T14.3 ✅ |
| revise (contract) | execution.contractVerification | T13.1 ✅ |
| rewrite (contract) | execution.contractVerification | T13.2 ✅ |
| revise (cycle) | execution.cycleAudit | T13.3 ✅ |
| rewrite (cycle) | execution.cycleAudit | T13.4 ✅ |
| totalCycles > 0 | execution.cycleAudit | T13.5 ✅ |

Output format stability: When synthesis is skipped, the same `result` SSE event type is emitted with the same shape, just without the LLM-synthesized content. Front-end receives identical event structures.

## Known Limitations

- Duplicate detection is intentionally conservative (consecutive same kind+model only).
- Budget warnings do not enforce limits — purely observational metadata.
- Synthesis skip only applies to short, clean, directly presentable worker results.
- E2E DB suites require PostgreSQL (same as all prior sprints).

## PM Sign-Off Checklist

- [x] Build complete
- [x] Functional acceptance
- [x] S87P targeted tests passing (52/52)
- [x] S75P–S86P full regression complete (non-DB unit: PASS, DB-backed E2E: BLOCKED)
- [x] Closure report written
- [x] Semantic boundary review complete
- [x] Commit / push / three-end sync
- [x] PM final closure sign-off

## Three-End Sync

| Location | Commit | Status |
|----------|--------|--------|
| Desktop | `704d737` | ✅ |
| origin/master | `704d73780f8c9e10c09655764e173c18d7bcab71` | ✅ |
| WorkBuddy | `704d737` (same workspace as Desktop) | ✅ |

## PM Sign-Off Record

```
PM SIGN-OFF:
Sprint 87P — LLM Call Budget & Duplicate Call Reduction V0
Status: CLOSED ✅
Closure baseline: 704d737
Date: 2026-05-26

S87P introduced non-blocking LLM call budget observability and a conservative
manager_synthesis skip for short, safe worker results.

Key design:
- Budget warnings are non-blocking metadata.
- Duplicate detection is metadata-only using kind+model.
- shouldSkipSynthesis only skips short, safe, directly presentable worker results.
- Full semantic veto prevents skip on human_review, verification failure,
  security failure, blocking issues, block/revise/rewrite, cycle activity,
  or execution errors.
- SSE result event shape remains unchanged.

Non-goals respected:
- No S85P fast path eligibility expansion.
- No semantic cache.
- No planner rewrite.
- No Human Review / Resume semantic changes.
- No UI dashboard.
- No prompt/content capture.
- No billing/cost estimate.
```
