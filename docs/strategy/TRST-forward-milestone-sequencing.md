# TRST Forward Milestone Sequencing

> **Status**: SEQUENCING_RECOMMENDATION ✅ (not an authorization)
> **Date**: 2026-08-10
> **Program**: TRST Forward Planning & Readiness Program — Workstream F
> **Companion**: `TRST-risk-register.md`, `MWT-5-decision-record-draft.md`,
> `MWT-4B-implementation-readiness-packet.md`
> **Note**: This is a RECOMMENDED route, not PM approval. Each step still requires the
> explicit authorization called out.

## 0. Purpose

Lay out the forward route so MWT-4B, MWT-4E, MWT-5 do not step on each other. Clear
separation: what can proceed before reviewer feedback, what cannot, what needs PM.

## 1. Current sealed milestones (done)

- MWT-3B1 control layer — SEALED ✅
- MWT-4A evidence projection — SEALED ✅
- TRST validation baseline — 7/7 GREEN ✅
- Sealed-flow quality sprint — ACCEPTED ✅

## 2. Pending milestones

| Milestone | State | Blocked by |
|-----------|-------|------------|
| MWT-4B (export/signing) | NOT_AUTHORIZED | reviewer feedback + PM G1–G5 |
| MWT-4E (identity) | NOT STARTED | PM charter |
| MWT-5 (approval dry-run) | PREBRIEF_ACCEPTED, impl NOT authorized | PM D1–D5 answers |
| MWT-7 (productionization) | FUTURE | post-4B/4E/5 |

## 3. Dependencies

```text
MWT-4B  ── independent of MWT-4E/MWT-5 (read-side consumer of sealed events)
MWT-4E  ── independent of MWT-4B; feeds MWT-5 identity later if D1=O2
MWT-5   ── depends on MWT-4B only conceptually (both read sealed events); no hard dep
MWT-7   ── depends on all of the above being sealed + validated
```

## 4. What can proceed BEFORE reviewer feedback

- ✅ This Readiness Program (docs-only) — DONE.
- ✅ Reviewer intake + synthesis tooling (Workstream A).
- ✅ MWT-4B readiness packet / AC / boundaries / test strategy (Workstream B).
- ✅ MWT-5 decision framing (Workstream C).
- ✅ Validation governance + regression guide (Workstream D).
- ✅ Risk register consolidation (Workstream E).
- ✅ This sequencing map (Workstream F).

## 5. What CANNOT proceed before reviewer feedback

- ❌ MWT-4B implementation (needs CHECKPOINT_2 feedback + PM G1–G5).
- ❌ Any product/backend/schema/Gateway code change.
- ❌ MWT-5 implementation (needs PM D1–D5 answers).

## 6. What requires PM decision

| Decision | Unlocks |
|----------|---------|
| CHECKPOINT_2 feedback synthesized + approve MWT-4B (G1–G5) | MWT-4B implementation |
| MWT-5 D1–D5 answers | MWT-5 implementation brief |
| Adopt R10 schema-gate rule | standing schema protection |
| MWT-4E charter | identity milestone |

## 7. Proposed order (recommendation, not authorization)

```text
STEP 1  CHECKPOINT_2 reviewer synthesis
          └─ intake → taxonomy → disposition (D-A..D-E)
STEP 2  MWT-4B implementation   (IF PM approves G1–G5)
          └─ readiness packet → impl → validate
STEP 3  MWT-4B validation
          └─ add MWT-4B Smoke + Regression to npm run validate; 9/9 green
STEP 4  MWT-4E                   (IF PM charters; optional before MWT-5)
          └─ identity primitive
STEP 5  MWT-5 decision record
          └─ PM answers D1–D5 → signed record
STEP 6  MWT-5 implementation brief
          └─ only after STEP 5 signed
STEP 7  MWT-7 productionization  (FUTURE, post all above)
```

## 8. Sequencing guardrails

- MWT-5 must NEVER introduce a new `TrstEventType` (R10) — sidecar only.
- MWT-4B must NEVER become enforcement (stays export only).
- MWT-5 must stay advisory until PM explicitly moves D5 to O2/O3.
- No milestone may break the 7/7 baseline without adding its own green sections.

## 9. Validation implications

Documentation only. No `npm run validate` impact. When STEP 2/3 and STEP 6 add scripts,
`npm run validate` must run and the baseline table in `TRST-validation-governance.md`
updated.
