# TRST Validation Governance

> **Status**: GOVERNANCE_BASELINE ✅
> **Date**: 2026-08-10
> **Program**: TRST Forward Planning & Readiness Program — Workstream D
> **Scope guard**: documents the existing `npm run validate` gate as a reusable milestone gate.

## 0. Purpose

Turn the current validation setup into a reusable gate specification for every future
milestone, so validation discipline is preserved and extended consistently.

## 1. Canonical command

```bash
npm run validate
```

Defined in backend `package.json`:
```json
"validate": "npx tsx scripts/trst/run-validation.mts"
```

## 2. Current baseline (frozen reference)

| # | Section | Expected result |
|---|---------|-----------------|
| 1 | Frontend Typecheck | 0 errors |
| 2 | Frontend Build | PASS |
| 3 | MWT-4A Smoke | 26/0/0 |
| 4 | MWT-4A Regression | 57/0 |
| 5 | MWT-3B1 Regression | 24/0 |
| 6 | MWT-3B1 Smoke | 8/8 + 1 SKIP |
| 7 | Backend Typecheck | 0 errors |

Aggregator rule: any section `failed > 0` → process exits non-zero. Sectioned output +
final summary.

## 3. Rules for adding future regressions

1. **Deterministic** — same input → same output; no clock/random in assertions.
2. **Fixture-based when possible** — load a committed fixture, not live services.
3. **No live Gateway dependency unless explicitly marked** — live smoke is non-gating.
4. **Privacy negative tests required** — any artifact touching sealed events must assert
   no raw content leakage.
5. **Non-zero exit on failure** — aggregator fails closed.
6. **Sectioned output** — each milestone gets its own numbered section.
7. **Final summary** — one-line per section + overall pass/fail count.

## 4. Adding a new section (procedure)

```text
1. Create scripts/<milestone>/run-<type>.mts (smoke or regression).
2. Ensure it prints a section header and exits non-zero on failure.
3. Append the step to STEPS in scripts/trst/run-validation.mts.
4. Run npm run validate locally; confirm new section green + baseline unchanged.
5. Update this doc's baseline table + TRST-execution-log.md.
```

## 5. Future milestone validation templates

### MWT-4B (when authorized)
| # | Section | Command |
|---|---------|---------|
| 8 | MWT-4B Smoke | `npx tsx scripts/mwt4b/run-smoke.mts` |
| 9 | MWT-4B Regression | `npx tsx scripts/mwt4b/run-regression.mts` |

New assertions: bundle field set, hash-manifest stability, privacy negative, event-count parity.

### MWT-5 (when authorized)
| # | Section | Command |
|---|---------|---------|
| +1 | MWT-5 Smoke | `npx tsx scripts/mwt5/run-smoke.mts` |
| +2 | MWT-5 Regression | `npx tsx scripts/mwt5/run-regression.mts` |

New assertions: approval record append, hash-chain verify, advisory-only (no downstream gating), no new event type.

### MWT-4E (if applicable)
| # | Section | Command |
|---|---------|---------|
| +3 | MWT-4E Smoke | `npx tsx scripts/mwt4e/run-smoke.mts` |

New assertions: identity primitive present, no schema drift, no raw content.

## 6. Non-goals

- ❌ Does not itself run validation (run `npm run validate`).
- ❌ Does not authorize any implementation.
- ❌ Does not change the canonical command.

## 7. Validation implications

This is the governance doc. If `run-validation.mts` or `package.json` change (e.g. adding
sections at implementation time), `npm run validate` MUST be run and the baseline table
updated here.
