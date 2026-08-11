# TRST Blocked Work Register

> **Status**: DOCUMENTATION_ONLY ✅ — authoritative list of currently blocked work.
> **Last updated**: 2026-08-10

---

## 1. MWT-4B Implementation

- **Status**: NOT_AUTHORIZED ❌
- **Why blocked**: Readiness Pack accepted, but awaits external reviewer feedback + `APPROVE_MWT-4B_IMPLEMENTATION`.
- **Unlock condition**: CHECKPOINT_2 synthesis complete + no BLOCK from min R1/R2/R3 (or PM accepts residual risk) + PM greenlight.
- **Risk if bypassed**: premature trust primitive (unsigned export could be misread as attestation); privacy leak if raw content sneaks in.

## 2. Export / Download Button

- **Status**: NOT_AUTHORIZED ❌
- **Why blocked**: part of MWT-4B; no implementation until greenlit.
- **Unlock condition**: MWT-4B implementation authorized.
- **Risk if bypassed**: unsigned artifact mistaken for certified evidence; scope creep into backend/durable store.

## 3. Signing

- **Status**: FORBIDDEN ❌
- **Why blocked**: no identity/key model exists; non-goal for v0.
- **Unlock condition**: separate PM charter (future TRST-4 / MWT track) + identity model.
- **Risk if bypassed**: false cryptographic assurance without key management; tamper-proof overclaim (architecture says tamper-EVIDENT only).

## 4. Backend Evidence / Signing Service

- **Status**: FORBIDDEN ❌
- **Why blocked**: MWT-4B is frontend-only projection; no backend service.
- **Unlock condition**: separate charter + PM approval.
- **Risk if bypassed**: new trust primitive without governance; violates "Evidence Graph / Event Backbone, not service" architecture.

## 5. Durable Evidence Report

- **Status**: FORBIDDEN ❌
- **Why blocked**: export is transient client snapshot; TrustOS does not persist as system-of-record.
- **Unlock condition**: separate charter (TRST-4C already covers durable index; report persistence needs its own scope).
- **Risk if bypassed**: implies system-of-record attestation; privacy/retention scope creep.

## 6. MWT-5 Policy / Approval

- **Status**: PREBRIEF_ACCEPTED_DIRECTIONAL_ONLY ⚠️ (NOT_STARTED, blocked)
- **Why blocked**: depends on identity model + reviewer validation; out of current gate.
- **Unlock condition**: MWT-4B resolved + PM MWT-5 charter + greenlight.
- **Risk if bypassed**: policy/enforcement before observation completeness; overclaim of governance.

## 7. run_id / trace_id

- **Status**: FORBIDDEN ❌
- **Why blocked**: deferred by PM (Option C = task_id only); needs deeper review.
- **Unlock condition**: separate object-model review + PM approval.
- **Risk if bypassed**: identity/linking semantics undefined; potential privacy/linkability leak.

## 8. Compliance Attestation

- **Status**: FORBIDDEN ❌
- **Why blocked**: non-goal; no certification authority in product.
- **Unlock condition**: separate compliance charter.
- **Risk if bypassed**: regulatory overclaim; unsupported certification.

## 9. v1 Stash Restoration

- **Status**: FORBIDDEN ❌
- **Why blocked**: unapproved MWT-3 object-model spike must stay isolated.
- **Unlock condition**: explicit PM stash-pop approval (unlikely; spike is reference only).
- **Risk if bypassed**: unvetted code into mainline; schema/route sprawl.

---

**Cross-reference**: `MWT-4B-export-non-goals.md` lists MWT-4B non-goals; `TRST-current-gate-snapshot.md` lists live gate; `TRST-next-decision-options.md` lists how to unblock.
