# Sprint 87P — LLM Call Budget & Duplicate Call Reduction V0

| Field | Value |
|---|---|
| Sprint | 87P |
| Baseline | adc53a5 (S86P closure) |
| Status | **BUILD COMPLETE** |
| Date | 2026-05-26 |

---

## Goal

Use `RuntimeTrace.llmCalls` to add per-task LLM call budget reporting and identify/reduce one safe duplicate or avoidable LLM call pattern in normal execution paths.

## Non-Goals

- 不扩大 S85P fast path eligibility
- 不做语义缓存
- 不做 full planner rewrite
- 不改 Human Review / Resume 语义
- 不做 UI dashboard
- 不记录 prompt/content
- 不做 provider billing/cost 估算

---

## Deliverables

| ID | Deliverable | Description |
|---|---|---|
| D1 | `LlmCallBudget` type | Define per-task budget metadata: `maxTotalCalls`, warnings |
| D2 | Budget status in RuntimeTrace | Check budget in `recordLlmCall()`, expose in `RuntimeTraceExtract` |
| D3 | Duplicate call detection | Detect consecutive same (kind, model) calls, flag `duplicateWarning` |
| D4 | Identify safe avoidable pattern | Manager → Manager Synthesis for trivially short Worker results |
| D5 | Gate the pattern | Skip `synthesizeManagerOutputStream()` when Worker result < threshold |
| D6 | Benchmark before/after | Measure `llmCalls.total` reduction on applicable requests |
| D7 | Regression S75P–S86P | Confirm no regressions |
| D8 | S87P duplicate-call report | Measurement report with before/after data |

---

## Success Criteria

1. `RuntimeTraceExtract` exposes `budgetStatus` with `total`, `max`, `overBudget`
2. At least one selected path has measurable reduction in `llmCalls.total` or duplicate warning
3. No prompt/content is captured
4. No S85P fast path rule expansion
5. S75P–S86P regression remains green

---

## Design

### D1: `LlmCallBudget` metadata

```ts
interface LlmCallBudget {
  maxTotalCalls: number;
  warnings: LlmCallBudgetWarning[];
}

interface LlmCallBudgetWarning {
  kind: "over_budget" | "near_budget" | "duplicate_consecutive";
  message: string;
  atCallSeq: number;
}
```

Per-request `maxTotalCalls` defaults to a reasonable cap. Callers (chat.ts) can override.

### D2: Budget check in recordLlmCall

After recording a call:
1. If `trace.budget` is set AND `llmCalls.length > maxTotalCalls`: push `over_budget` warning
2. If `llmCalls.length >= maxTotalCalls * 0.8`: push `near_budget` warning (once)
3. `RuntimeTraceExtract.budgetStatus`: `{ total, max, overBudget }`

### D3: Duplicate detection

In `recordLlmCall()`, check if the previous call has same `kind` + same `model`. If so:
- Set `duplicateOfPrevious: true` on the current call record
- Push `duplicate_consecutive` warning to budget
- `RuntimeTraceExtract.duplicateCount` in summary

### D4-D5: Skip Manager Synthesis for short Worker results

Pattern: After Worker finishes, `pollArchiveAndYield()` in `sse-poller.ts` calls `synthesizeManagerOutputStream()` with the Worker result. When the Worker result is trivially short (< 200 chars) and has no error indicators, the synthesis adds no meaningful value — just wraps the same text.

Gate condition:
- Worker result text length < 200 characters
- No error/exception keywords in result
- Not a tool-use result (no tool_call indicators)

When gated: return Worker result directly, skip the `manager_synthesis` LLM call.

Impact: 1 fewer `fastModel` call per applicable request. Conservative — most delegate_to_slow results are long-form and will still go through synthesis.

---

## Key Design Constraints

- All budget/duplicate metadata is **safe** — no prompt, content, or user data captured
- Duplicate detection is **metadata-only** — kind + model comparison, no text analysis
- Gating is **conservative** — only skips synthesis for trivially short, error-free results
- Budget is **per-request** — set in SSE handler, scoped by AsyncLocalStorage
