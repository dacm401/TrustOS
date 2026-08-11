# CHECKPOINT_2 Reviewer Response — Intake Template

> **Status**: READINESS_TOOLING_ONLY ✅ (no reviewer feedback fabricated)
> **Date**: 2026-08-10
> **Program**: TRST Forward Planning & Readiness Program — Workstream A
> **Scope guard**: template + mechanism only; no product code, no feedback content invented.

## 0. Purpose

Define a single, repeatable structure for capturing real CHECKPOINT_2 reviewer feedback
so that each response can be ingested, categorized, and translated into a PM decision
quickly. This template is the *form* reviewers (or the Agent, when relaying) fill in.
It does not pre-judge content.

## 1. Reviewer Response Template (fill one per reviewer response)

```text
=== CHECKPOINT_2 REVIEWER RESPONSE ===

1. REVIEWER IDENTITY / ROLE
   - Name/handle (or "Anonymous #N" if external):
   - Role: [Internal PM | Internal Engineer | External Beta Reviewer | Security Auditor | Other]
   - Reviewer cohort: [Cohort-A Technical | Cohort-B Governance | Cohort-C Security]

2. FEEDBACK CATEGORY
   - [ ] security/privacy
   - [ ] auditability
   - [ ] UX/operator clarity
   - [ ] backend/schema/storage
   - [ ] Gateway/runtime
   - [ ] export/signing
   - [ ] test/validation
   - [ ] documentation-only

3. CLASSIFICATION
   - [ ] BLOCKER      (must resolve before next gate)
   - [ ] NON-BLOCKER  (should resolve, not gating)
   - [ ] SUGGESTION   (nice-to-have / future)

4. AFFECTED MILESTONE
   - [ ] MWT-4A evidence projection
   - [ ] MWT-3B1 control layer
   - [ ] MWT-4B export/signing (if raised)
   - [ ] MWT-4E identity
   - [ ] MWT-5 approval
   - [ ] TRST validation/governance
   - [ ] Docs only
   - [ ] Other: _______

5. REQUIRED PM DECISION
   - What specifically does the PM need to decide?
   - e.g. "Approve MWT-4B start", "Clarify approval persistence model", "Accept risk R4"

6. PROPOSED ACTION (Agent suggestion, not commitment)
   - Concrete next step if this feedback is accepted.
   - e.g. "Add regression guard for X", "Extend intake taxonomy with Y", "Defer to MWT-4E"

7. EVIDENCE LINK
   - Source: [chat transcript | email | issue tracker | recorded session]
   - Pointer: _______
   - Date received: _______

8. RAW QUOTE (verbatim, if available)
   > "..."

=== END RESPONSE ===
```

## 2. How to use this template

1. When a real reviewer response arrives, copy the block above into a new dated file
   `docs/strategy/CHECKPOINT_2-responses/<YYYYMMDD>-<reviewer>.md`.
2. Fill every numbered field. Do not skip classification (BLOCKER/NON-BLOCKER/SUGGESTION).
3. Run it through `CHECKPOINT_2-feedback-taxonomy.md` to confirm the category.
4. Apply `CHECKPOINT_2-synthesis-playbook.md` to convert it into one of the 5 disposition types.
5. Append a one-line entry to the response log in `TRST-execution-log.md`.

## 3. Intake acceptance criteria

- [ ] Every response has a reviewer identity/role (even if "Anonymous #N").
- [ ] Every response has exactly one primary feedback category.
- [ ] Every response is classified BLOCKER / NON-BLOCKER / SUGGESTION.
- [ ] Every BLOCKER names the required PM decision explicitly.
- [ ] Every response links to evidence or states "no link".

## 4. Non-goals

- ❌ This template does NOT authorize any implementation.
- ❌ This template does NOT fabricate reviewer feedback.
- ❌ This template does NOT replace PM judgment on dispositions.

## 5. Validation implications

Pure documentation. No `npm run validate` impact. This file is part of the
reviewer-intake readiness system, not the sealed-flow code gate.
