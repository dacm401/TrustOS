# TRST Frontend Typecheck Baseline Cleanup — Brief

**Status:** PROPOSED (planning only; optional audit authorized, no product impl)
**Date:** 2026-08-10
**Context:** MWT-4A Frontend TSC = NO_NEW_ERRORS, 77 pre-existing baseline errors remain.

## 1. Problem Statement

The frontend typecheck currently reports **77 pre-existing `error TS` errors** that
are unrelated to MWT-4A (MWT-4A introduced 0 new errors). These are inherited from
earlier sprints (S95P/S96P/S99P/S101 family WIP, e.g. `fetchGatewaySessions` import
error, `ConversationPhase` type mismatches, unused imports). They:
- Obscure real regressions in future smoke/typecheck gates.
- Prevent us from writing "Frontend TSC PASS" honestly.
- Risk silent accumulation as the codebase grows.

## 2. Goal

Reduce the frontend `tsc --noEmit` error count from 77 → 0 (or to a documented,
intentional baseline) **without** changing runtime behavior or product scope.

## 3. Scope

- Frontend-only (`frontend/src/**`, `frontend/tsconfig.json`).
- Type-level fixes only: explicit types, optional chaining, unused-import removal,
  `@ts-expect-error` only where a real upstream type gap exists (documented).
- May touch any frontend file where a baseline error originates.

## 4. Non-Goals

- ❌ No product behavior change.
- ❌ No new features.
- ❌ No backend changes.
- ❌ No API/schema changes.
- ❌ Do not "fix" by deleting functionality — only by correct typing.

## 5. Approach

1. `npx tsc --noEmit -p frontend/tsconfig.json 2>&1 | Select-String "error TS"` → list 77.
2. Group by root cause (e.g. missing exports, type mismatches, unused symbols).
3. Fix in small batches, re-running tsc after each to track delta (77 → … → 0).
4. Add a CI gate asserting `error TS` count == 0 (or pinned baseline) post-cleanup.

## 6. Risks

- Some errors may be downstream of intentional WIP (e.g. `ManagerConversation` backend
  not yet wired). These should get `@ts-expect-error` with a tracked TODO, not silent deletion.
- Avoid scope creep into unrelated refactors.

## 7. Success Criteria

| Criterion | Target |
|---|---|
| Frontend TSC errors | 0 (or documented intentional baseline) |
| Frontend build | still PASS |
| Runtime behavior | unchanged |
| Product scope | unchanged |

## 8. Recommendation

Approve as a standalone hygiene brief. It does not block MWT-4A (already SEALED) and
improves future gate honesty. Not a product milestone — treat as maintenance.

## 9. Authorization State

```text
Frontend typecheck baseline audit: OPTIONAL (hygiene only)
Product implementation: NOT part of this brief.
```
