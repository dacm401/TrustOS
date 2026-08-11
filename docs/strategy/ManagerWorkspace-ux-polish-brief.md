# ManagerWorkspace UX Polish — Brief

**Status:** PROPOSED (planning only; minimal UI changes)
**Date:** 2026-08-10
**Context:** MWT-4A mounted `TaskPanel` into `ManagerWorkspace` right column (ACCEPTED
frontend-only exception). This exposed UX seams worth a dedicated polish pass.

## 1. Purpose

MWT-4A proved the projection works, but the integration surface is minimal:
- `TaskPanel` selection state is local; no deep-link / restore.
- Right column mounts `TaskPanel` but layout/empty-state copy is bare.
- `ManagerConversation` backend metadata not yet wired (separate backlog item).
- No obvious entry point telling a reviewer "select a task to see its evidence".

This brief proposes a **UX polish** pass — minimal, frontend-only, no scope expansion.

## 2. Candidate Improvements

| # | Area | Candidate |
|---|---|---|
| U1 | Empty state | Friendly copy in `TaskEvidenceView` when no task selected ("Select a task to view its evidence") |
| U2 | Selection affordance | Visual highlight of selected task row in `TaskPanel` |
| U3 | Layout | Right column resizable / collapsible for `TaskPanel` |
| U4 | Loading | Spinner/skeleton while `fetchGatewayEventsByTask` resolves |
| U5 | Deep-link | Restore selected `taskId` from URL query (frontend-only, no backend) |
| U6 | Error surface | Show non-fatal fetch error in `TaskEvidenceView` (currently swallowed to empty) |

## 3. Scope Guardrails

- ✅ Frontend-only.
- ✅ No new backend / API / schema.
- ✅ No product behavior change beyond UX.
- ✅ Reuse MWT-4A components (`TaskPanel`, `TaskEvidenceView`, `useTaskEvidence`).
- ❌ No export/signing/policy (see MWT-4B / MWT-5).
- ❌ No `run_id` / `trace_id`.
- ❌ No raw content exposure.

## 4. Out of Scope (separate backlog)

- `ManagerConversation` backend metadata wiring (API/contract) — separate brief.
- `SessionDetail` full execution timeline — future sprint.
- `usage` / `terminalSummary` persistence — future sprint.

## 5. Success Criteria

| Criterion | Target |
|---|---|
| Reviewer can find evidence entry point | obvious from empty state |
| Selected task visually clear | highlight + stable |
| Loading/error states graceful | no blank freeze |
| Frontend build + typecheck | pass (no new errors) |

## 6. Recommendation

Approve as a lightweight UX polish brief after MWT-4A SEAL is acknowledged. Schedule
after reviewer feedback (CHECKPOINT_2) so polish targets real reviewer pain points.

## 7. Authorization State

```text
ManagerWorkspace UX polish: PROPOSED (minimal UI, frontend-only)
Implementation: NOT authorized until PM approves brief + reviewer signal.
```
