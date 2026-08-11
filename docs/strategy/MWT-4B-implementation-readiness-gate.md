# MWT-4B Implementation Readiness Gate (CHECKPOINT_2)

**Status:** DRAFT gate definition (2026-08-10)
**Companion docs:** `MWT-4B-export-signing-prebrief.md` (hardened), `MWT-4B-review-questionnaire.md`,
`MWT-4B-risk-register.md`, `CHECKPOINT_2-reviewer-recruitment-plan.md`
**Purpose:** Define the explicit conditions that MUST hold before MWT-4B implementation may start.
Until the gate is PASS, implementation remains **NOT_AUTHORIZED ❌**.

---

## 1. Minimum Reviewer Approvals (entry condition)

MWT-4B implementation brief may be drafted ONLY after:

- [ ] **R1 Privacy** reviewer: approves `SAFE_META_KEYS` allow-list + exclusion list. (Required)
- [ ] **R2 Security** reviewer: approves unsigned/hash-only posture + labeling. (Required)
- [ ] **R3 Product** reviewer: approves "client-generated, unsigned" label clarity. (Required)
- [ ] R4 Backend + R5 Compliance: reviewed and no unmitigated high-risk conflict. (Strongly recommended)

Minimum viable: **R1 + R2 + R3 all approved, zero unmitigated High risks.**

---

## 2. Required Brief Revisions (before implementation authorization)

The hardened prebrief must, post-review, include final answers to:

- [ ] Export format decision: JSON / Markdown / both (resolves Open Q1).
- [ ] Unsigned frontend-only export accepted for Private Beta (resolves Open Q2, PM default YES).
- [ ] Bundle location: browser download vs reviewer attachment (resolves Open Q3).
- [ ] Explicit reviewer confirmation step required? (resolves Open Q4).
- [ ] Final metadata allow-list + exclusion list (resolves Open Q5/Q7).
- [ ] Signing deferral statement + future model placeholder (resolves Open Q6 / Q8).
- [ ] AC skeleton promoted from draft (§12) to final, with privacy + labeling ACs enforced.

---

## 3. Explicit PM Greenlight Condition

Implementation may START only when ALL hold:

1. CHECKPOINT_2 reviewer recruitment completed (≥3 reviewers, R1+R2+R3 min).
2. `MWT-4B-risk-register.md` reviewed; all High risks have mitigation or PM-accepted residual posture.
3. Prebrief hardened and revised per Section 2 above.
4. No Critical (≥15) risk remains open.
5. PM issues explicit directive: **`APPROVE_MWT-4B_IMPLEMENTATION`**.

Without condition 5, the default state is **NOT_AUTHORIZED ❌**.

---

## 4. Forbidden Implementation Before Greenlight

The following MUST NOT exist in code before PM greenlight:

- ❌ Export button / download action in `TaskEvidenceView`
- ❌ Any serialization of events to file/blob
- ❌ Signing code / crypto signature generation
- ❌ Backend endpoint for export or signing
- ❌ Policy / approval coupling to export
- ❌ Durable evidence report / system-of-record write
- ❌ `run_id` / `trace_id` introduction
- ❌ Any backend/Gateway/SQLite/schema change

Only documentation, prebrief hardening, and reviewer coordination are permitted now.

---

## 5. Gate Verdict Template (filled at CHECKPOINT_2 close)

```text
MWT-4B Implementation Readiness Gate:

  Reviewers engaged:     ___ / 3 minimum (R1+R2+R3)
  High risks mitigated:  ___ / ___ (all High covered?)
  Critical risks open:   0 required
  Prebrief revised:      YES / NO
  PM greenlight:         APPROVE_MWT-4B_IMPLEMENTATION / HOLD

  VERDICT: PASS / FAIL / HOLD
```

---

## 6. Relationship to Long-Range Roadmap

- MWT-4B sits between MWT-4A (SEALED) and MWT-5 (policy/approval, NOT_STARTED).
- Signing, if later required, depends on an identity/key model that is OUT of MWT-4B scope
  and likely belongs to a future TRST-4E (Authenticated Identity) or MWT-5 follow-on.
- Export must never implicitly advance MWT-5 — gate §4 forbids policy coupling.

---

*This gate is documentation only. It does not authorize implementation. PM greenlight is the
single authoritative trigger.*
