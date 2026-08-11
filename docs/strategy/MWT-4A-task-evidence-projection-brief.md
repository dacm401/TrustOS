# MWT-4A Task Evidence Projection — Implementation Brief

**Status**: DRAFT — READY_FOR_PM_REVIEW  
**Date**: 2026-08-10  
**Phase**: MWT-4 Task Evidence → MWT-4A (read-only projection)  
**Dependency**: MWT-3B1 (nullable task_id correlation) — **SEALED ✅ 2026-08-10**  
**Classification**: Planning document only — NO implementation authorized until PM issues `MWT-4A IMPLEMENTATION_AUTHORIZED`

---

## 0. Provenance

This brief upgrades `MWT-4-task-evidence-prebrief.md` (v1.0, 2026-08-10) from pre-research to an implementation-ready brief. The dependency gate (MWT-3B1 SEALED) is now satisfied, so the 8 open questions from the pre-brief (Section 7) are resolved below with default proposals. Items marked **[PM DECISION]** are recommendations, not mandates — PM may override at review.

---

## 1. Scope (Authorized Surface)

MWT-4A is a **read-only, on-demand, frontend-only projection** of events filtered by `task_id`. It is a *computed view*, not stored state. The backend query capability (`GET /v1/events?task_id=<id>`) already exists from MWT-3B1 — **no backend changes** in MWT-4A.

### In Scope

```text
✅ TaskEvidenceView component (NEW, frontend only)
✅ useTaskEvidence hook (NEW — query GET /v1/events?task_id=<id> + aggregate client-side)
✅ TaskEvidence types (NEW TypeScript types)
✅ Aggregate: event_count, total_tokens, total_cost, control_summary (allow/deny)
✅ Event timeline: ordered list of task events (by timestamp)
✅ Per-event privacy-safe detail block (TaskEvidenceView renders its own lightweight rows from GatewayEvent fields; styling patterns only from EvidenceReportPanel)
✅ Hash fields displayed when present (read-only display; no new verification algorithm)
✅ Event-scoped fallback: if selected task has 0 events, show message + link to event-scoped panel
✅ Integration: TaskPanel onTaskSelect → render TaskEvidenceView
✅ No backend changes — pure frontend query + aggregation
```

### Out of Scope (explicit guardrails)

```text
❌ Durable evidence report table (no new storage)
❌ Export (PDF / signed JSON / clipboard) — MWT-4B+
❌ Report approval workflow — MWT-5
❌ Policy binding — MWT-5
❌ Memory integration — MWT-6
❌ Task evidence signing — future
❌ Modification of existing EvidenceReportPanel (event-scoped stays intact)
❌ Backend evidence service / new API routes
❌ run_id / trace_id introduction
❌ v1 stash pop
```

---

## 2. Resolved Open Questions (from pre-brief Section 7)

| # | Question | Resolution (default) | Flag |
|---|----------|----------------------|------|
| 1 | Include control decisions (allow/deny)? | **Yes** — show allow/deny/unknown distribution. Source: explicit `control_decision` field ONLY. If absent → counted as `unknown`. No inference from `error_code`. | [PM DECISION] |
| 2 | Show risk assessment per event? | **Yes (lightweight)** — show risk level if event carries `risk_level`; otherwise omit. No new risk computation. | [PM DECISION] |
| 3 | Display format? | **Summary card + timeline**. Top: aggregate summary card (count/tokens/cost/control). Below: chronological event timeline, each row expandable to existing evidence bundle. | [PM DECISION] |
| 4 | Show cost ($) or just tokens? | **Both** — tokens (input/output) + estimated cost from `cost_estimate`. Mirrors existing event metadata. | [PM DECISION] |
| 5 | Accessible from Chat view? | **No for MWT-4A** — Task Evidence appears only in Tasks navigation (TaskPanel). Chat-view access deferred. | [PM DECISION] |
| 6 | Download evidence button? | **No** — export is MWT-4B. MWT-4A is view-only. | — |
| 7 | Changelog / history shown? | **No** — Task Evidence is an immutable computed view of current events. No history. | — |
| 8 | Own nav item or embedded in Task detail? | **Embedded** — rendered inside TaskPanel when a task is selected (uses existing `onTaskSelect` / `selectedTaskId` props). No new nav item. | [PM DECISION] |

