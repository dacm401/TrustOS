# Private Beta Validation Guide — MWT-8

This guide defines the validation status taxonomy used by `npm run validate`
(`scripts/trst/run-validation.mts`). It is consistent with the MWT-7 readiness
taxonomy.

## Status semantics

| Status | Meaning |
|--------|---------|
| `PASS` | Code/test succeeded. Deterministic success or live section ran with required env and passed. |
| `FAIL` | Code regression or assertion failure. **Must be fixed**, never reclassified. |
| `ENV_BLOCKED` | A required environment or external service is missing/unreachable (DB, gateway, browser). Honest blocker. |
| `SKIPPED` | An explicitly disabled optional section (opt-in only). |

## Readiness verdict

| Verdict | Rule |
|---------|------|
| `READY` | No `FAIL`, no `ENV_BLOCKED`. |
| `READY_WITH_ENV_BLOCKERS` | No `FAIL`, at least one `ENV_BLOCKED`. |
| `FAIL` | Any `FAIL` (regardless of other statuses). |

## Taxonomy boundaries (NARROW classifier — no catch-all)

| Condition | Status |
|-----------|--------|
| Missing `DATABASE_URL` | `ENV_BLOCKED(DB_URL_MISSING)` |
| Malformed `DATABASE_URL` | `ENV_BLOCKED(DB_URL_MALFORMED)` |
| Postgres `ECONNREFUSED` / `5432` / `postgres` | `ENV_BLOCKED(DB_CONNECTION_REFUSED)` |
| Missing gateway endpoint/key | `ENV_BLOCKED(GATEWAY_CONFIG_MISSING)` |
| Gateway unavailable | `ENV_BLOCKED(GATEWAY_UNAVAILABLE)` |
| No Chrome for browser harness | `ENV_BLOCKED` |
| Real assertion mismatch | `FAIL` |
| `TypeError` / `ReferenceError` | `FAIL` |
| Any unmatched error | `FAIL` (narrow: never silently `ENV_BLOCKED`) |

## How to run

```bash
npm run validate                      # full bucketed report
npx tsx scripts/trst/run-health-check.mts   # health check
npx tsx scripts/trst4h-iii/run-live-preflight.mts  # live env preflight
```

## Current standing result

```text
Deterministic:  41 PASS / 0 FAIL
Live:           3 PASS / 2 ENV_BLOCKED / 0 FAIL
Overall:        READY_WITH_ENV_BLOCKERS
```

## Important

- `ENV_BLOCKED` is **not** a failure. It means "configure the env to run this."
- `FAIL` is **always** a code/assertion problem.
- The harness never reports `READY` while `ENV_BLOCKED` remains, and never reports
  `PASS` for an `ENV_BLOCKED` section.
