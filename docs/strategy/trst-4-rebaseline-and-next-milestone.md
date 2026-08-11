# TRST-4 Rebaseline & Next Milestone Recommendation

**Status**: PENDING PM REVIEW
**Date**: 2026-08-05
**Author**: Agent (per PM directive TRST-4B seal)
**Previous Gate**: TRST-4B SEALED

---

## 1. Current Product Capability Map

After TRST-4A and TRST-4B, the TrustOS Private Beta product capability set is:

### Observe (Gateway → Event Pipeline)

| Capability | Status | Since |
|---|---|---|
| Gateway proxy (OpenAI-compatible) | ✅ | TRST-1 |
| Non-streaming model calls | ✅ | TRST-1 |
| Completed SSE streaming model calls | ✅ Validated | TRST-4B |
| Request routing + trace_id generation | ✅ | TRST-1 |
| Event hash (SHA-256) generation | ✅ | TRST-1 |
| Input hash (SHA-256 of request body) | ✅ | TRST-1 |
| Output hash (SHA-256 of full response) | ✅ | TRST-1 |
| request_mode ("streaming" / "non_streaming") | ✅ | TRST-4B |
| Client disconnect detection (STREAM_CANCELLED) | ✅ | TRST-4B |
| JSONL event store (local file) | ✅ | TRST-1 |
| Event hash chain / Merkle | ❌ | — |
| Digital signature on events | ❌ | — |
| Chunk-level streaming evidence | ❌ by design | Deferred |

### Assess (Analysis + Reviewer Surface)

| Capability | Status | Since |
|---|---|---|
| Risk/control signal classification | ✅ | TRST-2 |
| Reviewer-facing explanations (plain language) | ✅ | TRST-2 |
| Frontend assessment path (dashboard) | ✅ | TRST-2 |
| Dashboard EventChainViewer | ✅ | TRST-2 |
| Backend assessment API | ❌ | — |

### Control

| Capability | Status | Since |
|---|---|---|
| Shadow Mode / dry-run (runtime_effect=none) | ✅ | TRST-2 |
| Allow/warn/block decision recording | ✅ | TRST-2 |
| Actual blocking/enforcement | ❌ by design | Deferred to TRST-4F |

### Evidence

| Capability | Status | Since |
|---|---|---|
| Privacy-safe evidence bundles (hashes only) | ✅ | TRST-2 |
| HTML evidence report (self-contained) | ✅ | TRST-4A |
| Markdown evidence report | ✅ | TRST-4A |
| Report summary API (aggregate JSON) | ✅ | TRST-4A |
| Dashboard EvidenceReportPanel | ✅ | TRST-4A |
| Report download (Content-Disposition) | ✅ | TRST-4A |
| Streaming/non-streaming/unknown mode counts in report | ✅ | TRST-4B |
| Hash verification guide for reviewers | ✅ | TRST-4A |
| Evidence interpretation guide | ✅ | TRST-4B |
| Durable evidence storage / retrieval | ❌ | — |
| Evidence history / time-range query | ❌ | — |
| Per-event evidence export | ❌ | — |

### Validation

| Capability | Status | Since |
|---|---|---|
| TRST-3 MVP smoke (20 validations) | ✅ | TRST-3 |
| Multi-event trace demo | ✅ | TRST-3 |
| TRST-4A report smoke (14 validations) | ✅ | TRST-4A |
| TRST-4B streaming smoke (18 validations) | ✅ | TRST-4B |
| CI-integrated smoke | ❌ | — |
| Real reviewer sessions | ❌ | — |

### Docs

| Capability | Status | Since |
|---|---|---|
| Private Beta Limitations | ✅ v0.3 | TRST-4B |
| Reviewer Handoff | ✅ | TRST-4B |
| Evidence Interpretation Guide | ✅ v1.1 | TRST-4B |
| Architecture Thesis (TRST-0) | ✅ | TRST-0 |
| Threat Model v0.1 | ✅ | TRST-0 |
| Execution Trace Charter | ✅ | TRST-1 |

---

## 2. What Changed Since TRST-3

TRST-3 delivered an MVP with product loop validation, 52/52 AC, and 20/20 smoke. The two highest-priority gaps identified at TRST-3 closure were:

