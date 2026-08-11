# CHECKPOINT_2 Reviewer Packet (Outreach Kit)

**Status:** READY_FOR_REVIEWER_OUTREACH ✅ (2026-08-10, PM authorized)
**Purpose:** Standard packet to send to each recruited reviewer. Coordinate only — no implementation.
**Minimum reviewers required:** R1 Security + R2 Privacy + R3 Product. Optional: R4 Backend, R5 Compliance.

---

## Packet Contents (attach all to outreach message)

| # | File | Role in review |
|---|---|---|
| 1 | `CHECKPOINT_2-reviewer-recruitment-plan.md` | reviewer profiles, questions, artifacts, risk areas, acceptance, timeline, decision outputs |
| 2 | `MWT-4B-export-signing-prebrief.md` | hardened candidate scope (privacy/hash/trust boundary, no-signing, no-policy-coupling) |
| 3 | `MWT-4B-review-questionnaire.md` | the 8 canonical questions + sign-off block |
| 4 | `MWT-4B-risk-register.md` | 7 risks (R1–R7), ratings, mitigations |
| 5 | `MWT-4B-implementation-readiness-gate.md` | approval conditions + forbidden-before-greenlight list |
| 6 | `MWT-4A-closure-report.md` (optional) | context: what MWT-4A already shipped (read-only projection) |

---

## Reviewer Prompt (send verbatim)

```text
Please review MWT-4B Export/Signing prebrief for:
- privacy boundary
- raw content exclusion
- hash semantics
- unsigned export labeling
- frontend-only export acceptability
- attestation ambiguity
- metadata safety
- implementation readiness

Return:
1. APPROVE / APPROVE_WITH_REVISIONS / BLOCK
2. Required revisions
3. Risk concerns
4. Go/no-go recommendation for MWT-4B implementation
```

---

## Reviewer Role Mapping

| Role | Profile | Minimum? |
|---|---|---|
| R1 | Security / Integrity reviewer | **Required** |
| R2 | Privacy / Data Minimization reviewer | **Required** |
| R3 | Product / UX reviewer | **Required** |
| R4 | Backend / Architecture reviewer | Optional |
| R5 | Compliance / Audit Semantics reviewer | Optional |

---

## Outreach Checklist

- [ ] Identify R1 / R2 / R3 candidates (internal or external)
- [ ] Send packet (6 files) + prompt
- [ ] Set response deadline per recruitment plan timeline
- [ ] Track returns in `CHECKPOINT_2-review-synthesis.md` (create on first return)
- [ ] If a required role cannot be filled: open `CHECKPOINT_2-reviewer-gap-report.md`

---

## Notes

- Reviewer outreach is a human coordination action. The agent prepares and stages this packet;
  actual sending + collection happens via PM / human coordination channels.
- Under no circumstance does packaging or outreach authorize MWT-4B implementation.
- Implementation stays NOT_AUTHORIZED ❌ until `MWT-4B-implementation-readiness-gate.md` passes
  and PM issues `APPROVE_MWT-4B_IMPLEMENTATION`.
