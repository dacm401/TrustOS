# MWT-7E — TRST-4H-III Live Environment Unblock v0

**Milestone:** MWT-7E TRST-4H-III Live Environment Unblock v0
**Status:** IMPLEMENTED ✅ (2026-08-12)
**Branch:** `feature/trst-3-private-beta-readiness`
**Overall readiness:** `READY_WITH_ENV_BLOCKERS` (TRST-4H-III ×2 env-blocked, reasons now explicit)

## Why this milestone exists

Two live validation steps were `ENV_BLOCKED` with a generic "DB/gateway unavailable in
sandbox" line:

```text
TRST-4H-III Smoke       ENV_BLOCKED
TRST-4H-III Regression   ENV_BLOCKED
```

MWT-7E does NOT weaken these into PASS. Instead it **makes the blocker explicit and
providable**:

1. Adds offline live-env diagnostics that report exactly what is missing.
2. Adds a narrow classifier that maps each environmental signature to a precise reason code.
3. Documents the setup path so a configured environment can make the steps PASS.

## Root cause (honest)

`scripts/trst4h-iii/run-smoke.mts` and `run-regression.mts` exercise the Manager
`POST /api/manager/route-message` route **in-process** via an in-memory Hono router.
Their header comment asserts the `ask_clarification` branch short-circuits **before**
any DB call. In reality (`src/api/manager-route.ts`) `AgentSessionRepo.list(userId)`
runs at line ~52, **before** the `ask_clarification` short-circuit at line ~78. So
even a deterministic "how?" message touches Postgres and returns HTTP 500 when
`DATABASE_URL` is absent. Hence the live dependency is real.

MWT-7E does **not** modify the route handler (out of authorized scope). It surfaces
the dependency honestly and provides the preflight to satisfy it.

## Live-env dependencies identified

