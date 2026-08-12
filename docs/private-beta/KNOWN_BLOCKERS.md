# Private Beta Known Blockers — MWT-8

Honest list of known limitations and blockers. Updated 2026-08-12.

## 1. TRST-4H-III live env blocked (unless DB/gateway configured)

| Item | Status | Reason |
|------|--------|--------|
| TRST-4H-III Smoke | `ENV_BLOCKED` | `DB_CONNECTION_REFUSED` / `DATABASE_URL` + gateway required |
| TRST-4H-III Regression | `ENV_BLOCKED` | same |

**Why:** `scripts/trst4h-iii/*` exercise the Manager `POST /api/manager/route-message`
route, which (in `src/api/manager-route.ts`) calls `AgentSessionRepo.list(userId)`
before the `ask_clarification` short-circuit. Without `DATABASE_URL`/Postgres the
route returns HTTP 500. Gateway config is also required for `getAvailableModels()`.

**How to resolve:** set `DATABASE_URL` + `OPENAI_BASE_URL`/`OPENAI_API_KEY` (or
`GATEWAY_ENDPOINT`/`GATEWAY_API_KEY`), then run the live sections. With config
present they transition to `PASS` and overall may become `READY`.

**Not a code failure.** This is an environment dependency, classified per the
narrow MWT-7 taxonomy.

## 2. GitHub push network status

| Item | Status | Classification |
|------|--------|----------------|
| `git push origin feature/trst-3-private-beta-readiness` | `BLOCKED_BY_NETWORK` | environment/network issue |

`github.com:443` is reset by network DPI in the current environment. This is
**not a code-readiness failure** and is **not a milestone rejection reason**.
Local commits remain clean and ready. Retry when the network recovers:

```bash
git push origin feature/trst-3-private-beta-readiness
```

## 3. Browser harness requires Chrome

| Item | Status | Classification |
|------|--------|----------------|
| Browser harness smoke | `ENV_BLOCKED` in Chrome-less env | environment dependency |

If Chrome is not installed, the browser harness reports `ENV_BLOCKED` (not `FAIL`).
Deterministic suites and the in-process UI checks still pass.

## 4. Streaming not supported (future)

`stream=true` returns `UNSUPPORTED_STREAMING`. Out of private-beta scope; tracked
as a future charter (TRST-4B).

## 5. Durable evidence store / enforcement (future)

Durable evidence store, authenticated identity, and policy enforcement are future
charters (TRST-4C / 4E / 4F). Private beta is observation + reporting only.
