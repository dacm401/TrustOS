# TrustOS Private Beta — Evidence Interpretation Guide

```text
Version: v1.1 (TRST-4B: streaming output_hash semantics)
Date: 2026-08-05
Audience: Business, governance, and non-technical reviewers
Purpose: Explain how to read and interpret TrustOS evidence bundles
```

---

## What This Guide Covers

This guide explains TrustOS evidence bundles in non-technical language. It is written for reviewers who do not need to run terminal commands or parse JSON — you can use this guide alongside evidence that an observer or operator shows you.

---

## 1. What Is an Evidence Bundle?

An evidence bundle is a structured record of what TrustOS observed during one or more AI interactions. Think of it as a **safety inspection report for AI activity** — it tells you what happened, whether anything looked unusual, and what TrustOS recommended, without exposing the actual conversation content.

### What It Proves

| Property | Explanation |
|:---|:---|
| **An event was observed** | TrustOS recorded that an AI interaction occurred, with a timestamp and trace ID |
| **Digital fingerprints exist** | SHA256 hashes were generated for the event metadata, the AI input, and the AI output |
| **Assessment was performed** | TrustOS checked for governance signals (privacy concerns, operational issues, evidence integrity) |
| **Control recommendation recorded** | TrustOS recorded whether it would recommend "allow" or "review" if enforcement were enabled |
| **No raw content exposed** | The evidence contains only hashes and metadata — no actual conversation text |

### What It Does NOT Prove

| Not Covered | Why |
|:---|:---|
| **Legal compliance** | TrustOS is not a compliance audit tool; hashes are not legal evidence |
| **Notarization** | Evidence is not cryptographically signed or timestamped by a third party |
| **Authenticated identity** | The `agent_id` is a label set by the caller, not verified identity |
| **Enforcement** | Control is dry-run only — no requests are blocked or modified |
| **Long-term archive integrity** | Evidence is not persisted by TrustOS backend; it's exported at review time |

---

## 2. Reading an Evidence Bundle — Field-by-Field

### Top-Level Fields

| Field | What It Means | Example | Governance Significance |
|:---|:---|:---|:---|
| `bundle_version` | Evidence format version | `"1.0"` | Tells you which version of the evidence schema is in use |
| `generated_at` | When the evidence was exported | `"2026-08-04T10:30:00Z"` | Timestamp of evidence export, not the original events |
| `trace_id` | Unique identifier for the AI session | `"abc123-def456..."` | Groups all events from one AI interaction chain together |
| `event_count` | How many events are in this bundle | `3` | Tells you how many AI interactions were observed |
| `events` | List of individual events | `[{...}, {...}, {...}]` | The actual evidence records |

### Event-Level Fields

| Field | What It Means | Governance Significance |
|:---|:---|:---|
| `event_id` | Unique identifier for this event | Reference key for looking up a specific event |
| `event_type` | What kind of event | `model_call` means an AI model was called |
| `timestamp` | When the event occurred | Time of the actual AI interaction |
| `event_hash` | SHA256 hash of event metadata | Proves this event record hasn't been modified |
| `input_hash` | SHA256 hash of what was sent to the AI | Proves the input existed, without revealing its content |
| `output_hash` | SHA256 hash of what the AI returned | Proves the output existed, without revealing its content |
| `agent_id` | Label for the AI agent/user | Source label only; not authenticated identity |
| `model` | Which AI model was called | Tracks which model was used |

### Assessment Fields

| Field | What It Means | Governance Significance |
|:---|:---|:---|
| `assessment.risk_level` | Low / Medium / High | TrustOS's automated risk signal detection |
| `assessment.signals` | What triggered the risk level | Lists specific governance concerns detected (e.g., privacy, operational) |
| `assessment.summary` | Plain-language risk description | Human-readable explanation of the risk finding |

### Control Fields

| Field | What It Means | Governance Significance |
|:---|:---|:---|
| `control.recommendation` | Allow / Review | TrustOS's recommended action (dry-run — not enforced) |
| `control.rationale` | Why the recommendation | Explanation of the control decision |
| `control.mode` | Always `dry_run` in Private Beta | Confirms no enforcement occurred |
| `control.runtime_effect` | Always `none` in Private Beta | Confirms no request was blocked or modified |

### Privacy Fields

| Field | What It Means | Governance Significance |
|:---|:---|:---|
| `raw_content_included` | Should be `false` | **Critical**: confirms evidence does NOT contain raw conversation text |
| `privacy_flags` | Any privacy concerns detected | Usually empty for clean events |

### Streaming Model Calls (TRST-4B)

TrustOS supports streaming SSE responses (`stream=true`). This affects how output hashes work:

