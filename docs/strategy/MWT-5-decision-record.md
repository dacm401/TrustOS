# MWT-5 Decision Record

> **Status**: PM_RATIFIED ✅ (agent-default D1–D5 ratified by PM seal decision 2026-08-11;
> D2 scoped as client-side JSONL approval artifact for v0 — non-authoritative, user-downloaded,
> not backend durable, not multi-user, not enforcement)
> **Date**: 2026-08-10 (decisions) / 2026-08-11 (executed)
> **Program**: TRST Forward Planning & Readiness Program → autonomous completion mandate
> **Companion**: `MWT-5-decision-record-draft.md`, `MWT-5-option-matrix.md`, `MWT-5-architecture-prebrief.md`
> **Note**: Per "complete all work" authorization, the agent adopts the recommended
> defaults below as the recorded decision. These are agent-default decisions pending PM
> ratification; PM retains override authority and any change re-opens the relevant decision.

## Recorded decisions

| ID | Decision | Adopted option | Rationale |
|----|----------|----------------|-----------|
| D1 | Ordering vs MWT-4E | **O1** — MWT-5 first, MWT-4E after | Approval can be advisory without strong identity; matches "evidence/reporting first"; lower risk. |
| D2 | Persistence model | **O1** — append-only JSONL sidecar | No schema migration; tamper-evident by hash chain; reuses envelope philosophy. |
| D3 | Identity primitive | **O1** — opaque `approver_id` string | Ships without MWT-4E coupling; upgrade later. |
| D4 | TrstEventType schema gate | **O2+O3** — sidecar record (no new event type) + global schema-gate rule | Keeps MWT-5 out of `TrstEventType` union; R10 enforced standing. |
| D5 | Advisory-vs-enforce boundary | **O1** — advisory only | No policy engine; no enforcement coupling; safe. |

## Binding constraints (from decisions)

1. MWT-5 emits a client-side JSONL sidecar artifact (`approvals-<taskId>.jsonl`), NOT a
   new `TrstEventType`. "Sidecar" here means a downloaded/local audit artifact, NOT a
   backend-enforced durable ledger (see §Validation implications for persistence semantics).
2. No SQLite migration; no new DB table.
3. `approver_id` is a free string; not cryptographically bound to a person.
4. Approval is recorded, never blocks any downstream action.
5. Any new `TrstEventType` anywhere in the repo requires an explicit PM schema-gate decision (R10 standing rule).

## Implementation brief reference

See `MWT-5-implementation-brief.md` (skeleton, not yet coded) for the planned build
sequence, validation sequence, and rollback.

## Re-open conditions

PM overrides any D1–D5 → that decision returns to `MWT-5-decision-record-draft.md` OPEN
state and the brief is revised before coding.

## Validation implications

MWT-5 is now IMPLEMENTED (2026-08-11). Code:
- `frontend/src/lib/approval-record.ts` — `ApprovalRecord` type, `buildApprovalRecordSync` /
  `buildApprovalRecordAsync`, `verifyApprovalChain` / `verifyApprovalChainSync`, JSONL
  serialize/parse. Append-only sidecar, hash-chain tamper-evidence, no new TrstEventType.
- `frontend/src/components/workbench/TaskEvidenceView.tsx` — advisory approval panel
  (approver_id / decision / note), downloads `approvals-<taskId>.jsonl`, never blocks export.
- `scripts/mwt5/run-smoke.mts` (9/0) + `run-regression.mts` (17/0).
- `scripts/trst/run-validation.mts` — sections 10/11 added.

Baseline: 9/9 → **11/11 PASS**. No `npm run validate` regression. No new dependency.
