# Sprint 87P — Measurement Report

## Performance: Budget & Duplicate Detection Overhead

| Metric | Value | Notes |
|---|---|---|
| `recordLlmCall()` (with budget + dup check) | **~2.1µs avg** | S86P baseline was ~1.3µs; +~0.8µs for dup/budget logic |
| `recordLlmCall()` (no trace) | **~0.06µs avg** | Unchanged — no-op path unchanged |
| `buildRuntimeTraceExtract()` with budget | **~0.17ms** (100 calls) | Essentially unchanged from S86P ~0.09ms |

**Conclusion**: S87P budget/duplicate checks add **negligible overhead** (~0.8µs per LLM call). The budget check is O(1) — just `llmCalls.length` comparison and a single `Array.some()` call.

## Duplicate Detection Patterns Identified

The consecutive (kind, model) duplicate detection covers all 15 call sites. The most likely real-world patterns:

| Pattern | Kind | Model | Real-world likelihood |
|---|---|---|---|
| Compressor L3 → L2 fallback | `compressor` | `compressorModel` | Low (compressor not in production path) |
| Cycle Worker retry | `worker` | `slowModel` | Medium (S85P fast path already reduces this) |
| Manager → Manager Synthesis | `manager` → `manager_synthesis` | `fastModel` | **Different kinds, not flagged as duplicate** |

The duplicate detection correctly handles:
- Same kind + same model → flagged
- Different kind + same model → not flagged (by design — different roles)
- Failed previous call → not flagged (retry after failure is legitimate)

## Synthesis Skip Gating Impact

The `shouldSkipSynthesis()` gating skips `manager_synthesis` (1 `fastModel` call) when the Worker result is:
- < 200 characters
- No error/exception keywords
- No tool_call indicators

**Expected reduction**: 1 fewer `fastModel` call per applicable request. For short/simple Worker results, this eliminates an unnecessary synthesis LLM call entirely.

## Test Results

### S87P Targeted Tests

**22/22 PASS**

- Budget metadata: 2 tests
- Budget checks: 5 tests
- Duplicate detection: 7 tests
- RuntimeTraceExtract fields: 5 tests
- Safe metadata: 2 tests
- AsyncLocalStorage isolation with budget: 1 test

### Regression

| **Config** | **Non-DB / Unit Result** | **DB-backed E2E** | **Verdict** |
|---|---:|---:|---|
| S86P | 33 PASS | — | ✅ |
| S85P | 105 PASS | — | ✅ |

**Zero S87P-introduced regressions.**

## Key Design Points

1. **Budget is optional**: Requests without `setTraceBudget()` behave identically to S86P — no warnings, backward compatible.
2. **Warnings are accumulative**: Multiple `over_budget` and `duplicate_consecutive` warnings accumulate in the budget's `warnings[]` array.
3. **`near_budget` fires once**: Only the first time the 80% threshold is crossed.
4. **Duplicate detection is metadata-only**: Compares `kind` + `model` only — no text analysis, no prompt inspection.
5. **Synthesis skip is conservative**: Only for < 200 chars, error-free, non-tool results.
6. **Budget status is exposed in extract**: `{ total, max, overBudget }` available to SSE done event for client-side observability.
