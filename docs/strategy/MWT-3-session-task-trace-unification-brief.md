# MWT-3 Session / Task / Trace Unification — Two-Phase Brief v2.0

**Status**: DRAFT FOR PM REVIEW — IMPLEMENTATION NOT AUTHORIZED
**Author**: Agent
**Date**: 2026-08-10
**Supersedes**: MWT-3 Brief v1.0 (rejected 2026-08-09)
**Prerequisite**: MWT-2 SEALED ✅ (2026-08-10)

---

## Executive Summary

MWT-3 aims to make the Session→Task→Run→Event hierarchy observable in the product UI. Users and reviewers can currently create agent sessions, trigger tasks through the Gateway, and see individual chat messages — but there is no unified view that connects a session to its tasks, a task to its execution runs, or a run to its Gateway events.

The original v1 brief was rejected for 6 reasons (see Appendix A), primarily:

1. It bundled read-only discovery (frontend-only) with correlation field injection (backend gateway changes)
2. It assumed task_id/run_id on ALL events without handling pre-task-creation events
3. It expanded SQLite schema without object model review
4. It conflated "ManagerWorkspace restoration" with "Tasks navigation"

**This v2 brief splits MWT-3 into two independent phases:**

| Phase | Name | Type | Risk | Files |
|-------|------|------|------|-------|
| **MWT-3A** | Read-Only Session/Task Discovery | Frontend-only | Low | 4-5 |
| **MWT-3B** | Object Model Correlation Fields | Backend (Gateway + DB) | Medium | 6-8 |

**MWT-3A can be sealed independently. MWT-3B depends on 3A being sealed AND a separate object-model design review.**

---

## MWT-3A: Read-Only Session/Task Discovery

### Goal

User can navigate from Session → Task → Events using **existing data and existing APIs**. No new fields, no Gateway changes, no DB changes. Pure frontend integration.

### Current State

The following assets **already exist** in the codebase but are not wired into the product navigation:

| Asset | Path | Status |
|-------|------|--------|
| ManagerWorkspace | `frontend/src/components/manager-workspace/ManagerWorkspace.tsx` | Built, functional |
| SessionList | `frontend/src/components/manager-workspace/SessionList.tsx` | Built, functional |
| SessionDetail | `frontend/src/components/manager-workspace/SessionDetail.tsx` | Built, functional |
| ManagerConversation | `frontend/src/components/manager-workspace/ManagerConversation.tsx` | Built, functional |
| agent-sessions repo | `src/db/repositories/agent-session.ts` | Built, tested |
| task-archive-repo | `src/db/task-archive-repo.ts` | Built, tested |
| /v1/agent-sessions API | Gateway route | Active, serving data |
| /v1/session-events API | Gateway route | Active, serving data |
| agent_sessions table | DB migration 024 | Active, populated |

**These are not new features. They are existing, built, tested components that simply aren't in the navigation.**

### What Changes

```
BEFORE (no task visibility):
  Sidebar: [Chat] [概述/Overview] [任务/Tasks(empty)] [证据/Evidence] ...

AFTER (read-only discovery):
  Sidebar: [Chat] [概述/Overview] [任务/Tasks → displays sessions] [证据/Evidence] ...
```

The "任务/Tasks" nav item currently leads to an empty Tasks view. 3A replaces it with ManagerWorkspace (SessionList + SessionDetail), which already renders session → event hierarchy from existing APIs.

**Concretely:**
- Sidebar "任务/Tasks" navigates to ManagerWorkspace (read-only session/task browser)
- Users can see: session title → status → task archive state → session events timeline
- SessionDetail already shows events with status badges and summaries
- ManagerConversation is already wired for session-level chat review
- **No Chat→Manager rename** (this is a separate PM UI judgment, not bundled with 3A)

### Non-Changes (explicitly excluded)

```
❌ No Chat→Manager rename
❌ No new API endpoints
❌ No new DB tables or migrations
❌ No new data fields (task_id, run_id, etc.)
❌ No Gateway event changes
❌ No backend code changes at all
❌ No SQLite schema changes
❌ No Evidence/Policy/Enforcement changes
```

### Files (4-5, frontend only)

| File | Change | Lines |
|------|--------|-------|
| `frontend/src/components/layout/Sidebar.tsx` | Wire Tasks nav → ManagerWorkspace view | ~5 |
| `frontend/src/app/page.tsx` | Add ManagerWorkspace to view routing | ~10 |
| `frontend/src/components/manager-workspace/ManagerWorkspace.tsx` | Accept view props, minor polish | ~10 |
| `frontend/src/components/manager-workspace/SessionDetail.tsx` | Integration polish (e.g., loading states) | ~5 |
| *(optional)* `frontend/src/components/manager-workspace/SessionList.tsx` | Minor UX polish if needed | ~5 |

**Total: ~35 lines net, all frontend.**

### Acceptance Criteria (6)

