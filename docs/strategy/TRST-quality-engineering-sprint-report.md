# TRST Sealed Flows Quality Engineering Sprint — Completion Report

> **Status**: ENGINEERING_AUTHORIZED sprint complete ✅
> **Date**: 2026-08-10
> **Mode**: Continuous (no stop between subtasks)
> **Scope**: regression coverage for sealed TRST flows (MWT-4A evidence projection + ManagerWorkspace surface). No product features, no MWT-4B/export/signing, no backend/schema/Gateway change.

---

## 1. Summary

A full quality-engineering sprint over already-sealed MWT-4A task evidence projection logic. Inspected the repo, found **no frontend unit-test framework** (vitest/jest absent; `package.json` has no `test` script), and that repo convention for MWT-4A validation is a `tsx`-run deterministic DOM-free script (`scripts/mwt4a/run-smoke.mts`). Followed that convention: added an extended regression script + hardened the existing smoke, then ran the full validation baseline.

## 2. Files Changed

| File | Change |
|---|---|
| `scripts/mwt4a/run-regression.mts` | NEW — extended regression (40 assertions, 9 scenario groups R1-R9) |
| `scripts/mwt4a/run-smoke.mts` | EDIT — S2 field-level compare (robust vs JSON key order); companion-regression hint in output |

No production code changed. No `frontend/src/**` changed. No `src/services/**` / backend / Gateway / schema touched.

## 3. Tests / Regressions Added or Improved

- **New**: `run-regression.mts` with 9 groups:
  - R1 malformed/missing metadata (no tokens/cost/decision → zero, no throw)
  - R2 privacy-boundary leak regression (raw_prompt/output, api_key, run_id, trace_id, chain_of_thought all excluded; SAFE_META_KEYS contract)
  - R3 hash preservation (pass-through, no fabrication, missing hash tolerated)
  - R4 allow/deny/block/unknown decision boundary (case-insensitive; empty/missing → unknown)
  - R5 ordering stability (stable sort on equal timestamps)
  - R6 empty-timestamp handling (sorts first, no crash)
  - R7 `buildTaskEvidenceState` state contract (loading/error defaults)
  - R8 empty baseline consistency (`aggregate([])` deep-equals `EMPTY_SUMMARY`)
  - R9 no export/signing/policy/attest leakage in projection
- **Improved**: `run-smoke.mts` S2 now field-level (actionable failures, order-independent).

## 4. Scenarios Covered

Per PM target list — all covered:
- task evidence aggregation ✅ (S1/S5 + R1/R7/R8)
- ordering ✅ (AC5 + R5/R6)
- summary counts ✅ (S1/S5 + R1/R4)
- empty state ✅ (S2/S3 + R8)
- malformed/missing metadata ✅ (R1)
- privacy filtering / safe metadata projection ✅ (S11/S12 + R2/R9)
- allow/deny/unknown event handling ✅ (S7 + R4)
- hash preservation ✅ (R3)

UI render tests (loading/empty/error/populated) — **NOT ADDED**: no test framework present; PM forbids forcing dependency changes. Covered instead by deterministic projection scripts + component source unchanged (scope gate S8). Documented as gap (§8).

## 5. Bugs Found / Fixed

- **No product bugs found.** The 3 initial regression failures were **incorrect test assertions** (my expected counts for R4 were wrong), not code defects — the pure function behaves correctly (allow=1, deny=2 [DENY+Block], unknown=3 [unknown+empty+missing]). Assertions corrected; script now 40/0.
- This confirms the sealed MWT-4A logic is correct on decision-boundary and privacy edges.

## 6. Commands Run and Results

| Command | Result |
|---|---|
| `npx tsx scripts/mwt4a/run-smoke.mts` | 26 PASS / 0 FAIL / 0 SKIP ✅ |
| `npx tsx scripts/mwt4a/run-regression.mts` | 40 PASS / 0 FAIL ✅ |
| `npx tsc --noEmit` (frontend) | 0 errors ✅ |
| `npx next build` (frontend) | PASS (5/5 static pages) ✅ |
| `npx tsx scripts/mwt3b1/run-smoke.mts` | 8/8 PASS, 1 SKIP ✅ |
| `npx tsc --noEmit -p tsconfig.json` (backend) | 0 errors ✅ |

All commands exist and produced real results (no invented success).

## 7. Validation Baseline After Sprint

```text
Frontend TSC: 0 errors ✅ (unchanged)
Frontend Build: PASS ✅ (5/5 static pages)
Backend TSC: 0 errors ✅ (unchanged, read-only check)
MWT-4A Smoke: 26 PASS / 0 FAIL / 0 SKIP ✅ (S2 hardened)
MWT-4A Regression: 40 PASS / 0 FAIL ✅ (NEW)
MWT-3B1 Smoke: 8/8 PASS, 1 SKIP ✅ (unchanged)
```

## 8. Remaining Gaps

- **UI render tests absent** — no vitest/jest in frontend; adding them requires a dependency decision (out of sprint scope / PM prohibited forcing deps). Projection logic is covered deterministically; component render correctness relies on unchanged source + manual review.
- **Live-Gateway runtime smoke** not in seal gate (deterministic fixtures by design).
- **MWT-4B export tests** remain docs-only (implementation not authorized).
- **ManagerWorkspace panel** render not unit-tested (same framework gap); selection wiring verified via unchanged source + MWT-4A scope gate.

## 9. Scope Control Confirmation

```text
0 product-feature additions ✅
0 MWT-4B / export / download / signing ✅
0 backend / schema / Gateway changes ✅ (backend TSC read-only, 0 errors)
0 policy / approval / run_id / trace_id ✅
0 new dependencies ✅
Only: 1 new .mts regression script + 1 .mts smoke edit (both deterministic, no deps)
```

## 10. Current Gate Recommendation

Gate unchanged — all sealed workstreams remain SEALED/CLOSED. New regression script strengthens MWT-4A regression safety without altering semantics. Recommend:
- Keep `run-regression.mts` as a permanent MWT-4A regression gate.
- MWT-4B implementation still `NOT_AUTHORIZED ❌` — pending reviewer synthesis + PM greenlight.
- If PM wants UI render coverage, authorize a separate frontend test-framework decision (vitest add + render tests) as its own task.
