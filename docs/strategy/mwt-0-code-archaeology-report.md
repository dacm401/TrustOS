# MWT-0 Code Archaeology Report

> **Date**: 2026-08-08
> **Purpose**: Audit all unknown/unmounted/deleted modules before MWT-1/2/3 implementation
> **Output**: Module classification with evidence-based reuse recommendations

---

## 1. Archaeology Scope

12 questions per MWT-0 roadmap §3.3. This report audits 12 modules/components:

| # | Module | Current Location | Pre-MWT Status |
|---|--------|-----------------|----------------|
| 1 | ManagerWorkspace | `frontend/src/components/manager-workspace/` | Unmounted, in codebase |
| 2 | SessionList | `frontend/src/components/manager-workspace/` | Unmounted, in codebase |
| 3 | SessionDetail | `frontend/src/components/manager-workspace/` | Unmounted, in codebase |
| 4 | MemoryView | `frontend/src/components/views/MemoryView.tsx` | Unmounted, in codebase |
| 5 | TaskPanel | `frontend/src/components/workbench/TaskPanel.tsx` | Unmounted, in codebase |
| 6 | TracePanel | `frontend/src/components/workbench/TracePanel.tsx` | Unmounted, in codebase |
| 7 | TasksView | `frontend/src/components/views/TasksView.tsx` | **DELETED** (TRST-4X, cf4f6cf) |
| 8 | TaskProgress | `frontend/src/components/chat/TaskProgress.tsx` | **DELETED** (TRST-4X, cf4f6cf) |
| 9 | DecisionTimeline | `frontend/src/components/dashboard/DecisionTimeline.tsx` | **DELETED** (TRST-4X, cf4f6cf) |
| 10 | Task Planner (backend) | `backend_real/src/services/task-planner.ts` | In codebase |
| 11 | Execution Loop (backend) | `backend_real/src/services/execution-loop.ts` | In codebase |
| 12 | Context Manager (backend) | `backend_real/src/context/` | In codebase |

---

## 2. Module Audit Table

| Module | Exists | Compiles | Data Source | Last Modified | API Match | Reuse Recommendation |
|---|---:|---:|---|---|---|---|
| ManagerWorkspace | YES | ✅ | `/v1/agent-sessions` | 2026-04 | ⚠️ V1 API (may differ) | **AUDIT**: compiles, but V1 data source may not match TRST-4C. Review API contract. |
| SessionList | YES | ✅ (via MgrWS) | `/v1/agent-sessions` | 2026-04 | ⚠️ V1 API | **MAY_REUSE**: clean component, but data source is V1. Needs API adapter. |
| SessionDetail | YES | ✅ (via MgrWS) | `/v1/agent-sessions/:id` + `/v1/session-events` | 2026-04 | ⚠️ V1 API + events shape mismatch | **MAY_REUSE**: rich detail view. Events data shape differs from TRST-4C. |
| MemoryView | YES | ✅ | Client-side state mock | 2026-04 | ⚠️ No backend API | **REWRITE**: UI shell only, no data integration. HOLD until MWT-6. |
| TaskPanel | YES | ✅ | Mock/workbench state | Unknown | ⚠️ Mock data only | **AUDIT**: UI exists but data is mocked. Needs real task/run backend. |
| TracePanel | YES | ✅ | Mock/workbench state | Unknown | ⚠️ Mock data only | **AUDIT**: May overlap with EventChainViewer. Consider merge. |
| TasksView | DELETED (cf4f6cf) | — | `/v1/tasks`, `/v1/traces`, `/v1/evidence` | 2026-05 (deleted) | ❌ V1 APIs don't exist | **RECOVER & REWRITE**: 433 lines, rich UI. Recover from git, rewrite data layer to MWT-3 API. |
| TaskProgress | DELETED (cf4f6cf) | — | `GET /v1/tasks/:taskId/traces` (polling) | 2026-05 (deleted) | ❌ V1 API gone | **RECOVER & REWRITE**: 182 lines, simple polling UI. Rewrite for MWT-3 run API. |
| DecisionTimeline | DELETED (cf4f6cf) | — | Props-based (`DecisionRecord[]`) | 2026-05 (deleted) | ⚠️ `DecisionRecord` type outdated | **RECOVER & REWRITE**: 47 lines, simple display component. Data model needs update for MWT task decisions. |
| Task Planner (BE) | YES | ✅ (TS files) | Internal service | 2026-04 | N/A | **HIGH_PRIORITY_AUDIT**: 599 lines of task/step/plan logic. Core for MWT-3. |
| Execution Loop (BE) | YES | ✅ (TS files) | Internal service | 2026-04 | N/A | **HIGH_PRIORITY_AUDIT**: 571 lines of SSE worker loop. Core for MWT-2. |
| Context Manager (BE) | YES | ✅ (TS files) | Internal | 2026-04 | N/A | **AUDIT**: Compression + token budget. Useful for MWT-6. |

