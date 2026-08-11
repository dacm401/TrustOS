# CHECKPOINT_2 — Reviewer Recruitment Plan

**Status:** AUTHORIZED ✅ (2026-08-10, PM Final Instruction)
**Mode:** Documentation / Coordination ONLY — NO product implementation
**Depends on:** MWT-4A SEALED ✅, ManagerWorkspace UX Polish SEALED ✅
**Goal:** Recruit reviewers and calibrate MWT-4B (Task Evidence Export / Signing) before any implementation.

---

## 1. Purpose

MWT-4B touches the trust boundary of exported evidence: privacy, hash integrity,
attestation semantics, and signing. Implementation is **NOT authorized** until
reviewer feedback is synthesized and PM issues an explicit greenlight. This plan
organizes the recruitment, question set, artifacts, risk framing, acceptance,
timeline, and decision outputs for CHECKPOINT_2.

---

## 2. Reviewer Profiles Needed

| # | Profile | Focus | Min Priority |
|---|---|---|---|
| R1 | Privacy / Data Minimization reviewer | raw-content prohibition, metadata minimization, regulatory exposure | **Required** |
| R2 | Security / Integrity reviewer | hash semantics, tamper/replay, signing model, false attestation | **Required** |
| R3 | Product / UX reviewer | export clarity, "unsigned / client-generated" labeling, reviewer comprehension | **Required** |
| R4 | Backend / Architecture reviewer | frontend-only feasibility, reuse of `GET /v1/events?task_id=`, no backend creep | Optional |
| R5 | Compliance / Audit semantics reviewer | evidence-as-projection vs system-of-record, audit defensibility | Optional |

**Minimum viable configuration:** R1 + R2 + R3 (Security + Privacy + Product).

---

## 3. Review Questions (canonical set)

See `MWT-4B-review-questionnaire.md` for the full itemized list. Summary:

1. What exactly is exported?
2. Are hashes enough (no raw content)?
3. Does export imply attestation?
4. Should unsigned export be clearly labeled?
5. Is frontend-only export acceptable for Private Beta?
6. What metadata is safe to include?
7. What must be excluded?
8. What signing model is required later (when identity/key model exists)?

---

## 4. Artifacts to Review

| Artifact | Source | Why |
|---|---|---|
| `MWT-4B-export-signing-prebrief.md` | this repo (to be hardened) | candidate scope + open questions |
| `docs/strategy/TRST-threat-model-v0.1.md` | TRST-0.3 baseline (ACCEPTED) | Gateway entry policy + trust boundary |
| `frontend/src/lib/taskEvidence.ts` (`aggregateTaskEvidence`, `SAFE_META_KEYS`) | MWT-4A (SEALED) | defines the privacy-safe field surface |
| `frontend/src/components/workbench/TaskEvidenceView.tsx` | MWT-4A + UX Polish (SEALED) | what the export would serialize |
| `ManagerWorkspace-ux-polish-closure-report.md` | CHECKPOINT_2 input | confirms stable UX baseline |

Reviewers must NOT need backend access — all candidate export data is already
frontend-fetched and privacy-bounded by `SAFE_META_KEYS`.

---

## 5. Risk Areas (detailed in `MWT-4B-risk-register.md`)

- Raw data leak (privacy)
- False attestation (integrity)
- Hash misinterpretation (reviewer trust)
- User trust boundary confusion (product)
- Replay / tamper (security)
- Policy conflation (export ≠ approval)
- Privacy / regulatory exposure

---

## 6. Acceptance Criteria (CHECKPOINT_2 complete)

CHECKPOINT_2 is **complete** when:

- [ ] ≥ 3 reviewers engaged (R1+R2+R3 minimum).
- [ ] Each reviewer returns answers to the 8 canonical questions.
- [ ] At least 1 reviewer per risk area (privacy, security, product) has signed off.
- [ ] `MWT-4B-risk-register.md` reviewed and risks rated (likelihood/impact/mitigation).
- [ ] `MWT-4B-implementation-readiness-gate.md` approved by PM.
- [ ] Conflicting reviewer positions synthesized into a single recommended posture.
- [ ] PM decision: PROCEED_TO_MWT-4B_IMPLEMENTATION_BRIEF or HOLD.

---

## 7. Review Timeline (proposed)

| Phase | Window | Owner |
|---|---|---|
| Recruitment | Week 1 | PM / Agent coordination |
| Async review (questionnaire) | Week 1–2 | Reviewers |
| Risk register review | Week 2 | R1 + R2 |
| Synthesis + readiness gate draft | Week 2–3 | Agent → PM |
| PM decision | Week 3 | PM |

Private Beta reviewer pool (CHECKPOINT_2 real-review track) may run in parallel
with this export-boundary review.

---

## 8. Decision Outputs

This checkpoint must produce:

1. **Synthesized reviewer posture** — single recommended MWT-4B boundary:
   - frontend-only unsigned export acceptable? (PM default: YES, labeled "client-generated, unsigned")
   - required metadata allow-list
   - required exclusion list (raw content, policy/approval state)
2. **MWT-4B readiness verdict** — gate PASS/FAIL per `MWT-4B-implementation-readiness-gate.md`.
3. **PM greenlight condition** — explicit statement of what must hold before implementation.
4. **Updated PREBRIEF** — hardened with reviewer constraints, ready for implementation brief.

---

## 9. Forbidden During CHECKPOINT_2

- ❌ No export button, download, or signing code.
- ❌ No backend evidence service.
- ❌ No policy/approval coupling.
- ❌ No durable evidence report / system-of-record.
- ❌ No `run_id` / `trace_id`.
- ❌ No backend/Gateway/SQLite/schema changes.

Only documents and reviewer coordination are in scope.