| Requirement | Env var(s) | Why needed |
|-------------|-----------|-----------|
| **Database** | `DATABASE_URL` (postgresql://) | `AgentSessionRepo.list()` queries Postgres before routing |
| **Gateway** | `OPENAI_BASE_URL` / `OPENAI_API_KEY` (or `GATEWAY_ENDPOINT` / `GATEWAY_API_KEY`) | `getAvailableModels()` probes the model gateway |

No other live dependency. No network hard-dependency for the preflight itself.

## Preflight diagnostics architecture

`scripts/trst4h-iii/live-env-diagnostics.mts` (pure, offline):

```ts
inspectDatabase(opts?)   -> DatabaseReadiness   // env/url/host/port presence only
inspectGateway(opts?)    -> GatewayReadiness    // endpoint/key presence only
inspectHttpService(opts?)-> HttpServiceReadiness // optional
inspectLiveEnv(opts?)    -> LiveEnvReport       // aggregates + ready_to_run + summary
classifyTrst4hBlocker(text) -> "ENV_BLOCKED(...)" | "FAIL(...)"  // narrow reason codes
```

`scripts/trst4h-iii/run-live-preflight.mts` (section 43 in `run-validation.mts`):

- **Deterministic, offline, exit 0** (a reporting gate, never a failure gate).
- Reads config presence only. **Never opens a real socket or makes a real HTTP call.**
- Prints an explicit DB / gateway / http readiness table with reason codes.

## DB readiness classification

| Condition | Status | reason_code |
|-----------|--------|-------------|
| `DATABASE_URL` unset | `ENV_BLOCKED` | `DB_URL_MISSING` |
| `DATABASE_URL` malformed | `ENV_BLOCKED` | `DB_URL_MALFORMED` |
| `ECONNREFUSED` / `5432` / `postgres` | `ENV_BLOCKED` | `DB_CONNECTION_REFUSED` |
| well-formed + host + port | `PASS` | `DB_CONFIG_PRESENT` |

## Gateway / HTTP readiness classification

| Condition | Status | reason_code |
|-----------|--------|-------------|
| endpoint + key both missing | `ENV_BLOCKED` | `GATEWAY_CONFIG_MISSING` |
| endpoint missing | `ENV_BLOCKED` | `GATEWAY_ENDPOINT_MISSING` |
| key missing | `ENV_BLOCKED` | `GATEWAY_API_KEY_MISSING` |
| gateway unavailable text | `ENV_BLOCKED` | `GATEWAY_UNAVAILABLE` |
| both present | `PASS` | `GATEWAY_CONFIG_PRESENT` |

## ENV_BLOCKED classifier boundaries (NARROW)

Kept strict per MWT-7 rules. **No catch-all.**

```text
missing DB config          => ENV_BLOCKED
Postgres ECONNREFUSED      => ENV_BLOCKED
gateway endpoint/key missing => ENV_BLOCKED
gateway unavailable        => ENV_BLOCKED
ENOTFOUND/ETIMEDOUT/...    => ENV_BLOCKED

real assertion mismatch    => FAIL   (never ENV_BLOCKED)
TypeError / ReferenceError => FAIL   (never ENV_BLOCKED)
unknown error              => FAIL   (no broad catch-all)
```

## Deterministic strictness guarantee

TRST/MWT deterministic suites are **unchanged and strict**:

```text
deterministic failure = FAIL   (never reclassified to ENV_BLOCKED)
```

MWT-7E added only NEW deterministic suites (live-env smoke 20, regression 19) and a
preflight report. No existing deterministic test was weakened.

## Behavior examples (all verified)

| # | Scenario | Result |
|---|----------|--------|
| 1 | `DATABASE_URL` missing | `ENV_BLOCKED` |
| 2 | `DATABASE_URL` malformed | `ENV_BLOCKED(DB_URL_MALFORMED)` |
| 3 | Postgres `ECONNREFUSED` | `ENV_BLOCKED(DB_CONNECTION_REFUSED)` |
| 4 | gateway endpoint/key missing | `ENV_BLOCKED` |
| 5 | gateway unavailable | `ENV_BLOCKED(GATEWAY_UNAVAILABLE)` |
| 6 | real assertion mismatch | `FAIL` |
| 7 | `TypeError` / `ReferenceError` | `FAIL` |
| 8 | all required config present | preflight `READY_TO_RUN` |
| 9 | no required live env | deterministic validation still PASS; overall `READY_WITH_ENV_BLOCKERS` |

## Setup path (how to unblock)

```bash
# 1. Configure a reachable Postgres
export DATABASE_URL="postgresql://user:pass@localhost:5432/smartrouter"

# 2. Configure the model gateway
export OPENAI_BASE_URL="http://localhost:8787/v1"
export OPENAI_API_KEY="sk-..."

# 3. Run the preflight (offline; exit 0)
npx tsx scripts/trst4h-iii/run-live-preflight.mts
# -> Summary: READY_TO_RUN ...

# 4. Run the live TRST-4H-III sections (now PASS instead of ENV_BLOCKED)
npx tsx scripts/trst4h-iii/run-smoke.mts
npx tsx scripts/trst4h-iii/run-regression.mts

# 5. Full validation
npx tsx scripts/trst/run-validation.mts
```

Without those env vars, the two TRST-4H-III steps stay `ENV_BLOCKED` with explicit
reasons, and overall remains `READY_WITH_ENV_BLOCKERS`. This is correct, not a
regression.

## Validation result

```text
Deterministic:  41 PASS / 0 FAIL
Live:           3 PASS / 2 ENV_BLOCKED / 0 FAIL
  (MWT-7D browser harness PASS; TRST-4H-III ×2 explicit ENV_BLOCKED)
Skipped:        0
Overall:        READY_WITH_ENV_BLOCKERS
Frontend tsc:   0 errors
Backend tsc:    0 errors
```

## Files

- `scripts/trst4h-iii/live-env-diagnostics.mts` — diagnostics + narrow classifier
- `scripts/trst4h-iii/run-live-preflight.mts` — offline preflight report (section 43)
- `scripts/trst4h-iii/run-live-env-smoke.mts` — 20 PASS classifier fixtures
- `scripts/trst4h-iii/run-live-env-regression.mts` — 19 PASS behavior matrix
- `scripts/trst/run-validation.mts` — `liveDeps` annotation + explicit ENV_BLOCKED reasons + section 43
- `docs/strategy/TRST-live-env-readiness.md` — this file
- `docs/strategy/TRST-validation-health.md` — updated classifier reason codes + result
- `docs/strategy/TRST-execution-log.md` — MWT-7E entry added
