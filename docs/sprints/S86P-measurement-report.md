# Sprint 86P — Measurement Report

## Performance: Recording Overhead

| Metric | Value | Notes |
|---|---|---|
| `recordLlmCall()` (trace active) | **1.32µs** avg | 100 calls measured |
| `recordLlmCall()` (no trace) | **0.06µs** avg | 1000 calls — near-zero no-op |
| `buildRuntimeTraceExtract(100 calls)` | **0.09ms** | Negligible overhead for typical requests (1-10 calls) |

**Conclusion**: S86P instrumentation adds **negligible overhead** (~1.3µs per LLM call). The no-op path when no trace is active (~0.06µs) means zero cost for requests that don't use SSE (e.g., quick reply, session title generation outside of SSE context).

## Call Kind Coverage

All LLM call sites in the codebase are now classified:

| Call Kind | Call Sites | Count |
|---|---|---|
| `worker` | `slow-worker-loop.ts` (4 call sites: cycle, fast path, fallback, legacy) | 4 |
| `manager` | `llm-native-router.ts` (`_callFastModel` standard + `callOpenAIWithOptionsTraced` auth override) | 2 |
| `manager_synthesis` | `sse-poller.ts` (2 call sites: stream + non-stream) | 2 |
| `execution_loop` | `execution-loop.ts` (3 call sites: tool, reasoning, synthesis) | 3 |
| `planner` | `task-planner.ts` | 1 |
| `compressor` | `compressor.ts` (2), `sessions.ts` (1) | 3 |
| **Total** | | **15** |

## Regression Results

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

## S85P Fast Path Validation

S86P validates S85P's `estimatedRoundTripsSaved` assertion. With the LLM call counter now in place:
- Worker calls on the S85P fast path are recorded as `kind: "worker"` — a single call
- If the same task went through the normal cycle path, additional `kind: "worker"` calls from revise/rewrite cycles would be recorded
- The counter makes S85P's structural savings **measurable** in production

## Known Limitation (V0)

`callOpenAIWithOptions()` (used in `_callFastModel` when a custom API key is provided) was initially uncounted. **Fixed in PM review:** a traced wrapper `callOpenAIWithOptionsTraced()` now records auth override calls with `kind: "manager"`.

Provider field is intentionally omitted in S86P V0 unless safely available without inspecting request content. Can be added in a future sprint if needed.
