# Private Beta Runbook — MWT-8

**Status:** Private Beta Candidate — Release Pack v0 (2026-08-12)
**Branch:** `feature/trst-3-private-beta-readiness`
**Overall readiness:** `READY_WITH_ENV_BLOCKERS` (see KNOWN_BLOCKERS.md)

This runbook tells a private-beta operator how to install, start, validate, and
demo the Trust Spine + Memory Governance system. It does **not** modify any core
logic — it is packaging only.

---

## 1. Install

```bash
# From repo root (trustos/)
npm install            # backend deps (incl. playwright devDep)
cd frontend && npm install && cd ..   # frontend deps
```

> Playwright is installed as a **devDependency** and uses the locally-installed
> Chrome via `channel: "chrome"`. No browser binary is downloaded or committed.

## 2. Frontend startup

```bash
cd frontend
npm run dev            # default Next.js port 3000
# For the browser harness / validation, use port 3100:
MWT7D_FRONTEND_PORT=3100 PORT=3100 npm run dev
```

Open `http://127.0.0.1:3100/` (or `:3000`).

## 3. Validation command (full)

```bash
npm run validate
# equivalent to:
npx tsx scripts/trst/run-validation.mts
```

This runs all deterministic + live sections and prints a bucketed readiness
report. See VALIDATION.md for status semantics.

## 4. Browser harness smoke (real Chrome click path)

```bash
npx tsx scripts/frontend/run-browser-harness-smoke.mts
```

Starts/reuses the frontend dev server on `:3100`, drives Chrome, and asserts the
Audit and Memory surfaces are clickable and visible. In a Chrome-less environment
this reports `ENV_BLOCKED`, not `FAIL`.

## 5. Live env preflight (TRST-4H-III)

```bash
npx tsx scripts/trst4h-iii/run-live-preflight.mts
```

Offline report of DB/gateway/http config presence. Exit 0. Never opens a real
socket or makes a real HTTP call. Use it to see why a live section is blocked
before attempting it.

## 6. Optional: one-shot private beta check

```bash
npx tsx scripts/trst/run-private-beta-check.mts
```

Orchestrates validation + health check + live preflight + browser harness smoke
and prints a consolidated readiness summary. Does not hide `FAIL`; does not
convert `ENV_BLOCKED` to `PASS`.

## 7. Expected current result

```text
Deterministic:  41 PASS / 0 FAIL
Live:           3 PASS / 2 ENV_BLOCKED / 0 FAIL
Overall:        READY_WITH_ENV_BLOCKERS
```

The 2 live `ENV_BLOCKED` are the TRST-4H-III sections, which require `DATABASE_URL`
(Postgres) + gateway config. They are honest and diagnosable, not failures.

## 8. Troubleshooting

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| `npm run validate` exits 1 | A real `FAIL` (code regression) | Read the failing step; fix the code, do not reclassify |
| TRST-4H-III `ENV_BLOCKED` | Missing `DATABASE_URL`/`OPENAI_*` | See ENVIRONMENT.md, run preflight |
| Browser harness `ENV_BLOCKED` | No Chrome installed | Install Chrome, or skip — deterministic suites still pass |
| Frontend won't start | Port conflict | Set `PORT`/`MWT7D_FRONTEND_PORT` to a free port |
| `npm run dev` backend errors | Missing `.env` | Copy `.env.example` and fill required vars (see ENVIRONMENT.md) |

> Network/github push failures are **environment issues, not code readiness
> failures**. See KNOWN_BLOCKERS.md.
