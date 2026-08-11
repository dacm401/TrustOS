# TRST Standing Engineering Backlog — Batch Report

> Standing authorization: `STANDING_ENGINEERING_AUTHORIZATION ✅`
> Feature dev: `NOT_AUTHORIZED ❌` | MWT-4B impl: `NOT_AUTHORIZED ❌`
> Purpose: keep sealed-flow quality work progressing while CHECKPOINT_2 reviewer feedback is pending.
> Agent works in meaningful batches; reports after each batch or on blocker/boundary/reviewer-feedback.

---

## Batch 1 — Aggregate Validation Command (P0 + P4)

**Date**: 2026-08-10
**Status**: ✅ COMPLETE · all validation green

### 1. Batch focus
Create one canonical command that runs the full sealed-flow validation suite (Frontend TSC, Frontend Build, MWT-4A smoke, MWT-4A regression, MWT-3B1 smoke, Backend TSC) with sectioned readable output, non-zero exit on failure, and a final summary.

### 2. Files changed
- `scripts/trst/run-validation.mts` — NEW aggregate validation runner
- `package.json` (backend root) — added `"validate"` script alias (low-risk)
- `docs/strategy/TRST-validation-baseline.md` — NEW canonical command + baseline + troubleshooting
- `docs/strategy/TRST-execution-log.md` — updated gate + added Standing Backlog section

### 3. Improvements made
- Single `npm run validate` (or `npx tsx scripts/trst/run-validation.mts`) now covers all 6 sealed-flow checks.
- Sectioned output with per-step PASS/FAIL and a consolidated summary.
- Exit code `0` only on full pass; `1` on any failure — safe for CI / pre-commit gating.
- Windows-safe: uses `shell: true` with a single command string (no `npx ENOENT`, no `DEP0190` noise).
- Documented command, baseline, and troubleshooting so future runs are reproducible.

### 4. Assertions/scenarios added or improved
- No new functional assertions; this batch is validation *integration* (P0), not regression expansion.
- The aggregator now guarantees the 6 existing suites run as one gate (66 checks: 26 smoke + 40 regression + 8/1 smoke + 4 typecheck/build sections).

### 5. Commands run and results
```
npx tsx scripts/trst/run-validation.mts
  [PASS] Frontend Typecheck       exit 0
  [PASS] Frontend Build           exit 0
  [PASS] MWT-4A Smoke             26 PASS / 0 FAIL / 0 SKIP
  [PASS] MWT-4A Regression        40 PASS / 0 FAIL
  [PASS] MWT-3B1 Smoke            8 PASS / 0 FAIL / 1 SKIP
  [PASS] Backend Typecheck        exit 0
  => ALL 6 SECTIONS PASSED ✅  (exit 0)
```

### 6. Validation baseline (unchanged, reaffirmed)
```text
Frontend TSC: 0 errors ✅
Frontend Build: PASS ✅
Backend TSC: 0 errors ✅
MWT-4A Smoke: 26/0/0 ✅
MWT-4A Regression: 40/0 ✅
MWT-3B1 Smoke: 8/8 + 1 SKIP ✅
```

### 7. Issues found/fixed
- **Fixed**: `spawn npx ENOENT` on Windows → switched to `shell: true`.
- **Fixed**: `DEP0190 DeprecationWarning` (args + shell) → commands now built as a single string.
- No product/backend/schema bugs found. Frontend + backend typecheck already clean.

### 8. Remaining backlog candidates (next batches)
- **P1 Regression Expansion**: expand MWT-4A regression beyond 40 if meaningful; add MWT-3B1 regression if a pure deterministic path exists; add privacy-negative assertions.
- **P2 Smoke Diagnostics**: scenario labels / summary output for MWT-3B1 smoke; remove any order assumptions.
- **P3 Type Hygiene**: narrow `any` in touched scripts/tests; remove unused imports in smoke/regression files.
- **P4 Docs**: validation troubleshooting already done; keep execution-log synced per batch.

### 9. Scope confirmation
- ✅ No product features
- ✅ No MWT-4B / export / download / signing
- ✅ No backend / schema / Gateway changes
- ✅ No policy / approval / run_id / trace_id
- ✅ No new dependencies (reused `tsx` + `next`)

### 10. Reviewer feedback arrived?
- ⚠️ No. CHECKPOINT_2 reviewer responses still `PENDING_EXTERNAL_HUMAN_ACTION`. Work continues under standing authorization.

---

## Batch log (append future batches here)

| Batch | Focus | Date | Status |
|-------|-------|------|--------|
| 1 | Aggregate Validation Command (P0+P4) | 2026-08-10 | ✅ COMPLETE |
| 2 | MWT-4A Regression Expansion (P1) | 2026-08-10 | ✅ COMPLETE |
| 3 | MWT-3B1 Regression Characterization (P1, read-only backend import) | 2026-08-10 | ✅ COMPLETE |

---

## Batch 2 — MWT-4A Regression Expansion (P1)

**Date**: 2026-08-10
**Status**: ✅ COMPLETE · 57 PASS / 0 FAIL

### 1. Batch focus
Expand the MWT-4A deterministic regression beyond 40 assertions with meaningful edge-case coverage for sealed-flow projection behavior (cost type-safety, token type-agnosticism, large-aggregation determinism, negative/NaN token handling).

### 2. Files changed
- `scripts/mwt4a/run-regression.mts` — added R10 (4 asserts), R11 (3), R12 (7), R13 (3) = 17 new