---

## 3. Architecture

```text
Frontend (no backend change):
  TaskPanel (existing)
    └─ onTaskSelect(taskId) → set selectedTaskId
    └─ if selectedTaskId:
         └─ <TaskEvidenceView taskId={selectedTaskId} />
              └─ useTaskEvidence(taskId)
                   └─ fetch GET /v1/events?task_id=<taskId>&limit=200
                   └─ client-side aggregate (count / tokens / cost / control)
                   └─ render summary card + timeline
                        └─ each row → TaskEvidenceView's own lightweight privacy-safe detail block (styling reference only from EvidenceReportPanel)
```

**Backend**: unchanged. MWT-3B1 already provides `GET /v1/events?task_id=<id>` with `unassigned=true` / `task_id=null` semantics. MWT-4A consumes that endpoint as-is.

---

## 4. Files (Estimated Surface — 3-4 files, ~250 lines, frontend only)

| File | Type | Lines (est.) | Notes |
|------|------|--------------|-------|
| `frontend/src/components/workbench/TaskEvidenceView.tsx` | NEW | ~150 | Summary card + timeline; reads `useTaskEvidence` |
| `frontend/src/hooks/useTaskEvidence.ts` | NEW | ~60 | `fetchGatewayEventsByTask` + aggregate |
| `frontend/src/types/task-evidence.ts` | NEW | ~30 | `TaskEvidence`, `TaskEvidenceSummary` types |
| `frontend/src/lib/api.ts` | MODIFY | ~15 | Add `fetchGatewayEventsByTask(taskId, limit?)` |
| `frontend/src/components/workbench/TaskPanel.tsx` | MODIFY | ~10 | Wire `selectedTaskId` → `<TaskEvidenceView>` |

**No backend files touched.** No new dependencies. No schema change.

---

## 5. Acceptance Criteria (Draft — for PM to confirm)

```text
AC1: Selecting a task in Tasks view renders TaskEvidenceView.
AC2: TaskEvidenceView calls GET /v1/events?task_id=<id>&limit=200 and displays returned events.
AC3: Summary card shows event_count, total_input_tokens, total_output_tokens, total_tokens, total_cost.
AC4: Control summary shows allow / deny / unknown based ONLY on explicit control_decision (no inference from error_code).
AC5: Event timeline is ordered by timestamp (oldest→newest).
AC6: Each timeline row expands to a privacy-safe event detail block showing available hashes/metadata only (TaskEvidenceView renders its own lightweight rows from GatewayEvent; does NOT reuse EvidenceReportPanel renderer).
AC7: Existing hash fields are displayed when present; MWT-4A does NOT introduce new hash verification logic.
AC8: Task with 0 events → graceful empty state, does NOT fallback to all events.
AC9: Existing EvidenceReportPanel (event-scoped) unchanged and still functional.
AC10: No backend routes / no schema migration / no run_id / no trace_id.
AC11: Frontend typecheck: 0 NEW errors.
AC12: Frontend build passes (existing static build pipeline).
```

---

## 6. Risk / Guardrails

| Risk | Mitigation |
|------|------------|
| Scope creep to durable storage | AC10 + out-of-scope list enforced |
| "Just add export" pressure | Explicitly MWT-4B; not in AC |
| Performance with many events | `limit=200` cap on query; pagination if needed later |
| Confusion with event-scoped panel | Separate component; existing panel untouched (AC9) |
| Backend change temptation | Brief forbids; query already exists from MWT-3B1 |

---

## 7. Dependency Chain

```text
MWT-3B1 (SEALED ✅) → MWT-4A (this brief) → MWT-4B+ (export, durable, signing)
```

MWT-4A cannot start until PM issues `MWT-4A IMPLEMENTATION_AUTHORIZED`.

---

## 8. Next Steps

```text
1. PM reviews this brief
2. PM confirms/overrides [PM DECISION] items (Q1-Q5, Q8)
3. PM confirms AC1-AC12
4. PM issues MWT-4A IMPLEMENTATION_AUTHORIZED (or requested revisions)
5. Implementation (frontend only, 3-4 files)
```

