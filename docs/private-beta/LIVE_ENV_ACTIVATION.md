# Live Environment Activation — MWT-10

This guide explains how to activate the **live** environment required by the
TRST-4H-III live sections, so the overall beta verdict can move from
`READY_WITH_ENV_BLOCKERS` to `READY`.

> **No secrets are stored here.** This file documents *which* env vars are
> needed and *how* to set them locally. It never contains a real value. Copy
> `.env.private-beta.example` to `.env` and fill values on your own machine only.

## 1. Required env vars

| Var | Needed for | Notes |
|-----|-----------|-------|
| `DATABASE_URL` | TRST-4H-III Manager route-message (Postgres) | `postgresql://host:port/db` |
| `OPENAI_BASE_URL` *or* `GATEWAY_ENDPOINT` | Gateway-backed model availability | endpoint only |
| `OPENAI_API_KEY` *or* `GATEWAY_API_KEY` | Gateway auth | endpoint + key both required |

> `[LIV]` = live environment dependency (per the env template legend).

## 2. How to set them locally

```bash
cp .env.private-beta.example .env
# edit .env and fill ONLY the [LIV] vars:
#   DATABASE_URL=postgresql://user:pass@localhost:5432/trustos
#   OPENAI_BASE_URL=https://...
#   OPENAI_API_KEY=sk-...
#   (or GATEWAY_ENDPOINT / GATEWAY_API_KEY)
```

`.env` is gitignored — it is never committed.

## 3. Run live preflight (offline, presence-only)

```bash
npx tsx scripts/trst4h-iii/run-live-preflight.mts
```

Confirms config presence without opening a socket or making an HTTP call.

## 4. Run activation check (offline, with masking self-test)

```bash
npx tsx scripts/trst4h-iii/run-live-activation-check.mts
```

Reports `database` / `gateway` / `TRST-4H-III` status and the overall verdict.
The script asserts it only prints **presence** (`env_present=true`), never the
secret VALUE.

## 5. Run validation (live sections execute when env present)

```bash
npm run validate
npx tsx scripts/trst4h-iii/run-live-env-smoke.mts
npx tsx scripts/trst4h-iii/run-live-env-regression.mts
```

## 6. Expected PASS condition

| Scenario | `TRST-4H-III` | Overall |
|----------|---------------|---------|
| No live env | `ENV_BLOCKED` | `READY_WITH_ENV_BLOCKERS` |
| DB present, gateway missing | `ENV_BLOCKED` | `READY_WITH_ENV_BLOCKERS` |
| Gateway present, DB missing | `ENV_BLOCKED` | `READY_WITH_ENV_BLOCKERS` |
| DB + gateway present, live pass | `PASS` | `READY` |
| DB + gateway present, assertion fails | `FAIL` | `FAIL` |

## 7. Troubleshooting (DB / gateway)

| Symptom | reason_code | Fix |
|---------|-------------|-----|
| `DB_URL_MISSING` | `DATABASE_URL` unset | set `DATABASE_URL` |
| `DB_URL_MALFORMED` | bad URL scheme/host | use `postgresql://host:port/db` |
| `DB_CONNECTION_REFUSED` (live run) | Postgres unreachable | start Postgres / fix host:port |
| `GATEWAY_CONFIG_MISSING` | no endpoint/key | set gateway pair |
| `GATEWAY_ENDPOINT_MISSING` | key only | add endpoint |
| `GATEWAY_API_KEY_MISSING` | endpoint only | add key |
| `GATEWAY_UNAVAILABLE` (live run) | gateway 5xx/unreachable | check endpoint/key/network |

Real code/assertion failures are classified `FAIL` (never swallowed into
`ENV_BLOCKED`). See `classifyTrst4hBlocker` in `live-env-diagnostics.mts`.
