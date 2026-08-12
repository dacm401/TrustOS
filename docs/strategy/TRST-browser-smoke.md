# TRST Browser Smoke — MWT-7C

> MWT-7C Browser Smoke / UI Runtime Probe v0
> Authorized: 2026-08-12 (PM)
> Status: COMPLETE (live section honestly ENV_BLOCKED in this environment)

## Goal

Verify the frontend user-visible path through a lightweight browser/runtime
probe:

1. Frontend root page loads.
2. Sidebar **Audit** nav is clickable and `AuditReviewSurface` becomes visible.
3. Sidebar **Memory** nav is clickable and `MemoryGovernanceSurface` becomes visible.
4. Capture **hydration / runtime / console** errors as FAIL (never swallowed).

## Status taxonomy (shared with MWT-7)

| Situation | Status | Rule |
|---|---|---|
| Real UI assertion failure (nav/surface missing) | `FAIL` | never ENV_BLOCKED, never PASS |
| Hydration / runtime / console error | `FAIL` | never swallowed |
| Browser binary missing | `ENV_BLOCKED` | not PASS |
| Dev server / port unavailable (environment) | `ENV_BLOCKED` | not FAIL |
| Browser present but **no harness** to drive it | `ENV_BLOCKED` | **must NOT fake PASS** |
| Explicit skip flag | `SKIPPED` | `MWT7C_BROWSER_SMOKE=skip` |
| All reachable + no errors | `PASS` | only with a real harness |

## Why ENV_BLOCKED before MWT-7D (history)

MWT-7C found Chrome on this machine but had **no automation harness** to drive
it, so it honestly reported `ENV_BLOCKED` (never faked PASS).

## MWT-7D — harness integrated ✅

MWT-7D added a lightweight harness using **Playwright** (`channel: "chrome"`),
which drives the ALREADY-INSTALLED Chrome — no browser binary download, no cache
commit, added as a devDependency only. The live smoke now genuinely:

1. starts/connects the frontend dev server,
2. opens root in real Chrome,
3. clicks `nav-audit` → asserts `audit-review-surface` visible,
4. clicks `nav-memory` → asserts `memory-governance-surface` visible,
5. captures console/page errors (resource noise filtered, see below).

Live result:

```
status: PASS
root_loaded: true
audit_nav_found: true / audit_surface_visible: true
memory_nav_found: true / memory_surface_visible: true
runtime_errors: 0
```

### Error filtering (honest classification)

Network resource failures (favicon 404, backend `ERR_CONNECTION_REFUSED`) are
environment-level noise unrelated to the Audit/Memory UI path. They are
**filtered out**; only genuine JS hydration/runtime exceptions are counted as
FAIL. This honors PM requirement #4: backend absence must not become a browser
smoke prerequisite.

## Files

| File | Role |
|---|---|
| `scripts/frontend/browser-smoke-utils.mts` | classifier + selectors + env probe (single source of truth) |
| `scripts/frontend/run-browser-smoke.mts` | live runtime probe (bucket: live) |
| `scripts/frontend/run-browser-smoke-regression.mts` | deterministic classifier/marker tests |
| `frontend/src/components/audit/AuditReviewSurface.tsx` | `data-testid="audit-review-surface"` |
| `frontend/src/components/memory/MemoryGovernanceSurface.tsx` | `data-testid="memory-governance-surface"` |
| `frontend/src/components/layout/Sidebar.tsx` | `data-testid="nav-audit"` / `nav-memory` |
| `scripts/frontend/browser-harness.mts` | MWT-7D Playwright harness (chrome channel) |
| `scripts/frontend/run-browser-harness-smoke.mts` | MWT-7D live smoke (real click path) |
| `scripts/frontend/run-browser-harness-regression.mts` | MWT-7D deterministic regression |
| `package.json` (devDependency) | `playwright` (no browser download) |

## Surface markers

```text
audit nav :  [data-testid="nav-audit"]
memory nav:  [data-testid="nav-memory"]
audit surf:  [data-testid="audit-review-surface"]
memory surf: [data-testid="memory-governance-surface"]
```

These are test-only attributes — no visual or logic change.

## Running

```bash
# deterministic regression (offline, no browser needed)
npx tsx scripts/frontend/run-browser-smoke-regression.mts
npx tsx scripts/frontend/run-browser-harness-regression.mts

# live runtime probe
npx tsx scripts/frontend/run-browser-smoke.mts            # MWT-7C (no harness -> ENV_BLOCKED)
npx tsx scripts/frontend/run-browser-harness-smoke.mts   # MWT-7D (Playwright -> real PASS)

# skip explicitly
MWT7C_BROWSER_SMOKE=skip npx tsx scripts/frontend/run-browser-harness-smoke.mts
```

## Validation result (this environment)

- MWT-7C deterministic regression: **29 PASS / 0 FAIL**
- MWT-7D deterministic regression: **15 PASS / 0 FAIL**
- MWT-7C live browser smoke: **ENV_BLOCKED** (no harness path — kept for record)
- MWT-7D live browser smoke: **PASS** (real Chrome click path verified)
- Frontend typecheck: **0 errors**
- Overall: **READY_WITH_ENV_BLOCKERS** (only TRST-4H-III ×2 remain)

## Split commits

- MWT-7C C1/C2/C3: markers + probe / regression + aggregator / docs
- MWT-7D C1 `feat(frontend)`: browser harness integration (Playwright chrome channel)
- MWT-7D C2 `test(frontend)`: browser harness regression + aggregator sections
- MWT-7D C3 `docs(trst)`: browser harness readiness docs