**Current Status**: DRAFT — READY_FOR_PM_REVIEW. No implementation authorized.

---

## 9. PM Review Addendum (2026-08-10)

This section answers the 12 review points and 4 explicit questions from the PM post-3B1 task pack (Task 3).

### 9.1 Twelve Review Points

| # | PM Point | MWT-4A Answer |
|---|----------|---------------|
| 1 | Task Evidence is projection-only | ✅ Yes. Computed view over `GET /v1/events?task_id=<id>`. No stored state. |
| 2 | Source of truth: JSONL + SQLite index | ✅ Yes. Raw JSONL is system of record; SQLite `events` index (with `task_id` column from MWT-3B1) is query accelerator. Frontend reads via Gateway `/v1/events`. |
| 3 | No durable evidence table | ✅ Confirmed. No new table, no migration. |
| 4 | No backend changes | ✅ Confirmed. Reuses MWT-3B1 endpoint. 0 backend files touched. |
| 5 | No policy / approval / enforcement | ✅ Confirmed. Read-only view; no decision primitives. |
| 6 | No export/signing in 4A | ✅ Confirmed. Export is MWT-4B. 4A is view-only. |
| 7 | task_id=null fallback | ✅ Events with `task_id=null` are unassigned — excluded from any task projection; no task can be selected with null id (UI only selects real task_ids). |
| 8 | Missing task_id behavior | ✅ If a task_id has zero correlated events → graceful empty-state message, no crash (AC8). |
| 9 | Empty task events behavior | ✅ Same as #8 — empty-state, no fallback to all-events. |
| 10 | Error/loading state behavior | ✅ Loading spinner during fetch; error banner on non-200; both non-blocking to rest of Tasks view. |
| 11 | Existing Evidence view unchanged | ✅ AC9 — event-scoped `EvidenceReportPanel` untouched. |
| 12 | MWT-4A AC list final | ✅ AC1–AC12 in Section 5, pending PM confirmation. |

### 9.2 Four Explicit Questions

**Q1: What is evidence?**
→ In MWT-4A, "evidence" = the set of TRST-1 events already emitted by the Gateway and correlated to a `task_id`. Each event carries hashes (`input_hash`, `output_hash`, `event_hash`), control metadata, and metrics. MWT-4A does not create new evidence — it *projects existing events* into a task-centric view.

**Q2: What is source data?**
→ (a) Raw JSONL event stream (`.trustos/events.jsonl`) — system of record.
→ (b) SQLite `events` index with `task_id` column — query accelerator, populated by MWT-3B1's `syncFromJsonl` / `appendEvent`.
→ (c) Gateway `GET /v1/events?task_id=<id>` — the read API MWT-4A consumes (frontend-only call).

**Q3: What is displayed?**
→ Per selected task:
→ 1. Summary card: event_count, total_tokens (input+output), total_cost, control allow/deny distribution.
→ 2. Timeline: chronological events (model_call / tool_call / session_lifecycle / errors / terminal states), each expandable to its existing privacy-safe evidence bundle (reuse renderer).
→ 3. Per-event hash fields displayed when present (read-only display; no new verification algorithm).

**Q4: What is explicitly NOT displayed?**
→ No new durable report; no export/sign button; no approval/policy UI; no run_id/trace_id introduction; no event content (hashes only, privacy-safe); no events from other tasks; no unassigned (`task_id=null`) events; no Chat-view embedding (deferred); no new backend routes.

### 9.3 Status After Addendum

```text
MWT-4A Brief: BRIEF_REVIEW_IN_PROGRESS ⚠️
All 12 PM review points answered.
All 4 explicit questions answered.
Implementation: NOT_AUTHORIZED ❌
Awaiting: PM content review + greenlight (or revisions)
```

---

*Draft: 2026-08-10. Version 1.0. Upgraded from MWT-4-task-evidence-prebrief.md after MWT-3B1 SEAL. Addendum 9 added 2026-08-10 for PM review pack Task 3.*
