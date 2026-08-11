# CHECKPOINT_2 Feedback Taxonomy

> **Status**: READINESS_TOOLING_ONLY ✅
> **Date**: 2026-08-10
> **Program**: TRST Forward Planning & Readiness Program — Workstream A
> **Companion**: `CHECKPOINT_2-reviewer-response-intake-template.md`, `CHECKPOINT_2-synthesis-playbook.md`

## 0. Purpose

A fixed vocabulary for classifying real CHECKPOINT_2 reviewer feedback so synthesis is
consistent and fast. Each category maps to the relevant existing milestone / risk and to
a default synthesis disposition.

## 1. Category table

| Code | Category | Definition | Typical maps to | Default disposition hint |
|------|----------|------------|-----------------|---------------------------|
| CAT-SEC | security/privacy | Raw content leakage, weak hashing, identity gaps, privacy flag gaps | MWT-3B1, MWT-4E, Trust envelope | BLOCKER if leakage; else NON-BLOCKER |
| CAT-AUD | auditability | Missing tamper-evidence, unverifiable hash, gaps in evidence graph | Event envelope, MWT-4A, MWT-4B | BLOCKER if hash unverifiable |
| CAT-UX | UX/operator clarity | Confusing reviewer UI, unclear control badge, missing guidance | MWT-4A TaskEvidenceView, MWT-4B export UX | NON-BLOCKER / SUGGESTION |
| CAT-BAK | backend/schema/storage | Schema drift, missing persistence, migration concern | MWT-4B, MWT-4E, durable store | BLOCKER if schema gate needed |
| CAT-GW | Gateway/runtime | Gateway behavior, streaming, runtime smoke | Gateway, MWT-4B runtime | NON-BLOCKER unless silent behavior change |
| CAT-EXP | export/signing | Bundle format, signature, verification flow | MWT-4B | BLOCKER if signing contract unclear |
| CAT-TST | test/validation | Missing regression, flaky smoke, coverage gap | TRST validation governance | NON-BLOCKER / SUGGESTION |
| CAT-DOC | documentation-only | Docs unclear, missing pointer, wording | All docs | SUGGESTION / no-action |

## 2. Classification rules

- **One primary category per response.** If a response spans two, pick the dominant one
  and note the secondary in `PROPOSED ACTION`.
- **Severity is not the category.** BLOCKER/NON-BLOCKER/SUGGESTION is the *classification*
  field; the category above is the *topic*. Keep them separate.
- **When in doubt**, use CAT-DOC only if it is genuinely docs-only; otherwise escalate to
  the most relevant functional category and mark NON-BLOCKER for PM triage.

## 3. Mapping to risk register

| Category | Related consolidated risk IDs (see `TRST-risk-register.md`) |
|----------|-------------------------------------------------------------|
| CAT-SEC | R3 (identity primitive), R8 (live Gateway not in baseline) |
| CAT-AUD | R6 (approval tamper), R10 (schema gate) |
| CAT-UX | R5 (approval UI noise) |
| CAT-BAK | R1 (MWT-4B reviewer dependency), R10 (schema gate) |
| CAT-GW | R8 (live Gateway not in baseline) |
| CAT-EXP | R2 (export/signing scope boundary) |
| CAT-TST | R7 (NaN characterization), R9 (frontend render test gap) |
| CAT-DOC | — |

## 4. Non-goals

- ❌ Does not authorize implementation.
- ❌ Does not fabricate feedback.
- ❌ Does not replace PM severity judgment.

## 5. Validation implications

Documentation only. No `npm run validate` impact.
