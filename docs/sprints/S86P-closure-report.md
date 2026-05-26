# Sprint 86P — Runtime LLM Call Counter & Round Trip Observability V0 — Closure Report

| Field | Value |
|---|---|
| Sprint | 86P |
| Baseline | 428281a (S85P closure) |
| Status | **BUILD COMPLETE / PENDING FINAL SIGN-OFF** |
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

---

## Key Design Decisions

### 1. Gateway-level instrumentation

All LLM call recording happens at the `model-gateway.ts` layer — `callModel`, `callModelFull`, `callModelWithTools`, and `callModelStream`. Callers only need to pass `llmCallKind` as a parameter. This avoids scattered hand-written counters throughout the codebase and ensures every model call is recorded at the single source of truth.

### 2. Request-scoped trace context via AsyncLocalStorage

S86P V0 uses Node.js `AsyncLocalStorage` for per-request trace isolation:

```ts
const runtimeTraceStorage = new AsyncLocalStorage<{ trace: RuntimeTrace; llmCallSeq: number }>();

export function runWithRequestTrace<T>(
  trace: RuntimeTrace,
  fn: () => T | Promise<T>
): T | Promise<T> {
  return runtimeTraceStorage.run({ trace, llmCallSeq: 0 }, fn);
}
```

This eliminates the cross-request contamination risk that a module-level singleton would introduce under concurrent requests. `chat.ts` wraps the entire SSE handler in `runWithRequestTrace(runtimeTrace, () => { ... })`. AsyncLocalStorage preserves context across awaited operations inside the returned `Promise`.

### 3. Safe metadata only

`RuntimeTraceLlmCall` records only:
- `id`, `kind`, `model`, `startedAt`, `endedAt`, `durationMs`, `success`, `errorCode`

Does NOT record:
- prompt, content, completion, messages, tools, arguments, user data, API keys

Provider is intentionally omitted in S86P V0 unless safely available without inspecting request content.

### 4. `modelCalls` counter is derived from `llmCalls.length`

```text
RuntimeTrace.llmCalls is the source of truth.
counters.modelCalls mirrors llmCalls.length.
```

No independent counter increment — this prevents any divergence between the array and the counter.

### 5. Streaming duration semantics

Streaming calls (`callModelStream`) are measured from stream invocation to generator completion (i.e., when the async generator finishes yielding all chunks). The `recordLlmCall` is placed after the `for await` loop completes.

---

## Deliverables

| ID | Deliverable | Status |
|---|---|---|
| D1 | `RuntimeTraceLlmCall` type | ✅ |
| D2 | Gateway instrumentation (callModel, callModelFull, callModelWithTools, callModelStream, callOpenAIWithOptionsTraced) | ✅ |
| D3 | Call kind classification (7 kinds) | ✅ |
| D4 | Safe metadata only — no prompt/content captured | ✅ |
| D5 | Unit tests + benchmark tests | ✅ |
| D6 | Regression: S75P–S85P | ✅ |
| D7 | Measurement report | ✅ |
| D8 | AsyncLocalStorage concurrency safety (PM fix #1) | ✅ |
| D9 | callOpenAIWithOptionsTraced auth override path (PM fix #2) | ✅ |
| D10 | Closure report (this document) | ✅ |

---

## Call Kind Distribution

| Call Kind | Call Sites | Source Files |
|---|---|---|
| `worker` | 4 | `slow-worker-loop.ts` |
| `manager` | 2 (inc. auth override) | `llm-native-router.ts` (`_callFastModel` standard + `callOpenAIWithOptionsTraced`) |
| `manager_synthesis` | 2 | `sse-poller.ts` |
| `execution_loop` | 3 | `execution-loop.ts` |
| `planner` | 1 | `task-planner.ts` |
| `compressor` | 3 | `compressor.ts` (2), `sessions.ts` (1) |
| **Total** | **15** | |

Auth override manager calls (custom API key / base URL) are now counted via `callOpenAIWithOptionsTraced` — they were previously uncounted in the initial implementation.

---

## Validation

### S86P Targeted Tests

**31/31 PASS**

- Trace context lifecycle: 6 tests
- recordLlmCall basic recording: 6 tests
- Call kind classification: 7 tests
- Trace extract with llmCallSummary: 3 tests
- Safety (no prompt/content leakage): 1 test
- AsyncLocalStorage parallel isolation: 4 tests
- Benchmark: 4 tests

### Regression

| **Config** | **Non-DB / Unit Result** | **DB-backed E2E** | **Verdict** |
|---|---:|---:|---|
| S85P | 105 PASS | — | ✅ |
| S84P | 157 PASS | 30 BLOCKED | ✅ unit / ⚠️ DB |
| S83P | 128 PASS | 30 BLOCKED | ✅ unit / ⚠️ DB |
| S82P | 112 PASS | 25 BLOCKED | ✅ unit / ⚠️ DB |
| S81P | 100 PASS | 21 BLOCKED | ✅ unit / ⚠️ DB |
| S80P | 81 PASS | 15 BLOCKED | ✅ unit / ⚠️ DB |
| S79P | 66 PASS | 11 BLOCKED | ✅ unit / ⚠️ DB |
| S78P | 54 PASS | 7 BLOCKED | ✅ unit / ⚠️ DB |
| S77P | 17 PASS | 2 BLOCKED | ✅ unit / ⚠️ DB |
| S76P | 9 PASS | N/A | ✅ |
| S75P | 16 PASS | N/A | ✅ |

**Zero S86P-introduced regressions.** All E2E failures are pre-existing PostgreSQL-unavailable errors.

---

## Performance

| Metric | Value | Notes |
|---|---|---|
| `recordLlmCall()` (trace active) | ~1.3µs avg | Negligible |
| `recordLlmCall()` (no trace) | ~0.06µs avg | Near-zero no-op |
| `buildRuntimeTraceExtract(100 calls)` | ~0.09ms | Negligible for typical requests (1-10 calls) |

---

## Known Limitations (V0)

1. **Streaming duration**: Measured from generator invocation to completion — may differ slightly from time-to-first-byte semantics used by other layers.

2. **Provider field**: Intentionally omitted in V0. `provider` is derivable from the model name via the provider registry when needed. Can be added in S87/S88 if required for observability.

3. **DB-backed E2E tests**: Blocked by local PostgreSQL unavailability — pre-existing issue, not introduced by S86P.

---

## S85P Fast Path Validation

S86P validates S85P's `estimatedRoundTripsSaved` assertion. With the LLM call counter in place:
- Worker calls on the S85P fast path are recorded as `kind: "worker"` — a single call
- If the same task went through the normal cycle path, additional `kind: "worker"` calls from revise/rewrite cycles would be recorded
- The counter makes S85P's structural savings **measurable** in production

---

## PM Sign-Off Checklist

- [x] Build complete (all deliverables implemented)
- [x] Functional acceptance (design review passed)
- [x] S86P targeted tests passing
- [x] S85P regression green
- [x] S75P–S84P unit regression unchanged
- [x] AsyncLocalStorage concurrency safety
- [x] Auth override path counted (callOpenAIWithOptionsTraced)
- [x] Closure report written
- [ ] Commit / push / three-end sync
- [ ] PM final closure sign-off
