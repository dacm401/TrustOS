# Private Beta Operator Onboarding — MWT-9

End-to-end onboarding for a new private-beta operator. Follow the steps in order. The
goal: an operator with zero prior context can go from repo checkout to a demonstrable,
honestly-reported private-beta system.

**Current overall readiness:** `READY_WITH_ENV_BLOCKERS` (normal — see §8 to upgrade).

---

## 1. Repo checkout

```bash
git clone <repo-url> trustos
cd trustos
git checkout feature/trst-3-private-beta-readiness
git status --short        # must be clean (or documented untracked only)
```

---

## 2. Dependency install

```bash
npm install                 # backend deps (root)
cd frontend && npm install && cd ..   # frontend deps
```

> Playwright is a devDependency; it uses your installed Chrome via `channel:"chrome"`.
> No browser binary is downloaded or committed.

---

## 3. Environment setup

```bash
cp .env.private-beta.example .env
# edit .env — fill only what you need
```

| Capability | Env required? |
|------------|---------------|
| Deterministic validation | none |
| Browser harness smoke | Chrome only (no env) |
| TRST-4H-III live tests | `DATABASE_URL` + gateway config |

Full key reference: ENVIRONMENT.md. Required keys in the template:

```text
DATABASE_URL=
OPENAI_BASE_URL=
OPENAI_API_KEY=
GATEWAY_ENDPOINT=
GATEWAY_API_KEY=
FRONTEND_PORT=
```

> The template contains **empty keys only** — no real secrets. `.env` is gitignored.

---

## 4. Validation

```bash
npm run beta:check     # pack-consistency gate (quick)
npm run validate       # full bucketed readiness report
```

Expected: `beta:check` all PASS; `validate` shows deterministic `41 PASS / 0 FAIL`,
live `3 PASS / 2 ENV_BLOCKED / 0 FAIL`, overall `READY_WITH_ENV_BLOCKERS`.

---

## 5. Browser smoke

```bash
npx tsx scripts/frontend/run-browser-harness-smoke.mts
```

Drives Chrome against the `:3100` frontend and asserts Audit + Memory surfaces are
clickable. `PASS` with Chrome; `ENV_BLOCKED` without (not a code failure).

---

## 6. Live preflight

```bash
npx tsx scripts/trst4h-iii/run-live-preflight.mts
```

Shows the explicit DB/gateway readiness table — config presence only, no real network
call. Use it to confirm which live env var is missing.

---

## 7. Demo path

```bash
cd frontend
MWT7D_FRONTEND_PORT=3100 PORT=3100 npm run dev
# open http://127.0.0.1:3100/
```

Then follow DEMO_SCRIPT.md: Audit → audit-review-surface → Memory →
memory-governance-surface → readiness report walkthrough → live preflight.

---

## 8. Reporting template (how to upgrade READY_WITH_ENV_BLOCKERS → READY)

Generate a readiness report:

```bash
npx tsx scripts/trst/run-private-beta-report.mts
```

To reach full `READY` (per BETA_ACCEPTANCE_CRITERIA.md):

1. Provide `DATABASE_URL` (Postgres reachable) + gateway config.
2. Re-run `npm run validate` — TRST-4H-III sections must transition to `PASS`.
3. Confirm zero `FAIL` and zero `ENV_BLOCKED`.
4. Re-run `npm run beta:check` — it will now assert `READY`.

Until then, the honest verdict is `READY_WITH_ENV_BLOCKERS`. **Do not claim `READY`
while ENV_BLOCKED remains.**

---

## 9. Escalation path for blockers

| Blocker | Owner | Action |
|---------|-------|--------|
| TRST-4H-III `ENV_BLOCKED` | env owner | set `DATABASE_URL` + gateway config |
| Browser harness `ENV_BLOCKED` | operator | install Chrome, or skip (deterministic still PASS) |
| Real `FAIL` in `npm run validate` | code owner | fix code, do not reclassify |
| GitHub push network blocked | env/network | retry when network recovers; record in KNOWN_BLOCKERS.md |

All blockers must be documented in KNOWN_BLOCKERS.md and classified honestly
(environment, not code failure). See RELEASE_CHECKLIST.md before any drop.
