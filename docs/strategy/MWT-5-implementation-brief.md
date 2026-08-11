# MWT-5 Implementation Brief

> **Status**: IMPLEMENTED ✅ (decisions signed; code complete; 11/11 validate PASS)
> **Date**: 2026-08-11
> **Program**: TRST autonomous completion mandate
> **Companion**: `MWT-5-decision-record.md`, `MWT-5-architecture-prebrief.md`
> **Scope guard**: advisory only; frontend-only sidecar; no new TrstEventType.

## 0. Purpose

This document originally served as the implementation brief. As of 2026-08-11, the brief
has been executed as the MWT-5 advisory frontend-only sidecar implementation under the
autonomous completion mandate. It is retained as the implementation rationale and build
trace. The decision record (`MWT-5-decision-record.md`) carries the D1–D5 defaults, which
are `SIGNED_BY_AGENT_DEFAULTS_PENDING_PM_RATIFICATION` and are NOT yet a PM final sign-off.

## 1. Decisions in force (from `MWT-5-decision-record.md`)

- D1 O1: MWT-5 before MWT-4E
- D2 O1: append-only JSONL sidecar (client-side artifact — see §10 persistence note)
- D3 O1: opaque `approver_id`
- D4 O2+O3: sidecar record, no new event type, global schema gate
- D5 O1: advisory only

## 2. Build sequence (executed)

```text
SEQ-1  Define ApprovalRecord type (approver_id, target_ref, decision, note, ts, prev_hash)   ✅
SEQ-2  Implement buildApprovalRecord* → produces record with chained prev_hash                ✅
SEQ-3  Implement verifyApprovalChain* → validates hash chain integrity                        ✅
SEQ-4  Frontend: advisory approval action on TaskEvidenceView (no blocking)                   ✅
SEQ-5  Tests: append determinism, chain verify, tamper detection, no event-type added         ✅
SEQ-6  Integrate MWT-5 Smoke + Regression into npm run validate                                ✅
```

## 3. Validation sequence

- Pure deterministic regression on append + hash-chain (mirrors MWT-4B).
- Privacy negative: no raw content in approval record.
- Frontend build + typecheck; backend typecheck untouched (no backend change).
- Added sections 10/11 to `scripts/trst/run-validation.mts`.

## 4. Rollback / fallback

- Sidecar JSONL is additive; deleting it reverts to no-approval state with zero impact
  on sealed flows. No migration to roll back.

## 5. Non-goals (hard)

- ❌ No MWT-4E identity integration.
- ❌ No policy engine / enforcement.
- ❌ No new `TrstEventType`.
- ❌ No signature/PKI.

## 6. Readiness status

| Item | Status |
|------|--------|
| Decisions signed (agent defaults) | ⚠️ pending PM ratification |
| Type defined | ✅ (`ApprovalRecord`, `ApprovalDecision`) |
| Writer/reader (append + verify chain) | ✅ (`approval-record.ts`) |
| Frontend action (advisory, non-blocking) | ✅ (`TaskEvidenceView` 审批面板) |
| Tests (smoke 9 + regression 17) | ✅ (`scripts/mwt5/`) |

## 7. Validation implications

- Integrated into `npm run validate` as sections 10/11 (MWT-5 Smoke + Regression).
- Baseline extended: 9/9 → **11/11 PASS** (2026-08-11).
- No backend typecheck impact (frontend-only module). No new dependency.
