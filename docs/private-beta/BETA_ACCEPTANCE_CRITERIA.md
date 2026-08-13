# Private Beta Acceptance Criteria — MWT-9

Defines what it means to be a **Private Beta Candidate** vs **Full READY**, and what is
**Rejected**. This is the gate referenced by `npm run beta:check` and the readiness
report.

---

## 1. Private Beta Candidate

**Allowed current state:** `READY_WITH_ENV_BLOCKERS`

Required:

- No real `FAIL` (deterministic or live).
- Browser harness `PASS`, or explicitly `ENV_BLOCKED` with a documented reason
  (no Chrome installed).
- All `ENV_BLOCKED` items documented in KNOWN_BLOCKERS.md with explicit reasons.
- `beta:check` pack-consistency gate passes.
- Frontend + backend typecheck clean (0 errors).

> A Private Beta Candidate can be handed to a controlled private-beta operator **with**
> the KNOWN_BLOCKERS and ENVIRONMENT docs attached. It is not a full production release.

---

## 2. Full READY

**Required:**

- No `FAIL` (anywhere).
- No `ENV_BLOCKED` (anywhere).
- TRST-4H-III live sections `PASS` (requires `DATABASE_URL` + gateway config present
  and reachable).
- Browser harness `PASS`.
- `npm run validate` overall verdict = `READY`.
- `beta:check` asserts `READY`.

> Full READY means the external live environment is provisioned and the Manager
> route-message live path actually passes.

---

## 3. Rejected

Any of the following rejects the beta drop:

- Any **deterministic** `FAIL`.
- Any **browser runtime** `FAIL` (real Chrome click path failed, not env-blocked).
- Any **undocumented** blocker (an `ENV_BLOCKED` not present in KNOWN_BLOCKERS.md).
- Any **false `READY` claim** — asserting `READY` while `ENV_BLOCKED` remains.

---

## 4. Taxonomy boundary (must hold)

| Claim | Condition |
|-------|-----------|
| `READY` | no `FAIL`, no `ENV_BLOCKED` |
| `READY_WITH_ENV_BLOCKERS` | no `FAIL`, ≥1 `ENV_BLOCKED` (documented) |
| `FAIL` (reject) | any `FAIL` |

`ENV_BLOCKED` is **never** counted as `PASS`, and **never** silently converted to `FAIL`
for known environment signatures (narrow classifier — see VALIDATION.md).

---

## 5. Current standing

```text
Deterministic:  41 PASS / 0 FAIL
Live:           3 PASS / 2 ENV_BLOCKED / 0 FAIL
Overall:        READY_WITH_ENV_BLOCKERS   ← Private Beta Candidate (acceptable)
```

Acceptance: **Private Beta Candidate — PASS**. Full `READY` blocked only by TRST-4H-III
live env (environment dependency, not code failure).
