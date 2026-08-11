# MWT-4A Implementation Readiness Report — Task Evidence Projection

**Status**: READINESS DOC — implementation NOT authorized.  
**Date**: 2026-08-10  
**Task**: Post-MWT-3B1 Task Pack Task 6.  
**Companion docs**: `MWT-4A-task-evidence-projection-brief.md`, `MWT-4A-ui-archaeology.md`, `MWT-4A-smoke-plan.md`.

---

## 1. Final Proposed File List

| File | Type | Purpose |
|------|------|---------|
| `frontend/src/components/workbench/TaskEvidenceView.tsx` | NEW | Summary card + timeline; consumes `useTaskEvidence` |
| `frontend/src/hooks/useTaskEvidence.ts` | NEW | Fetch `GET /v1/events?task_id=<id>` + client-side aggregate |
| `frontend/src/lib/api.ts` | MODIFY | Add `fetchGatewayEventsByTask(taskId, limit?)` wrapper |
| `frontend/src/components/workbench/TaskPanel.tsx` (or parent) | MODIFY | Wire `<TaskEvidenceView taskId={selectedTaskId} />` |
| `frontend/src/types/task-evidence.ts` | NEW (optional) | `TaskEvidenceSummary`, `TaskEvidenceEvent` types |

**Total: 3–5 files, ~250 lines, frontend-only.**

---

## 2. Expected Line Count

```text
TaskEvidenceView.tsx   ~150
useTaskEvidence.ts      ~60
api.ts (add)            ~15
TaskPanel.tsx (edit)    ~10
task-evidence.ts        ~30 (if separate)
────────────────────────────
                      ~250–265 lines
```

---

## 3. Component Integration Point

```tsx
// in ManagerWorkspace (or TaskPanel parent)
const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

<TaskPanel userId={userId} sessionId={sessionId}
  selectedTaskId={selectedTaskId}
  onTaskSelect={setSelectedTaskId} />
{selectedTaskId && <TaskEvidenceView taskId={selectedTaskId} />}
```

No new props beyond what `TaskPanel` already exposes (`selectedTaskId`, `onTaskSelect`).

---

## 4. API Usage

```text
GET /v1/events?task_id=<id>&limit=200   (MWT-3B1 endpoint, unchanged)
→ wrapped by fetchGatewayEventsByTask(taskId) in api.ts
→ returns GatewayEventsResponse { events: GatewayEvent[], total }
```

No new backend route. No `/report` dependency (that is event-scoped EvidenceReportPanel, untouched).

---

## 5. State Model

```text
Local component state (useTaskEvidence):
  - loading: boolean
  - error: string | null
  - events: GatewayEvent[]
  - summary: { event_count, total_input_tokens, total_output_tokens,
               total_cost, control: { allow, deny } }

No global store change. No persistence. No url param.
```

---

## 6. Fallback Model

| Condition | Behavior |
|-----------|----------|
| `task_id=null` selected | Impossible via UI guard — selection layer only emits real task_ids |
| 0 events for task_id | Empty-state message: "No correlated events for this task" |
| Fetch non-200 | Error banner, non-blocking to Tasks list |
| Loading | Spinner in detail region |

---

## 7. AC Mapping

| AC | Mechanism |
|----|-----------|
| AC1 select→render | TaskPanel.onTaskSelect → TaskEvidenceView mount |
| AC2 calls /events?task_id | useTaskEvidence fetch |
| AC3 count/tokens/cost | client-side summary aggregate |
| AC4 allow/deny | derive from event.control_decision |
| AC5 ordered timeline | sort by timestamp asc |
| AC6 privacy-safe detail block | TaskEvidenceView own lightweight rows; styling reference only from EvidenceReportPanel |
| AC7 hash verify | existing hash UI (read-only) |
| AC8 empty state | fallback model |
| AC9 EvidenceReportPanel unchanged | separate component, no edit |
| AC10 no backend/schema/run/trace | git diff frontend-only |
| AC11 0 new FE tsc errors | tsc gate |
| AC12 build PASS | build gate |

---

## 8. Smoke Mapping

See `MWT-4A-smoke-plan.md` — 10 cases S1–S10 map 1:1 to the AC grid above.

---

## 9. Risks

| Risk | Mitigation |
|------|------------|
| Scope creep to durable storage | AC10 + out-of-scope list enforced |
| "Just add export" pressure | Explicitly MWT-4B; not in AC |
| Fetch wrapper diverges from existing `fetchGatewayEvents` | Extend pattern, same endpoint |
| UI guard misses null task_id | S3 smoke case |
| Large event volume | `limit=200` cap |

---

## 10. PM Greenlight Checklist

```text
[ ] PM confirms read-only projection semantics (Section 9.2 brief)
[ ] PM confirms no backend change (api.ts frontend-only edit acceptable)
[ ] PM confirms AC1–AC12
[ ] PM confirms file list (3–5 files)
[ ] PM confirms embedding (no new tab/route)
[ ] PM issues: MWT-4A IMPLEMENTATION_AUTHORIZED
```

---

## 11. Readiness Verdict

```text
MWT-4A Implementation Readiness: READY_PENDING_PM_GREENLIGHT ⚠️
All planning artifacts complete:
  - Brief (with PM review addendum)
  - UI Archaeology
  - Smoke Plan
  - This Readiness Report
Blocked only on PM implementation authorization.
```

---

*Report: 2026-08-10. Readiness documentation only. No code.*
