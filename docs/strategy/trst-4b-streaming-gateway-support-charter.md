# TRST-4B — Streaming Gateway Support: Charter & Execution Plan

**Status**: ACCEPTED ✅ | IMPLEMENTATION COMPLETE ✅ | PENDING PM SEAL
**Date**: 2026-08-05
**Author**: Agent (autonomous, within PM-authorized planning scope)
**Predecessor**: TRST-4A Evidence Report UX (SEALED)

**Closure Report**: [trst-4b-streaming-validation-closure.md](./trst-4b-streaming-validation-closure.md)

---

## 1. Redirect: Problem Statement Changed

### 1.1 What We Thought

TRST-4B was originally conceived as: **"Implement streaming support in the Gateway"** — assuming the gateway only handled non-streaming chat completions and that streaming was a new feature to build.

### 1.2 What the Code Audit Found

The gateway **already has full SSE streaming support**, implemented during TRST-2:

```typescript
// llm-gateway-server.ts Line 2-11:
// POST /v1/chat/completions — OpenAI-compatible LLM passthrough (streaming OK)
// Stream support: full SSE passthrough with accumulated evidence recording.
```

The streaming path (lines 262-461) includes:
- SSE reader → chunked passthrough (`ReadableStream`)
- Full text accumulation: `fullText += delta` (line 374)
- `output_hash = SHA256(fullText)` at stream completion (line 388-389)
- Token usage from final `[DONE]` chunk (line 375)
- First-chunk latency: `firstChunkAt - t0` (lines 383-384)
- Stream error handling: `STREAM_UPSTREAM_ERROR`, `STREAM_HTTP_xxx`, `STREAM_ERROR`
- Proper event recording: `appendEvent(event)` on both success and failure

The `GET /health` endpoint reports: `streaming: "sse_passthrough"`.

### 1.3 What's Actually Wrong

The **TRST-4A evidence report template** claims:
> *"Streaming mode: not supported. Streaming requests are rejected by the gateway. No evidence is captured for real-time responses."*

This is **inaccurate**. The gateway supports streaming and captures evidence from streaming requests. The report is understating the product's actual capability.

### 1.4 Revised Problem Statement

TRST-4B is now: **"Streaming Gateway Validation, Hardening, and Correct Labeling."**

Not a feature implementation. A validation + hardening exercise on an existing capability that was built during TRST-2 but never formally validated, smoke-tested, or correctly labeled in downstream artifacts.

---

## 2. Why Streaming Matters

### 2.1 Product Reason

Most real-world LLM usage is streaming. In simulated Private Beta reviews:
- Non-streaming: default experience, well-tested (20/20 smoke)
- Streaming: exists in code, not validated, incorrectly labeled "not supported"

A reviewer who tries streaming and sees it work — but then reads "not supported" in the report — loses trust in both the product and the evidence.

### 2.2 Governance Reason

Streaming output is generated incrementally. Without proper evidence recording:
- `output_hash` might not be computed if the stream is cancelled mid-way
- Partial outputs might go unrecorded
- Token usage might be missing
- The evidence trail has a gap

The code already handles these cases, but they need formal validation.

### 2.3 TrustOS Product Direction

For TrustOS to be a credible governance product, it must support the primary mode of AI interaction (streaming) and correctly represent that support in its own reporting.

---

## 3. Current Streaming Behavior (Code Analysis)

### 3.1 Happy Path

```
Client → Gateway (stream=true) → Upstream Provider (SSE)
                                         ↓
Gateway reads SSE chunks, accumulates fullText
                                         ↓
Gateway computes output_hash = SHA256(fullText)
                                         ↓
Gateway records event: status=success, output_hash present, token usage present
                                         ↓
Gateway streams chunks to client (SSE passthrough)
```

### 3.2 Failure Paths

| Failure Mode | Error Code | output_hash | token usage | Event Status |
|---|---|---|---|---|
| Upstream connection error | `STREAM_UPSTREAM_ERROR` | absent | absent | failure |
| Upstream HTTP error (4xx/5xx) | `STREAM_HTTP_xxx` | absent | absent | failure |
| Stream reader error mid-stream | `STREAM_ERROR` | **may be present** (partial) | **may be present** | failure |
| Client disconnect | Not explicitly handled | — | — | Not recorded |

### 3.3 Privacy Design

- Full text is accumulated **in memory only** (line 348: `let fullText = ""`)
- Only `output_hash` is written to the event (not `fullText`)
- `fullText` is used for a single SHA-256 computation, then discarded (GC)
- Event stores: `output_hash`, `token_count`, `cost_estimate`, `latency_ms`

