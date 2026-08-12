# Private Beta Environment Requirements — MWT-8

What an operator needs to run each capability. Items are grouped by requirement
level. **No browser binary is downloaded or committed** (Playwright uses the
installed Chrome via `channel: "chrome"`).

## Runtime

| Requirement | Required for | Notes |
|-------------|--------------|-------|
| Node.js (>=18) + npm | everything | test/build/run |
| Chrome (any recent stable) | browser harness smoke | via Playwright `channel:"chrome"`; absent → `ENV_BLOCKED` |
| `npm install` (root + frontend) | everything | install deps once |

## Deterministic validation

```bash
npm run validate
```

| Env var | Required? | Why |
|---------|-----------|-----|
| None | — | Deterministic suites are offline/config-free |

Result expected: `41 PASS / 0 FAIL`.

## Browser smoke

```bash
npx tsx scripts/frontend/run-browser-harness-smoke.mts
```

| Env var | Required? | Why |
|---------|-----------|-----|
| Chrome installed | Yes | Playwright drives local Chrome |
| `MWT7D_FRONTEND_PORT` / `PORT` | Optional | frontend port (default 3100 in harness) |

No live DB/LLM/gateway needed. Backend-unavailable noise is filtered.

## TRST-4H-III live tests

```bash
npx tsx scripts/trst4h-iii/run-smoke.mts
npx tsx scripts/trst4h-iii/run-regression.mts
# or check prerequisites first:
npx tsx scripts/trst4h-iii/run-live-preflight.mts
```

| Env var | Required? | Why |
|---------|-----------|-----|
| `DATABASE_URL` (postgresql://) | Yes | `AgentSessionRepo.list()` queries Postgres before routing in `manager-route.ts` |
| `OPENAI_BASE_URL` / `OPENAI_API_KEY` | Yes | `getAvailableModels()` probes the model gateway |
| `GATEWAY_ENDPOINT` / `GATEWAY_API_KEY` | Alt | accepted aliases for the gateway pair |

> **Root cause note:** `src/api/manager-route.ts` calls `AgentSessionRepo.list(userId)`
> *before* the `ask_clarification` short-circuit, so even the deterministic
> clarification path requires Postgres. In a no-DB sandbox the live section is
> `ENV_BLOCKED`. This is a known dependency, not a bug to hide.

Postgres expectation: reachable instance at the host/port in `DATABASE_URL`. The
preflight checks URL well-formedness + host/port presence only — it does **not**
open a real connection unless you run the live test itself.

## Optional / future

- Streaming (`stream=true`) — not yet supported (returns `UNSUPPORTED_STREAMING`).
- Durable evidence store — future charter.
- Authenticated identity / policy enforcement — future charter.

## Classification recap

- Required for deterministic validation: **none**
- Required for browser smoke: **Chrome**
- Required for TRST-4H-III live tests: **DATABASE_URL + gateway config**
- Optional / future: streaming, durable store, enforcement
