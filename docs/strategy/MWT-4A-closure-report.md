# MWT-4A Closure Report — Task Evidence Projection

**Status:** SEALED ✅
**Date:** 2026-08-10
**PM Final Sign-off:** Yes

## 1. Summary

MWT-4A delivers a **frontend-only, read-only, on-demand** projection of task evidence
over MWT-3B1 `task_id`-correlated Gateway events. It does not introduce durable
evidence state, backend APIs, policy semantics, `run_id`/`trace_id` identities, or
raw content exposure.

The feature lets a reviewer select a task in `TaskPanel` and see a `TaskEvidenceView`
with (a) an aggregated summary card and (b) a privacy-safe timeline of correlated
events, derivable only from existing Gateway event metadata.

## 2. Deliverables (7 files, frontend-only + 1 script)

| File | Type | Role |
|---|---|---|
| `frontend/src/components/workbench/TaskEvidenceView.tsx` | NEW | Summary card + privacy-safe timeline |
| `frontend/src/hooks/useTaskEvidence.ts` | NEW | React wrapper over fetch + pure aggregation |
| `frontend/src/types/task-evidence.ts` | NEW | `TaskEvidenceSummary` / `TaskEvidenceState` types |
| `frontend/src/lib/taskEvidence.ts` | NEW | `aggregateTaskEvidence` / `sortEventsByTimestamp` / `buildTaskEvidenceState` pure fns |
| `frontend/src/lib/api.ts` | MODIFY | `fetchGatewayEventsByTask(taskId)` — wraps MWT-3B1 `GET /v1/events?task_id=` |
| `frontend/src/components/workbench/TaskPanel.tsx` | MODIFY | Selection state + view switch |
| `frontend/src/components/manager-workspace/ManagerWorkspace.tsx` | MODIFY | Mount `TaskPanel` (ACCEPTED frontend-only exception) |
| `scripts/mwt4a/run-smoke.mts` | NEW | Deterministic seeded smoke (no live Gateway) |

## 3. Acceptance Criteria Results

| AC | Result | Evidence |
|---|---|---|
| AC1 selection renders / projection path | ✅ | S1 deterministic projection |
| AC2 `/events?task_id` wrapper path | ✅ | `fetchGatewayEventsByTask` wraps MWT-3B1 endpoint |
| AC3 summary aggregates | ✅ | S5 tokens/cost summed |
| AC4 allow/deny/unknown explicit-only | ✅ | No inference from `error_code` |
| AC5 timeline ordered | ✅ | `sortEventsByTimestamp` ascending |
| AC6 privacy-safe detail | ✅ | `SAFE_META_KEYS` excludes raw fields |
| AC7 existing hash display only | ✅ | Only `event_hash`/`input_hash`/`output_hash` shown |
| AC8 empty state | ✅ | S2 zero summary, no crash |
| AC9 EvidenceReportPanel unchanged | ✅ | Not in MWT-4A scope |
| AC10 no backend/schema/run/trace | ✅ | S9 scope gate |
| AC11 frontend typecheck no new errors | ✅⚠️ | NO_NEW_ERRORS; 77 pre-existing baseline remain |
| AC12 frontend build pass | ✅ | Build exit 0 (5/5 static pages) |

## 4. Verification

```text
MWT-4A Smoke:        26 PASS / 0 FAIL / 0 SKIP  ✅ (deterministic, no live Gateway)
Frontend Build:      PASS (5/5 static pages)     ✅
Backend TSC:         0 errors                    ✅
MWT-3B1 Smoke:       8/8 PASS                    ✅ (no regression)
Frontend TSC:        NO_NEW_ERRORS               ✅ (77 pre-existing baseline)
```

## 5. PM Seal Blocker (resolved)

Pre-fix smoke was `1 PASS / 0 FAIL / 8 SKIP` because live Gateway 500 caused the
data-layer cases to be skipped. PM required a deterministic smoke independent of
live Gateway. Fix: extracted `aggregateTaskEvidence` pure fn + seeded fixtures.
Post-fix smoke: `26 PASS / 0 FAIL / 0 SKIP`.

## 6. Scope Boundaries (confirmed)

- ✅ frontend-only
- ✅ no backend / API / schema / Gateway changes
- ✅ EvidenceReportPanel unchanged
- ✅ no durable evidence table
- ✅ no export / signing
- ✅ no policy / approval / enforcement
- ✅ no `run_id` / `trace_id`
- ✅ no raw prompt / output display
- ✅ v1 stash untouched

## 7. Known Limitations / Follow-ups

- Frontend typecheck has **77 pre-existing baseline errors** unrelated to MWT-4A.
  Candidate for separate `TRST-frontend-typecheck-baseline-cleanup` brief.
- `ManagerWorkspace.tsx` backend metadata wiring is a separate backlog item (pre-existing).
- MWT-4B (Export/Signing) and MWT-5 (Policy/Approval) are NOT authorized.

## 8. Final Statement

```text
MWT-4A Task Evidence Projection: SEALED ✅
Task Evidence is now a frontend-only, read-only, on-demand projection over
MWT-3B1 task_id-correlated Gateway events. No durable state, no backend APIs,
no policy semantics, no run/trace identities, no raw content exposure.
```
