# TRST Release Notes — MWT-3B1 → MWT-4A

> **Status**: DOCUMENTATION_ONLY ✅ — consolidated release view.
> **Scope**: Sealed workstreams between MWT-3B1 (task_id correlation) and MWT-4A (Task Evidence Projection).
> **Date**: 2026-08-10

---

## 1. MWT-3B1 Sealed Summary

- Minimal nullable `task_id` correlation added to the event envelope (snake_case wire).
- Ingestion via trusted `X-TrustOS-Task-Id` header only; no Gateway auto-generation.
- `GET /v1/events?task_id=<id>` and `?task_id=null` (unassigned) query support.
- SQLite: idempotent `ALTER TABLE ADD COLUMN task_id TEXT` + index; JSONL rebuild, no backfill.
- Correlation-only semantics (not authorization).
- Smoke: 8/8 PASS. v1 stash untouched.

## 2. Backend Typecheck Cleanup Closed

- Baseline 12 errors → 0 errors.
- 3 files: `event-envelope.ts`, `event-index.ts`, `llm-gateway-server.ts`.
- Fixes: `request_mode` type declaration (9), `.get()` value cast (2), task_id completion on 3 envelope sites (3).
- MWT-3B1 smoke 8/8 PASS retained. No runtime/schema/API change.

## 3. MWT-4A Task Evidence Projection Sealed

- Read-only, frontend-only projection of task-scoped evidence.
- New files: `TaskEvidenceView.tsx`, `useTaskEvidence.ts`, `task-evidence.ts` (types), `taskEvidence.ts` (aggregateTaskEvidence pure fn), `scripts/mwt4a/run-smoke.mts`.
- Modified: `api.ts` (fetchGatewayEventsByTask), `TaskPanel.tsx` (selection + view switch), `ManagerWorkspace.tsx` (mount TaskPanel — recorded allowed frontend-only exception).
- Deterministic seeded smoke (no live Gateway): 26 PASS / 0 FAIL / 0 SKIP.
- No durable table, no new API beyond existing events query.

## 4. Frontend Typecheck Cleanup Closed

- Baseline 77 pre-existing errors → 0 errors (type hygiene only, no behavior change).
- No new runtime code; frontend build PASS (5/5 static pages).

## 5. ManagerWorkspace UX Polish Sealed

- Lightweight frontend-only polish of 3 components: `ManagerWorkspace.tsx`, `TaskPanel.tsx`, `TaskEvidenceView.tsx`.
- Added: count badges, tooltips, friendly copy, summary grid, timeline title, Chinese labels, hash truncation.
- No API/semantic/backend change. Regressions all green.

## 6. What Changed for Users

- Tasks view shows evidence per task with a clean summary (event count, cost, tokens, allow/deny/unknown).
- Task evidence timeline with hashed, privacy-safe entries.
- Improved ManagerWorkspace readability (badges, tooltips, labels).

## 7. What Changed for Developers

- `aggregateTaskEvidence` pure function extracted for deterministic smoke.
- Frontend + Backend typecheck baselines at 0 errors.
- Deterministic MWT-4A smoke harness (`scripts/mwt4a/run-smoke.mts`) — no live Gateway needed.

## 8. What Explicitly Did NOT Change

- No export / download button.
- No signing / attestation.
- No policy / approval / enforcement.
- No run_id / trace_id.
- No backend evidence service introduced.
- No Gateway routes beyond existing `/events`.
- No SQLite schema beyond `task_id` column.
- No v1 stash pop/merge.
- No Chat→Manager rename.

## 9. Validation Summary

```text
Frontend TSC: 0 errors ✅
Frontend Build: PASS ✅
Backend TSC: 0 errors ✅
MWT-4A Smoke: 26 PASS / 0 FAIL / 0 SKIP ✅
MWT-3B1 Smoke: 8/8 PASS, 1 SKIP ✅
```

## 10. Known Limitations

- Evidence projection is read-only; no export/portability yet (MWT-4B blocked).
- `task_id` is correlation-only; no task lifecycle (create/edit/delete).
- Real external reviewer validation for Private Beta still pending (CHECKPOINT_2).
- MWT-4A sealed on deterministic smoke; live-Gateway runtime smoke was not the seal gate.
