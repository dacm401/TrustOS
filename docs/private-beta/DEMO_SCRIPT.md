# Private Beta Demo Script — MWT-8

User-visible demo path for the Trust Spine + Memory Governance surfaces. Use this
to show a reviewer the private-beta capabilities end-to-end in a browser.

## Prerequisites

- Frontend running on `:3100` (or `:3000`):
  ```bash
  cd frontend && MWT7D_FRONTEND_PORT=3100 PORT=3100 npm run dev
  ```
- Optional (automated): `npx tsx scripts/frontend/run-browser-harness-smoke.mts`
  drives the same path in real Chrome and asserts visibility.

## Demo steps

### 1. Open frontend
Open `http://127.0.0.1:3100/`. The app shell + sidebar render with no runtime or
hydration errors.

### 2. Sidebar → Audit
Click **Audit** (`nav-audit`).
Show:
- `audit-review-surface` is visible.
- Approval status, evidence report, provenance binding, and review/replay status
  are presented for the selected record.
- The reviewer explanation is human-readable (risk/control/evidence in plain language).

### 3. Sidebar → Memory
Click **Memory** (`nav-memory`).
Show:
- `memory-governance-surface` is visible.
- Governance status: sensitivity classification, retention policy, references,
  and content fingerprint are displayed.
- Explain how Memory Governance evaluates and governs stored content.

### 4. Readiness report
Open a terminal and run:
```bash
npm run validate
```
Walk the reviewer through:
- Deterministic: `41 PASS / 0 FAIL`.
- Live: browser harness `PASS`, TRST-4H-III `ENV_BLOCKED` (explicit reason).
- Overall: `READY_WITH_ENV_BLOCKERS`.

Explain that `ENV_BLOCKED` means "provide `DATABASE_URL` + gateway config to run
the live Manager route-message sections", not a code failure.

### 5. Live env preflight (optional)
```bash
npx tsx scripts/trst4h-iii/run-live-preflight.mts
```
Show the explicit DB/gateway readiness table — config presence only, no real
network call.

## Talking points
- **Code readiness:** PASS. Frontend + backend typecheck clean.
- **Browser runtime readiness:** PASS (real Chrome click path verified).
- **Validation taxonomy:** strict; `FAIL` is never hidden.
- **Live external integration:** `ENV_BLOCKED` with explicit reasons until DB/gateway
  are configured.

## Known gaps (show honestly)
- TRST-4H-III live sections require live Postgres + gateway; not run in this sandbox.
- See KNOWN_BLOCKERS.md for the full list.