| AC | Content |
|----|---------|
| 3A-1 | Clicking "任务/Tasks" in sidebar navigates to session list view |
| 3A-2 | Session list shows active/completed sessions with title, status, created_at |
| 3A-3 | Clicking a session shows SessionDetail with event timeline |
| 3A-4 | Session events display with type, summary, severity, visibility badges |
| 3A-5 | Navigation between ManagerWorkspace and Chat is functional (both accessible) |
| 3A-6 | Existing Chat/Overview/Evidence/Gateway views unchanged |

### Should-Have (2)

| # | Content |
|---|---------|
| S1 | ManagerConversation shows session chat history in review-friendly format |
| S2 | Empty state for "no sessions" with CTA to create one |

### PM Decision Gates for 3A

```
MWT-3A AUTHORIZATION CHECKLIST:
  ☐ Brief accepted by PM
  ☐ Chat→Manager rename explicitly deferred (not bundled)
  ☐ No backend/DB/Gateway/API changes confirmed
  ☐ Scope limited to existing ManagerWorkspace components
  ☐ Authorization: MWT-3A IMPLEMENTATION AUTHORIZED
```

---

## MWT-3B: Object Model Correlation Fields

### Status: DESIGN STAGE — NOT READY FOR IMPLEMENTATION

MWT-3B adds `task_id` and `run_id` to Gateway events and provides API endpoints for task/run-level event queries. This enables the full Observe→Visualize→Correlate loop where a reviewer can trace a detected issue through its associated task and all events in that run.

**MWT-3B REQUIRES:**
1. MWT-3A SEALED ✅
2. Object Model Design Review (Phase 0 — this section)
3. PM approval of the design review
4. Then PM authorization for implementation

### Object Model Design Review (Phase 0)

Before any code is written for 3B, the following semantics must be clarified and agreed upon:

| Concept | Current State | MWT-3B Proposition | Open Questions |
|---------|---------------|-------------------|----------------|
| `session_id` | Exists (agent_sessions.id) | Immutable — created at session start | Is this the top-level grouping? |
| `task_id` | Exists (task_archives.task_id) | Assigned when Manager creates a task | What about events before task assignment? |
| `run_id` | Does NOT exist today | Execution attempt ID — new field, unique per poll cycle group | Relationship to session? to task? 1:N? |
| `trace_id` | Does NOT exist today (was `event_id` in v1) | Cross-event correlation ID — NOT the same as run_id | Do we need this at all? Or is `event_id` sufficient? |
| `event_id` | Exists (event-index hash) | Immutable — assigned by Gateway on arrival | No change needed |

**Key Design Decision Required:**

```
OPTION A: run_id as execution correlation
  - run_id groups all events from one Worker execution cycle or poll group
  - task_id = "which task is this run for"
  - No separate trace_id — run_id is the trace

OPTION B: trace_id as logical trace, run_id as execution attempt
  - trace_id = a logical task execution (may span multiple retries)
  - run_id = a single attempt (poll cycle group)
  - Each task has 1 trace, trace has 1..N runs

OPTION C: Minimal — task_id only, no run_id yet
  - task_id on events is sufficient for correlation
  - run_id can be added later when multi-run retry exists
  - Simplest path, least premature design
```

**Pre-Task-Creation Events Handling (must solve regardless of A/B/C):**

```
Events BEFORE a task_id exists (e.g., initial model_call before Manager delegates):
  → event_envelope.task_id = null (not omitted, explicitly null)
  → POST-assignment: subsequent events carry task_id
  → Event query: "events for task X" naturally excludes pre-task events
  → Event query: "unassigned events" = WHERE task_id IS NULL
```

This avoids the v1 rejection reason: "task_id/run_id on ALL events too strong."

### What Changes (after design review approved)

| Layer | Change | Scope |
|-------|--------|-------|
| Gateway event envelope | +task_id (nullable), +run_id (nullable) | src/services/trst1/event-envelope.ts |
| Gateway event index | Store task_id/run_id in event-index (existing column-ready) | src/services/trst1/event-index.ts |
| API: GET /v1/tasks/:taskId/runs | Return runs for a task (if run_id exists) | Gateway route |
| API: GET /v1/runs/:runId/events | Return events filtered by run_id | Gateway route |
| Frontend: EventChainViewer | Filter events by task_id/run_id | frontend component |
| Smoke | scripts/mwt3/run-smoke.mjs | validation |

### Files (6-8, backend + frontend)

| File | Change |
|------|--------|
| `src/services/trst1/event-envelope.ts` | +task_id, +run_id (both nullable) |
| `src/services/trst1/event-index.ts` | Store task_id/run_id, new WHERE clauses |
| `src/services/trst1/llm-gateway-server.ts` | 2 new GET endpoints, header parsing |
| `src/models/providers/openai.ts` | X-TrustOS-Task-Id header (if from Manager) |
| `src/types/task.ts` | RunId type definition |
| `frontend/src/components/evidence/EventChainViewer.tsx` | task_id/run_id filter |
| `frontend/src/types/dashboard.ts` | Event type extension |
| `scripts/mwt3/run-smoke.mjs` | Validation |

### Acceptance Criteria (8, tentative — pending design review)

