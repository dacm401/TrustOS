# Private Beta Quickstart — MWT-9

**Status:** Private Beta Candidate — Operator Onboarding & Release Gate v0 (2026-08-12)
**Branch:** `feature/trst-3-private-beta-readiness`
**Overall readiness:** `READY_WITH_ENV_BLOCKERS` (this is the **normal, expected** current state — see BETA_ACCEPTANCE_CRITERIA.md)

Copy-paste the commands below. Each section states its expected result.

---

## 0. Prerequisites (check once)

- Node.js >= 18 + npm
- Git
- Chrome (any recent stable) — only for the browser harness smoke; not required for deterministic validation

---

## 1. Checkout & install

```bash
git clone <repo-url> trustos
cd trustos
npm install                 # backend deps (incl. playwright devDep, no browser binary)
cd frontend && npm install && cd ..   # frontend deps
```

Expected: both installs finish with no fatal errors.

---

## 2. Configure environment (optional for deterministic, required for live)

Copy the template and fill only what you need:

```bash
cp .env.private-beta.example .env
# then edit .env — see ENVIRONMENT.md for what each var does
```

- Deterministic validation + browser smoke need **nothing** in `.env`.
- TRST-4H-III live tests need `DATABASE_URL` + gateway config
  (`OPENAI_BASE_URL`/`OPENAI_API_KEY` or `GATEWAY_ENDPOINT`/`GATEWAY_API_KEY`).

> Never commit real secrets. `.env` is gitignored. `.env.private-beta.example` contains
> only empty keys + comments.

---

## 3. Run the private beta pack check (one shot)

```bash
npm run beta:check
```

Expected: all pack-consistency checks PASS, and the verdict prints
`READY_WITH_ENV_BLOCKERS` (because TRST-4H-III live env is not yet provided).

---

## 4. Run full validation

```bash
npm run validate
```

Expected current result:

```text
Deterministic:  41 PASS / 0 FAIL
Live:           3 PASS / 2 ENV_BLOCKED / 0 FAIL
Overall:        READY_WITH_ENV_BLOCKERS
```

Any `FAIL` is a real code regression — do not reclassify it.

---

## 5. Start the frontend (to view / demo)

```bash
cd frontend
MWT7D_FRONTEND_PORT=3100 PORT=3100 npm run dev
```

Open `http://127.0.0.1:3100/`.

---

## 6. Browser harness smoke (real Chrome click path)

```bash
npx tsx scripts/frontend/run-browser-harness-smoke.mts
```

Expected: `PASS` when Chrome is installed. In a Chrome-less environment it reports
`ENV_BLOCKED` (not `FAIL`) — deterministic suites still pass.

---

## 7. Live env preflight (why TRST-4H-III is blocked)

```bash
npx tsx scripts/trst4h-iii/run-live-preflight.mts
```

Offline report of DB/gateway config presence. Use it to see exactly which env var is
missing before attempting the live sections.

---

## 8. Generate an operator-facing readiness report

```bash
npx tsx scripts/trst/run-private-beta-report.mts
```

Prints a timestamped readiness summary (verdict, deterministic/live/browser/TRST-4H-III
status, known blockers, next actions). Optionally writes
`docs/private-beta/generated-readiness-report.md` (template only — runtime reports are
not committed).

See OPERATOR_ONBOARDING.md for the full flow, and BETA_ACCEPTANCE_CRITERIA.md for how
`READY_WITH_ENV_BLOCKERS` differs from `READY`.

---

## Current expected state (do not be alarmed)

```text
Overall: READY_WITH_ENV_BLOCKERS
```

This is **correct and expected**. The product/core/frontend/browser/docs are ready; only
the external TRST-4H-III (DB/gateway) live env remains blocked. To reach full `READY`,
provide `DATABASE_URL` + gateway config (see OPERATOR_ONBOARDING.md §8).
