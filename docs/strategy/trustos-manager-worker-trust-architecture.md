# TrustOS Manager-Worker-Trust Architecture

> **Document**: MWT-0 Architecture Rebaseline
> **Version**: v0.1
> **Date**: 2026-08-08
> **Status**: ACCEPTED_WITH_REVISIONS (PM reviewed 2026-08-08)
> **Last Updated**: 2026-08-08 (PM review revisions)
> **Author**: Agent (TrustOS MWT-0 Architecture Rebaseline)
> **Replaces**: TRST-0-trustos-architecture-thesis.md (as primary architecture reference)
> **Scope**: TrustOS product architecture — 5-layer model, object model, module classification, current state assessment

---

## Table of Contents

1. [Historical Product Intent](#1-historical-product-intent)
2. [The Calibration: What Was Wrong](#2-the-calibration-what-was-wrong)
3. [Five-Layer Architecture](#3-five-layer-architecture)
4. [Chat as Manager Shell Entrypoint](#4-chat-as-manager-shell-entrypoint)
5. [Manager Layer Specification](#5-manager-layer-specification)
6. [Worker Layer Specification](#6-worker-layer-specification)
7. [Gateway as Trust Layer](#7-gateway-as-trust-layer)
8. [Evidence as Review Artifact](#8-evidence-as-review-artifact)
9. [Session / Task / Trace Object Model](#9-session--task--trace-object-model)
10. [Current Implemented Capability Map](#10-current-implemented-capability-map)
11. [Module Classification & Re-audit](#11-module-classification--re-audit)
12. [Architecture Decisions](#12-architecture-decisions)

---

## 1. Historical Product Intent

### 1.1 Original Product DNA

TrustOS was not conceived as an API proxy or gateway product. Its original thesis was:

> **An AI-native operating system for trusted AI work** — where a Manager orchestrates Workers to execute tasks, and the system provides observation, evidence, and trust.

The original product flow:

```
User → Chat / Manager Shell → Manager → Worker / Tools / Model Calls → Results, Memory, Tasks, Evidence, Feedback
```

### 1.2 Core Product Question

Not:

> How to build an OpenAI API proxy?

But:

> How can an AI Manager reliably dispatch Workers, execute tasks, explain process, accumulate memory, control cost, and earn user trust?

### 1.3 Original Product Pillars

1. **Default Chat + On-demand Agent**: User enters through Chat; Manager understands intent; Workers execute
2. **Budgeted Intelligence**: Cost-aware model routing and task budgeting
3. **Observable Execution**: What the AI does should be visible and explainable
4. **Trust by Design**: Evidence, not blind faith

---

## 2. The Calibration: What Was Wrong

### 2.1 The Inverted Architecture

During TRST-2 through TRST-4C, the architecture became inverted:

```
WRONG:
TrustOS = Gateway product
Chat/Manager/Worker = traffic generators for Gateway

RIGHT:
TrustOS = Manager + Worker intelligent runtime system
Gateway = trust/observation/evidence layer
```

### 2.2 Root Causes

1. **Gateway became the organizing principle**: TRST phases were numbered around Gateway capabilities, and Manager/Worker features were seen as "traffic sources" for Gateway events
2. **Chat was classified as demo/deprecatable**: At TRST-4X, ChatInterface was briefly considered for deletion before being restored as conditional
3. **Manager/Worker code decayed**: While Gateway was being built, the old chat backend/router/context/task code received no maintenance
4. **Module deletion used wrong lens**: TasksView, DecisionTimeline, TaskProgress were classified as removable when viewed through a "Gateway console" lens — but they are potentially core under a Manager/Worker lens

### 2.3 What Was NOT Wrong

The TRST phases were not wasted. They solved a real problem — **trust infrastructure for AI runtime** — but the framing was incorrect. What was built is correct; only the classification needs fixing.

---

## 3. Five-Layer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    LAYER 1 — INTERACTION                     │
│                                                              │
│  Chat / Manager Shell                                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │ Chat     │  │ Tasks    │  │ Workers  │  │ Evidence    │  │
│  │ Input    │  │ Current  │  │ Activity │  │ / Trace     │  │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘  │
│                                                              │
│  User-facing entry point. Chat as primary interaction.      │
├─────────────────────────────────────────────────────────────┤
│                    LAYER 2 — MANAGER                         │
│                                                              │
│  ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ Intent   │ │ Task      │ │ Worker   │ │ Budget       │  │
│  │ Engine   │ │ Planner   │ │ Router   │ │ Controller   │  │
│  └──────────┘ └───────────┘ └──────────┘ └──────────────┘  │
│  ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ Memory   │ │ Progress  │ │ Decision │ │ Session      │  │
│  │ Manager  │ │ Tracker   │ │ Engine   │ │ Manager      │  │
│  └──────────┘ └───────────┘ └──────────┘ └──────────────┘  │
│                                                              │
│  Product brain. Plans, routes, tracks, explains.            │
├─────────────────────────────────────────────────────────────┤
│                    LAYER 3 — WORKER / TOOL                   │
│                                                              │
│  ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ Model    │ │ Tool      │ │ Code     │ │ Retrieval    │  │
│  │ Caller   │ │ Executor  │ │ Runner   │ │ Engine       │  │
│  └──────────┘ └───────────┘ └──────────┘ └──────────────┘  │
│  ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ Analysis │ │ File      │ │ Search   │ │ External     │  │
│  │ Worker   │ │ Worker    │ │ Worker   │ │ API Worker   │  │
│  └──────────┘ └───────────┘ └──────────┘ └──────────────┘  │
│                                                              │
│  Execution layer. Managed by Manager. Observable by Trust.   │
├─────────────────────────────────────────────────────────────┤
│                    LAYER 4 — TRUST                           │
│                                                              │
│  ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ Observe  │ │ Hash      │ │ Risk     │ │ Dry-run      │  │
│  │ (Gateway)│ │ Engine    │ │ Assess   │ │ Control      │  │
│  └──────────┘ └───────────┘ └──────────┘ └──────────────┘  │
│  ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ Evidence │ │ Privacy   │ │ Trace    │ │ Prove        │  │
│  │ Report   │ │ Boundary  │ │ Correlate│ │ (Verifiable) │  │
│  └──────────┘ └───────────┘ └──────────┘ └──────────────┘  │
│                                                              │
│  Cross-cutting trust infrastructure. Observes L2+L3.        │
├─────────────────────────────────────────────────────────────┤
│                    LAYER 5 — STORAGE / MEMORY / HISTORY      │
│                                                              │
│  ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ Sessions │ │ Tasks     │ │ Events   │ │ Memory       │  │
│  │ Store    │ │ Store     │ │ Store    │ │ Store        │  │
│  └──────────┘ └───────────┘ └──────────┘ └──────────────┘  │
│  ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ Traces   │ │ Evidence  │ │ Feedback │ │ Config       │  │
│  │ Store    │ │ Store     │ │ Store    │ │ Store        │  │
│  └──────────┘ └───────────┘ └──────────┘ └──────────────┘  │
│                                                              │
│  Persistence layer. SQLite event index is v0.1 start.       │
└─────────────────────────────────────────────────────────────┘
```

### 3.1 Layer Interaction Rules

1. **L1 (Interaction)** talks to L2 (Manager), not directly to L3 (Worker)
2. **L2 (Manager)** talks to L3 (Worker) and L5 (Storage), never directly implements L4
3. **L3 (Worker)** executes, reports to L2, is observed by L4
4. **L4 (Trust)** is cross-cutting: it observes L2+L3, writes to L5, feeds back to L1
5. **L5 (Storage)** serves all layers; no layer directly writes raw content that conflicts with L4 privacy model
6. **L2 (Manager) owns product semantics**: session, task, run, decision, and user-facing state objects are defined by Manager — their meaning, lifecycle, and relationships belong to the Manager layer, not to Gateway or Storage
7. **L4 (Trust/Gateway) owns trust semantics**: event, hash, trace, evidence, and verifiability objects are defined by Trust — their meaning belongs to the Trust layer, not to Manager or Storage
8. **L5 (Storage) stores state but must not drive product architecture**: Storage schema follows product semantics defined by L2 and L4. SQLite tables, API contracts, and persistence formats must never implicitly define what a session or task or event means

### 3.2 Data Flow (Complete Product Path)

```
User
  ↓
Chat / Manager Shell (L1)
  ↓
Manager plans and routes (L2)
  ↓
Worker / Model / Tool execution (L3)
  ↓
Gateway observes execution (L4)
  ↓
Trust Layer creates events, hashes, traces (L4)
  ↓
Evidence Report explains what happened (L4)
  ↓
User / reviewer audits and improves trust (L1)
```

---

## 4. Chat as Manager Shell Entrypoint

### 4.1 Product Identity

ChatInterface is the **original primary interaction surface** of TrustOS. It predates the TRST Gateway work (TRST-2 through TRST-4C) and is part of the original product interaction model — not a feature that evolved from a demo.

```
ChatInterface:
  Product role:     original primary interaction surface
  Current role:     Gateway-observed Manager Shell entrypoint (via TRST-F1 wiring)
  Maturity:         Shell baseline incomplete — observable but not yet Manager-aware
```

The "demo interaction surface" classification was a pre-F1 historical label only. As of TRST-F1, ChatInterface is wired through the Gateway observation pipeline and serves as the active primary entrypoint.

### 4.2 Current Capabilities

ChatInterface has been wired to Gateway through TRST-F1 (Chat → Backend → Gateway → LLM path). It supports:
- SSE streaming chat
- Fast/Slow dual-model routing
- Clarification questions
- Delegation polling
- Execution metadata display (S101P)

### 4.3 Current Limitations

ChatInterface does not yet function as a full Manager Shell. Key gaps:
- No session/task/trace ID linkage visible to user
- No Gateway observation status visible in chat header
- No Worker activity feedback in the chat view
- No Evidence entry from within chat
- No task progress visualization

### 4.4 Target: Manager Shell

Chat should evolve from a simple chat interface into a Manager Shell that shows:

```
┌─────────────────────────────────────────┐
│ Manager Shell                            │
│                                          │
│ Session: sess_abc123  Trace: tr_def456  │
│ ┌─────────────────────────────────────┐ │
│ │ 💬 Chat                             │ │
│ │                                     │ │
│ │ User: Summarize this document       │ │
│ │ Manager: I'll break this into...    │ │
│ │  ├─ Worker 1: Extract text          │ │
│ │  ├─ Worker 2: Summarize sections    │ │
│ │  └─ Worker 3: Combine & format      │ │
│ │                                     │ │
│ │ [Task Progress ████████░░ 80%]      │ │
│ │ [Evidence →] [Trace →]              │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### 4.5 Transition Path

| Step | Change | Milestone |
|------|--------|-----------|
| 1 | Display session_id + Gateway observation status in chat header | MWT-1 |
| 2 | Show task progress as Manager dispatches Workers | MWT-1 |
| 3 | Add Evidence link from within chat session | MWT-4 |
| 4 | Worker activity summary inline in chat | MWT-2 |
| 5 | Unified Manager Shell that embeds Chat + Tasks + Workers | MWT-3 |

---

## 5. Manager Layer Specification

### 5.1 Core Responsibilities

| Responsibility | Description | Current Status |
|---------------|-------------|----------------|
| Intent Understanding | Parse user input into actionable intent | Partial (in ChatInterface routing) |
| Task Planning | Decompose goals into subtasks | Decayed (old task planner unused) |
| Worker Orchestration | Select and dispatch Workers | Partial (Fast/Slow routing) |
| Model Routing | Choose appropriate model for subtask | Partial (dual-model in ChatInterface) |
| Budget Control | Enforce token/cost limits per task | Minimal (Worker-level only) |
| Memory Management | Store/retrieve user context and preferences | Exists (MemoryView + backend) |
| Progress Tracking | Track task completion status | Decayed (old TaskProgress unused) |
| Decision Explanation | Explain why a model/worker/action was chosen | Partial (DecisionCard in ChatInterface) |
| Session Management | Maintain session continuity | Partial (SessionList + SessionDetail in ManagerWorkspace, not connected) |

### 5.2 Current Code Location

Manager capabilities are fragmented across:
- `ChatInterface.tsx` — intent routing (Fast/Slow model choice)
- `ManagerWorkspace.tsx` — session management UI (not in navigation)
- `DecisionCard.tsx` — decision display
- `ExecutionMetadata.tsx` — execution info display
- Old backend chat/router/context/task modules — potentially stale

### 5.3 Key Gap

There is no unified "Manager" entity in code. Manager behavior is implicit in the chat routing logic. For MWT-1+, Manager needs to become an explicit architectural component with its own state, lifecycle, and API surface.

---

## 6. Worker Layer Specification

### 6.1 Core Responsibilities

| Responsibility | Description | Current Status |
|---------------|-------------|----------------|
| Model Call Execution | Execute LLM API calls | Yes (via Gateway) |
| Tool Call Execution | Execute tool/function calls | Partial (SSE worker loop) |
| Code Execution | Run sandboxed code | Not implemented |
| Retrieval | Search/retrieve documents | Not implemented |
| Analysis | Analyze data/structured content | Not implemented |
| Status Reporting | Report execution state to Manager | Partial (SSE progress events) |
| Result Hashing | Produce verifiable output hashes | Via Gateway (TRST-2C) |
| Budget Compliance | Respect Manager's token/cost limits | Partial |
| Failure Handling | Report failures with diagnostics | Partial |

### 6.2 Worker Lifecycle

```
                  ┌──────────┐
    Manager       │ WORKER   │
    dispatches →  │ LIFECYCLE │
                  └──────────┘
                       │
    ┌──────────────────┼──────────────────┐
    │                  │                  │
    ▼                  ▼                  ▼
┌────────┐      ┌──────────┐      ┌──────────┐
│ queued │ ──→  │ running  │ ──→  │ complete │
└────────┘      └──────────┘      └──────────┘
                       │                  │
                       ▼                  ▼
                ┌──────────┐      ┌──────────┐
                │  failed  │      │ approval │
                └──────────┘      │ _needed  │
                                  └──────────┘
```

### 6.3 Worker Event Types (for Trust Layer)

Gateway should observe these Worker-level events:
- `worker_start` — Worker dispatch
- `worker_step` — Sub-step within worker run
- `model_call` — LLM API call (already implemented)
- `tool_call` — Tool execution (partial)
- `worker_complete` — Worker finished successfully
- `worker_failed` — Worker failed
- `worker_approval_needed` — Human approval required

### 6.4 Current Code Location

Worker execution lives in:
- Backend SSE worker loop (WorkBuddy backend)
- `ChatInterface.tsx` — SSE event handling
- Not yet explicitly modeled as a named Worker in the Gateway event stream

---

## 7. Gateway as Trust Layer

### 7.1 Correct Positioning

Gateway is NOT the product. Gateway is Trust Layer infrastructure — a cross-cutting capability that observes Manager and Worker execution to produce verifiable evidence.

```
WRONG:  "TrustOS is Gateway + Dashboard"
RIGHT:  "TrustOS is Manager+Worker runtime; Gateway provides trust"
```

### 7.2 What Gateway Observes

| Event Type | Current | Needed | Priority |
|-----------|---------|--------|----------|
| `model_call` | ✅ Mature | — | — |
| `tool_call` | ⚠️ Partial | Worker tool execution events | MWT-2 |
| `worker_start` | ❌ Not observed | Worker dispatch events | MWT-2 |
| `worker_complete` | ❌ Not observed | Worker completion events | MWT-2 |
| `task_step` | ❌ Not observed | Manager task decomposition | MWT-3 |
| `decision` | ❌ Not observed | Manager routing/planning decisions | MWT-3 |
| `approval_request` | ❌ Not observed | Human approval boundary | MWT-5 |
| `policy_recommendation` | ❌ Not observed | Policy suggestions | MWT-5 |

### 7.3 What Gateway Should NOT Become

The following MUST NOT be prioritized before Manager/Worker product loop is complete:

1. ❌ Full API platform
2. ❌ Enterprise gateway product
3. ❌ Provider registry
4. ❌ Auth/RBAC platform
5. ❌ Compliance archive
6. ❌ Enforcement firewall
7. ❌ Production-grade proxy infrastructure

### 7.4 Gateway Capability Summary (from TRST-2/3/4)

| Capability | Status | Source |
|-----------|--------|--------|
| Non-streaming model_call observation | ✅ Mature | TRST-2 |
| Streaming model_call observation | ✅ Mature | TRST-4B |
| Event hashing (input/output/event) | ✅ Mature | TRST-2 |
| Trace/session/run correlation | ✅ Mature | TRST-2 |
| Risk assessment (dry-run) | ✅ Mature | TRST-2 |
| Evidence report generation | ✅ Mature | TRST-4A |
| Privacy boundary / no raw content | ✅ Mature | TRST-2 |
| SQLite event index | ✅ Implemented | TRST-4C |
| Session list API | ✅ Implemented | TRST-4C |
| Pagination events API | ✅ Implemented | TRST-4C |
| Chat→Gateway wiring | ✅ Implemented | TRST-F1 |

---

## 8. Evidence as Review Artifact

### 8.1 Current State

Evidence reports are generated from Gateway-observed model_call events. They contain:
- Event hashes (input_hash, output_hash, event_hash)
- Risk assessment (allow/flag/block dry-run)
- Token counts and cost
- Privacy boundary compliance (no raw content)

### 8.2 Target State

Evidence should evolve from "model call report" to "task execution evidence report":

| Current | Target |
|---------|--------|
| Per-event evidence | Per-task evidence report |
| Model call focus | Task + Worker + Model focus |
| Technical event data | Human-readable execution summary |
| No user goal context | User goal summary (privacy-safe) |
| No Manager decisions | Manager decision audit trail |
| No Worker steps | Worker execution steps |
| No approval points | Human approval audit points |

### 8.3 Target Evidence Report Structure

```
Task Evidence Report
├─ Task Summary (privacy-safe, no raw prompt)
├─ Manager Decisions
│  ├─ Intent classification
│  ├─ Task decomposition
│  ├─ Worker selection
│  └─ Model routing choices
├─ Worker Execution Steps
│  ├─ Worker 1: model_call → [hash]
│  ├─ Worker 2: tool_call → [hash]
│  └─ Worker 3: model_call → [hash]
├─ Risk & Control Signals
│  ├─ Risk scores per event
│  ├─ Any flags triggered
│  └─ Dry-run control decisions
├─ Output Verifiability
│  ├─ Output hashes (SHA256 verifiable)
│  └─ No raw content in report
├─ Human Approval Points
│  └─ Any decisions requiring approval
└─ Known Limitations
   └─ What this report does NOT cover
```

---

## 9. Session / Task / Trace Object Model

### 9.1 Object Hierarchy

```
Session (session_id)
├── Task (task_id)
│   ├── Run (run_id)
│   │   ├── Step (step_index)
│   │   │   ├── Event (event_id)    ← Gateway-observed
│   │   │   │   ├── input_hash
│   │   │   │   ├── output_hash
│   │   │   │   └── event_hash
│   │   │   └── Event (event_id)
│   │   └── Step
│   └── Run
└── Task
```

### 9.2 Identifier Definitions

| ID | Definition | Source | Lifecycle |
|----|-----------|--------|-----------|
| `session_id` | User conversation session | Manager Layer | Created at session start, persisted across tasks |
| `task_id` | User goal/task | Manager Layer | Created when Manager decomposes intent |
| `run_id` | Single execution attempt for a task | Manager Layer | One per execution attempt (retry = new run) |
| `trace_id` | Trust event correlation chain | Trust Layer (Gateway) | Spans multiple events within a run |
| `event_id` | Single observed event | Trust Layer (Gateway) | One per model_call/tool_call/step |

### 9.3 Mapping Between Layers

```
Manager Layer          Trust Layer
─────────────          ────────────
Session                ← session_id on events
Task                   ← (not yet mapped to events)
Run                    ← trace_id correlation group (not 1:1 forced)
Step                   ← individual event
```

**run_id / trace_id relationship:**

`run_id` and `trace_id` serve different ownership domains and MUST NOT be treated as a strict 1:1 mapping.

```
run_id:
  Owned by Manager (L2).
  Identifies a single execution attempt of a task.

trace_id:
  Owned by Trust (L4).
  Identifies a correlation chain of observed trust events.

Default mapping:
  One run_id → one primary trace_id (common case).

Allowed variance:
  One run_id → multiple trace_id values
  (if a single execution attempt generates multiple distinct observation chains,
   e.g., parallel tool calls with separate Gateway correlation groups).

Constraint:
  One trace_id MUST NOT span multiple unrelated task runs
  unless explicitly tagged as a cross-run trace.
```

This separation prevents two problems:
1. **Tight coupling**: If run_id = trace_id is forced, any change to Manager execution semantics breaks Trust correlation.
2. **Multi-chain tasks**: Complex tasks with parallel workers or retries naturally produce multiple traces per run — the model must accommodate this.

### 9.4 Current Implementation Status

| Mapping | Status |
|---------|--------|
| session_id → Gateway events | ✅ Via TRST-4C session API |
| trace_id → event group | ✅ Via Gateway correlation |
| task_id → events | ❌ Not mapped |
| run_id → events | ❌ Not mapped |
| step → event | ❌ Not mapped |

This means: Gateway currently sees individual events with session context, but does not understand task/run/step hierarchy. This is the key gap MWT-3 addresses.

---

## 10. Current Implemented Capability Map

### 10.1 By Layer — What Exists Today

| Layer | Capability | Level | Source |
|-------|-----------|-------|--------|
| **L1 Interaction** | ChatInterface (SSE streaming) | ✅ Implemented | Frontend |
| L1 | OverviewView (dashboard) | ✅ Implemented | Frontend |
| L1 | EventChainViewer | ✅ Implemented | Frontend |
| L1 | EvidenceReportPanel | ✅ Implemented | Frontend |
| L1 | GatewayStatusCard | ✅ Implemented | Frontend |
| L1 | MemoryView (not in nav) | ⚠️ Exists, disconnected | Frontend |
| L1 | ManagerWorkspace (not in nav) | ⚠️ Exists, disconnected | Frontend |
| L1 | SessionList/SessionDetail | ⚠️ Exists, disconnected | Frontend |
| **L2 Manager** | Fast/Slow model routing | ✅ In ChatInterface | Frontend |
| L2 | Decision display (DecisionCard) | ✅ Implemented | Frontend |
| L2 | Execution metadata display | ✅ Implemented | Frontend (S101P) |
| L2 | Task planning/ decomposition | ❌ Decayed | Old backend |
| L2 | Budget control | ❌ Decayed | Old backend |
| L2 | Progress tracking | ❌ Decayed | Old backend |
| **L3 Worker** | Model call execution | ✅ Via Gateway | Backend |
| L3 | SSE worker loop | ✅ Implemented | Backend |
| L3 | Tool calls | ⚠️ Partial | Backend |
| L3 | Worker lifecycle events | ❌ Not observed | — |
| **L4 Trust** | model_call observation | ✅ Mature | Gateway |
| L4 | Streaming observation | ✅ Mature | Gateway (TRST-4B) |
| L4 | Event hashing | ✅ Mature | Gateway |
| L4 | Risk assessment (dry-run) | ✅ Mature | Gateway |
| L4 | Evidence report | ✅ Mature | Gateway (TRST-4A) |
| L4 | Privacy boundary | ✅ Mature | Gateway |
| L4 | Chat→Gateway wiring | ✅ Mature | TRST-F1 |
| **L5 Storage** | SQLite event index | ✅ Implemented | Gateway (TRST-4C) |
| L5 | Sessions API | ✅ Implemented | Gateway (TRST-4C) |
| L5 | Pagination | ✅ Implemented | Gateway (TRST-4C) |
| L5 | Memory store | ✅ Implemented | Backend |
| L5 | Task store | ❌ Not implemented | — |
| L5 | Evidence store | ❌ Not implemented | — |

### 10.2 Capability Heat Map

```
Layer 1 (Interaction):  ████████░░  80% — Chat shell functional, Manager UX incomplete
Layer 2 (Manager):      ███░░░░░░░  30% — Routing exists, planning/orchestration decayed
Layer 3 (Worker):       ████░░░░░░  40% — Model calls work, lifecycle not observed
Layer 4 (Trust):        █████████░  90% — Most mature layer, over-invested relative to others
Layer 5 (Storage):      ████░░░░░░  40% — Event index exists, task/evidence store missing
```

### 10.3 Key Insight

Layer 4 (Trust) is the most mature layer. This is a symptom of the inverted architecture. The correction is to invest in Layers 1, 2, 3, and 5 until they match the maturity of Layer 4 — not to do more Trust work in isolation.

---

## 11. Module Classification & Re-audit

### 11.1 Active Modules (in Navigation)

| Module | Nav ID | Layer | Classification | Notes |
|--------|--------|-------|---------------|-------|
| ChatInterface | chat | L1 | **A-CORE** | Primary Manager Shell entrypoint |
| OverviewView | overview | L1 | **A-CORE** | Manager/Trust console summary |
| EvidenceReportPanel | evidence | L1/L4 | **A-CORE** | Trust Layer evidence output |
| EventChainViewer | events | L1/L4 | **A-CORE** | Trust event timeline |
| GatewayStatusCard | gateway | L4 | **B-SUPPORT** | Gateway diagnostics |
| DebugPanel | advanced | L4 | **B-SUPPORT** | Debug/development |
| AdminPanel | advanced > admin | L4 | **B-SUPPORT** | Admin operations |

### 11.2 Existing but Disconnected Modules (Re-audited)

| Module | Location | Gateway-Only Lens | Manager/Worker Lens | Recommendation |
|--------|----------|------------------|---------------------|----------------|
| ManagerWorkspace | `manager-workspace/` | Deletable | **A-CANDIDATE_CORE** — Manager Shell container | **AUDIT_BEFORE_RESTORE** in MWT-3: archaeology must confirm compilability, API compatibility, UI quality before any restoration decision |
| SessionList | `manager-workspace/` | Deletable | **A-CANDIDATE_CORE** — Task/session history | **MAY_REUSE_OR_REWRITE**: depends on MWT-3 object model alignment; current Sessions API may not match target data shape |
| SessionDetail | `manager-workspace/` | Deletable | **A-CANDIDATE_CORE** — Task execution detail | **AUDIT_BEFORE_RESTORE**: verify current API contract compatibility with TRST-4C backend and MWT-3 object model |
| ManagerConversation | `manager-workspace/` | Deletable | **B-SUPPORT** — Manager interaction | **KEEP** as secondary interaction surface |
| MemoryView | `views/MemoryView.tsx` | Non-TRST | **HIGH_AUDIT_PRIORITY** — Memory governance UI | **HOLD** until MWT-6; separate health audit required before any restoration |
| TaskPanel | `workbench/TaskPanel.tsx` | Deletable | **HIGH_AUDIT_PRIORITY** — Task view | **AUDIT from git history**: check compilability, data model fit, UI quality before MWT-3 decision |
| TracePanel | `workbench/TracePanel.tsx` | Deletable | **B-SUPPORT** — May overlap Events | **MERGE** with EventChainViewer or keep as detail view |
| BetaPanel | `dashboard/BetaPanel.tsx` | Low value | Low value | **KEEP ARCHIVED** — may resurrect for reviewer analytics |
| CommandPalette | `layout/CommandPalette.tsx` | Deletable | **C-OPTIONAL** | **KEEP** if lightweight, delete if heavy |
| SessionSwitcher | `layout/SessionSwitcher.tsx` | Deletable | **B-SUPPORT** | **HOLD** until MWT-3 session model matures; then AUDIT_BEFORE_RESTORE |
| PreviewPane | `chat/PreviewPane.tsx` | Deletable | **C-OPTIONAL** | **KEEP** if low maintenance burden |

### 11.3 Previously Deleted Modules (Code Archaeology Required)

| Module | Original Purpose | Guess at Current State | Recovery Priority |
|--------|-----------------|----------------------|-------------------|
| TasksView | Task list/management view | Unknown — code may be in git history | HIGH (MWT-1/2) |
| TaskProgress | Worker execution progress bar | Unknown | HIGH (MWT-2) |
| DecisionTimeline | Manager decision timeline | Unknown | HIGH (MWT-3) |
| GrowthChart | Growth/usage chart | Low value | LOW |
| ObservabilityPanel | Observability dashboard | May overlap with Events | LOW (merge) |

**Action required**: Git archaeology in MWT-0 to determine what deleted code is recoverable vs. needs rewrite.

### 11.4 Classification Legend

| Class | Meaning | Action |
|-------|---------|--------|
| **A-CORE** | Core to Manager/Worker product (confirmed by archaeology) | Active development, in navigation |
| **A-CANDIDATE_CORE** | Hypothesized as core, pending archaeology | Must pass AUDIT_BEFORE_RESTORE before promotion to A-CORE |
| **B-SUPPORT** | Supports core product | Maintain, may be in secondary nav |
| **C-OPTIONAL** | Nice-to-have | Keep if no maintenance burden |
| **D-DELETE** | No product value | Remove |
| **HIGH_AUDIT_PRIORITY** | Likely high value, unknown state | Archaeology required before classification |

---

## 12. Architecture Decisions

### AD-1: Five-Layer Model

**Decision**: TrustOS architecture is defined as 5 layers: Interaction → Manager → Worker/Tool → Trust → Storage. Trust (Layer 4) is a cross-cutting capability, not the organizing principle.

**Semantic ownership**:
- L2 (Manager) owns product semantics: session, task, run, decision objects.
- L4 (Trust/Gateway) owns trust semantics: event, hash, trace, evidence objects.
- L5 (Storage) must not drive product architecture: schema follows semantics defined by L2 and L4.

**Rationale**: Prevents future inversion where Gateway becomes the product center. All roadmap planning must reference which layer is being developed.

**Enforcement**: Any new feature proposal must identify its target layer. Features targeting Layer 4 in isolation require explicit justification.

### AD-2: Manager Shell as Primary UI

**Decision**: ChatInterface is the original primary interaction surface of TrustOS, predating the TRST Gateway work. It evolves into Manager Shell — the primary user interaction surface that shows Chat + Task + Worker + Evidence in a unified view.

**Rationale**: Prevents Chat from being classified as "demo" or "deprecatable." Chat is the root of the user experience. The "demo interaction surface" label was a pre-F1 historical classification only.

**Transition**: ChatInterface stays in MWT-1 but gains session/task/evidence linkage. Full Manager Shell unification in MWT-3.

### AD-3: Gateway is Trust Infrastructure

**Decision**: Gateway is Layer 4 infrastructure that observes Manager (L2) and Worker (L3). Gateway does not drive product direction.

**Rationale**: Prevents premature productionization of Gateway as a standalone product before Manager/Worker product loop is complete.

**Enforcement**: No Gateway-only features (provider registry, auth/RBAC, enforcement) until L2+L3 product loop is validated.

### AD-4: Evidence Must Be Task-Scoped

**Decision**: Evidence reports must evolve from per-event to per-task scope, incorporating Manager decisions and Worker execution steps.

**Rationale**: Per-event evidence is technically correct but product-semantically incomplete. A reviewer needs to understand the full task execution, not individual model calls.

### AD-5: Object Model Before Database

**Decision**: The session/task/run/trace/event object model (Section 9) must be explicitly defined and mapped before any new storage schema changes. TRST-4C SQLite index must remain as an event/session query index only — no schema expansion until MWT-3 object model is confirmed.

**Rationale**: TRST-4C SQLite index was built around events. Without the task/run model, the event store is a flat log rather than a task execution record. Extending the schema prematurely risks baking in the wrong abstractions that MWT-3 must later undo.

### AD-6: Module Re-audit Required Before Any Restoration

**Decision**: All disconnected and deleted modules must go through code archaeology and architecture audit before any restoration decision. No module may be restored to navigation directly from git history. §11 classification uses A-CANDIDATE_CORE and HIGH_AUDIT_PRIORITY as hypotheses only — not final directives.

**Restoration gate**: Each candidate module must pass four checks before restoration:
1. Compilability: does the code still build?
2. API compatibility: does its data contract match current backend APIs?
3. Data model alignment: does it fit the MWT object model defined in §9?
4. UI quality: is the component quality acceptable, or does it need rewrite?

**ManagerWorkspace-specific**: ManagerWorkspace restoration in MWT-3 is conditional on: (a) code archaeology confirms restorable or defines rewrite scope, (b) MWT-3 task/run object model is defined and accepted, (c) MWT-3 backend data layer is in place.

**Rationale**: TRST-4X deleted modules using a Gateway-only product lens. Some deleted modules are potentially core under Manager/Worker architecture — but their actual state (compilability, API compatibility, data model alignment, UI quality) is unknown. Archaeology must precede any restoration decision.

### AD-7: TRST-4D Pause

**Decision**: TRST-4D Backend Assessment API is paused until Manager/Worker assessment semantics are defined.

**Rationale**: An isolated `/events/:id/assess` endpoint would evaluate model calls without understanding task context. The correct API is `/tasks/:id/assess` that evaluates Manager decisions + Worker execution + model calls as a whole.

---

## Appendix A: Document References

| Document | Relationship |
|----------|-------------|
| `TRST-0-trustos-architecture-thesis.md` | Predecessor — this document supersedes as primary architecture reference |
| `chat-interface-product-positioning.md` | Detailed ChatInterface positioning (still valid) |
| `trst-4-rebaseline-and-next-milestone.md` | TRST-4 rebaseline context (informational) |
| `TRST-execution-log.md` | Project state anchor (to be updated post-MWT-0) |
| `PHASE-3-MANAGER-WORKER-SPEC.md` | Earlier Manager/Worker spec (informational, partially stale) |
| `trustos-roadmap-rebaseline-2026-08.md` | Companion document — MWT roadmap |

---

## Appendix B: Review Checklist

- [ ] Five-layer model accurately captures TrustOS architecture
- [ ] Manager/Worker/Gateway relationship is correctly ordered
- [ ] Chat as Manager Shell entrypoint is clearly defined
- [ ] Session/Task/Trace object model is complete and mappable
- [ ] Module re-audit reflects current codebase state
- [ ] Architecture decisions are actionable and enforceable
- [ ] Capability heat map is accurate
- [ ] No Gateway-first bias in any section
