# TRST Regression Expansion Guide

> **Status**: GOVERNANCE_BASELINE ✅
> **Date**: 2026-08-10
> **Program**: TRST Forward Planning & Readiness Program — Workstream D
> **Companion**: `TRST-validation-governance.md`

## 0. Purpose

A how-to for expanding the sealed-flow regression suite without breaking the
deterministic, privacy-safe discipline established by MWT-4A (57/0) and MWT-3B1 (24/0).

## 1. Principles (hard rules)

1. **Deterministic** — no `Date.now()`, no `Math.random()`, no network in assertions.
2. **Fixture-based** — commit the input fixture; assert against known output.
3. **Characterization over assumption** — if current behavior is surprising (e.g. NaN
   propagation in MWT-4A R13), assert the *actual* behavior and note it; do not silently
   "fix" semantics in a regression test.
4. **Privacy negative required** — any test touching sealed events must include at least
   one assertion that raw content is absent.
5. **Fail closed** — test process exits non-zero on any failed check.
6. **Sectioned + summarized** — integrate into `npm run validate`.

## 2. Step-by-step (per new regression)

```text
1. Decide the milestone + behavior under test.
2. Create a committed fixture (e.g. scripts/<m>/fixtures/sample.jsonl).
3. Write scripts/<m>/run-regression.mts:
   - import sealed pure functions (read-only) where possible
   - load fixture, run transformation, assert
   - print "R<n>: <name>" per check
   - count pass/fail, exit(1) if fail>0
4. Append to STEPS in scripts/trst/run-validation.mts.
5. Run npm run validate; confirm green + baseline unchanged.
6. Document the new section in TRST-validation-governance.md.
```

## 3. Naming + counting convention

- Smoke: `scripts/<m>/run-smoke.mts` — happy-path, few assertions, fast.
- Regression: `scripts/<m>/run-regression.mts` — many assertions, characterization.
- Each check printed as `R<num>: <description>` so failures are traceable.
- Skip is allowed but must be explicit (`SKIP` + reason), like MWT-3B1's 1 SKIP.

## 4. Anti-patterns to avoid

- ❌ Asserting "what should be" instead of "what is" for sealed behavior.
- ❌ Live Gateway calls inside a deterministic section.
- ❌ Silent catch that hides a failed check.
- ❌ Raw content substring appearing in a fixture used for positive assertions.
- ❌ Editing `event-envelope.ts` `TrstEventType` without a schema-gate decision.

## 5. Examples from current baseline

- MWT-4A R13: asserts `Number.isNaN` propagation (characterization of current contract).
- MWT-3B1 R1–R10: deterministic sealed-event hashing + `extractTaskId` behavior.
- MWT-3B1 1 SKIP: `jsonl-event-store.ts` intentionally skipped (filesystem-coupled).

## 6. Validation implications

If this guide's procedure is followed at implementation time, `npm run validate` must be
run after adding the new section. Until then, docs-only; baseline unchanged.
