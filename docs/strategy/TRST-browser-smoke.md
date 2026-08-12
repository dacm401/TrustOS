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

## Why no real browser run yet

This repo has **no Playwright / Puppeteer dependency**. Per PM authorization,
when no browser harness exists we implement a lightweight runtime probe and
**must classify browser-runtime-unavailability honestly as ENV_BLOCKED — never
fake PASS**.

The probe (`detectBrowserRuntime()`) finds Chrome on this machine, but without a
harness to actually launch headless Chrome, click nav, and assert surface
visibility, a true PASS is impossible. The live script therefore reports:

```
status: ENV_BLOCKED
blocker: browser binary present but no runtime harness (Playwright/Puppeteer) wired
```

This keeps the contract honest: `ENV_BLOCKED` is never counted as PASS, and a
real UI failure would still be FAIL.

## Files

| File | Role |
|---|---|
| `scripts/frontend/browser-smoke-utils.mts` | classifier + selectors + env probe (single source of truth) |
| `scripts/frontend/run-browser-smoke.mts` | live runtime probe (bucket: live) |
| `scripts/frontend/run-browser-smoke-regression.mts` | deterministic classifier/marker tests |
| `frontend/src/components/audit/AuditReviewSurface.tsx` | `data-testid="audit-review-surface"` |
| `frontend/src/components/memory/MemoryGovernanceSurface.tsx` | `data-testid="memory-governance-surface"` |
| `frontend/src/components/layout/Sidebar.tsx` | `data-testid="nav-audit"` / `nav-memory` |

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

# live runtime probe (honest ENV_BLOCKED if no harness)
npx tsx scripts/frontend/run-browser-smoke.mts

# skip explicitly
MWT7C_BROWSER_SMOKE=skip npx tsx scripts/frontend/run-browser-smoke.mts
```

## Future real-browser wiring (when a harness is added)

Replace the `browser-available` branch in `run-browser-smoke.mts` with an actual
launch + nav + surface-visibility + console-error capture, then classify via
`classifyBrowserSmoke(...)`. Reuse `SELECTORS` and the classifier unchanged.

## Validation result (this environment)

- Deterministic regression: **29 PASS / 0 FAIL**
- Live browser smoke: **ENV_BLOCKED** (no harness to drive Chrome)
- Frontend typecheck: **0 errors**
- Overall: **READY_WITH_ENV_BLOCKERS** (browser blocker added to live bucket)

## Split commits

- C1 `feat(frontend)`: surface `data-testid` markers + browser smoke probe
- C2 `test(frontend)`: browser smoke regression + aggregator section
- C3 `docs(trst)`: browser smoke readiness docs
