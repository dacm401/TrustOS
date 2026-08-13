# Private Beta Candidate Status

> Release marker for MWT-9F Push Sync & Beta Candidate Tag v0.
> This is a documentation marker, not a generated runtime artifact.

## Candidate marker

- **Tag:** `private-beta-candidate-v0`
- **Commit:** `c4bb593`
- **Branch:** `feature/trst-3-private-beta-readiness`
- **Date:** 2026-08-13

## Readiness

| Area | Status |
|---|---|
| Deterministic validation | PASS (offline) |
| Browser harness smoke | PASS (offline) |
| TRST-4H-III live | ENV_BLOCKED (DB + gateway required) |
| Backend typecheck | 0 errors |
| beta:check | 48 PASS / 0 FAIL |
| Secrets | none committed |
| Verdict | **READY_WITH_ENV_BLOCKERS** (not READY) |

## What this marker means

- The private beta operator onboarding + release-gate workflow is code-complete and
  synced to GitHub.
- New operators can follow `QUICKSTART.md` / `OPERATOR_ONBOARDING.md` without guessing.
- Full READY requires supplying `[LIV]` variables (`DATABASE_URL` + gateway pair) and
  re-running `npm run validate` so TRST-4H-III transitions from ENV_BLOCKED to PASS.
- This marker does **not** claim Full READY. The live env is not provided in this pack.

## Promotion path to Full READY

1. Provide `DATABASE_URL` (reachable Postgres) + gateway config (`OPENAI_*` or `GATEWAY_*`).
2. `npm run validate` → TRST-4H-III live PASS.
3. `npm run beta:check` → asserts READY when blockers clear.
4. Re-tag / re-mark as Full READY candidate.

## MWT-11 status (2026-08-13)

- **Live env provisioning:** NOT performed in CI/agent environment — no reachable
  Postgres or gateway credentials available here. Operator must supply `[LIV]`
  vars locally (`.env` is gitignored, never committed).
- **Reviewer feedback archive:** `reviewer-feedback/` created with README + sanitized
  `session-001-template.md`. Real sessions recorded only after live env is supplied.
- **Full readiness gates run (offline):** `npm run validate` exit 0; `run-live-activation-check.mts`
  exit 0; `run-private-beta-report.mts` exit 0.
- **Verdict:** still `READY_WITH_ENV_BLOCKERS` (TRST-4H-III ×2 ENV_BLOCKED). No false READY.
- **Secrets:** none committed; `.env` gitignored + untracked; reports presence-only.

## MWT-12 operator runbook (2026-08-13)

- **MWT-12 Operator Live Run & First Reviewer Evidence v0:** AUTHORIZED_FOR_OPERATOR_ENV.
- Single entry point for operator execution: `MWT-12-OPERATOR-RUNBOOK.md`.
- Covers: `[LIV]` prerequisites, four gate commands, reviewer session flow,
  decision rules, and the 12-section completion-report format.
- Agent/CI must NOT run MWT-12 (no real `[LIV]` credentials here). Operator-only.