### 3. Improvements made
- R10: `cost_estimate` type safety — only numeric cost summed; string/object/null ignored.
- R11: token summation is type-agnostic across `event_type` (tool_call tokens counted like model_call). Documents current contract.
- R12: 100-event aggregation determinism — stable counts, stable control split (allow=34/deny=33/unknown=33).
- R13: negative / NaN token handling — honest documentation of current contract (negative summed as-is; NaN propagated as NaN since `typeof NaN === "number"`).

### 4. Assertions added
- 17 new meaningful assertions (R10–R13). Total: 40 → 57.

### 5. Commands run and results
```
npx tsx scripts/mwt4a/run-regression.mts
  === MWT-4A Regression Result: 57 PASS / 0 FAIL ===   (exit 0)
npx tsx scripts/trst/run-validation.mts
  ALL 6 SECTIONS PASSED ✅   (exit 0)
```

### 6. Validation baseline (updated regression count)
```text
MWT-4A Regression: 57 PASS / 0 FAIL ✅  ← updated from 40
(others unchanged: Frontend TSC 0, Frontend Build PASS, Backend TSC 0,
 MWT-4A Smoke 26/0/0, MWT-3B1 Smoke 8/8 + 1 SKIP)
```

### 7. Issues found/fixed
- Discovered via R13: `NaN` output tokens are propagated (not zeroed) by `aggregateTaskEvidence` because the guard is `typeof === "number"`. Documented as honest regression (no product change). This is a known contract edge; flagged for PM awareness, not fixed (out of sealed-scope change).

### 8. Remaining backlog candidates
- **P1**: assess MWT-3B1 deterministic regression path (needs a pure function; currently smoke-only).
- **P2**: MWT-3B1 smoke scenario labels + final structured summary.
- **P3**: narrow `any` in touched scripts; unused-import cleanup in smoke/regression files.
- **P4**: keep execution-log + this report synced per batch.

### 9. Scope confirmation
- ✅ No product features | ✅ No MWT-4B / export / signing | ✅ No backend / schema / Gateway
- ✅ No policy / run_id / trace_id | ✅ No new dependencies

### 10. Reviewer feedback arrived?
- ⚠️ No. Still `PENDING_EXTERNAL_HUMAN_ACTION`. Work continues under standing authorization.

---

## Batch 3 — MWT-3B1 Regression Characterization (P1, read-only backend import)

**Date**: 2026-08-10
**Status**: ✅ COMPLETE · 24 PASS / 0 FAIL · integrated into `npm run validate` (7th section)

### 1. Batch focus
Add deterministic regression characterization for sealed MWT-3B1, covering task_id extraction, event sealing/hash determinism, and absence of run_id/trace_id/policy introduction. Authorized to READ-ONLY import backend pure helpers.

### 2. Backend modules inspected read-only
- `src/services/trst1/event-envelope.ts` — READ, imported `extractTaskId`, `sealEvent`, `computeEventHash`.
- `src/services/trst1/jsonl-event-store.ts` — READ, **not imported** (filesystem-coupled; would break determinism).

### 3. Files changed
- `scripts/mwt3b1/run-regression.mts` — NEW (24 asserts, R1–R10)
- `scripts/trst/run-validation.mts` — added "MWT-3B1 Regression" as section 5 (now 7 sections)
- `docs/strategy/TRST-validation-baseline.md` — added MWT-3B1 Regression row + baseline
- `docs/strategy/TRST-standing-engineering-backlog-report.md` — Batch 3 entry
- `docs/strategy/TRST-execution-log.md` — gate + batch log update

### 4. Regression scenarios added (24)
- R1 valid task id extraction (trim, preserve)
- R2 missing → null (undefined/null/empty/whitespace; no fabrication)
- R3 malformed/unsupported (number/object throw; documented contract edge)
- R4 flat `task_id` schema (string|null, no nesting)
- R5 partial/unknown event shape seals deterministically
- R6 hash stable regardless of key insertion order
- R7 hash determinism + sha256 shape
- R8 no run_id/trace_id introduction (passthrough only)
- R9 no policy/approval semantics added
- R10 import is side-effect free (input not mutated, new object returned)

### 5. Whether backend imports had side effects
- ✅ `event-envelope.ts` import is side-effect free (only `node:crypto` at load; no server/DB/Gateway). Reaching runtime asserts purity. `jsonl-event-store.ts` intentionally NOT imported.

### 6. Commands run and results
```
npx tsx scripts/mwt3b1/run-regression.mts  → 24 PASS / 0 FAIL (exit 0)
npm run validate                          → ALL 7 SECTIONS PASSED ✅ (exit 0)
```

### 7. Updated validation baseline
```text
Frontend TSC: 0 errors ✅
Frontend Build: PASS ✅
Backend TSC: 0 errors ✅
MWT-4A Smoke: 26/0/0 ✅
MWT-4A Regression: 57/0 ✅
MWT-3B1 Regression: 24/0 ✅   ← NEW
MWT-3B1 Smoke: 8/8 + 1 SKIP ✅
```

### 8. Known characterization gaps
- `extractTaskId` rejects non-string/non-null inputs by throwing (not a silent null). Documented as current contract; not changed.
- `jsonl-event-store.ts` persistence behavior not characterized (out of determinism scope; would need filesystem).

### 9. Scope confirmation
- ✅ No backend MODIFICATION | ✅ No server/Gateway/SQLite start | ✅ No schema/migration change
- ✅ No MWT-4B/export/signing | ✅ No policy/run_id/trace_id addition | ✅ No new dependencies
- ✅ Read-only backend import only (pure helpers)

### 10. Reviewer feedback arrived?
- ⚠️ No. Still `PENDING_EXTERNAL_HUMAN_ACTION`. Work continues under standing authorization.
