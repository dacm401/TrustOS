# MWT-7 — Validation Health & Readiness Semantics

**Milestone:** MWT-7 Productionization / Validation Health v0
**Status:** IMPLEMENTED ✅ (2026-08-12)
**Branch:** `feature/trst-3-private-beta-readiness`

## Goal
Make validation and local-readiness reporting production-friendly by clearly
separating deterministic PASS, live ENV_BLOCKED, real FAIL, and intentional
SKIPPED — so a private-beta runner can see at a glance what passed, what is
environment-blocked, and what actually failed.

## Validation Status Taxonomy
| Status | Meaning | Counted as PASS? |
|--------|---------|------------------|
| `PASS` | Step ran and succeeded | yes |
| `FAIL` | Step ran and a real assertion/condition failed | NO |
| `ENV_BLOCKED` | Step could not run: missing DB / gateway / build toolchain | NO |
| `SKIPPED` | Optional step intentionally disabled | n/a |

Hard rules:
- `ENV_BLOCKED` is NEVER counted as `PASS`.
- `ENV_BLOCKED` is NOT an ordinary `FAIL` — it is reported separately and does
  not by itself indicate a regression.
- Any real `FAIL` forces overall = `FAIL`.

## Overall Readiness
```
any FAIL                              => FAIL
no FAIL but any ENV_BLOCKED           => READY_WITH_ENV_BLOCKERS
otherwise (all PASS / SKIPPED)        => READY
```

## Files
- `scripts/trst/validation-status.ts` — taxonomy + `computeReadiness` + bucket summary
- `scripts/trst/env-diagnostics.ts` — health checks (node/npm/typecheck/DB/gateway/network) + narrow live-env-blocker classifier
- `scripts/trst/run-health-check.mts` — local readiness health report (no hard network/DB dependency)
- `scripts/trst/run-validation-health-smoke.mts` — 24 PASS
- `scripts/trst/run-validation-health-regression.mts` — 123 PASS
- `scripts/trst/run-validation.mts` — aggregator upgraded to per-bucket reporting + readiness verdict; live steps classified via `isEnvBlockedError`

## Live-env-blocker classifier (NARROW)
Only well-known environmental signatures are classified `ENV_BLOCKED`:
`ECONNREFUSED`, `ENOTFOUND`, `ETIMEDOUT`, `ECONNRESET`, `getaddrinfo`,
`DATABASE_URL` missing, gateway unavailable, `OPENAI_API_KEY` missing,
Postgres/5432, sandbox-no-db, and build-toolchain environmental signatures
(`UnhandledSchemeError`, `node:` scheme, `webpack errors`).

Real code failures (assertion mismatches, `TypeError`, `ReferenceError`) do NOT
match and remain `FAIL`. No broad catch-all.

## Health diagnostics (v0)
- Checks: Node version, npm availability, backend/frontend typecheck toolchain,
  `DATABASE_URL` presence, `OPENAI_API_KEY`/`OPENAI_BASE_URL` presence, GitHub
  network reachability (cheap ping, short timeout).
- Does NOT force a real DB connection or real LLM call. Reports config presence.
- A missing DB/gateway config is reported as `warn`/`missing` (env-blocker), not
  as a code FAIL.

## Current standing result
```
Deterministic:  36 PASS / 0 FAIL
Live:           0 PASS / 3 ENV_BLOCKED / 0 FAIL
Skipped:        0
Overall:        READY_WITH_ENV_BLOCKERS
```
The 3 ENV_BLOCKED = Frontend Build (sandbox webpack `node:` scheme limitation)
+ 2 × TRST-4H-III live HTTP/Postgres sections (no DB/gateway in sandbox).

All MWT/TRST deterministic product suites (MWT-4/4E/4F/5/5R/5R-UI/6/6-UI/7,
TRST-4A/4B/4E/4F/4G/4H/4H-I/4H-II) PASS. No real code regression.
