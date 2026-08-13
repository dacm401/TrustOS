# Reviewer Session Guide — MWT-10

Runbook for the first private-beta reviewer session. The system is currently a
**Private Beta Candidate** (`READY_WITH_ENV_BLOCKERS`): deterministic + browser
paths are validated; the live TRST-4H-III sections remain `ENV_BLOCKED` until a
live DB/gateway is supplied.

> Reviewer sessions are allowed in the **Candidate** state, provided the
> blockers below are disclosed up front.

## 1. Pre-session checklist

- [ ] Operator completed `QUICKSTART.md` (install, env copy, validate, beta:check).
- [ ] Reviewer has the demo machine / browser access.
- [ ] Known blockers disclosed (see §4).
- [ ] `REVIEWER_FEEDBACK_TEMPLATE.md` ready to capture notes.

## 2. Demo path

Walk the reviewer through three areas:

### A. Audit (Trust Spine)
- Open the audit UI.
- Show an audit artifact / review replay.
- Point out tamper-evident hashes (no raw content shown).

### B. Memory (Memory Governance)
- Open the Memory Governance UI.
- Show the evaluator result + governance view.
- Confirm browser-verified flows work.

### C. Readiness report
- Run `npx tsx scripts/trst/run-private-beta-report.mts`.
- Explain the honest verdict `READY_WITH_ENV_BLOCKERS`.
- Show the `KNOWN_BLOCKERS.md` entry for TRST-4H-III.

## 3. Questions for reviewer

- Is the audit trail understandable without training?
- Can you verify an artifact without seeing raw content?
- Does Memory Governance surface the right control signals?
- Any UX friction in the three demo paths?
- Would you trust this for a pilot with real (non-prod) data?

## 4. Known blockers disclosure (must read aloud)

| Blocker | Status | Impact |
|---------|--------|--------|
| TRST-4H-III live (×2) | `ENV_BLOCKED` | DB/gateway not provided in this pack; live route-message + model availability not exercised here |
| Browser harness | needs Chrome | `ENV_BLOCKED` in Chrome-less env |
| Streaming | unsupported | `stream=true` -> `UNSUPPORTED_STREAMING` (future charter) |

These are **environment dependencies**, not code failures.

## 5. Expected feedback format

Capture per `REVIEWER_FEEDBACK_TEMPLATE.md`:

- environment
- validation result
- UI feedback
- trust/audit feedback
- memory governance feedback
- blockers encountered
- severity
- recommendation: `continue` / `fix before beta` / `reject`
