# Private Beta Release Checklist — MWT-8

Run through this checklist before declaring a private-beta drop. Updated 2026-08-12.

## Pre-release

- [ ] **1. Git status clean**
  ```bash
  git status --short   # must be empty (or only intentional, documented untracked)
  ```

- [ ] **2. Validation run**
  ```bash
  npm run validate
  ```
  Expect: deterministic `41 PASS / 0 FAIL`; live `3 PASS / 2 ENV_BLOCKED / 0 FAIL`;
  overall `READY_WITH_ENV_BLOCKERS`. Any `FAIL` blocks release.

- [ ] **3. Frontend + backend typecheck**
  ```bash
  cd frontend && npx tsc --noEmit   # expect 0 errors
  npx tsc --noEmit                  # backend, expect 0 errors
  ```

- [ ] **4. Browser harness smoke**
  ```bash
  npx tsx scripts/frontend/run-browser-harness-smoke.mts
  ```
  Expect `PASS` (or `ENV_BLOCKED` if no Chrome — documented, not a release blocker).

- [ ] **5. Live preflight**
  ```bash
  npx tsx scripts/trst4h-iii/run-live-preflight.mts
  ```
  Review DB/gateway readiness table; confirm TRST-4H-III blockers are explicit.

- [ ] **6. Known blockers reviewed**
  Read `KNOWN_BLOCKERS.md`. Confirm TRST-4H-III + any network/push blockers are
  documented and correctly classified as environment, not code failure.

- [ ] **7. GitHub push synced OR network-blocked documented**
  ```bash
  git push origin feature/trst-3-private-beta-readiness
  ```
  If blocked by network, record it in `KNOWN_BLOCKERS.md` §2 and proceed — it is
  not a code-readiness failure.

- [ ] **8. No cache/binary committed**
  Verify no `node_modules`, `.next`, Playwright browser binaries, or other cache
  are staged. `.gitignore` must cover them.

## Release artifacts

- [ ] `docs/private-beta/RUNBOOK.md`
- [ ] `docs/private-beta/VALIDATION.md`
- [ ] `docs/private-beta/DEMO_SCRIPT.md`
- [ ] `docs/private-beta/ENVIRONMENT.md`
- [ ] `docs/private-beta/KNOWN_BLOCKERS.md` (this file)
- [ ] `docs/private-beta/RELEASE_CHECKLIST.md` (this file)
- [ ] `scripts/trst/run-private-beta-check.mts`

## Acceptance gate

- **READY_WITH_ENV_BLOCKERS** is an acceptable private-beta state as long as all
  `ENV_BLOCKED` items are documented in `KNOWN_BLOCKERS.md` and no `FAIL` exists.
- Do **not** claim `READY` while TRST-4H-III remains `ENV_BLOCKED`.
