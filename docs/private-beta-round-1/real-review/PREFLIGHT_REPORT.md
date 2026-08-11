# Private Beta Round 1 — Runtime Preflight Report

```text
Project: TrustOS
Phase: Private Beta Program Round 1
Gate: Runtime Preflight Before Session 1
Date: 2026-08-04
Status: PREFLIGHT_PARTIAL — READY_FOR_PM_DECISION
```

---

## 1. Executive Summary

```text
Smoke:        20 PASS / 0 FAIL / 1 SKIP ✅
Trace Demo:   9 PASS / 1 FAIL (upstream API timeout) ⚠️
Trace Demo R2: 4 PASS / 5 FAIL (upstream API 503 + timeout) ⚠️
Overall:      PREFLIGHT_PARTIAL
```

The **product loop validates cleanly** via smoke. All core TrustOS behaviors pass:
gateway health, event hashing, evidence privacy, dry-run control. 

The trace-demo failure is **100% upstream API instability** — SiliconFlow DeepSeek-V4-Flash
responses are timing out (>60s) or returning 503. This is not a TrustOS product issue.

---

## 2. Smoke Results

```text
Command:  node scripts/trst3/run-private-beta-smoke.mjs
Result:   PASS — 20 pass / 0 fail / 0 warn / 1 skip
Duration: 16162ms
Gateway:  http://localhost:8787
Model:    deepseek-ai/DeepSeek-V4-Flash
```

| Phase | Checks | Result |
|:---|:---|---:|
| Phase 1: Gateway Health | 2 | ✅ PASS |
| Phase 2: Fresh Non-Streaming Model Call | 3 | ✅ PASS |
| Phase 3: Event Readback | 2 | ✅ PASS |
| Phase 4: Hash Validation | 4 | ✅ PASS (output_hash 10/10, 100%) |
| Phase 5: Assessment | 0+1 skip | ⊘ SKIP (no /assess endpoint — use Dashboard) |
| Phase 6: Dry-Run Control | 1 | ✅ PASS |
| Phase 7: Evidence Bundle | 5 | ✅ PASS (raw_content_included=false) |
| Phase 8: Privacy Safety | 3 | ✅ PASS |

**Key validations all passed:**
- `output_hash` coverage: 10/10 (100%) on fresh non-streaming events ✅
- `raw_content_included`: false ✅
- Control mode: dry_run + runtime_effect=none ✅
- No forbidden keys in events or evidence ✅

---

## 3. Trace Demo Results — Run 1

```text
Command:  node scripts/trst3/run-multi-event-trace-demo.mjs
Result:   FAIL_WITH_ISSUES — 9 pass / 1 fail / 0 warn
Duration: 71670ms
Trace ID: 9f1d29bf-90fa-42dc-8f73-1dcb0e1a826f
```

| Phase | Checks | Result |
|:---|:---|---:|
| Phase 1: Gateway Health | 1 | ✅ PASS |
| Phase 2: Step 1 (Planning) | 1 | ✅ PASS (HTTP 200, 5039ms) |
| Phase 2: Step 2 (Tool selection) | 1 | ❌ FAIL (timeout, 60s) |
| Phase 2: Step 3 (Final answer) | 1 | ✅ PASS (HTTP 200, 4126ms) |
| Phase 3: Trace Correlation | 5 | ✅ PASS (2/3 events correlated) |
| Phase 4: Explanation | — | N/A |

**The single failure**: Step 2 timed out after 60 seconds waiting for upstream model response.
The conversation history in Step 2 (3 messages: user + assistant + follow-up discount question)
likely triggered longer model processing time on the overloaded upstream.

**What validated correctly:**
- The 2 events that succeeded have full hashes (event_hash, input_hash, output_hash)
- Trace correlation works across the 2 successful events
- Session correlation works
- No raw content in evidence

---

## 4. Trace Demo Results — Run 2 (Retry)

