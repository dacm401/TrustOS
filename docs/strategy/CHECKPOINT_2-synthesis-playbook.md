# CHECKPOINT_2 Synthesis Playbook

> **Status**: READINESS_TOOLING_ONLY ✅
> **Date**: 2026-08-10
> **Program**: TRST Forward Planning & Readiness Program — Workstream A
> **Companion**: `CHECKPOINT_2-reviewer-response-intake-template.md`, `CHECKPOINT_2-feedback-taxonomy.md`

## 0. Purpose

Convert each classified reviewer response into exactly one disposition type, so the PM
sees a clean, decision-ready list instead of free-form notes. This is the *translation*
step between intake and PM decision.

## 1. The five disposition types

| Disposition | Meaning | When to use |
|-------------|---------|-------------|
| D-A BLOCKER | Must resolve before next gate; requires PM decision + likely implementation | Response is CAT-SEC/CAT-AUD/CAT-EXP and breaks a sealed contract or privacy guarantee |
| D-B SCOPE-ADJUST | Changes what a milestone includes; no new charter needed, but re-scope | Response reveals a missing AC or boundary that fits an authorized milestone |
| D-C ACCEPTED-RISK | Known limitation; consciously accept and document | Response names a gap we already decided to defer (see risk register) |
| D-D DEFERRED | Out of current scope; track for a future charter | Response targets MWT-4E/MWT-5/MWT-7 or a not-yet-authorized area |
| D-E NO-ACTION | Acknowledged, no change needed | Response is mistaken, already covered, or CAT-DOC wording-only |

## 2. Decision flow (apply per response)

```text
1. Is it a BLOCKER on a sealed contract (privacy/audit/hash)? ──YES──► D-A BLOCKER
                                                          │
                                                          NO
2. Does it fit an authorized milestone's scope (MWT-4A/3B1/4B-if-approved)? ──YES──► D-B SCOPE-ADJUST
                                                          │
                                                          NO
3. Is the gap already an accepted/known risk in TRST-risk-register.md? ──YES──► D-C ACCEPTED-RISK
                                                          │
                                                          NO
4. Does it target MWT-4E / MWT-5 / MWT-7 / not-yet-authorized? ──YES──► D-D DEFERRED
                                                          │
                                                          NO
5. Otherwise ──► D-E NO-ACTION (with one-line rationale)
```

## 3. Output format (one row per response)

```text
RESPONSE: <reviewer> <date>
CATEGORY: <CAT-XXX from taxonomy>
CLASS:    <BLOCKER | NON-BLOCKER | SUGGESTION>
DISPOSITION: <D-A | D-B | D-C | D-D | D-E>
PM DECISION NEEDED: <explicit question or "none">
TRACKED IN: <risk ID | milestone | "n/a">
```

## 4. Synthesis acceptance criteria

- [ ] Every response gets exactly one disposition (no mixing).
- [ ] Every D-A BLOCKER names the required PM decision.
- [ ] Every D-C ACCEPTED-RISK cites the risk ID it maps to.
- [ ] Every D-D DEFERRED names the future charter it belongs to.
- [ ] Output is appended to the synthesis log in `TRST-execution-log.md`.

## 5. Non-goals

- ❌ Does not implement anything.
- ❌ Does not fabricate reviewer feedback.
- ❌ Does not let the Agent decide BLOCKER severity — PM confirms all D-A.

## 6. Validation implications

Documentation only. No `npm run validate` impact.