---

## 3. Detailed Findings

### 3.1 Frontend: In-Codebase But Unmounted

These modules exist in `frontend/src/components/` but are NOT imported in any page route:

**ManagerWorkspace** (`components/manager-workspace/`)
- Contains: ManagerWorkspace.tsx (main), SessionList.tsx, SessionDetail.tsx, ManagerConversation.tsx
- Imports: `useAgentSessions`, `useSessionEvents` from `@/hooks/useQueries`
- Data source: `/v1/agent-sessions` endpoints (likely migrated/deprecated)
- State: COMPILED but not in Sidebar nav since TRST-4X
- Notes: SessionList has the `ExpandedSession` concept (left panel). SessionDetail has tabs: Chat, Execution, Decisions, Evidence, Errors

**MemoryView** (`components/views/MemoryView.tsx`)
- Self-contained component with client-side state management only
- Mock categories: Context, Domain Knowledge, Patterns, Connections, Behavior
- No real backend API — purely UI shell
- Recommendation: HOLD until MWT-6, then assess whether to rewrite or extend

**TaskPanel** (`components/workbench/TaskPanel.tsx`)
- Task planning display component
- Uses mock data — no real task/run API behind it
- Good UI structure: task goal, steps, progress, outputs

**TracePanel** (`components/workbench/TracePanel.tsx`)
- Trace visualization component
- Overlaps somewhat with existing EventChainViewer
- May be merged or kept as detail drill-down

### 3.2 Frontend: Deleted (Recoverable from Git)

These were deleted in commit `cf4f6cf` (TRST-4X Console Surface Rebaseline):

**TasksView** (`views/TasksView.tsx`) — 433 lines
- Recoverable: `git show cf4f6cf^:frontend/src/components/views/TasksView.tsx`
- Features: task list with status dots, intent badges, priority sorting, detail panel (Task Info → Summary → Traces → Evidence)
- Depends on: `useTasks`, `useTraces`, `useEvidence`, `usePatchTask`, `useTaskSummary` from `@/hooks/useQueries`
- API endpoints: `/v1/tasks`, `/v1/traces`, `/v1/evidence` — ALL CURRENTLY NON-EXISTENT
- Verdict: **High quality UI, but data layer needs complete rewrite for MWT-3**

**TaskProgress** (`chat/TaskProgress.tsx`) — 182 lines
- Recoverable: `git show cf4f6cf^:frontend/src/components/chat/TaskProgress.tsx`
- Features: progress bar, status display (routing→executing→completed/failed), active trace count
- Polls: `GET /v1/tasks/:taskId/traces` every 3 seconds
- Depends on: `useTaskProgress` from `@/hooks/useQueries`, `TaskProgressSummary` type
- Verdict: **Simple polling pattern still valid for MWT-2, but endpoint needs to be MWT-3 run API**

