# TrustOS Roadmap Rebaseline — MWT Phases

> **Document**: MWT-0 Roadmap Rebaseline
> **Version**: v0.1
> **Date**: 2026-08-08
> **Status**: DOCS_ACCEPTED_PENDING_ARCHAEOLOGY (PM reviewed 2026-08-08)
> **Supersedes**: TRST-4D/4E/4F/4G linear plan
> **Companion**: `trustos-manager-worker-trust-architecture.md`
> **Scope**: Full product roadmap from current state through productionization

---

## Table of Contents

1. [Roadmap Overview](#1-roadmap-overview)
2. [Current State Summary](#2-current-state-summary)
3. [MWT-0: Architecture Rebaseline](#3-mwt-0-architecture-rebaseline)
4. [MWT-1: Manager Shell Baseline](#4-mwt-1-manager-shell-baseline)
5. [MWT-2: Worker Run Lifecycle](#5-mwt-2-worker-run-lifecycle)
6. [MWT-3: Session / Task / Trace Unification](#6-mwt-3-session--task--trace-unification)
7. [MWT-4: Task Evidence Report](#7-mwt-4-task-evidence-report)
8. [MWT-5: Manager Policy & Approval Dry-run](#8-mwt-5-manager-policy--approval-dry-run)
9. [MWT-6: Memory Governance](#9-mwt-6-memory-governance)
10. [MWT-7: Productionization](#10-mwt-7-productionization)
11. [Paused / Deferred Items](#11-paused--deferred-items)
12. [Risk Register](#12-risk-register)
13. [Next Action After Approval](#13-next-action-after-approval)

---

## 1. Roadmap Overview

### 1.1 Phase Sequence

```
NOW → MWT-0 ──→ MWT-1 ──→ MWT-2 ──→ MWT-3 ──→ MWT-4 ──→ MWT-5 ──→ MWT-6 ──→ MWT-7
     (docs)     (2-3d)    (3-5d)    (3-5d)    (3-5d)    (5-7d)    (3-5d)    (TBD)
```

### 1.2 Phase Map

| Phase | Focus | Layer | Key Deliverable | Est. Effort |
|-------|-------|-------|-----------------|-------------|
| **MWT-0** | Architecture | All | This doc + architecture doc | 2 days |
| **MWT-1** | Manager Shell | L1/L2 | Chat → Manager Shell upgrade | 2-3 days |
| **MWT-2** | Worker Lifecycle | L3/L4 | Worker events in Gateway | 3-5 days |
| **MWT-3** | Object Model | L2/L3/L5 | Session/Task/Trace unification | 3-5 days |
| **MWT-4** | Task Evidence | L4 | Evidence report v2 (task-scoped) | 3-5 days |
| **MWT-5** | Policy/Control | L2/L4 | Approval & enforcement dry-run | 5-7 days |
| **MWT-6** | Memory | L2/L5 | Memory governance | 3-5 days |
| **MWT-7** | Production | All | Auth/RBAC/deploy/multi-tenant | TBD |

### 1.3 Design Principles

1. **Serial execution**: Each MWT phase depends on the previous. No parallel tracks that split attention.
2. **Deliver working software**: Every MWT phase ends with a demonstrable, smoke-testable capability.
3. **Trust Layer as cross-cut**: Trust capabilities are built INTO each phase where needed, not as a separate track.
4. **No premature productionization**: MWT-7 is explicitly gated behind all product loop phases.
5. **Code archaeology before rewrite**: Deleted modules are assessed for recovery before new code is written.

---

## 2. Current State Summary

### 2.1 What We Have

| Asset | Status | Phase Source |
|-------|--------|-------------|
| ChatInterface with SSE streaming | ✅ Active | Pre-TRST + TRST-F1 |
| Chat → Gateway wired | ✅ Active | TRST-F1 |
| Gateway model_call observation | ✅ Mature | TRST-2 |
| Gateway streaming observation | ✅ Mature | TRST-4B |
| Gateway event hashing | ✅ Mature | TRST-2 |
| Gateway risk assessment (dry-run) | ✅ Mature | TRST-2 |
| Evidence report generation | ✅ Mature | TRST-4A |
| Evidence report (human-readable, TRST-4A) | ✅ Mature | TRST-4A |
| SQLite event index + sessions API | ✅ Active | TRST-4C |
| ManagerWorkspace (disconnected) | ⚠️ In code, not in nav | Pre-TRST |
| SessionList / SessionDetail (disconnected) | ⚠️ In code, not in nav | Pre-TRST |
| MemoryView (disconnected) | ⚠️ In code, not in nav | Pre-TRST |
| TaskPanel (disconnected) | ⚠️ In code, not in nav | Pre-TRST |
| ExecutionMetadata (shared component) | ✅ Active | S101P |

### 2.2 What We're Missing

| Gap | Severity | Addressed In |
|-----|----------|-------------|
| Chat doesn't show session/task context | HIGH | MWT-1 |
| No Worker lifecycle events in Gateway | HIGH | MWT-2 |
| No task/run object model | HIGH | MWT-3 |
| Evidence reports are event-scoped not task-scoped | MEDIUM | MWT-4 |
| No approval workflow | MEDIUM | MWT-5 |
| Memory governance | LOW | MWT-6 |
| Old Manager/Worker backend code status unknown | BLOCKER | MWT-0 |

---

## 3. MWT-0: Architecture Rebaseline

### 3.1 Goal

Establish the corrected product architecture and roadmap baseline. No code changes.

### 3.2 Deliverables

| # | Deliverable | Form | Owner |
|---|-------------|------|-------|
| D0.1 | Five-layer architecture document | `docs/strategy/trustos-manager-worker-trust-architecture.md` | ✅ Done |
| D0.2 | MWT roadmap (this document) | `docs/strategy/trustos-roadmap-rebaseline-2026-08.md` | ✅ Done |
| D0.3 | Code archaeology report | Section in execution log | 🔲 |
| D0.4 | Updated execution log | `docs/strategy/TRST-execution-log.md` | 🔲 |
| D0.5 | MWT-1 implementation brief | Section in this document (see §4) | 🔲 (draft below) |

### 3.3 Code Archaeology (D0.3)

Must answer these questions:

| Question | How to Answer |
|----------|--------------|
| Is old task planner code recoverable? | Check git history for `backend_real/` task/planner modules |
| Is old Worker loop code functional? | Check if SSE worker loop compiles and runs |
| What was in TasksView before deletion? | Git log for `TasksView.tsx` |
| What was in DecisionTimeline? | Git log for `DecisionTimeline.tsx` |
| What was in TaskProgress? | Git log for `TaskProgress.tsx` |
| Does ManagerWorkspace have backend API? | Check `ManagerWorkspace.tsx` data fetching |
| What backend routes exist for /api/chat? | Check current backend router |
| Does ManagerWorkspace currently compile? | Build check |
| What API do SessionList / SessionDetail depend on? | Read component source |
| Is MemoryView runnable? Is TaskPanel runnable? | Build + smoke check |
| Does Chat → Backend → Gateway → LLM still pass smoke? | Run existing smoke tests |
| Which modules are reusable vs must be rewritten? | Synthesis from above |

Output: `docs/strategy/mwt-0-code-archaeology-report.md`

Format:

| Module | Exists | Compiles | Data Source | Last Modified | Reuse Recommendation |
|---|---:|---:|---|---|---|

### 3.4 Status

| Item | Status |
|------|--------|
| MWT-0 overall | **DOCS_ACCEPTED_PENDING_ARCHAEOLOGY** ⚠️ |
| Architecture doc | ✅ ACCEPTED_WITH_REVISIONS (PM review 2026-08-08) |
| Roadmap doc | ✅ ACCEPTED_WITH_REVISIONS (PM review 2026-08-08) |
| D0.3 Code archaeology | 🔲 NOT STARTED |
| D0.4 Execution log update | 🔲 NOT STARTED |
| D0.5 MWT-1 implementation brief | 🔲 NOT STARTED (outline in §4) |

**MWT-0 IS NOT COMPLETE.** It will be complete only when D0.3, D0.4, and D0.5 are all done and PM-accepted.

### 3.5 Acceptance Criteria

- [ ] Architecture document: PM reviewed and accepted with revisions ✅ (done 2026-08-08)
- [ ] Roadmap document: PM reviewed and accepted with revisions ✅ (done 2026-08-08)
- [ ] Code archaeology: all 12 questions answered with evidence, table output
- [ ] Execution log: updated with MWT-0/PM-review and MWT-1 gate
- [ ] MWT-1 implementation brief finalized and PM-accepted
- [ ] No code changed during MWT-0 (strictly enforced)

### 3.6 MWT-1 Start Gate

MWT-1 implementation may start ONLY after:
- [ ] PM accepts MWT-0 docs with revisions (this review)
- [ ] D0.3 code archaeology is completed and reviewed
- [ ] D0.4 execution log is updated
- [ ] D0.5 MWT-1 implementation brief is accepted

Do NOT begin MWT-1 code changes before all four gates pass.

### 3.7 Effort: 2 days (documentation + archaeology)

---

## 4. MWT-1: Manager Shell Baseline

### 4.1 Goal

Upgrade ChatInterface from a simple chat box into a Manager Shell that shows session context, Gateway observation status, and basic task awareness.

### 4.2 Target State

```
┌──────────────────────────────────────────────┐
│ 💬 Manager Shell                   sess_abc  │
│                                              │
│ 🔗 Gateway: Online                           │
│ 👁 Observation: Active                       │
│ 📊 Events captured: 12                       │
│                                              │
│ ┌──────────────────────────────────────────┐ │
│ │ 👤 User: Summarize the quarterly report   │ │
│ │                                          │ │
│ │ 🤖 Manager: I'll break this into steps:  │ │
│ │   ├─ Step 1: Extract key sections        │ │
│ │   ├─ Step 2: Summarize per section       │ │
│ │   └─ Step 3: Compile final summary       │ │
│ │                                          │ │
│ │ 📊 Execution: 2/3 steps complete         │ │
│ │ 🔍 [View Evidence →]                     │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ ┌─ Session Info ───────────────────────────┐ │
│ │ Session: sess_abc123                     │ │
│ │ Trace:   tr_def456                       │ │
│ │ Events:  12 observed                     │ │
│ │ Tokens:  4,231 total                     │ │
│ │ Cost:    $0.0003                         │ │
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

### 4.3 Specific Changes

#### 4.3.1 Frontend — ChatInterface Header

| Change | Description | Effort |
|--------|-------------|--------|
| Session badge | Display current `session_id` in chat header | Small |
| Gateway status indicator | Three-layer display: Gateway (Online/Offline), Observation (Active/Pending), Events captured (N). Observation status MUST be based on actual Gateway route or captured events, not only `/health`. | Medium |
| Evidence entrypoint | "View Evidence" link carrying session context. Opens Evidence view with session context banner. If session-scoped evidence is not available, opens Evidence view with available context only. Does NOT claim full task-scoped evidence (MWT-4). | Small |
| Worker activity summary | Show active worker count / step progress (data from SSE) | Medium |

#### 4.3.2 Frontend — ExecutionMetadata Enhancement

| Change | Description | Effort |
|--------|-------------|--------|
| Session context | Add session_id, trace_id to ExecutionMetadata | Small |
| Gateway correlation | Show "Events captured: N" from Gateway | Small |
| Cost summary | Aggregate token/cost for the chat session | Medium |

#### 4.3.3 Backend (Minimal — Prefer Existing APIs)

| Change | Description | Effort |
|--------|-------------|--------|
| Use existing APIs | Prefer TRST-4C `/sessions`, `/events`, `/health` APIs wherever possible | N/A |
| Thin adapter (if needed) | Minimal frontend adapter only if existing APIs don't provide necessary fields | Small |

**Backend constraints:**
- No new durable task/run schema or persistence
- No new product object schema
- No `/api/chat/sessions/:id` endpoint (use existing TRST-4C APIs)
- No premature session API design before MWT-3 object model

### 4.4 Files Likely Touched

| File | Change |
|------|--------|
| `ChatInterface.tsx` | Header with session badge, three-layer Gateway status, Evidence entrypoint |
| `MessageBubble.tsx` | Optional: execution step inline |
| `ExecutionMetadata.tsx` | Add session/trace/event context |
| `Sidebar.tsx` | No change (Chat stays) |
| (No new backend endpoints) | Use existing TRST-4C APIs |

### 4.5 Acceptance Criteria

- [ ] ChatInterface displays `session_id` in header
- [ ] ChatInterface shows three-layer Gateway observation status (Gateway online/offline, Observation active/pending, Events captured: N)
- [ ] Observation status is based on actual Gateway route or captured events, not only `/health`
- [ ] Evidence entrypoint carries current session context
- [ ] Evidence link does NOT claim full task-scoped evidence (MWT-4 scope)
- [ ] ExecutionMetadata shows session_id, trace_id, events captured
- [ ] Chat continues to function (SSE streaming, Fast/Slow routing)
- [ ] No regression: existing smoke tests pass
- [ ] Frontend typecheck: 0 errors
- [ ] PM walkthrough: Manager Shell shows clear Trust observation status

### 4.6 NOT In Scope

- ❌ Full ManagerWorkspace restoration
- ❌ Worker lifecycle events (MWT-2)
- ❌ Task/run object model (MWT-3)
- ❌ Navigation restructure
- ❌ Deleting or renaming Chat
- ❌ New durable task/run schema or persistence
- ❌ New product object schema
- ❌ New backend endpoints (use existing TRST-4C APIs)
- ❌ Full task-scoped evidence claims

### 4.7 Effort: 2-3 days

---

## 5. MWT-2: Worker Run Lifecycle

### 5.1 Goal

Define Worker lifecycle in the Manager/Worker layer first, then emit trust observations for lifecycle transitions. The Trust Layer observes real Worker lifecycle transitions — Worker events are observations of actual execution, not synthetic events manufactured for report completeness.

**Core principle**: Worker events MUST reflect actual lifecycle transitions:

```
Manager dispatches Worker
  → Worker lifecycle transition occurs (start/step/complete/fail)
  → Trust Layer observes and records the transition
```

Events must not be created solely to fill a report checklist. Each Worker event must correspond to a real state change in the Worker execution.

### 5.2 Target State

```
Manager dispatches Worker
        │
        ▼
┌── Worker Run (run_id: wr_001) ──┐
│                                  │
│  worker_start    → event         │
│  worker_step     → event         │
│  model_call      → event (hash)  │
│  tool_call       → event (hash)  │
│  worker_step     → event         │
│  model_call      → event (hash)  │
│  worker_complete → event         │
│                                  │
│  Status: complete                │
│  Steps: 3/3                      │
│  Events: 6 observed              │
│  Hashes: 2 model_call outputs    │
└──────────────────────────────────┘
```

### 5.3 Specific Changes

#### 5.3.1 Gateway — Worker Event Types

| Event Type | Payload | Hash | Priority |
|-----------|---------|------|----------|
| `worker_start` | worker_id, run_id, task_id, worker_type | event_hash | P0 |
| `worker_step` | step_index, step_type, description | event_hash | P0 |
| `worker_complete` | run_id, status, result_summary, output_hash | event_hash | P0 |
| `worker_failed` | run_id, error, diagnostics | event_hash | P1 |
| `tool_call` | tool_name, parameters_hash, result_hash | input_hash, output_hash | P0 |

#### 5.3.2 Backend — Worker Lifecycle Events

| Change | Description | Effort |
|--------|-------------|--------|
| Worker run initialization | Emit `worker_start` when Manager dispatches Worker | Medium |
| Step tracking | Emit `worker_step` on each sub-step | Medium |
| Completion event | Emit `worker_complete` with result summary | Small |
| Failure event | Emit `worker_failed` with diagnostics | Small |
| Tool call event | Emit `tool_call` on tool execution | Medium |

#### 5.3.3 Frontend — Worker Activity Display

| Change | Description | Effort |
|--------|-------------|--------|
| Worker status in ChatInterface | Show active Worker runs inline in chat | Medium |
| Worker detail in EventChainViewer | Filter events by worker_run_id | Small |
| TaskPanel restoration assessment | Evaluate if TaskPanel can display Worker runs | Small |

### 5.4 Files Likely Touched

| File | Change |
|------|--------|
| Gateway event types | New: `worker_start`, `worker_step`, `worker_complete`, `worker_failed`, `tool_call` |
| Backend worker loop | Emit lifecycle events through Gateway |
| `ChatInterface.tsx` | Worker activity display |
| `EventChainViewer.tsx` | Worker event filtering |
| `TaskPanel.tsx` (if restored) | Worker run detail view |

### 5.5 Acceptance Criteria

- [ ] `worker_start` event emitted ONLY when Manager actually dispatches a Worker
- [ ] `worker_step` events emitted for each sub-step
- [ ] `worker_complete` event emitted ONLY when Worker actually completes
- [ ] `worker_failed` event emitted ONLY when Worker actually fails (not timeout-inferred unless explicitly marked inferred)
- [ ] `tool_call` events emitted with input/output hashes
- [ ] All worker events correspond to real lifecycle transitions — no synthetic report-filler events
- [ ] All worker events appear in EventChainViewer
- [ ] ChatInterface shows active Worker status
- [ ] Smoke: Worker run produces complete event chain
- [ ] Privacy: no raw content in worker events
- [ ] Frontend typecheck: 0 errors

### 5.6 NOT In Scope

- ❌ Task decomposition events (MWT-3)
- ❌ Approval workflow (MWT-5)
- ❌ Worker registry
- ❌ Custom worker types

### 5.7 Effort: 3-5 days

---

## 6. MWT-3: Session / Task / Trace Unification

### 6.1 Goal

Implement the full session → task → run → trace → event object model. Unify the data model across Manager, Worker, and Trust layers.

### 6.2 Target Object Model

```
Session (session_id)
├── metadata: created_at, status, user_context
├── events: [event_id, ...]
│
├── Task (task_id)
│   ├── description (privacy-safe)
│   ├── status: planning | executing | completed | failed
│   ├── created_at, completed_at
│   │
│   └── Run (run_id)
│       ├── attempt_number
│       ├── status: running | completed | failed
│       ├── trace_id (correlation group)
│       │
│       └── Event (event_id) × N
│           ├── event_type: model_call | tool_call | worker_start | worker_step | ...
│           ├── input_hash
│           ├── output_hash
│           ├── event_hash
│           ├── timestamp
│           └── privacy_flags
```

### 6.3 Specific Changes

#### 6.3.1 Data Model — Manager Side

| Change | Description | Effort |
|--------|-------------|--------|
| Task creation | Manager creates `task_id` when intent is decomposed | Medium |
| Run creation | Manager creates `run_id` per execution attempt | Small |
| Mapping | `task_id` and `run_id` propagated to Worker and Gateway events | Medium |

#### 6.3.2 Data Model — Gateway Side

| Change | Description | Effort |
|--------|-------------|--------|
| `task_id` on events | All Gateway events carry `task_id` | Small |
| `run_id` on events | All Gateway events carry `run_id` | Small |
| Task API | `GET /api/tasks`, `GET /api/tasks/:id` | Medium |
| Run API | `GET /api/tasks/:id/runs`, `GET /api/runs/:id` | Medium |

#### 6.3.3 Frontend — Navigation & Views

| Change | Description | Effort |
|--------|-------------|--------|
| ManagerWorkspace restoration | Restore to navigation as "Tasks" view | Medium |
| SessionList → TaskList | Reorient SessionList to show tasks (not sessions) | Medium |
| SessionDetail → TaskDetail | Show task + runs + events timeline | Medium |
| Navigation update | Add Tasks to sidebar (between Chat and Evidence) | Small |
| Overview enhancement | Show active tasks, not just sessions | Small |

### 6.4 Navigation Target

```
Current:                    Target:
┌──────────┐               ┌──────────┐
│ 💬 Chat   │               │ 💬 Manager│  ← Chat + session context
│ 🏠 Overview│              │ 📋 Tasks  │  ← Task list + detail
│ 📋 Evidence│              │ 📋 Evidence│
│ 🔗 Events │              │ 🔗 Events │
│ ⚙️ Gateway│              │ ⚙️ Gateway│
│ 🔧 Adv    │              │ 🔧 Adv    │
└──────────┘               └──────────┘
```

### 6.5 Acceptance Criteria

- [ ] `task_id` present on all Gateway events
- [ ] `run_id` present on all Gateway events
- [ ] `GET /api/tasks` returns task list for session
- [ ] `GET /api/tasks/:id` returns task with runs and events
- [ ] ManagerWorkspace restored as Tasks view in navigation (only if archaeology passes)
- [ ] TaskDetail shows: task info → runs → events → evidence
- [ ] Session → Task → Run → Event hierarchy navigable in UI
- [ ] Overview shows active task count
- [ ] Smoke: create task, run worker, verify full trace chain
- [ ] Frontend typecheck: 0 errors

### 6.6 Navigation Change Gates

#### Chat → Manager Rename Gate

The navigation item "Chat" MAY be renamed to "Manager" ONLY after:
- [ ] MWT-1 PM walkthrough is passed
- [ ] ChatInterface has Manager Shell capabilities (session context, Gateway status, Evidence entry)
- [ ] The product experience under "Manager" tab is recognizably a Manager Shell, not a plain chat

Do NOT rename Chat → Manager in MWT-1. This rename is a MWT-3 action with MWT-1 as gate condition.

#### ManagerWorkspace Restoration Gate

ManagerWorkspace MAY be restored as Tasks view in navigation ONLY after:
- [ ] Code archaeology confirms module is restorable OR defines rewrite scope
- [ ] MWT-3 task/run object model is defined and PM-accepted
- [ ] MWT-3 backend data layer is in place (schema defined, API drafted)
- [ ] Real task data is available (MWT-3 creates the task/run model — data availability is an output of MWT-3, not a prerequisite to starting)

Do NOT restore an empty shell Tasks page. The Tasks view must have meaningful data behind it.

### 6.7 Effort: 3-5 days

---

## 7. MWT-4: Task Evidence Report

### 7.1 Goal

Upgrade Evidence Reports from event-scoped ("model call report") to task-scoped ("task execution evidence report").

### 7.2 Target Evidence Report Structure

```
┌─────────────────────────────────────────────┐
│ TASK EVIDENCE REPORT                        │
│ Task: "Quarterly Report Summary"            │
│ Session: sess_abc123                        │
│ Generated: 2026-08-08T10:30:00Z             │
│─────────────────────────────────────────────│
│                                             │
│ TASK SUMMARY                                │
│ Goal: Summarize quarterly report document   │
│ Status: Completed ✅                        │
│ Manager: Default Manager                    │
│                                             │
│ EXECUTION OVERVIEW                          │
│ Total runs: 1                               │
│ Total steps: 5                              │
│ Total events: 8 observed                    │
│ Model calls: 3 (all hashed)                 │
│ Tool calls: 2 (all hashed)                  │
│ Failures: 0                                 │
│                                             │
│ MANAGER DECISIONS                           │
│ 1. Intent: document_summarization           │
│ 2. Model: gpt-4o (reasoning)                │
│ 3. Workers: extract → summarize → compile   │
│ 4. Budget: 10,000 tokens                    │
│                                             │
│ WORKER EXECUTION                            │
│ Worker 1 (extract): ✅                      │
│  ├─ model_call → output_hash: a1b2...       │
│  └─ tool_call  → result_hash: c3d4...       │
│ Worker 2 (summarize): ✅                     │
│  └─ model_call → output_hash: e5f6...       │
│ Worker 3 (compile): ✅                       │
│  └─ model_call → output_hash: g7h8...       │
│                                             │
│ RISK & CONTROL                              │
│ Risk score: 0.1 (low)                       │
│ Flags: none                                 │
│ Control: all allow                          │
│                                             │
│ VERIFIABILITY                               │
│ All output hashes SHA256-verifiable         │
│ No raw content in this report               │
│                                             │
│ LIMITATIONS                                 │
│ This report does not include raw            │
│ prompt/output content. Raw conversation     │
│ content, if retained by the application,    │
│ is outside this evidence report and         │
│ governed by product privacy settings.       │
│ This report covers TrustOS-observed events  │
│ It does not guarantee completeness of       │
│ unobserved side effects or external actions │
└─────────────────────────────────────────────┘
```

### 7.3 Specific Changes

#### 7.3.1 Backend — Evidence Report Generator

| Change | Description | Effort |
|--------|-------------|--------|
| Task-scoped aggregation | Aggregate events by task_id | Medium |
| Manager decision section | Extract decision events | Medium |
| Worker step section | Extract worker lifecycle events | Medium |
| Risk summary per task | Aggregate risk scores | Small |
| Human-readable formatting | Upgrade report template | Medium |
| Export format | Support JSON + human-readable format | Small |

#### 7.3.2 Frontend — Evidence View

| Change | Description | Effort |
|--------|-------------|--------|
| Task selector | Select task to generate report for | Small |
| Report renderer | Render task evidence report v2 | Medium |
| Hash verifier | SHA256 verification UI | Small (reuse TRST-4A) |
| Print/export | Export report as file | Small |

### 7.4 Acceptance Criteria

- [ ] Evidence reports scoped to task, not individual event
- [ ] Report includes: task summary, Manager decisions, Worker steps, model/tool calls
- [ ] All hashes present and verifiable
- [ ] Risk summary aggregated per task
- [ ] Human approval points documented (if any)
- [ ] Limitations statement included
- [ ] No raw content in report
- [ ] Reviewer can SHA256-verify any output hash
- [ ] Smoke: complete a task → generate report → verify all hashes
- [ ] Frontend typecheck: 0 errors

### 7.5 Effort: 3-5 days

---

## 8. MWT-5: Manager Policy & Approval Dry-run

### 8.1 Goal

Implement policy evaluation and human approval workflow at the Manager level — not as isolated Gateway enforcement.

### 8.2 Key Principle

Policy and approval must be Manager-aware, not Gateway-only:

```
WRONG:
Gateway enforces policy → Manager/Worker have no visibility

RIGHT:
Manager evaluates policy → Manager requests approval → Gateway records decision
```

### 8.3 Specific Changes

#### 8.3.1 Policy Definition

| Policy Type | Example | Priority |
|------------|---------|----------|
| Budget limit | "Max $0.10 per task" | P0 |
| Model restriction | "No gpt-4o for simple tasks" | P1 |
| Tool restriction | "No file_delete without approval" | P1 |
| Content boundary | "Flag output containing PII patterns" | P2 |

#### 8.3.2 Approval Workflow — User-Mediated, Not Automated Enforcement

MWT-5 implements **user-mediated approval flow**, not automated enforcement.

```
Manager evaluates policy
  → Advisory recommendation is generated (allow/flag/deny recommendation)
  → User receives approval prompt in Manager Shell
  → User explicitly approves or denies
  → If user denies: Manager stops task because USER chose to stop
  → If user approves: task continues as normal
  → Gateway records approval_request + approval_decision as events
```

Key distinction: The task stops because the USER decided to, not because a policy engine enforced blocking. This is a human decision captured by the Trust Layer, not automated enforcement.

| Trigger | Action |
|---------|--------|
| Budget exceeded | Manager generates advisory recommendation → user approves/denies |
| Tool requires approval | Manager defers → user approves/denies |
| Policy violation detected | Manager flags with advisory recommendation → user decides |

#### 8.3.3 Implementation

| Change | Description | Effort |
|--------|-------------|--------|
| Policy rules engine | Simple rule evaluator in Manager | Medium |
| Approval request UI | ChatInterface approval card | Medium |
| Approval event | `approval_request` and `approval_decision` events in Gateway | Small |
| Dry-run only | No blocking enforcement in MWT-5 | Constraint |
| Policy dashboard | Simple policy view in Advanced | Small |

### 8.4 Acceptance Criteria

- [ ] Budget limit policy triggers advisory recommendation (not blocking)
- [ ] User can approve/deny in ChatInterface
- [ ] If user denies, Manager stops task because of explicit user decision (not automated enforcement)
- [ ] Approval decisions recorded as Gateway events (approval_request + approval_decision)
- [ ] Evidence report includes approval trail
- [ ] Policy evaluation is advisory: no automatic Gateway blocking/enforcement is implemented
- [ ] Smoke: exceed budget → approval prompt → user approves → task continues
- [ ] Smoke: exceed budget → approval prompt → user denies → task stops (user-mediated)
- [ ] Frontend typecheck: 0 errors

### 8.5 Effort: 5-7 days

---

## 9. MWT-6: Memory Governance

### 9.1 Goal

Make the Memory system observable and governable through the Trust Layer.

### 9.2 Scope

| Feature | Description |
|---------|-------------|
| Memory event types | `memory_create`, `memory_update`, `memory_delete`, `memory_use` events in Gateway |
| Memory audit trail | Trace which memory was used in which task |
| Memory risk assessment | Flag memories containing sensitive patterns |
| MemoryView restoration | Restore to navigation ONLY after separate health audit confirms component is runnable and data-compatible |
| Memory cleanup | User can review and purge memories |

### 9.3 Acceptance Criteria

- [ ] Memory operations produce Gateway events
- [ ] Memory usage appears in task evidence report
- [ ] Memory risk flags (dry-run only)
- [ ] MemoryView available in navigation
- [ ] Memory audit trail viewable

### 9.4 Effort: 3-5 days

---

## 10. MWT-7: Productionization

### 10.1 Goal

Make TrustOS deployable, secure, and multi-user capable.

### 10.2 Scope (TBD — depends on MWT-1 through MWT-6 outcomes)

| Candidate | Description | Priority |
|-----------|-------------|----------|
| Authentication | User login/identity | High |
| RBAC | Role-based access control | Medium |
| Multi-tenant | Multiple workspaces/users | Medium |
| Durable backend | Replace SQLite with production DB | Medium |
| Deployment | Docker/production deploy scripts | High |
| Monitoring | Health checks, metrics, alerts | Medium |
| Backup/Recovery | Event log backup | Low |

### 10.3 Gate

MWT-7 scope is TBD and will be defined after MWT-6 completion. The constraint is: no productionization before product loop is complete.

---

## 11. Paused / Deferred Items

| Item | Reason Paused | Resume Gate |
|------|--------------|-------------|
| TRST-4D Backend Assessment API | Needs Manager/Worker semantics first | After MWT-3 object model |
| Provider registry | Gateway-only feature, no product need yet | After MWT-7 |
| Auth/RBAC | Premature before product loop | MWT-7 |
| Enforcement (blocking) | Premature before dry-run validated | After MWT-5 |
| Legal-grade evidence | Premature for Private Beta | After MWT-7 |
| Enterprise admin | No enterprise users yet | After MWT-7 |
| Streaming-specific hardening | TRST-4B is sufficient for Private Beta | Post-MWT-4 if issues found |

---

## 12. Risk Register

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| Old Manager/Worker code too decayed to recover | HIGH | MEDIUM | MWT-0 archaeology; plan for rewrite if needed |
| MWT-3 object model too complex for Private Beta | MEDIUM | LOW | Start simple (task + run only), add nesting later |
| Gateway overhead from Worker events | LOW | LOW | Worker events are lightweight; same path as model_call |
| Navigation restructure breaks existing users | LOW | LOW | Only 1 navigation item added (Tasks); others unchanged |
| MWT-5 policy engine scope creep | MEDIUM | MEDIUM | User-mediated approval, not automated enforcement; no blocking code |
| PM review cycle delays implementation | MEDIUM | LOW | Documents designed for single-review acceptance |
| Two-product-line confusion (TrustOS vs Gateway) | LOW | LOW | Architecture doc explicitly resolves this |

---

## 13. Next Action After Approval

### 13.1 PM Approved MWT-0 Docs (Current State)

PM has reviewed and accepted MWT-0 documents with revisions (2026-08-08). Next immediate steps:

1. **D0.3 Code archaeology** — audit all unknown modules (ManagerWorkspace, SessionList, SessionDetail, TaskPanel, TaskProgress, DecisionTimeline, TasksView, MemoryView, old backend code). Output: `docs/strategy/mwt-0-code-archaeology-report.md`
2. **D0.4 Execution log update** — update `docs/strategy/TRST-execution-log.md` with MWT-0 PM review results, MWT-1 gate conditions, and updated project status
3. **D0.5 MWT-1 implementation brief** — finalize MWT-1 detailed brief based on archaeology findings

### 13.2 MWT-1 Start Gate (NOT YET OPEN)

MWT-1 implementation may begin ONLY after:
- [ ] D0.3 code archaeology completed and reviewed
- [ ] D0.4 execution log updated
- [ ] D0.5 MWT-1 brief finalized and PM-accepted
- [ ] PM gives explicit MWT-1 start directive

Do NOT begin MWT-1 code changes until all four gates pass. This gate is intentionally strict to prevent premature implementation before archaeology reveals the true state of old code.

### 13.3 MWT-1 Startup Checklist (After Gates Pass)

- [ ] Review code archaeology findings for MWT-1 impact
- [ ] Verify ChatInterface.tsx has existing session metadata hooks
- [ ] Verify TRST-4C `/sessions`, `/events`, `/health` API availability
- [ ] Create MWT-1 feature branch
- [ ] Implement changes per §4.3
- [ ] Run existing smoke tests
- [ ] PM walkthrough

---

## Appendix A: Phase Dependency Graph

```
MWT-0 (docs)
  │
  ▼
MWT-1 (Manager Shell)
  │
  ▼
MWT-2 (Worker Lifecycle)
  │
  ▼
MWT-3 (Object Model)
  │
  ▼
MWT-4 (Task Evidence)
  │
  ▼
MWT-5 (Policy/Approval)
  │
  ▼
MWT-6 (Memory)
  │
  ▼
MWT-7 (Productionization)
```

Each phase MUST complete (all ACs met, PM sign-off) before the next begins. No parallel tracks.

---

## Appendix B: Scope Guard

The following are explicitly OUT OF SCOPE for the entire MWT roadmap:

- ❌ New external API integrations
- ❌ New AI model providers
- ❌ Mobile/native apps
- ❌ Real-time collaboration
- ❌ Plugin marketplace
- ❌ Public API
- ❌ SaaS/multi-tenant billing
- ❌ SOC2/ISO compliance
- ❌ Third-party audit integration
