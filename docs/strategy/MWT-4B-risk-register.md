# MWT-4B Risk Register (CHECKPOINT_2)

**Status:** DRAFT for reviewer calibration (2026-08-10)
**Companion docs:** `MWT-4B-export-signing-prebrief.md`, `MWT-4B-review-questionnaire.md`
**Scope note:** Risks below apply to the *candidate* MWT-4B (frontend-only, unsigned export).
They are mitigated by the hardened prebrief boundaries; residual risk informs the readiness gate.

Rating scale: Likelihood (L) 1–5, Impact (I) 1–5, Score = L×I. Severity: ≥15 Critical, 9–14 High, 4–8 Medium, ≤3 Low.

---

## R1 — Raw Data Leak (Privacy)

- **Description:** Exported bundle inadvertently includes raw prompt / completion / tool payloads.
- **Likelihood:** 2 — prebrief mandates `SAFE_META_KEYS` only; but serialization bug could widen surface.
- **Impact:** 5 — direct privacy violation, regulatory exposure.
- **Score:** 10 (High)
- **Mitigation:**
  - Serialize ONLY `SAFE_META_KEYS` allow-list; unit test asserts no extra key present.
  - Smoke test injects a mock event with raw fields and asserts they are absent from output.
  - Code review gate: any field outside allow-list requires prebrief revision + PM re-auth.
- **Owner:** R1 Privacy reviewer.

## R2 — False Attestation (Integrity)

- **Description:** Recipient interprets an unsigned export as TrustOS/Gateway-endorsed or "verified".
- **Likelihood:** 3 — unsigned artifacts are often assumed trusted by non-experts.
- **Impact:** 4 — undermines trust model, false assurance.
- **Score:** 12 (High)
- **Mitigation:**
  - Mandatory label "Client-generated, unsigned evidence projection" in JSON + Markdown.
  - Prebrief forbids "verified"/"attested"/"approved" wording in bundle.
  - Product reviewer validates label prominence (Q4).
- **Owner:** R2 Security + R3 Product.

## R3 — Hash Misinterpretation (Reviewer Trust)

- **Description:** Reviewer believes `event_hash` proves store authenticity, not just self-consistency.
- **Likelihood:** 3 — hashes look authoritative.
- **Impact:** 3 — over-trust of a snapshot.
- **Score:** 9 (High)
- **Mitigation:**
  - Document that hashes are integrity hints, not attestations (prebrief §5).
  - Bundle includes `bundle_hash` clearly marked self-describing/client-computed.
  - Reviewer guide states verification requires independent event-store access.
- **Owner:** R2 Security.

## R4 — User Trust Boundary Confusion (Product)

- **Description:** User/revwer confuses projection snapshot with system-of-record.
- **Likelihood:** 3
- **Impact:** 3
- **Score:** 9 (High)
- **Mitigation:**
  - Export header states "projection snapshot, not system-of-record".
  - No DB/store write on export; read-only path only.
  - UX copy reviewed by R3.
- **Owner:** R3 Product.

## R5 — Replay / Tamper (Security)

- **Description:** Exported bundle is modified or replayed after generation; no signature to detect it.
- **Likelihood:** 4 — files are trivially editable.
- **Impact:** 3 — recipient may act on altered snapshot.
- **Score:** 12 (High)
- **Mitigation:**
  - `bundle_hash` lets a careful reviewer detect post-export edits (self-consistency only).
  - Prebrief documents this is accepted for Private Beta; signing deferred (§7).
  - Reviewer acknowledgement that unsigned = editable by design.
- **Owner:** R2 Security.

## R6 — Policy Conflation (Export ≠ Approval)

- **Description:** Export is read as a policy/approval decision (MWT-5 scope bleed).
- **Likelihood:** 2
- **Impact:** 4 — false governance signal.
- **Score:** 8 (Medium)
- **Mitigation:**
  - Prebrief §8: export independent of enforcement; `control_decision` exported as observed data only.
  - No approval UI coupled to export.
  - Label clarifies "export is not an approval".
- **Owner:** R2 Security + R5 Compliance.

## R7 — Privacy / Regulatory Exposure (Compliance)

- **Description:** Even hashed/metadata export could enable re-identification or violate retention policy.
- **Likelihood:** 2
- **Impact:** 5 — regulatory / audit failure.
- **Score:** 10 (High)
- **Mitigation:**
  - Field allow-list minimization (R1).
  - `privacy_flags` exported as boolean summary only.
  - Compliance reviewer (R5) ratifies allow-list + exclusion list.
  - No PII fields exist in Gateway events by design (TRST-0.3 privacy posture).
- **Owner:** R5 Compliance + R1 Privacy.

---

## Risk Summary

| ID | Risk | Score | Severity | Status |
|---|---|---:|---|---|
| R1 | Raw data leak | 10 | High | Mitigated (allow-list + smoke) |
| R2 | False attestation | 12 | High | Mitigated (label + wording ban) |
| R3 | Hash misinterpretation | 9 | High | Mitigated (docs) |
| R4 | Trust boundary confusion | 9 | High | Mitigated (header + read-only) |
| R5 | Replay / tamper | 12 | High | Accepted-for-Private-Beta (unsigned by design) |
| R6 | Policy conflation | 8 | Medium | Mitigated (no coupling) |
| R7 | Privacy / regulatory | 10 | High | Mitigated (minimization + R5 ratify) |

**All High risks have a defined mitigation or explicit PM-accepted residual posture.**
No Critical (≥15) risks. Implementation may proceed to brief stage only after reviewer sign-off
(see `MWT-4B-implementation-readiness-gate.md`).