1. **Evidence not readable** — "5/5 simulated reviewer profiles flagged evidence bundle as unreadable (High severity)"
2. **Streaming support under-documented** — Gateway already supported SSE but docs/reports claimed otherwise

TRST-4A and TRST-4B addressed both gaps:

### TRST-4A: Evidence Report UX
- **Product impact**: Evidence report went from "developer JSON" to "reviewer-facing governance artifact"
- **New surfaces**: HTML report, Markdown report, report/summary API, dashboard panel
- **Privacy**: Zero raw content in any report surface
- **Lines**: +814 in 8 files

### TRST-4B: Streaming Validation & Hardening
- **Product impact**: Streaming correctly labeled, client disconnect handled, semantics documented
- **Key adds**: request_mode field, STREAM_CANCELLED event, privacy hardening (fullText cleared after hash)
- **Correction**: Removed "streaming not supported" inaccuracy from 3 docs + report template
- **Lines**: +322/-12 in 9 files

### Cumulative TRST-4 impact
- **16 files changed** (TRST-4A: 8, TRST-4B: 9, overlap: 1)
- **~+1,136 lines net**
- **Zero new dependencies**
- **Zero regression on TRST-3 smoke**
- **Value**: Evidence report UX + streaming readiness = the two biggest reviewer-facing gaps closed

---

## 3. TRST-4A Sealed Summary

```
TRST-4A Evidence Report UX: SEALED ✅
PM Disposition: ACCEPTED, SEALED
Scope: Human-readable evidence report on top of TRST-2/TRST-3 pipeline
Files: 8 (3 new, 5 modified)
Validation: 14/14 smoke, 20/20 TRST-3 regression, tsc 0 errors, build 6/6
Privacy: RAW_CONTENT_SCAN PASS, OVERCLAIM_SCAN PASS
```

Closure report: `docs/strategy/trst-4a-evidence-report-ux-closure.md`

---

## 4. TRST-4B Sealed Summary

```
TRST-4B Streaming Support Validation & Hardening: SEALED ✅
PM Disposition: ACCEPTED, SEALED
Scope: Validate, harden, and correctly document existing SSE streaming
Files: 9 (2 new, 7 modified)
Validation: tsc 0 errors, build 6/6, TRST-4A regression 14/14
Semantics: Completed stream = output_hash present; Cancelled/failed = output_hash absent
Privacy: fullText cleared after hash; RAW_CONTENT_SCAN PASS; OVERCLAIM_SCAN PASS
```

Closure report: `docs/strategy/trst-4b-streaming-validation-closure.md`

---

## 5. Remaining Product Gaps

Ranked by product impact:

### Gap 1: Durable Evidence Store / Evidence History (TRST-4C)

**Current state**: Evidence lives in a local JSONL file on the gateway host. No persistence across restarts (file mode only). No history query. No retrieval API for past sessions.

**Why it matters**: Evidence is now human-readable (4A) and streaming-capable (4B), but cannot survive a gateway restart or be queried by time range. A reviewer cannot return to review evidence from last week without the gateway still running against the same file.

**What it's NOT**: A production database. TRST-4C would deliver the minimum durable persistence — a SQLite-backed event store with readAll/by-session/by-timerange query. No distributed store, no cloud backup, no replication.

### Gap 2: Backend Assessment API (TRST-4D)

**Current state**: Assessment (risk/control classification) runs inline in the gateway proxy path. No standalone API to re-assess existing events or assess batches.

**Why it matters**: Reviewers can read evidence (4A) but cannot programmatically query assessment results. The dashboard shows results but there's no API contract for external tooling.

### Gap 3: Authenticated Identity / Source Binding (TRST-4E)

**Current state**: Events have `agent_id` and `session_id` but no cryptographic identity binding. Anyone with gateway access can see all events.

**Why it matters**: For any reviewer to trust that "event X came from agent Y," we need minimal identity binding. This is not full auth/RBAC — it's source attribution.

### Gap 4: Policy Engine / Enforcement Path (TRST-4F)

**Current state**: Control decisions are recorded but never enforced. Shadow mode only.

**Why it matters**: The "Control" leg of the Observe→Assess→Control→Prove loop is currently dry-run only. Real enforcement is the ultimate product differentiator but also the highest-risk capability addition.

