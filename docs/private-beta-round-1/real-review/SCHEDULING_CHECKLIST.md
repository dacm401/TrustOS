# TrustOS Private Beta Round 1 — Reviewer Scheduling Checklist

```text
Version: v1.0
Date: 2026-08-04
Purpose: Tracking checklist for real reviewer recruitment and session execution
Status: READY — pending reviewer confirmation
```

---

## Phase 0: Pre-Session Preparation

- [ ] **PM Gate Decision**: PREFLIGHT_PARTIAL resolved (Option A/B/C/D selected)
- [ ] **Preflight re-run** (immediately before Session 1):
  - `npm run trst3:smoke` — must be 20 PASS / 0 FAIL
  - `npm run trst3:trace-demo` — target: 10 PASS / 0 FAIL
  - If trace-demo still blocked: confirm fallback to DOC_ONLY_REVIEW for trace section
- [ ] **Gateway running**: localhost:8787, healthy
- [ ] **API key ready**: `.env` configured with working upstream key
- [ ] **Reviewer docs loaded** (5 files):
  - `docs/private-beta-reviewer-handoff.md`
  - `docs/private-beta-reviewer-session-guide.md`
  - `docs/private-beta-limitations.md`
  - `docs/private-beta-evidence-interpretation-guide.md`
  - `docs/private-beta-round-1-plan.md`
- [ ] **Observer checklists printed/ready** (one per session)
- [ ] **Feedback form ready** (shared doc/form link)

---

## Phase 1: Reviewer Recruitment

| # | Profile | Path | Invited | Confirmed | Scheduled |
|:---|:---|:---|:---|:---|:---|
| R1 | AI product / engineering | A | [ ] | [ ] | [ ] |
| R2 | Governance / risk | B | [ ] | [ ] | [ ] |
| R3 | Security / privacy | C | [ ] | [ ] | [ ] |
| R4 | Developer / operator | A | [ ] | [ ] | [ ] |
| R5 | Skeptical non-builder | B | [ ] | [ ] | [ ] |

**Gate**: ≥3 confirmed before first session.
**Target**: 3-5 confirmed.

---

## Phase 2: Per-Session Checklist

### Before Each Session

- [ ] Gateway confirmed running (`curl localhost:8787/health`)
- [ ] API key confirmed (test with single model call)
- [ ] Reviewer path materials ready (A/B/C-specific guide sections)
- [ ] Fresh observer checklist printed
- [ ] Screen share / remote session link ready (if remote)
- [ ] Evidence interpretation guide open (for Path B/C reviewers)
- [ ] Feedback form link ready

### Session Flow (45-60 min)

```text
00:00-05:00  Welcome + TrustOS overview (1 min pitch)
05:00-10:00  Path-specific walkthrough intro
10:00-20:00  Phase 1: Gateway + Model Call (observer demo for B/C)
20:00-30:00  Phase 2: Hash + Evidence Review
30:00-40:00  Phase 3: Trace Correlation Demo (if API available)
40:00-50:00  Phase 4: Limitations + Product Positioning
50:00-60:00  Feedback form + open discussion
```

### After Each Session

- [ ] Feedback form submitted by reviewer
- [ ] Observer checklist completed (within 30 min of session end)
- [ ] Session notes written (raw, unpolished)
- [ ] Any stop conditions triggered? (if yes, escalate immediately)

---

## Phase 3: Post-Collection Synthesis

After all sessions complete:

- [ ] All feedback forms collected
- [ ] All observer checklists complete
- [ ] Scores aggregated (per-dimension, per-reviewer)
- [ ] Repeated issues identified (same issue from ≥2 reviewers)
- [ ] Issues classified: Doc/Presentation vs Product Behavior
- [ ] Dry-run comprehension assessed (per-reviewer)
- [ ] Evidence comprehension assessed (per-reviewer)
- [ ] Stop condition audit (re-check all 8 conditions)
- [ ] Overclaim scan run
- [ ] Classification recommendation prepared
- [ ] `CHECKPOINT_2_REAL_REVIEW_RESULTS_SYNTHESIZED` written

---

## Phase 4: Session Log

| # | Reviewer | Path | Date | Duration | Status | Notes |
|:---|:---|:---|:---|:---|:---|:---|
| 1 | [name] | [A/B/C] | [ ] | — | Pending | |
| 2 | [name] | [A/B/C] | [ ] | — | Pending | |
| 3 | [name] | [A/B/C] | [ ] | — | Pending | |
| 4 | [name] | [A/B/C] | [ ] | — | Pending | |
| 5 | [name] | [A/B/C] | [ ] | — | Pending | |

---

## Stop Conditions — Session Vigilance

During sessions, watch for these 8 conditions. If triggered, escalate immediately:

- [ ] SC1: Gateway cannot start
- [ ] SC2: Fresh event lacks output_hash
- [ ] SC3: Evidence contains raw prompt/output/model response
- [ ] SC4: Reviewer believes TrustOS blocks requests today
- [ ] SC5: Docs claim enforcement/auth/legal-grade as current
- [ ] SC6: Product behavior contradicts limitations
- [ ] SC7: Product code fix needed to complete core loop
- [ ] SC8: Privacy/security regression appears

---

## Dependencies

```text
PM Gate:         PREFLIGHT_PARTIAL decision (A/B/C/D)
API Stability:   Upstream model availability for trace-demo
Gateway:         Running on localhost:8787
Docs:            All 5 reviewer docs prepared (DF1-DF6 applied)
Observer:        Available for all sessions
```

---

*SCHEDULING_CHECKLIST | v1.0 | 2026-08-04 | READY*
