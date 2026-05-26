# Sprint 86P — Runtime LLM Call Counter & Round Trip Observability V0

| Field | Value |
|---|---|
| Sprint | 86P |
| Baseline | 428281a (S85P closure) |
| Status | **BUILD COMPLETE** |
| Date | 2026-05-26 |

---

## Goal

Add runtime-level LLM call counting and round-trip observability so performance work can measure actual model calls per task instead of relying on estimates.

## Non-Goals

- No fast path eligibility expansion
- No caching system
- No planner rewrite
- No Human Review / Resume semantic changes
- No S85P rule changes
- No UI dashboard
- No tracing backend
- No prompt/content capture in trace

## Deliverables

| ID | Deliverable | Description |
|---|---|---|
| D1 | `RuntimeTraceLlmCall` type | Define call record structure with kind, model, timing, success/error |
| D2 | Gateway instrumentation | Auto-record LLM calls at `model-gateway.ts` (callModel, callModelFull, callModelWithTools, callModelStream, callOpenAIWithOptionsTraced) |
| D3 | Call kind classification | Distinguish worker, manager, manager_synthesis, execution_loop, planner, compressor, unknown |
| D4 | Safe metadata only | Record duration, provider/model, success/failure — never prompt, content, or user data |
| D5 | Tests + benchmarks | Unit tests (24) + benchmark tests (6): recording latency, extract performance, counter consistency |
| D6 | Regression | S75P–S85P unit regression confirming zero S86P-introduced failures |
| D7 | Measurement report | Performance characteristics and observability baseline |

## Design

### Request-scoped trace context

Node.js `AsyncLocalStorage` provides per-request trace isolation. `chat.ts` wraps the entire SSE handler in `runWithRequestTrace(runtimeTrace, () => { ... })`. `model-gateway.ts` reads the store via `getRequestTrace()` to auto-record LLM calls — no per-function trace parameter passing needed.

### Safe metadata only

`RuntimeTraceLlmCall` records only:
- `id`, `kind`, `model`, `startedAt`, `endedAt`, `durationMs`, `success`, `errorCode`

Does NOT record:
- prompt, content, completion, messages, tools, arguments, user data, API keys

### SSE extract includes by-kind summary

`RuntimeTraceExtract.llmCallSummary` provides `{ total, byKind: Record<string, number> }` — shipping per-call details to the client would be too large, but the summary is lightweight.