### 3.4 Gaps Identified

1. **Client disconnect not handled**: If the client closes the connection mid-stream, the gateway may continue reading and accumulating until the upstream completes or errors — but no disconnect-specific event is recorded.

2. **No dedicated streaming smoke test**: The TRST-3 smoke suite (20 tests) tests non-streaming only. Streaming has no formal validation.

3. **Report template claims "not supported"**: The evidence report's Known Limitations section is factually wrong.

4. **No explicit stream chunk-count or time-to-first-token in event**: While `latency_ms` (total) is recorded, first-chunk latency is only used for gateway overhead calculation, not exposed in events.

5. **Partial stream (cancelled) event semantics undefined**: If a stream is cancelled, should output_hash be the hash of partial output? Or absent? Current code behavior: present if any text accumulated before error.

---

## 4. Product Goals

### 4.1 This Charter Covers

1. **Validate** existing streaming implementation via dedicated E2E smoke
2. **Fix** the evidence report template to accurately reflect streaming capability
3. **Harden** edge cases (client disconnect, partial output semantics)
4. **Document** streaming behavior for reviewers and operators
5. **Smoke** streaming + report interaction (report includes streaming events)

### 4.2 This Charter Does NOT Cover

- Rewriting the streaming implementation (it works)
- Adding new streaming providers (only OpenAI-compatible SSE, already supported)
- Chunk-level evidence (chunk hashes — PM explicitly deferred: "建议 Private Beta 先做 final_output_hash only")
- Streaming for MCP (MCP streaming is a separate concern)
- WebSocket streaming (gateway uses HTTP SSE)
- Real-time dashboard streaming (frontend latches on existing SSE)

---

## 5. Non-Goals (Explicit)

| Non-Goal | Reason |
|---|---|
| Chunk-level hashes / Merkle tree for stream chunks | PM deferred: "不要引入 chunk-level evidence" |
| Persistent storage of raw streamed text | Privacy boundary — memory-only buffering for hashing is the design |
| Streaming rate limiting / quota | Separate concern (S98P cost cap already covers gateway-level limits) |
| Multi-provider streaming (Anthropic, etc.) | Open-core AI-compatible SSE only for Private Beta |
| Frontend real-time stream viewer | This charter is gateway + evidence, not frontend UX |
| Streaming at Provider A vs Provider B | Single-provider SSE passthrough — provider-agnostic |

---

## 6. Streaming output_hash Semantics

### 6.1 Decision: Final Output Hash Only

```text
output_hash = SHA256(fullReconstructedFinalOutput)
```

**Rationale** (per PM direction):
- Chunk-level hashes add complexity without proportional reviewer value
- Final hash enables the same verification workflow as non-streaming
- Reviewer can verify: "I received this response → SHA-256 matches the hash in evidence report"

### 6.2 When output_hash is Generated

| Scenario | output_hash | Rationale |
|---|---|---|
| Stream completes successfully | Present | Full output buffered in memory, hashed |
| Stream cancelled mid-way | **Absent** (status: failure, error_code: STREAM_CANCELLED) | Partial output is not a verifiable final output |
| Stream errors mid-way | **May be present** (if any text accumulated) | Current behavior — needs explicit decision |
| Stream errors at connection | Absent | No output to hash |

### 6.3 Decision Required (PM): Partial Stream Hash

PM should decide:
- **Option A**: `output_hash` = absent on any non-success stream (cleaner, simpler)
- **Option B**: `output_hash` = hash of whatever was accumulated (current behavior, more data)

**Agent recommendation**: Option A — cleaner semantics, unambiguous. Reviewer will see `status=failure, output_hash=absent` and know the output is not verifiable.

---

## 7. Event Schema Implications

### 7.1 Existing Fields (No Additions Required)

The `TrstEventEnvelope` already supports everything needed:
```typescript
event_type: "model_call"
status: "success" | "failure"
output_hash?: string        // Present if stream completed with output
token_count?: number       // From stream [DONE] chunk
cost_estimate?: number     // Estimated from usage
latency_ms: number         // Total (from request to stream end)
gateway_overhead_ms?: number // total - upstream latency (first-chunk)
error_code?: string        // STREAM_UPSTREAM_ERROR, STREAM_HTTP_xxx, STREAM_CANCELLED
error_message?: string     // Capped at 500 chars
```

### 7.2 Potential New Fields (Deferred to Future Charter)

| Field | Rationale for Deferring |
|---|---|
| `ttft_ms` (time-to-first-token) | Already computed internally (firstChunkAt) but not in event — add later |
| `stream_chunks` (total chunk count) | Computed internally — add later |
| `stream_status` (completed/cancelled/partial) | Redundant with event status |
| `output_length_chars` | Redundant — can be derived from token_count |