### Gap 5: Production Ops Baseline (TRST-4G)

**Current state**: Gateway is a development server. No process management, health monitoring, log rotation, or operational observability beyond the event store itself.

**Why it matters**: A product cannot go to real reviewers without basic operational stability. However, this may be premature to fully implement before real reviewer feedback.

### Gap 6: Real Private Beta Reviewer Round

**Current state**: All product validation has been simulated (agent smoke tests). Zero real human reviewers have used the product.

**Why it matters**: The entire purpose of TRST-4 capabilities (readable evidence, streaming support) is to serve real reviewers. Without real reviewer feedback, we risk building infrastructure that reviewers don't actually need.

---

## 6. Real Reviewer Readiness Status

### What a reviewer CAN do today

| Activity | Readiness | Notes |
|---|---|---|
| Start the gateway | ✅ | `npm run gateway:start` |
| Use TrustOS as AI proxy | ✅ | Non-streaming + streaming, OpenAI-compatible |
| View HTML evidence report | ✅ | `GET /report` — self-contained, privacy-safe |
| View report summary | ✅ | `GET /report/summary` — aggregate stats |
| Download evidence report | ✅ | `GET /report?format=download` |
| View Dashboard | ✅ | EvidenceReportPanel + EventChainViewer |
| Verify output hashes | ✅ | SHA-256 verification guide in docs |
| Understand streaming evidence | ✅ | Evidence Interpretation Guide has streaming semantics |
| Understand limitations | ✅ | Limitations doc v0.3, handoff doc |
| Know what ISN'T recorded | ✅ | Privacy table in report explicitly states what's NOT recorded |

### What a reviewer CANNOT do today

| Activity | Blocker | Severity |
|---|---|---|
| Return to evidence from past sessions | No durable store | Medium |
| Query evidence by time range | No query API | Medium |
| Prove who generated what | No identity binding | Low (for beta) |
| See enforcement in action | Shadow mode only | Low (for beta) |
| Run without technical setup | Requires Node.js + API key | Medium (accepted for beta) |

### Readiness judgment

**Overall**: READY for real reviewer round.

The two highest-severity blockers from TRST-3 (unreadable evidence, streaming gap) are resolved. The remaining gaps (durable store, identity, enforcement) are important but not blockers for initial reviewer feedback. Real reviewers can:

1. Run the gateway
2. Send AI requests through it
3. View privacy-safe evidence reports
4. Verify output hashes
5. Understand what the product does and doesn't do

The value of real reviewer feedback NOW (before building TRST-4C) outweighs the cost of reviewers encountering the known limitations (which are clearly documented).

---

## 7. Candidate Next Milestones

### Option A: Run Real Reviewer Round Now

**What**: Recruit 3-5 real reviewers, run structured review sessions, collect feedback.

**Prerequisites**: 
- Reviewer recruitment (not an implementation task)
- Session structure / interview guide
- Feedback collection form

**Duration estimate**: 1-2 weeks (recruitment + sessions + synthesis)

**Product impact**: Grounds TRST-4C~4G prioritization in real user evidence.

**Risk of NOT doing this**: Overbuilding infrastructure (durable store, assessment API, identity) before validating that reviewers actually need those capabilities.

### Option B: TRST-4C — Durable Evidence Store

**What**: SQLite-backed event store with readAll, by-session, by-timerange query. Replaces JSONL file as primary store.

**Key ACs**:
- Events persist across gateway restarts
- Query by session_id
- Query by time range (from → to)
- Backward-compatible with JSONL read
- No distributed store, no cloud dependency

**File envelope**: 2-3 files (new store module, migration from JSONL, smoke script)
**Lines estimate**: ~300-500

**Product impact**: Removes the most practical blocker for real reviewers — inability to review past evidence.

### Option C: TRST-4D — Backend Assessment API

**What**: Standalone API endpoint(s) to assess events programmatically. Separate from inline gateway assessment.

**Key ACs**:
- `POST /assess` — assess a batch of events
- `GET /assess/:event_id` — re-assess single event
- Returns risk/control signals + explanations
- Same assessment logic as gateway inline path

**File envelope**: 2-3 files (assessment endpoint, API handlers, smoke script)
**Lines estimate**: ~250-400

**Product impact**: Enables external tooling to consume assessment results.