| AC | Content | Depends on |
|----|---------|-----------|
| 3B-1 | Gateway event_envelope carries `task_id` (nullable) | Design decision |
| 3B-2 | Gateway event_envelope carries `run_id` (nullable) | Design decision |
| 3B-3 | `GET /v1/tasks/:taskId/runs` returns runs for a task (HTTP 200 + JSON list) | API design |
| 3B-4 | `GET /v1/runs/:runId/events` returns events for a run (HTTP 200 + JSON list) | API design |
| 3B-5 | Pre-task-creation events have `task_id: null`, post-assignment have task_id | Null handling |
| 3B-6 | Event index query supports task_id/run_id WHERE filters | Backend |
| 3B-7 | Existing events unchanged — task_id/run_id are additive only | Regression |
| 3B-8 | Smoke: Gateway + event index + API + filtering all functional | Validation |

### PM Decision Gates for 3B

```
MWT-3B AUTHORIZATION CHECKLIST:
  ☐ MWT-3A SEALED
  ☐ Object model design review completed (run_id vs trace_id, null handling)
  ☐ Brief v3.0 with finalized ACs (not these tentative ones)
  ☐ Authorization: MWT-3B IMPLEMENTATION AUTHORIZED
```

---

## Non-Goals (Both Phases)

The following are explicitly excluded from MWT-3A and MWT-3B:

```
❌ Chat→Manager rename (separate PM UI judgment, separate brief)
❌ Manager Policy / Approval workflow (MWT-5)
❌ Evidence Report changes (MWT-4)
❌ Productionization / Auth / RBAC (MWT-7)
❌ Memory Governance (MWT-6)
❌ Durable evidence store / backend evidence service
❌ Streaming enforcement
❌ Manager agent behavior changes (routing, decision logic)
❌ New AI model calls or agent framework integrations
```

---

## Architecture Rules

1. **Read-only before write**: MWT-3A is pure read-only — no new data created. MWT-3B adds data fields but only after design review.
2. **Existing APIs only (3A)**: 3A uses only APIs that are already serving production data (/v1/agent-sessions, /v1/session-events).
3. **Nullable by design (3B)**: task_id and run_id default to null, not zero or empty string. Explicit null ≠ absent.
4. **Additive fields only (3B)**: No existing event fields removed, renamed, or restructured. task_id/run_id are appended only.
5. **No implicit task creation**: Gateway never auto-creates tasks. task_id is always assigned by Manager or external caller.
6. **No ManagerWorkspace data mutation**: 3A is read-only. No create/update/delete session or task from UI.

---

## Risk Register

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| 3A: ManagerWorkspace has bit-rot (API contracts changed since built) | Low-Med | Low | 4 files, small surface, easy to fix |
| 3A: Nav label confusion (Tasks vs Manager) | Low | Low | Keep label as "任务/Tasks", PM can change later |
| 3B: run_id vs trace_id design disagreement blocks implementation | Med | Med | Separate 3B into; start with simplest option (C: task_id only) |
| 3B: Pre-task events not handled → data inconsistency | Low | High | Null-by-default design prevents this |
| 3B: SQLite migration scaling (existing table alteration) | Low | Low | 1-2 nullable columns, no new tables, fast migration |

---

## Dependencies

```
MWT-0 (Architecture) ── CLOSED ✅
MWT-1 (Manager Shell) ── SEALED ✅
MWT-2 (Worker Lifecycle) ── SEALED ✅
    │
    ├── MWT-3A (Read-Only Discovery) ← LOW RISK, frontend only
    │       │
    │       └── Prerequisite for MWT-3B
    │
    └── MWT-3B (Object Model Correlation) ← REQUIRES design review first
            │
            └── Prerequisite for MWT-4 (Task Evidence), MWT-5 (Policy)
```

---

## Appendix A: Rejection Reasons (v1.0) — All Addressed

| # | Rejection Reason (2026-08-09) | v2.0 Resolution |
|---|-------------------------------|-----------------|
| 1 | MWT-2 not implemented/sealed | RESOLVED — MWT-2 SEALED ✅ 2026-08-10 |
| 2 | SQLite schema expansion without object model review | RESOLVED — 3A has zero DB changes. 3B requires separate design review before any schema work. |
| 3 | run_id/trace_id semantics need deeper review | RESOLVED — 3B Phase 0 is object model design review. 3A doesn't touch these. |
| 4 | "task_id/run_id on ALL events" too strong | RESOLVED — Nullable by design. Pre-task events have `task_id: null`. |
| 5 | MWT-3 too large, must split | RESOLVED — Split into 3A (4-5 files, frontend-only) + 3B (6-8 files, post-design-review). |
| 6 | ManagerWorkspace restoration ≠ Tasks authorization | RESOLVED — 3A is read-only session/task browser using existing components. No new authorization. |
| 7 | Chat→Manager rename needs separate PM judgment | RESOLVED — Explicitly excluded from both phases. Moved to separate scope. |

## Appendix B: Git Stash Status

```
MWT-3 v1 spike: stashed (10 files in spike/mwt-3-unapproved-object-model)
  → NOT to be pop'ed or merged for 3A
  → MWT-3B may reference v1 spike as reference material only
  → MWT-3A is net-new work on top of mainline, not from stash
```
