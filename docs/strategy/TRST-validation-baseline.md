# TRST Sealed-Flow Validation Baseline

> Standing Engineering Backlog — Batch 1 deliverable (P0 Validation Integration + P4 Dev Docs).
> Last updated: 2026-08-10.

## Canonical validation command

Run the full sealed-flow quality gate in one command:

```bash
# From repo root (trustos/)
npx tsx scripts/trst/run-validation.mts

# or via package alias (backend package.json)
npm run validate
```

This runs, in order, each sectioned and clearly labeled:

| # | Section | Command | CWD |
|---|---------|---------|-----|
| 1 | Frontend Typecheck | `npx tsc --noEmit` | `frontend/` |
| 2 | Frontend Build | `npx next build` | `frontend/` |
| 3 | MWT-4A Smoke | `npx tsx scripts/mwt4a/run-smoke.mts` | root |
| 4 | MWT-4A Regression | `npx tsx scripts/mwt4a/run-regression.mts` | root |
| 5 | MWT-3B1 Regression | `npx tsx scripts/mwt3b1/run-regression.mts` | root |
| 6 | MWT-3B1 Smoke | `npx tsx scripts/mwt3b1/run-smoke.mts` | root |
| 7 | Backend Typecheck | `npx tsc --noEmit -p tsconfig.json` | root |

### Behavior

- **Sectioned output**: each step prefixed with a `▶` header and a pass/fail line.
- **Final summary**: prints `[PASS]` / `[FAIL]` per section and `ALL N SECTIONS PASSED ✅` or `N/M SECTION(S) FAILED ❌`.
- **Exit code**: `0` only if every section passes; `1` if any section fails. Safe for CI / pre-commit gating.
- **No new dependencies**: reuses already-present `tsx` + `next`. Read-only; no product/backend/schema changes.

## Validation Baseline (adopted 2026-08-10)

```text
Frontend TSC:           0 errors ✅
Frontend Build:         PASS ✅
Backend TSC:            0 errors ✅ (read-only)
MWT-4A Smoke:           26 PASS / 0 FAIL / 0 SKIP ✅
MWT-4A Regression:      57 PASS / 0 FAIL ✅  ← regression baseline (expanded Batch 2)
MWT-3B1 Regression:     24 PASS / 0 FAIL ✅  ← added Batch 3 (read-only backend import)
MWT-3B1 Smoke:          8 PASS / 0 FAIL / 1 SKIP ✅
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `spawn npx ENOENT` | running aggregator without a shell on Windows | already fixed: aggregator uses `shell: true` |
| `DEP0190 DeprecationWarning` | args passed to shell spawn | already fixed: commands built as single string |
| Frontend Build slow | `next build` is a full production build | expected; run less often than typecheck |
| MWT-3B1 `1 SKIP` | no upstream API key → synthetic event path | expected; S1/S2 live model_call skipped |
| A section fails | see that section's inline output | fix within authorized scope, re-run `npm run validate` |

## Scope guard

This baseline covers **sealed-flow quality only**. It does NOT validate:

- MWT-4B export/download/signing (implementation not authorized)
- backend/schema/Gateway runtime behavior (out of scope)
- policy / approval / run_id / trace_id product logic (not part of sealed flows)
- live-Gateway runtime smoke (kept non-gating, deterministic fixtures are the gate)

See `TRST-execution-log.md` for current gate state and `TRST-standing-engineering-backlog-report.md` for batch history.