### Option D: TRST-4E — Authenticated Identity / Source Binding

**What**: Minimal identity binding — associate events with authenticated agent/source.

**Key ACs**:
- Agent identity token (API key per agent)
- Source binding in event envelope (verified_agent_id)
- Optional: simple viewer password for report access

**File envelope**: 3-5 files (identity module, middleware, smoke script)
**Lines estimate**: ~500-800

**Product impact**: Foundation for trust ("who generated this evidence?").

### Option E: TRST-4F — Policy Engine / Enforcement Path

**What**: Actual enforcement — gateway blocks requests that policy flags.

**Key ACs**:
- Policy configuration (allow/warn/block rules)
- Gateway enforcement path (non-shadow)
- Audit trail of enforced decisions
- Shadow/enforcement mode toggle

**Risk**: HIGHEST risk — changes gateway behavior from passive to active.

**File envelope**: 5-8 files
**Lines estimate**: ~1000+

### Option F: TRST-4G — Production Ops Baseline

**What**: Operational stability — process management, health checks, log rotation.

**Key ACs**:
- Process manager (PM2 or systemd)
- Health endpoint hardening
- Log rotation / retention
- Basic monitoring

**File envelope**: 3-5 files (config, scripts, docs)
**Lines estimate**: ~300-500

---

## 8. Recommendation

### Primary Recommendation: Option A — Run Real Reviewer Round Now

**Rationale**:

```
1. TRST-4A fixed the #1 blocker: evidence was unreadable.
2. TRST-4B fixed the #2 blocker: streaming was incorrectly labeled.
3. Both were validated through simulated review (smoke tests).
4. But simulated validation has reached its limit.
5. We have no evidence that real reviewers need what TRST-4C~4G would build.
6. In the TrustOS product loop philosophy, we should Observe (real reviewer feedback) 
   before we build more infrastructure.
7. This is consistent with the PM's own initial recommendation.
```

**The product loop argument**:

TrustOS's own product loop is Observe→Assess→Control→Prove. We've been running simulated loops. TRST-4A and 4B validated that the product CAN serve reviewers. The next step is to actually put it in front of reviewers to Observe what happens — before looping back to build more.

### Secondary Recommendation: Parallel Lightweight Preparation

While recruiting and scheduling reviewers (which is not an implementation task), the agent can prepare:

```
1. Reviewer session structure / interview guide
2. Feedback collection form (Google Form or similar)
3. Quick-start reviewer script (one-command setup, if feasible)
4. Pre-session checklist (gateway running, API key configured, events generated)
```

### Implementation Order (if PM chooses to proceed with capability work)

If PM decides NOT to run real reviewer round yet, the recommended implementation order is:

```
1. TRST-4C Durable Evidence Store (biggest practical gap)
2. TRST-4G Production Ops Baseline (reviewer experience + stability)
3. TRST-4E Authenticated Identity (trust foundation before enforcement)
4. TRST-4D Backend Assessment API (API contract for external tooling)
5. TRST-4F Policy Engine / Enforcement (highest risk, last)
```

---

## 9. Stop Conditions

The following conditions would warrant STOPPING and re-assessing before continuing to the next milestone:

### For Real Reviewer Round
- **< 3 reviewers** complete sessions → insufficient feedback. Re-assess recruitment strategy.
- **Major product bug** discovered during real session → fix before continuing recruitment.
- **Reviewers consistently find evidence unreadable** despite TRST-4A → re-open TRST-4A scope.
- **Reviewer feedback contradicts planned TRST-4C~4G priority** → re-rank before building.

### For TRST-4C (if chosen)
- **PM determines real reviewer round should happen first** → defer 4C.
- **SQLite adds unacceptable complexity** → consider simpler durable storage (e.g., append-only log with index file).

### Global Stop Conditions
- **Overclaim creep**: Any claim of "tamper-proof," "production-grade," "legal compliance," "enterprise RBAC" → stop and fix language.
- **Privacy regression**: Any raw content appearing in new surfaces → stop and fix before proceeding.
- **Scope expansion**: Any new dependency, DB migration framework, auth provider, cloud service introduced without charter → stop and escalate to PM.

---

## 10. Decision: Whether to Run Real Reviewer Round Before TRST-4C