**Decision**: No schema changes for TRST-4B. The existing envelope is sufficient.

---

## 8. Privacy Constraints

### 8.1 Hard Constraints

```text
1. Full streamed text MUST NOT be written to JSONL
2. Full streamed text MUST NOT appear in evidence report
3. Full streamed text MUST NOT be exposed to frontend
4. Full streamed text MUST NOT be logged to console/stderr
5. Full streamed text MAY be transiently buffered in memory for SHA-256 hashing
6. After hashing, the text buffer SHOULD be eligible for GC (no reference retained)
```

### 8.2 Current Code Compliance

- ✅ `fullText` is a local variable in the `ReadableStream.start()` closure
- ✅ Only `outputHash` is written to the event object (line 397)
- ✅ No `console.log(fullText)` or similar leak
- ✅ Event does not store raw output — only `output_hash`
- ⚠️ No explicit `fullText = ""` or nullification after hashing (relies on closure going out of scope → GC)

### 8.3 TRST-4B Hardening Action

Add explicit `fullText = ""` after hash computation to remove reference (belt-and-suspenders), and/or wrap the accumulation in an immediately-discarded scope.

---

## 9. Evidence Report Implications

### 9.1 Report Template Fix

The evidence report's "Known Limitations" line:
> *"Streaming mode: not supported"*

Must be replaced with accurate text reflecting actual capability:
```text
Streaming mode: supported (SSE passthrough with accumulated evidence recording).
Streaming output_hash is computed from the full reconstructed response.
```

### 9.2 Streaming Events in Report

Streaming `model_call` events are indistinguishable from non-streaming events in the event log — same `event_type`, same `output_hash` field. The report doesn't need to differentiate them, which is the correct design.

### 9.3 Streaming-Specific Stats

Optionally add to report summary:
- `streaming_events` count
- `streaming_completion_rate` (completed / total streaming requests)

These are "nice to have" — not required for TRST-4B baseline.

---

## 10. Acceptance Criteria (10 ACs)

| AC | Description | Priority |
|---|---|---|
| AC-1 | Streaming smoke test: 10+ streaming model calls complete successfully | Must |
| AC-2 | output_hash coverage: 100% on completed streams | Must |
| AC-3 | Token usage: recorded from stream `[DONE]` chunk | Must |
| AC-4 | Latency measurement: `latency_ms` and `gateway_overhead_ms` correct | Must |
| AC-5 | Non-streaming regression: TRST-3 20/20 + TRST-4A 14/14 PASS | Must |
| AC-6 | Evidence report template: "Streaming mode" label fixed to accurate text | Must |
| AC-7 | Streaming events appear correctly in evidence report HTML | Must |
| AC-8 | Privacy: no raw text in events/JSONL/report (confirmed by scan) | Must |
| AC-9 | Client disconnect: graceful handling, event recorded with STREAM_CANCELLED | Should |
| AC-10 | Partial output hash semantics: documented decision (Option A or B) | Should |

---

## 11. Work Packages (3 WPs)

### WP1: Streaming Smoke Test Suite (Must-have, ~150 lines)

**File**: `scripts/trst4b/run-streaming-smoke.mjs`

**Tests** (10+ scenarios):
1. Basic streaming call (simple prompt, verify output_hash present)
2. Multi-message conversation stream
3. Long output stream (verify full output_hash)
4. Cost estimation from stream usage
5. Latency measurement correctness
6. Gateway overhead measurement correctness
7. Stream with no usage in [DONE] (fallback)
8. Event integrity: event_hash valid for streaming event
9. Evidence report includes streaming events
10. Streaming + non-streaming mixed run
11. (Should) Client disconnect simulation
12. (Should) Empty/zero-token stream

**Dependencies**: None. Pure HTTP client against gateway.

### WP2: Report Template Fix + Code Hardening (Must-have, ~30 lines)

**Files**:
- `src/services/trst1/evidence-report.ts` — Fix "Streaming mode: not supported" line
- `src/services/trst1/llm-gateway-server.ts` — Add explicit `fullText = ""` after hash (privacy hardening)
- `src/services/trst1/llm-gateway-server.ts` — Add client disconnect handling (if feasible)

**Dependencies**: WP1 (smoke validates the fix).

### WP3: Streaming Documentation (Should-have, ~80 lines)

**File**: `docs/trst4b-streaming-behavior.md`

**Contents**:
- Streaming architecture (SSE passthrough flow)
- output_hash semantics for streaming
- Privacy: in-memory buffering, not persisted
- Known limitations and current behavior
- How to verify streaming evidence (reviewer guide section)