| Scenario | `output_hash` | `status` | What it means |
|---|---|---|---|
| Stream completed | Present | `success` | Full output was accumulated in memory, hashed, and the hash was stored. The matching content was delivered to the client. |
| Stream failed (upstream error) | Absent | `failure` | No output was produced. No hash recorded (there's nothing to hash). |
| Stream cancelled (client disconnected) | Absent | `failure` | Output was partially delivered but the stream didn't complete. No partial hash — honest "incomplete" signal. |

**Key principle for reviewers**: If `output_hash` is absent on a streaming event, TrustOS is explicitly NOT claiming verifiable evidence for that output. This is by design — an absent hash is more honest than a hash of incomplete output.

**Non-streaming calls** produce `output_hash` for every successful response. If a non-streaming call has no `output_hash`, it likely failed at the upstream level.

---

## 3. How to Verify Evidence (Non-Technical)

### What a Reviewer Checks

You don't need to run hash verification yourself. An operator or technical reviewer can verify on your behalf. The key checks are:

| Check | What to Ask | Correct Answer |
|:---|:---|:---|
| Privacy safety | "Does this evidence contain the actual AI conversation?" | No — `raw_content_included=false` |
| Hash presence | "Are the digital fingerprints recorded?" | Yes — `event_hash`, `input_hash`, `output_hash` all present |
| Control mode | "Did TrustOS block or modify anything?" | No — `control.mode=dry_run`, `runtime_effect=none` |
| Verify output_hash | "Can you prove the hash matches the actual AI output?" | Yes — SHA256 the raw output and compare with `output_hash` |
| No overclaiming | "Is TrustOS claiming to be a legal compliance tool?" | No — limitations clearly stated |

### How Hash Verification Works (for Reference)

If you want to understand the mechanism:

1. TrustOS records `output_hash` = SHA256(the AI's response) in the event
2. A reviewer who has access to the original AI response can compute SHA256(response) independently
3. If the computed hash matches `output_hash` → the evidence is consistent with the original output
4. If the computed hash does NOT match → the evidence or the output has been modified

This is called **hash-verifiable evidence**, not "tamper-proof" evidence. It allows detection of mismatches, but you need the original output to verify.

---

## 4. What TrustOS Is NOT

This guide intentionally covers what TrustOS does NOT provide, because reviewer understanding of limitations is as important as understanding capabilities.

| TrustOS is NOT | Why This Matters |
|:---|:---|
| A blocking/enforcement system | No AI requests are stopped; TrustOS observes and recommends |
| An identity verification system | `agent_id` is a label, not proof of who made the request |
| A legal compliance recorder | Evidence is reviewer-facing, not court-ready |
| A notarized audit trail | No cryptographic signing or third-party timestamping |
| A production-grade infrastructure | Private Beta; no SLOs, availability guarantees, or failover |

For the complete list, see `docs/private-beta-limitations.md`.

---

## 5. Example: What Good Evidence Looks Like

**Scenario**: An AI agent made 3 model calls in a single session. All 3 were clean — no privacy concerns, no operational issues.

**Evidence Bundle (Interpreted)**:

```
TrustOS Evidence Report
Generated: 2026-08-04 10:30 UTC
Trace ID: trace-abc123

Summary:
- 3 AI model calls observed
- Model: deepseek-ai/DeepSeek-V4-Flash
- Risk assessment: Low (no concerning signals detected)
- Control recommendation: Allow (dry-run — not enforced)
- Privacy: Safe — evidence contains no raw conversation content
- All events have complete digital fingerprints (hashes)

What This Means:
TrustOS observed 3 AI interactions. Each interaction generated a hash
that can be verified independently. No concerning governance signals
were detected. No raw conversation content is included in this evidence.
```

---

## 6. Example: What Requires Review

**Scenario**: An event is missing `output_hash`. This was a historical event from before the TRST-2C fix.

**Evidence (Interpreted)**:

```
TrustOS Evidence Report
Generated: 2026-08-04 10:30 UTC
Trace ID: trace-def456

Summary:
- 1 AI model call observed
- Model: deepseek-ai/DeepSeek-V4-Flash
- Risk assessment: Medium (evidence-integrity signal)
  → output_hash is missing — cannot verify output consistency
- Control recommendation: Review (dry-run — not enforced)
- Privacy: Safe — evidence contains no raw conversation content

What This Means:
TrustOS observed 1 AI interaction but was unable to record an output hash.
This means the output cannot be verified through hash comparison.
This may be a historical event from before the hash coverage fix — fresh
events should have complete hashes. The event itself is still recorded
and privacy-safe, but output verification is not available for this event.
```

---

## 7. Quick Reference Card

```
TRUSTOS EVIDENCE — QUICK CHECKS

✓ raw_content_included = false           → Privacy is protected
✓ event_hash present                     → Event record exists
✓ input_hash present                     → Input is verifiable
✓ output_hash present                    → Output is verifiable
✓ control.mode = dry_run                 → No enforcement
✓ control.runtime_effect = none         → No request blocked
⚠ output_hash missing                    → Cannot verify output
✗ raw_content_included = true            → PRIVACY CONCERN — escalate
✗ control.mode = enforce               → SCOPE VIOLATION — escalate
```

---

## References

- `docs/private-beta-reviewer-handoff.md` — Full reviewer handoff
- `docs/private-beta-limitations.md` — Complete limitations list
- `docs/private-beta-reviewer-session-guide.md` — Session walkthrough
- `docs/private-beta-feedback-form.md` — Feedback form

---

> **Status**: Evidence Interpretation Guide — v1.0 (2026-08-04, DF4)  
> **Note**: This guide explains evidence bundles in non-technical language. It does not add product capabilities or change the evidence schema.