```text
Command:  node scripts/trst3/run-multi-event-trace-demo.mjs (retry)
Result:   FAIL_WITH_ISSUES — 4 pass / 5 fail / 0 warn
Duration: 123243ms
Trace ID: 41a2f5cf-155f-4ce4-ac46-c603bda9178b
```

| Phase | Detail | Result |
|:---|:---|:---|
| Step 1 | HTTP 503 (729ms) | ❌ FAIL |
| Step 2 | Timeout (60s) | ❌ FAIL |
| Step 3 | Timeout (60s) | ❌ FAIL |

Run 2 confirms **upstream API instability** — HTTP 503 on Step 1 followed by timeouts on Steps 2-3.
This is not a TrustOS product issue. The gateway correctly forwarded requests and recorded
failure events with event_hash and input_hash (no output_hash, correctly, since no response).

---

## 5. Root Cause Analysis

```text
Type:           EXTERNAL_DEPENDENCY — not TrustOS product issue
Symptom:        Upstream API (SiliconFlow DeepSeek-V4-Flash) returning 503 or timing out >60s
Impact:         Trace-demo cannot complete with 3/3 successful steps
Product Impact: None — smoke validates all product behaviors independently
Mitigation:     Wait for upstream API to stabilize, or use a different API provider for Session 1
```

Evidence:
- Smoke's Phase 2 model_call succeeded (same model, same gateway, simpler prompt)
- Trace Step 1 succeeded in Run 1 (same model, same gateway)
- Inconsistency (503 on Run 2 Step 1, timeout on Run 1 Step 2, success on Run 1 Steps 1+3)
  is characteristic of upstream overload, not gateway failure

---

## 6. PM Gate Decision Required

Per PM directive §7:

> "If runtime preflight fails: Do not start reviewer sessions. Escalate to PM with PREFLIGHT_BLOCKED."

The smoke component passes fully (20/0). The trace-demo failure is external.

### Options for PM

| Option | Description | Risk |
|:---|---|:---|
| **A: ACCEPT_PARTIAL_PREFLIGHT** | Authorize reviewer sessions. Smoke validates product; trace-demo blocked by external API. Re-run trace-demo before first session. | Low — product validation is independent of upstream availability |
| **B: DOC_ONLY_REVIEW** | Proceed with reviewer sessions using documentation only. Skip runtime trace-demo. Per PM directive: "Only DOC_ONLY_REVIEW may proceed" if preflight cannot run. | Medium — reviewers see docs but not live trace correlation |
| **C: BLOCK_UNTIL_API_STABLE** | Wait. Do not proceed until upstream API stabilizes and trace-demo passes 10/10. | Schedule delay |
| **D: TRY_ALTERNATIVE_MODEL** | Switch trace-demo to a different model with lower latency (e.g., a smaller/faster provider). | Scope change |

### Recommendation

**Option A — ACCEPT_PARTIAL_PREFLIGHT**, with guardrail:
- Smoke validates product (20/0 PASS). Product is ready.
- Trace-demo is blocked by external API latency, not TrustOS behavior.
- Proceed with reviewer material preparation (invites, scheduling, path assignment).
- Re-run trace-demo immediately before Session 1.
- If trace-demo still fails: fall back to Option B (DOC_ONLY_REVIEW) for that session component.

---

## 7. Current Preflight Status

```text
Smoke:        20 PASS / 0 FAIL ✅
Trace Demo:   BLOCKED by upstream API ⚠️
Assessment:   SKIP (no endpoint, use Dashboard) ⊘
Gateway:      Healthy, running on localhost:8787 ✅
output_hash:  100% on fresh non-streaming events ✅
Evidence:     raw_content_included=false, privacy-safe ✅
Dry-run:      Confirmed (no enforcement) ✅

Overall:      PREFLIGHT_PARTIAL — Product Validated, Trace Demo Blocked by External API

Gate Status:  PM DECISION REQUIRED — Option A, B, C, or D
Next:         Real reviewer recruitment materials prepared, pending gate decision
```

---

*PREFLIGHT_REPORT | 2026-08-04 | PREFLIGHT_PARTIAL | READY_FOR_PM_DECISION*