### Recommendation: YES — Run real reviewer round before TRST-4C.

**Three reasons**:

**1. Product philosophy**: TrustOS's own thesis is that governance products must be validated through real use, not just infrastructure building. TRST-4A and 4B made evidence readable and streaming honest. The next validation step is real human reviewers, not more infrastructure.

**2. Priority grounding**: Without real reviewer feedback, we are guessing which of TRST-4C~4G matters most. Maybe reviewers care deeply about durable evidence. Maybe they care more about identity. Maybe they want enforcement. We don't know. Running 3-5 real sessions gives us data to prioritize TRST-4C through 4G before building any of them.

**3. Risk of overbuilding**: Every TRST-4 milestone so far (4A, 4B) addressed direct, validated gaps from TRST-3 simulated reviews. TRST-4C~4G are speculative — plausible needs, but not yet validated by real reviewer demand. Building durable evidence storage before confirming that reviewers actually want to review past evidence is premature productionization, which the PM has consistently cautioned against.

### If PM agrees with this recommendation:

Next steps:
```
1. Agent prepares reviewer session materials (interview guide, feedback form, quick-start)
2. PM recruits 3-5 reviewers (not an agent task)
3. Agent supports sessions (technical setup, troubleshooting)
4. After 3-5 sessions: agent synthesizes feedback → TRST-4B.5 Review Synthesis
5. PM + Agent jointly re-rank TRST-4C~4G based on real feedback
6. PM authorizes next implementation milestone
```

---

## 11. Updated Product Maturity

```
Private Beta Candidate — Evidence Report UX + Streaming Validated ✅

Product completeness (estimated):
  Obsess:  90%  (streaming + non-streaming; missing chunk-level, hash chain)
  Assess:  60%  (frontend review path exists; missing backend API)
  Control: 10%  (shadow mode only; no enforcement)
  Evidence: 50%  (human-readable reports exist; missing durable store, query, history)
  Docs:    85%  (comprehensive for beta scope; missing reviewer session guide)

Overall Private Beta readiness: 75-80%

NOT yet:
  Production Ready
  Enterprise Ready  
  Legal Compliance Platform
  Enforcement Gateway
```

---

## 12. Appendix: Milestone History

| Milestone | Status | Date Sealed | Deliverables |
|---|---|---|---|
| TRST-0 | Baseline Accepted | 2026-07-14 | Architecture thesis, threat model, execution charter |
| TRST-1A/1B | CLOSED | 2026-07-15 | Gateway MVP, event pipeline, shadow mode |
| TRST-1C | HELD | — | MCP spike (deferred) |
| TRST-2 | SEALED | — | Risk/control assessment, reviewer surface |
| TRST-2B | CLOSED | 2026-07-31 | Product loop fixes |
| TRST-2C | CLOSED | 2026-07-31 | Fresh-event E2E validation |
| TRST-3 MVP | CLOSED | 2026-08-05 | 52/52 AC, 6/6 WP, 20/20 smoke |
| TRST-4A | SEALED | 2026-08-05 | Evidence Report UX (8 files, 14/14 smoke) |
| TRST-4B | SEALED | 2026-08-05 | Streaming Validation & Hardening (9 files, 18-val smoke) |
| TRST-4C | NOT_STARTED | — | Durable Evidence Store |
| TRST-4D | NOT_STARTED | — | Backend Assessment API |
| TRST-4E | NOT_STARTED | — | Authenticated Identity |
| TRST-4F | NOT_STARTED | — | Policy Engine / Enforcement |
| TRST-4G | NOT_STARTED | — | Production Ops Baseline |

---

## 13. PM Decision Required

```text
PM DIRECTIVE REQUIRED:

Option A: AUTHORIZE_REAL_REVIEWER_ROUND — recruit reviewers, run sessions, synthesize feedback
Option B: AUTHORIZE_TRST_4C — start Durable Evidence Store implementation
Option C: AUTHORIZE_TRST_4x — start another TRST-4 milestone (specify which)
Option D: PAUSE — release packaging or other non-implementation work
Option E: OTHER — PM's own directive

Agent recommendation: Option A (Real Reviewer Round)
```

---

*End of TRST-4 Rebaseline & Next Milestone Recommendation*
*Status: PENDING PM REVIEW*