**Dependencies**: None.

---

## 12. Test Plan

### 12.1 Pre-Implementation Baseline

```text
1. Run TRST-3 regression smoke (20 tests) — establish baseline
2. Run TRST-4A report smoke (14 tests) — establish baseline
3. Run 5 manual streaming calls against gateway — verify code behavior
4. Record: output_hash coverage %, known issues
```

### 12.2 Implementation Testing

```text
1. WP1 smoke: 10+ streaming scenarios
2. WP2 code change: manual verification
3. TRST-3 regression: 20/20 must remain PASS
4. TRST-4A report: 14/14 must remain PASS
5. Frontend build: 6/6 pages, tsc 0 errors
```

### 12.3 Acceptance Testing

```text
1. Full streaming smoke: all WP1 ACs verified
2. Regression: combined TRST-3 + TRST-4A + TRST-4B smoke
3. Report: streaming events visible, template correct
4. Privacy scan: no raw text leakage
```

---

## 13. Stop Conditions

| Condition | Action |
|---|---|
| Streaming smoke reveals fundamental bug in SSE passthrough | STOP, report to PM, propose fix scope |
| Regression smoke fails (any non-streaming test) | STOP immediately, revert streaming changes, diagnose |
| Privacy scan finds raw text in events/report | STOP, block implementation, root-cause |
| Client disconnect handling requires major refactor | SKIP AC-9, document limitation |
| Implementation exceeds 3 WPs / 300 lines | ESCALATE to PM for scope review |

---

## 14. Rollback Plan

### 14.1 What Could Go Wrong

| Risk | Likelihood | Severity |
|---|---|---|
| Streaming smoke reveals hidden bug | Low | Medium — fix required but path expected narrow |
| Non-streaming regression | Low | High — must be clean, rollback if not |
| Client disconnect handling complex | Medium | Low — deferrable to future charter |
| Output_hash semantics disagreement | Low | Low — just pick Option A |

### 14.2 Rollback Mechanism

All TRST-4B changes are to:
- 1 smoke script (can be deleted)
- 2 source files (template fix + code hardening, minimal diffs)
- 1 doc file (no runtime impact)

Rollback is trivial: `git revert` the TRST-4B commit. No schema changes, no dependency changes, no configuration changes.

---

## 15. Execution Order

```text
Phase 0: Pre-Implementation Baseline
  → Manual streaming verification
  → Record current behavior

Phase 1: WP1 — Streaming Smoke Test Suite
  → Write and run smoke script
  → Fix any issues found
  → Achieve AC-1 through AC-5

Phase 2: WP2 — Template Fix + Code Hardening
  → Fix evidence report template
  → Add privacy hardening (explicit fullText nullification)
  → Add client disconnect handling (if simple)

Phase 3: WP3 — Documentation
  → Write streaming behavior doc

Phase 4: Acceptance
  → Full combined smoke (TRST-3 + 4A + 4B)
  → Privacy scan
  → Regression verification
  → Produce TRST-4B Closure Report
```

---

## 16. File Envelope

```
trustos/
├── scripts/trst4b/
│   └── run-streaming-smoke.mjs        [NEW]    10+ streaming smoke tests
├── src/services/trst1/
│   ├── evidence-report.ts             [MOD]    Fix "Streaming mode" label
│   └── llm-gateway-server.ts          [MOD]    Privacy hardening + disconnect
├── docs/
│   └── trst4b-streaming-behavior.md   [NEW]    Streaming semantics doc
```

**Estimated: 4 files, ~+260/-10 lines. No new dependencies.**

---

## 17. PM Decision Points

The following require PM input before implementation:

1. **Partial Stream Hash Option A vs B** (§6.3): Agent recommends A (absent on non-success). PM to confirm or override.

2. **Client Disconnect Handling** (§11 WP2): AC-9 marked Should-have. PM decides whether to require for TRST-4B or defer.

3. **Streaming stats in evidence report** (§9.3): Optional enhancement. Agent recommends deferring to keep TRST-4B scope tight.

---

## 18. Current State

```text
TRST-3 MVP: CLOSED ✅
TRST-4A Evidence Report UX: IMPLEMENTED ✅, PM PENDING SEAL
TRST-4A Closure Report: DONE ✅

TRST-4B Streaming Gateway Support:
  CHARTER_AND_EXECUTION_PLAN: DONE ✅
  IMPLEMENTATION: NOT AUTHORIZED ❌
  NEXT: PM to review charter, make decisions on §17 points, and issue AUTHORIZE_TRST_4B_IMPLEMENTATION
```
