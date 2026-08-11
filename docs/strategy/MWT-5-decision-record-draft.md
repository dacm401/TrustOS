# MWT-5 Decision Record Draft

> **Status**: DECISION_FRAMING_ONLY ✅ (implementation NOT authorized)
> **Date**: 2026-08-10
> **Program**: TRST Forward Planning & Readiness Program — Workstream C
> **Companion**: `MWT-5-option-matrix.md`, `MWT-5-architecture-prebrief.md`, `MWT-5-risk-register.md`
> **Note**: Defaults below are RECOMMENDATIONS, not PM approvals. Each "Required PM answer"
> must be filled by PM before any MWT-5 implementation brief is written.

## 0. Purpose

Pre-frame the 5 MWT-5 PM decision points so the PM can answer them in one pass and get a
decision record. Each decision has: statement, options, recommended default, pros, cons,
implementation impact, testing impact, risk if deferred, required PM answer.

---

## D1. Ordering vs MWT-4E

- **Decision statement**: Should MWT-5 (approval dry-run) be implemented before or after
  MWT-4E (authenticated identity)?
- **Options**:
  - O1. MWT-5 first, MWT-4E after (approval can be advisory without strong identity).
  - O2. MWT-4E first, then MWT-5 (approval binds to a real actor).
  - O3. Parallel / independent (both can start from separate seams).
- **Recommended default**: O1 — MWT-5 is advisory-only and does not require strong
  identity; deferring identity keeps MWT-5 lightweight.
- **Pros (O1)**: faster to value; no identity dependency; matches "evidence/reporting
  first" principle; lower risk.
- **Cons (O1)**: approval actor is weakly identified until MWT-4E lands.
- **Implementation impact**: MWT-5 stays read-side + local state; no auth integration.
- **Testing impact**: no identity test needed; MWT-4E tests added later.
- **Risk if deferred**: none acute; MWT-5 simply waits, but reviewer value is delayed.
- **Required PM answer**: O1 / O2 / O3?

---

## D2. Persistence model

- **Decision statement**: Where does an approval decision record live?
- **Options**:
  - O1. Append-only JSONL sidecar (no schema change, mirrors event store style).
  - O2. New SQLite table (structured, queryable, needs migration).
  - O3. In-memory / session-only (no persistence; advisory preview only).
- **Recommended default**: O1 — append-only JSONL keeps MWT-5 inside the no-schema-change
  boundary and matches the existing event envelope philosophy.
- **Pros (O1)**: zero migration; tamper-evident by hash chain; reuses envelope patterns.
- **Cons (O1)**: weaker queryability than SQL.
- **Implementation impact**: a writer + reader for a JSONL approval log; no DB change.
- **Testing impact**: deterministic regression on append + hash-chain verification.
- **Risk if deferred**: MWT-5 cannot persist approvals → only demo-grade.
- **Required PM answer**: O1 / O2 / O3?

---

## D3. Identity primitive

- **Decision statement**: What identifies the approver?
- **Options**:
  - O1. Opaque `approver_id` string (free text / handle), no auth.
  - O2. Reuse existing actor label from event envelope (e.g. `agent_id` / session user).
  - O3. Wait for MWT-4E authenticated identity.
- **Recommended default**: O1 — minimal, no auth coupling; upgrade to O3 later.
- **Pros (O1)**: ships without MWT-4E; simple.
- **Cons (O1)**: not cryptographically bound to a real person.
- **Implementation impact**: a string field on the approval record.
- **Testing impact**: string presence + non-empty assertion only.
- **Risk if deferred**: approvals are unattributable until MWT-4E.
- **Required PM answer**: O1 / O2 / O3?

---

## D4. TrstEventType schema gate

- **Decision statement**: Does adding an `approval` event type require a schema-gate
  decision, or reuse an existing type?
- **Options**:
  - O1. Add new `approval` TrstEventType (requires schema gate + migration if persisted).
  - O2. Reuse existing envelope, mark approval as a sidecar record (not a new event type).
  - O3. Gate new event types behind explicit PM schema approval (global rule).
- **Recommended default**: O2 for MWT-5 dry-run; O3 as the standing rule (see risk R10).
- **Pros (O2+O3)**: no `TrstEventType` union expansion; enforces the frozen schema gate.
- **Cons (O2)**: approval not visible in the core event graph until later.
- **Implementation impact**: approval is a sidecar JSONL, not a new event type.
- **Testing impact**: existing envelope regression (24/0) stays untouched.
- **Risk if deferred**: new event types creep in without review → schema drift.
- **Required PM answer**: Approve O2 for MWT-5 + adopt O3 as global gate?

---

## D5. Advisory-vs-enforce boundary

- **Decision statement**: Is MWT-5 approval advisory (record only) or enforcing (blocks
  a downstream action)?
- **Options**:
  - O1. Advisory only — records the decision, never blocks.
  - O2. Soft-enforce — warns if an unapproved item proceeds.
  - O3. Hard-enforce — blocks until approved (requires policy engine → out of MWT-5).
- **Recommended default**: O1 — MWT-5 is explicitly "dry-run / advisory" per prebrief.
- **Pros (O1)**: no policy engine; no enforcement coupling; safe.
- **Cons (O1)**: does not prevent mistakes, only records intent.
- **Implementation impact**: write-side only; no control-layer gating.
- **Testing impact**: assert record created; assert no downstream action altered.
- **Risk if deferred**: scope creep into enforcement (MWT-7 territory).
- **Required PM answer**: O1 / O2 / O3?

---

## 1. Decision summary table (for PM one-pass answer)

| ID | Question | Recommended | PM answer |
|----|----------|-------------|-----------|
| D1 | Ordering vs MWT-4E | O1 (MWT-5 first) | ⏳ |
| D2 | Persistence model | O1 (JSONL sidecar) | ⏳ |
| D3 | Identity primitive | O1 (opaque approver_id) | ⏳ |
| D4 | TrstEventType gate | O2+O3 | ⏳ |
| D5 | Advisory vs enforce | O1 (advisory) | ⏳ |

## 2. Validation implications

Documentation only. No `npm run validate` impact. This draft becomes a signed decision
record only when PM fills the "PM answer" column.
