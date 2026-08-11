# MWT-5 Prebrief — Policy / Approval

**Status:** NOT_AUTHORIZED ❌ (planning only; implementation NOT authorized)
**Date:** 2026-08-10
**Based on:** MWT-4A SEALED ✅, MWT-3B1 Control layer (allow/deny/unknown)

## 1. Purpose

MWT-4A surfaces `control_decision` (allow/deny/unknown) as a **read-only display**.
MWT-5 would add the human-in-the-loop **approval** layer: a reviewer can act on a
`deny`/`unknown` decision (approve / reject / request changes) and have that decision
recorded and propagated. This prebrief scopes the candidate; it does NOT authorize
implementation.

## 2. Candidate Scope

- Reviewer action surface on `TaskEvidenceView` / event timeline for `deny`/`unknown`.
- Approval record: who, when, decision, optional note.
- Propagation target: Gateway Control layer (MWT-3B1 `control_decision`) — requires
  a new or extended backend endpoint (out of MWT-4A's frontend-only scope).
- Audit trail: approvals must be tamper-evident (ties to Evidence Graph / Event Backbone).

## 3. Non-Goals (must not expand without new PM charter)

- ❌ No enforcement engine — MWT-5 is approval capture, not blocking enforcement.
- ❌ No new policy DSL in this prebrief (policy authoring is a later charter).
- ❌ No `run_id` / `trace_id` introduction.
- ❌ No raw content exposure in approval UI.
- ❌ No export/signing (see MWT-4B).

## 4. Dependency Note

MWT-5 inherently requires **backend state** (approval records) and likely an
**authenticated identity** (MWT-4E candidate from TRST-4 charter family). It is
therefore downstream of both:
- MWT-4E (Authenticated Identity) — to know *who* approved.
- A durable, tamper-evident store — to record *what* was approved.

Per the frozen TRST principle *"evidence/reporting first → identity/policy →
enforcement last"*, MWT-5 sits in the **policy** tier and should follow identity work.

## 5. Open Questions for PM

1. Is approval capture needed for Private Beta, or is read-only control display (MWT-4A)
   sufficient for the first reviewer cohort?
2. Where do approvals persist: extend Gateway event store, or a new approval table?
3. Does approval require authenticated identity first (blocking on MWT-4E)?
4. Is "approve" advisory (recorded) or enforcing (blocks downstream task)?

## 6. Proposed AC Skeleton (draft, not final)

| AC | Draft |
|---|---|
| AC1 | Reviewer can act on deny/unknown event |
| AC2 | Approval recorded with identity + timestamp |
| AC3 | Approval visible in timeline |
| AC4 | No enforcement/blocking in MWT-5 |
| AC5 | Tamper-evident record |
| AC6 | No raw content in approval UI |
| AC7 | Backend change scoped + documented |
| AC8 | Frontend build + typecheck pass |

## 7. Recommendation

Keep as prebrief. Do not implement until identity (MWT-4E) and durable store strategy
are chartered. Priority tier: **policy** (after evidence/reporting + identity).

## 8. Authorization State

```text
MWT-5 implementation: NOT_AUTHORIZED ❌
Only planning / prebrief authorized.
```
