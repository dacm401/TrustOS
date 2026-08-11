# MWT-5 Architecture Prebrief — Manager Policy & Approval (Dry-run)

> **Status**: ARCHITECTURE_RESEARCH_ONLY ✅ (read-only; implementation NOT authorized)
> **Date**: 2026-08-10
> **Companion**: `MWT-5-policy-approval-prebrief.md` (policy scope + draft ACs)
> **Baseline frozen refs**: MWT-4A SEALED ✅, MWT-3B1 (control layer) SEALED ✅
> **Scope guard**: No product code, no routes/components/backend logic, no schema/Gateway/SQLite change, no deps, no MWT-4B/export/signing, no policy/run_id/trace_id addition.

## 0. Relationship to existing MWT-5 docs

This document is the **architecture** prebrief. It complements, and does not replace,
`MWT-5-policy-approval-prebrief.md`:

| Doc | Answers |
|-----|---------|
| `MWT-5-policy-approval-prebrief.md` | What MWT-5 *is* (policy tier, user-mediated, draft ACs) |
| **This doc** | *Where* it plugs in, *what seams exist today*, *what boundaries a future impl must respect*, *how to test it* |

Both remain planning-only. Neither authorizes implementation.

## 1. Repo areas inspected (read-only)

| Area | File / Path | Relevance to MWT-5 |
|------|-------------|--------------------|
| Event envelope + types | `src/services/trst1/event-envelope.ts` | `control_decision` (allow/deny/unknown/block) is the natural hook; `TrstEventType` union currently has NO `approval_request`/`approval_decision` |
| Sealing/hash | same file (`sealEvent`, `computeEventHash`) | Approval events, if added, must follow the same tamper-evident envelope contract |
| Frontend evidence view | `frontend/src/components/workbench/TaskEvidenceView.tsx` | `EventRow` already renders `control_decision`; natural attach point for an approval action surface on deny/unknown |
| Frontend data hook | `frontend/src/hooks/useTaskEvidence.ts` + `frontend/src/lib/taskEvidence.ts` | Read-only projection; aggregation already exposes `control.{allow,deny,unknown}` |
| Frontend API client | `frontend/src/lib/api.ts` | Existing `X-User-Id` header (identity primitive present), `patchTask` write pattern exists (resume/pause/cancel) → approval write endpoint can mirror this |
| Gateway read path | `frontend/src/lib/api.ts` → `GATEWAY_URL/events?task_id=` | Approval reads would reuse the existing task-scoped event query |
| Durable store | `src/db/task-archive-repo.ts` + migration `011_task_archive_events.sql` | Candidate backing store for approval records (if approvals persist as events in the archive) |

**Key finding**: The read side (display of `control_decision`, task-scoped event fetch) is already
sealed and reusable. The **write side** (recording an approval) does not exist yet and would
require (a) a new event type in `TrstEventType`, and (b) a backend persistence path — both of which
are explicitly out of scope for this prebrief and gated behind MWT-4E (identity) + durable-store
strategy per the existing policy prebrief.

## 2. Proposed architecture boundaries (for future implementation)

> These are **interface boundaries only** — no code written. They describe where a future MWT-5
> implementation would plug in, derived from seams observed in §1.

### 2.1 Layering (per five-layer architecture + MWT-5 principle)

```
L1 Interaction:   Approval action surface attached to TaskEvidenceView EventRow (deny/unknown only)
                  → emits user decision to L2
L2 Manager:       Approval orchestration: captures decision, attaches identity, builds approval event
                  (user-mediated; NO automated blocking logic here)
L3 Worker/Tool:   (unaffected in MWT-5)
Gateway/Trust:    Records approval_request + approval_decision as tamper-evident events
                  (reuses sealEvent envelope; NO enforcement/blocking)
```

Core principle (from roadmap §8.2 / policy prebrief): **Manager evaluates → user decides → Gateway
records**. The task stops only because the *user* chose to stop, not because a policy engine enforced
blocking. MWT-5 is **approval capture**, not enforcement.

### 2.2 Minimal interface sketch (boundary contracts, not code)

| Boundary | Direction | Contract shape (sketch) |
|----------|-----------|-------------------------|
| UI → Manager | emit decision | `{ taskId, eventId, decision: "approve"|"reject"|"request_changes", note?, actorId }` |
| Manager → Gateway | record event | new `approval_request` / `approval_decision` `TrstEventType` (requires `TrstEventType` extension) |
| Gateway → Store | persist | append to event archive (reuse `task-archive-repo` pattern); tamper-evident via `sealEvent` |
| Store → UI | read back | approval events appear in existing `fetchTaskTraces(taskId)` stream; `TaskEvidenceView` renders them |

