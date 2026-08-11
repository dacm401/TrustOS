# MWT-4A UI Archaeology — Reusable Component Audit

**Status**: AUDIT ONLY — no implementation.  
**Date**: 2026-08-10  
**Task**: Post-MWT-3B1 Task Pack Task 4 (read-only code archaeology).  
**Scope**: Identify reusable frontend components for MWT-4A Task Evidence Projection.

---

## 0. Audit Method

Read-only static analysis of:
- `frontend/src/components/dashboard/EvidenceReportPanel.tsx` (existing evidence UI)
- `frontend/src/components/workbench/TaskPanel.tsx` (task list + selection)
- `frontend/src/components/manager-workspace/*` (ManagerWorkspace, SessionDetail, etc.)
- `frontend/src/components/chat/ExecutionMetadata.tsx` (execution visibility)
- `frontend/src/types/dashboard.ts` (task/event types)
- `frontend/src/lib/api.ts` (API fetch layer)

> Note: PM audit list referenced `frontend/src/components/evidence/*` — that directory
> does NOT exist. Existing evidence UI lives in `dashboard/EvidenceReportPanel.tsx`.
> Audit reflects actual repo state.

---

## 1. Reusable Components Available

| Component / API | Location | Reusable for MWT-4A? | Notes |
|-----------------|----------|----------------------|-------|
| `fetchGatewayEvents(limit)` | `lib/api.ts:430` | ✅ Yes (extend) | Calls `GATEWAY_URL/events?limit=`. Needs `task_id` param variant. |
| `GatewayEvent` type | `lib/api.ts:415` | ✅ Yes | Loose `[key: string]: unknown` — `task_id`, `control_decision`, `token_count`, `cost_estimate` all accessible. |
| `GatewayEventsResponse` | `lib/api.ts:425` | ✅ Yes | `{ events, total }` shape. |
| `TaskPanel` + `onTaskSelect` / `selectedTaskId` | `workbench/TaskPanel.tsx:16-17` | ✅ Integration point | Already passes `task_id` to parent. No new prop needed. |
| `EvidenceReportPanel` | `dashboard/EvidenceReportPanel.tsx` | ⚠️ Partial | Event-scoped report (calls `/report`, not `/events`). Data layer NOT reusable, but card/section styling patterns reusable. |
| `ExecutionMetadata` | `chat/ExecutionMetadata.tsx` | ⚠️ Partial | Shared execution-visibility component; shows metrics. Styling reference only. |
| `ReportSummary` type | `lib/api.ts:445` | ❌ No | Tied to `/report` backend; MWT-4A computes summary client-side from events. |

**Key finding**: The data path MWT-4A needs (`GET /v1/events?task_id=<id>`) is already
served by the Gateway. The frontend `fetchGatewayEvents` wrapper exists but lacks a
`task_id` filter — MWT-4A adds a sibling wrapper `fetchGatewayEventsByTask(taskId)`.

---

## 2. How ManagerWorkspace Passes task_id

`TaskPanel` receives `onTaskSelect?: (taskId: string) => void` and `selectedTaskId?: string | null`.
Parent (likely `ManagerWorkspace` or session view) holds `selectedTaskId` state and renders
`TaskPanel` + detail region. **This is the exact mount point for `TaskEvidenceView`** —

```tsx
<TaskPanel userId={...} sessionId={...}
  selectedTaskId={selectedTaskId}
  onTaskSelect={setSelectedTaskId} />
{selectedTaskId && <TaskEvidenceView taskId={selectedTaskId} />}
```

No new navigation/routing required.

---

## 3. Where Task Evidence Projection Mounts

**Embedded inside the existing Tasks view** (within `ManagerWorkspace` detail region),
rendered conditionally on `selectedTaskId`. No new route, no new top-level tab.

---

## 4. New Tab Needed?

**No.** MWT-4A is embedded in the existing Tasks panel detail area. PM pre-brief Q8
(default) confirmed: embedded, no new nav item.

---

## 5. New Route Needed?

**No.** Pure client-side component rendering. No backend route (MWT-3B1 already provides
`GET /v1/events?task_id=`). Frontend may add a `fetchGatewayEventsByTask` wrapper in `api.ts`
(this is a frontend lib addition, not a route).

---

## 6. Impact on Existing Chat / Tasks / Evidence Views

| View | Impact |
|------|--------|
| Chat view | None — MWT-4A is Tasks-only (pre-brief Q5 deferred Chat access). |
| Tasks view | Additive — new detail region when a task is selected. Existing list unchanged. |
| Evidence view (`EvidenceReportPanel`) | None — event-scoped report untouched (MWT-4A AC9). |

---

## 7. Estimated Files Modified

```text
NEW (2):
  - src/components/workbench/TaskEvidenceView.tsx
  - src/hooks/useTaskEvidence.ts        (or inline in TaskEvidenceView)

MODIFY (2):
  - src/lib/api.ts                      (add fetchGatewayEventsByTask wrapper)
  - src/components/workbench/TaskPanel.tsx (or its parent) — wire <TaskEvidenceView>

TYPES (1, optional):
  - src/types/task-evidence.ts          (TaskEvidenceSummary etc.)

Total: 3–5 files, frontend-only, ~250 lines.
```

---

## 8. Frontend-Only Feasibility

**Yes — fully frontend-only.**

- Backend: `GET /v1/events?task_id=<id>` exists (MWT-3B1). No change.
- Frontend: new component + new fetch wrapper + client-side aggregation.
- No schema, no migration, no new API route, no Gateway change.

---

## 9. Summary Answer to PM 8 Questions

1. **Reusable components?** → `fetchGatewayEvents`/`GatewayEvent` (extend), `TaskPanel` integration props, `EvidenceReportPanel` styling patterns.
2. **How ManagerWorkspace passes task_id?** → `TaskPanel.onTaskSelect(taskId)` → parent state → renders detail.
3. **Where does projection mount?** → Inside Tasks detail region, conditional on `selectedTaskId`.
4. **New tab?** → No.
5. **New route?** → No (frontend wrapper only).
6. **Impact on existing views?** → None on Chat/Evidence; additive on Tasks.
7. **Estimated files?** → 3–5 frontend files, ~250 lines.
8. **Frontend-only?** → Yes.

---

*Audit: 2026-08-10. Read-only. No code changed.*
