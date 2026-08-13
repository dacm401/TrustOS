# MWT-12 Operator Live Run & First Reviewer Evidence — Operator Runbook

> Milestone: MWT-12 Operator Live Run & First Reviewer Evidence v0
> Mode: **Live Operator Execution** (operator-only; never run by agent/CI)
> Authorized: PM 2026-08-13 — log anchor `e0772e0`
> Branch: `feature/trst-3-private-beta-readiness`

This runbook is the single entry point for executing MWT-12 in a real operator
environment. It collects the four gate commands, the reviewer-session flow, the
decision rules, and the 12-section completion-report format into one checklist.

It complements (does NOT replace):
- `RELEASE_CHECKLIST.md` — generic private-beta pre-release checklist
- `REVIEWER_SESSION_GUIDE.md` — how to run the reviewer demo
- `REVIEWER_FEEDBACK_TEMPLATE.md` — sanitized feedback capture template
- `LIVE_ENV_ACTIVATION.md` — live env prerequisites and semantics

---

## 0. Hard constraints (do not violate)

- **Never commit `.env`.** It is gitignored + untracked. A committed secret is a
  release blocker and a rejection condition.
- **Never print secret VALUES** (DATABASE_URL, API keys, gateway keys) into
  logs, docs, chat, or the completion report. Report **presence only**
  (`present` / `missing`) or **masked** (`sk-…`, `postgres://…:…@host`).
- **Never claim `READY`** while TRST-4H-III remains `ENV_BLOCKED`.
- **Never fake live run or reviewer session.** Real `[LIV]` DB/gateway + a real
  human reviewer are required. Missing them is `ENV_BLOCKED`, not `FAIL`.
- **Sanitize reviewer feedback.** No personal name / handle / email unless the
  reviewer explicitly approves.

---

## 1. Prerequisites (local operator environment only)

Provide these in your local `.env` (never commit it):

```text
DATABASE_URL=postgres://<user>:<pass>@<host>:<port>/<db>   # reachable Postgres
```

Plus ONE of the following pairs:

```text
OPENAI_BASE_URL=https://...
OPENAI_API_KEY=sk-...
```

or

```text
GATEWAY_ENDPOINT=https://...
GATEWAY_API_KEY=...
```

If you cannot supply these, **stop** — MWT-12 cannot proceed, and the verdict
stays `READY_WITH_ENV_BLOCKERS`. Do not substitute fake values.

---

## 2. Setup

```bash
git checkout feature/trst-3-private-beta-readiness
git pull

cp .env.private-beta.example .env
# Edit .env locally: fill [LIV] vars above. Do NOT commit .env.
```

---

## 3. Gate commands (run in order)

Each command is offline-safe and exits non-zero only on a real code/assertion
failure (not on `ENV_BLOCKED`). Capture the **counts / verdict only** — never
paste secret values.

### 3.1 beta:check
```bash
npm run beta:check
```
Expect: `Checks: 48 passed, 0 failed` (offline pack-consistency).

### 3.2 Live activation check
```bash
npx tsx scripts/trst4h-iii/run-live-activation-check.mts
```
With `[LIV]` env supplied, `database` / `gateway` / `TRST-4H-III` should move
from `ENV_BLOCKED` to `PASS`. Secret-masking self-test must stay `PASS`.

### 3.3 Full validation
```bash
npm run validate
```
Expect: deterministic `41 PASS / 0 FAIL`; live should transition from
`3 PASS / 2 ENV_BLOCKED / 0 FAIL` toward `5 PASS / 0 ENV_BLOCKED / 0 FAIL` once
DB + gateway are reachable. Overall verdict moves
`READY_WITH_ENV_BLOCKERS` → `READY`.

### 3.4 Readiness report
```bash
npx tsx scripts/trst/run-private-beta-report.mts
```
Expect verdict `READY` (was `READY_WITH_ENV_BLOCKERS`). 9/9 onboarding docs,
no false READY.

---

## 4. Reviewer session

Follow `REVIEWER_SESSION_GUIDE.md`:
1. Pre-session checklist (operator done, reviewer has machine/browser, blockers
   disclosed).
2. Demo paths A (Audit) / B (Memory) / C (Readiness report).
3. Ask the five reviewer questions.
4. Capture feedback using `REVIEWER_FEEDBACK_TEMPLATE.md` (or copy
   `reviewer-feedback/session-001-template.md` to
   `reviewer-feedback/session-001-<role>.md`).

Record **role only**, no personal data. Mark demo paths completed yes/no.
List blockers encountered (distinguish `ENV_BLOCKED` vs real `FAIL`).
Assign severity (`none` / `low` / `medium` / `high` / `critical`) and
recommendation (`continue` / `fix before beta` / `reject`).

---

## 5. Decision rules

| Outcome | Condition |
|---|---|
| **Full READY** | no FAIL + no ENV_BLOCKED + TRST-4H-III PASS + reviewer `continue` + no high/critical blocker |
| **Remain Candidate** | no FAIL but some ENV_BLOCKED remains + reviewer can continue with disclosed blockers |
| **Fix Before Beta** | medium/high blocker found OR reviewer cannot complete core demo |
| **Rejected** | any real validation FAIL / critical trust-audit-memory issue / false READY claim / secret leakage |

Promotion from Private Beta Candidate → Full READY requires **Full READY** above
AND PM review of the sanitized evidence.

---

## 6. Completion report (12 sections)

Produce this and hand it back to PM (sanitized):

```text
MWT-12 Completion Report

1. Operator environment
   - DB: present/missing only
   - gateway: present/missing only
   - no secret values

2. beta:check result
   - PASS / FAIL counts only

3. live activation check result
   - database: present/missing/reachable/unreachable only
   - gateway: present/missing/reachable/unreachable only
   - TRST-4H-III: PASS / ENV_BLOCKED / FAIL
   - overall verdict

4. full validation result
   - deterministic count
   - live count
   - overall verdict

5. readiness report verdict

6. TRST-4H-III status

7. Reviewer session summary
   - role only
   - no personal data
   - demo paths completed
   - blockers encountered

8. Feedback classification
   - severity
   - recommendation

9. Promotion decision
   - Full READY / Remain Candidate / Fix Before Beta / Rejected

10. Files changed
    - sanitized feedback only

11. Commit / push status

12. Confirmation
    - no secrets committed
    - no false READY
    - reviewer data sanitized
    - live result classified honestly
```

Do NOT paste: DATABASE_URL, API key, gateway key, reviewer personal
name/email, or raw logs containing credentials.

---

## 7. If you cannot complete MWT-12

If live env or a human reviewer is unavailable, **stop and report**:
`MWT-12 WAITING_FOR_OPERATOR_EVIDENCE`. Do not fake results. The system remains
a Private Beta Candidate (`READY_WITH_ENV_BLOCKERS`); this is a correct state,
not a failure.