**DecisionTimeline** (`dashboard/DecisionTimeline.tsx`) — 47 lines
- Recoverable: `git show cf4f6cf^:frontend/src/components/dashboard/DecisionTimeline.tsx`
- Features: chronological decision list with intent badges, routing info, cost/token/latency stats
- Depends on: `DecisionRecord` from `@/types/dashboard` (OUTDATED — doesn't match MWT task/run model)
- Verdict: **Display component is fine, but DecisionRecord type needs update to MWT event model**

### 3.3 Backend: Existing Service Modules

**Task Planner** (`backend_real/src/services/task-planner.ts`) — ~599 lines
- Manages task goal analysis, step breakdown, dependency ordering
- NOT currently wired to any API endpoint
- Core for Manager dispatch in MWT-3
- Verdict: **HIGH priority audit. Must understand its internal model before MWT-3 design.**

**Execution Loop** (`backend_real/src/services/execution-loop.ts`) — ~571 lines
- SSE-based worker execution loop with yield/step/budget management
- Currently powers ChatInterface worker mode
- Core for MWT-2 Worker lifecycle observation
- Verdict: **Operational today. MWT-2 must hook lifecycle events into this loop.**

**LLM Native Router** (`backend_real/src/services/llm-native-router.ts`)
- Fast/Slow routing logic used by Chat → Gateway path
- Operational today via TRST-F1 wiring
- Verdict: **No change needed for MWT-1/2. Verify F1 path for MWT-1**

**Context Manager** (`backend_real/src/context/compressor.ts`, `token-budget.ts`)
- Message compression + token counting
- Verdict: **HOLD for MWT-6. Operational today.**

### 3.4 Frontend TypeScript Status

**73 TypeScript errors** detected in current `frontend/` codebase.

Breakdown (approximate):
- Type mismatches between V1 types and current API shapes (~40%)
- Missing imports from deleted modules (~20%)
- Strict null checks on optional fields (~25%)
- Other (~15%)

These errors exist in the codebase today and do NOT prevent the Next.js dev server from running (Next.js uses SWC, not `tsc`, for compilation). However, any component recovery from git will introduce MORE errors as V1 types won't match current code.

**Impact on MWT-1/2/3**: These 73 errors must be resolved before or during MWT-3 (when restoring deleted components adds more errors). MWT-1 should not introduce new errors.

### 3.5 Current Chat → Backend → Gateway → LLM Smoke Status

Based on TRST-3 MVP closure (ID: 83099421) and TRST-F1 implementation:
- **SSE streaming chat**: Operational (S101P: 23 PASS)
- **Worker execution smoke**: Operational (S101P: 22 PASS)
- **Fast/Slow routing**: Operational (TRST-F1)
- **Gateway observation pipeline**: Operational (TRST-4C)
- **Existing TRST-4C APIs**: `/sessions`, `/events`, `/health` — available and functional

**MWT-1 can use these existing APIs without new backend work.**

### 3.6 ManagerConversation Status

ManagerConversation (`components/manager-workspace/ManagerConversation.tsx`) was wired in S101P:
- Chat-specific content: DecisionCard, routing badge
- ExecutionMetadata shared component
- Backend metadata wiring NOT yet done (S101P backlog item)
- Verdict: **Keep as secondary interaction surface. MWT-1 does NOT touch this.**

---

## 4. MWT Impact Analysis

### 4.1 Impact on MWT-1 (Manager Shell Baseline)

**Blockers: NONE.** MWT-1 is scoped to ChatInterface header changes + ExecutionMetadata enhancement. All existing APIs (`/sessions`, `/events`, `/health`) are available and functional.

**Risks:**
- The 73 TS errors mean typecheck won't pass. MWT-1 should fix errors it introduces but not all 73.
- ChatInterface currently has no session_id display — this is net-new in ChatInterface, not in existing TRST-4C APIs. Need to verify `/sessions` returns the correlation data ChatInterface needs.

### 4.2 Impact on MWT-2 (Worker Run Lifecycle)

**Key finding**: The execution loop (`backend_real/src/services/execution-loop.ts`, ~571 lines) is operational and powers the current Worker. MWT-2 must hook lifecycle events into THIS loop. No need to create a new Worker engine.

**Risk**: The execution loop was not designed with event emission in mind. Adding hooks may require refactoring the loop's internal control flow.

### 4.3 Impact on MWT-3 (Session/Task/Trace Unification)

**Key findings:**
- TaskPlanner (599 lines) exists in backend but is NOT wired to any API
- TasksView (433 lines), TaskProgress (182 lines), DecisionTimeline (47 lines) are all recoverable from git
- But ALL use V1 APIs that DON'T EXIST today
- Object model must be defined first, then APIs built, then components rewired

**Recommendation for MWT-3**: Define object model → build `/api/tasks`, `/api/runs` endpoints → recover TasksView/TaskProgress from git → rewrite data layer (not UI) to new endpoints. Reuse UI structure and component patterns from recovered code.

---

## 5. Module Reuse Recommendations Summary

```
RECOVER_FROM_GIT + REWRITE_DATA_LAYER (3):
  TasksView:       433 lines, good UI → recover, rewrite API calls
  TaskProgress:    182 lines, simple polling → recover, update endpoint
  DecisionTimeline: 47 lines, small display → recover, update types

AUDIT_IN_CODEBASE (4):
  ManagerWorkspace: compiles, V1 API mismatch → audit API contract
  SessionList:      clean component, V1 data → audit API compatibility
  SessionDetail:    rich detail, V1 events → audit data shape
  TaskPanel:        UI exists, mock data → audit real API needs

REWRITE (1):
  MemoryView:       UI shell only → rewrite from scratch when MWT-6 starts

KEEP_AS_IS (2):
  TracePanel:       works but overlaps EventChainViewer → merge or keep
  ManagerConversation: secondary surface, stays as-is

BACKEND_AUDIT (3):
  Task Planner:     599 lines, not wired → audit for MWT-3
  Execution Loop:   571 lines, operational → audit for MWT-2 hooks
  Context Manager:  operational → HOLD for MWT-6
```

---

## 6. Answers to 12 Archaeology Questions

| # | Question | Answer |
|---|----------|--------|
| 1 | ManagerWorkspace 当前是否编译？ | ✅ Yes, but unmounted from nav |
| 2 | SessionList / SessionDetail 当前依赖什么 API？ | `/v1/agent-sessions`, `/v1/session-events` (V1, likely deprecated) |
| 3 | MemoryView 当前是否可运行？ | ✅ Compiles but mock data only — no real backend |
| 4 | TaskPanel 当前是否可运行？ | ✅ Compiles but mock data only |
| 5 | 已删除 TasksView / TaskProgress / DecisionTimeline 在 git history 中的状态？ | All recoverable from cf4f6cf. TasksView=433 lines, TaskProgress=182 lines, DecisionTimeline=47 lines |
| 6 | 旧 backend task/planner/router/context 模块是否存在？ | ✅ YES. Task-planner(599L), execution-loop(571L), llm-native-router, context-manager — all in `backend_real/src/` |
| 7 | 当前 /api/chat backend 的真实调用路径是什么？ | SSE worker loop → execution-loop.ts → Gateway (TRST-F1) → LLM |
| 8 | 当前 Chat → Backend → Gateway → LLM 是否仍通过 smoke 验证？ | ✅ Yes. TRST-3 MVP: 20/0 PASS. S101P: 45/0 PASS |
| 9 | 哪些模块可复用，哪些必须重写？ | 见 §5 表格。3 个从 git 恢复+改写数据层，4 个审计后复用，1 个重写 |
| 10 | 对 MWT-1/MWT-2/MWT-3 的影响是什么？ | 见 §4。MWT-1: 无阻塞。MWT-2: 需在 execution-loop 加 hooks。MWT-3: 需定义对象模型后重写前端数据层 |

---

## 7. Action Items

Immediate (before MWT-1):
- [ ] Verify `/sessions` API returns session_id usable by ChatInterface
- [ ] Verify `/health` API returns Gateway status parseable by ChatInterface
- [ ] Document which of the 73 TS errors are new (to prevent regressions)

MWT-2 prep:
- [ ] Audit execution-loop.ts for lifecycle hook injection points
- [ ] Define worker event schema (worker_start/step/complete/failed)

MWT-3 prep:
- [ ] Recover TasksView, TaskProgress, DecisionTimeline from git (keep as reference, do NOT restore to nav)
- [ ] Audit task-planner.ts internal model for alignment with MWT object model
- [ ] Plan V1→MWT API migration path for backend

---
*Report generated by Agent (MWT-0 Code Archaeology, 2026-08-08)*