### 2.3 What must NOT change (frozen seams)

- `control_decision` semantics on existing events (allow/deny/unknown) — MWT-5 reads, never rewrites.
- MWT-4A projection purity (`aggregateTaskEvidence` stays read-only, no approval logic).
- Privacy boundary: no raw prompt/output/provider-payload in approval UI or approval events.

## 3. Risks / open questions

| # | Risk / Question | Severity | Notes |
|---|-----------------|----------|-------|
| R1 | Approval persistence needs backend state | HIGH | Gated behind MWT-4E (authenticated identity) + durable store strategy |
| R2 | `TrstEventType` extension adds a schema change | MED | New event types must follow `sealEvent` envelope; needs PM charter |
| R3 | "Who approved" requires identity | HIGH | Current `X-User-Id` header is a primitive, not full auth; real identity is MWT-4E |
| R4 | Advisory vs enforcing confusion | MED | Must stay user-mediated; no blocking code (scope guard) |
| R5 | Approval UI on every deny/unknown = noise | LOW | Scope action surface to deny/unknown only; optional batch-approve later |
| R6 | Approval event replay / tamper | MED | Reuse existing `event_hash` chain; no new crypto |
| R7 | MWT-5 scope creep into policy DSL | MED | Policy *authoring* is a later charter; MWT-5 only captures decisions on existing control flags |

### Open questions for PM (carry from policy prebrief, still open)

1. Advisory only for first cohort, or enforce stop on deny?
2. Where do approvals persist: extend event archive, or a dedicated approval table?
3. Blocked on MWT-4E identity, or acceptable with `X-User-Id` primitive for Private Beta?
4. Does MWT-5 follow MWT-4E (per "identity/policy → enforcement last") — i.e. is MWT-5 itself deferred until identity lands?

## 4. Non-goals confirmed

- ❌ No enforcement / blocking engine (MWT-5 = capture, not enforce)
- ❌ No policy DSL / policy authoring (later charter)
- ❌ No `run_id` / `trace_id` *introduction* (they already exist on envelope; MWT-5 may read them, not add new ones)
- ❌ No raw content in approval UI or approval events
- ❌ No export/signing (MWT-4B)
- ❌ No schema/Gateway/SQLite change in this prebrief (architecture research only)
- ❌ No new dependencies

## 5. Future test strategy (for when implementation is authorized)

Derived from the sealed-flow validation harness pattern established in Batches 1–3:

| Layer | Test type | Approach (mirrors existing) |
|-------|-----------|------------------------------|
| Event envelope | deterministic regression | Extend `scripts/mwt3b1/run-regression.mts`: add `approval_request`/`approval_decision` to `TrstEventType`, assert `sealEvent` tamper-evidence holds for them |
| Aggregation | pure-function regression | Extend `scripts/mwt4a/run-regression.mts`: approval events must NOT alter token/cost sums; must be classified in a new `control.approval` bucket (or ignored) without breaking existing 57 asserts |
| Frontend | smoke (no vitest yet) | Add `scripts/mwt5/run-smoke.mts` mirroring MWT-3B1 smoke: render `TaskEvidenceView` with a deny event, assert approval action surface present, assert no raw content |
| Integration | gateway event append | New smoke phase asserting approval events appear in `fetchTaskTraces(taskId)` |
| Gate | aggregate | Add `MWT-5 Smoke` + `MWT-5 Regression` sections to `scripts/trst/run-validation.mts` (`npm run validate`) |

Test-safety guardrails (from standing backlog): no vitest/jest introduction unless separately
authorized; keep deterministic fixtures; no live-Gateway runtime as a gate.

## 6. Recommendation

Keep as architecture prebrief. MWT-5 implementation should **not** start until:
1. PM resolves the MWT-4E ordering question (identity before approval?), and
2. A durable-store strategy for approval records is chartered, and
3. `TrstEventType` extension is explicitly authorized (schema change gate).

This prebrief is safe to keep alongside `MWT-5-policy-approval-prebrief.md`; it adds the
*engineering seam map* needed before any implementation brief is drafted.

## 7. Authorization state

```text
MWT-5 implementation: NOT_AUTHORIZED ❌
MWT-5 architecture prebrief: ARCHITECTURE_RESEARCH_ONLY ✅ (this doc)
No product code written. No schema changed. No dependencies added.
```
