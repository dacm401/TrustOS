# Loop Separation RFC

> **Version**: v0.1  
> **Stage**: T100  
> **Status**: Draft  
> **Date**: 2026-07-03  
> **Author**: TrustOS Team  
> **Purpose**: Defines why TrustOS must separate Manager Loop, Worker Loop, and Action Loop — and how. This is not an Agent Engine PaaS design. It is a targeted architecture correction that addresses the single-chat-window loop confusion problem.

---

## 1. Problem

### 1.1 The Single Chat Window Trap

Current TrustOS (S99P) routes all interactions through a single chat interface. This creates a monolithic loop where:

| Symptom | Root Cause |
|---|---|
| Manager quick responses blocked by Worker long tasks | Fast and slow execution share one loop |
| User interaction, task execution, tool calls, and approvals mixed in one stream | No separation of control vs. execution |
| Multiple delegated task events interleave in one conversation | No session-scoped event routing |
| Worker interprets, executes, and approves its own behavior | Self-supervision — no independent oversight |
| Long-running task state buried in chat context | No durable session store for Worker state |
| Low-risk actions re-judged by Manager LLM repeatedly | No fast-path Action Loop bypassing Manager |

### 1.2 The Core Insight

> **Fast model vs. slow model is not just about model speed. It's about the responsibility difference between a control loop and an execution loop.**

Putting Manager, Worker, and Tool execution into one monolithic agent loop is the root cause of the symptoms above.

### 1.3 The Reference Architecture Trap

We reviewed an "Agent Engine" architecture diagram showing: Agent Loop instance pools, Environment Sandbox, Agent Memory, Agent Wall, auto-scaling, and external resource gateways. The diagram is instructive — but it is **not** what TrustOS should become.

We absorb **one lesson** from it:

> **Do not put Manager, Worker, and Tool execution into one monolithic agent loop.**

We do **not** use this RFC to justify building a full Agent Engine PaaS.

---

## 2. Principle

### 2.1 Core Principle

> **TrustOS does not put Manager, Worker, and Tool execution into one monolithic agent loop. TrustOS separates the control loop, execution loop, and action loop.**

### 2.2 What This Means

```
NOT:  One big Agent Loop handling everything
      User → [Manager + Worker + Tools in one context] → Response

YES:  Three separate loops with clear interfaces
      User → Manager Loop → Delegation Contract
           → Worker Loop (async) → Action Requests
           → Action Loop (deterministic) → Tool Execution
```

### 2.3 Loop Separation vs. Agent Engine

| Concept | Agent Engine | TrustOS |
|---|---|---|
| Loop instances | Pool of identical agent loops | 3 distinct loop types with different responsibilities |
| Scaling | Auto-scale agent instances | Manager scales with users, Worker scales with tasks |
| Sandbox | Full remote sandbox PaaS | Action Loop as deterministic guard at the edge |
| Memory | Agent Memory as general store | Session-scoped Worker state + user Memory namespace |
| External access | Agent Wall gateway | Action Loop enforces Delegation Contract |

---

## 3. Three Loops

### 3.1 Manager Loop

**Role**: User-facing control loop. Fast, light, stable. Manages intent, delegation, approval, and summarization.

**Responsibilities**:
- Receive user input
- Understand user goal
- Decide whether to create a Session
- Generate Delegation Contract
- Select / delegate Worker
- Manage user-visible progress
- Handle critical approvals
- Explain risks
- Summarize Worker results
- Generate Trust Report

**Characteristics**:
- Fast
- Lightweight
- Stable
- User-facing
- Does NOT perform heavy execution
- Does NOT block for long durations

**Inputs**:
```
user_message
session_state_summary
user_memory
policy_summary
worker_event_summary
```

**Outputs**:
```
manager_response
delegation_contract
approval_request
worker_instruction
trust_report
```

### 3.2 Worker Loop

**Role**: Delegated execution loop. May be slow, long-running, pausable, retryable, replaceable. Performs work under a Delegation Contract.

**Responsibilities**:
- Execute task per Delegation Contract
- Decompose sub-tasks
- Request tool calls
- Process tool results
- Produce intermediate results
- Report progress
- Generate final artifacts

**Characteristics**:
- May be slow
- May be long-running
- May be paused
- May be retried
- May fail
- May be replaced
- Does NOT own final authorization

**Inputs**:
```
delegation_contract
worker_instruction
allowed_context
tool_results
previous_worker_state
```

**Outputs**:
```
action_request
progress_event
artifact_update
worker_result
worker_error
```

### 3.3 Action Loop

**Role**: Deterministic tool/resource access loop. Evaluates Worker Action Requests, enforces policy, produces decisions and audit events. Does NOT use LLM for routine decisions.

**Responsibilities**:
- Receive Worker Action Requests
- Execute policy check
- Execute risk / sensitive / budget check
- Return allow / deny / ask / redact / sandbox / defer
- Call real tools
- Write audit events
- Generate approval requests when needed

**Characteristics**:
- Deterministic
- High performance
- Auditable
- Avoids LLM usage
- Does NOT chat with users

**Inputs**:
```
action_request
delegation_contract
policy_snapshot
resource_metadata
budget_state
```

**Outputs**:
```
decision
tool_result
audit_event
approval_request
```

---

## 4. Event Flow

### 4.1 Target Flow

```
User Request
  → Manager Loop
      → direct response
      OR create Session + Delegation Contract
          → Worker Loop (async)
              → Action Requests
                  → Action Loop
                      → Tool Execution
              → Worker Events
          → Manager summarizes / asks / reports
```

### 4.2 Simplified Diagram

```
User
  ↓
Manager Loop
  ├─ direct answer
  ├─ create Delegation Contract
  ├─ ask approval
  └─ summarize / report
        ↓
Session Runtime
        ↓
Worker Loop
  ├─ progress event
  ├─ action request
  └─ artifact / result
        ↓
Action Loop
  ├─ allow
  ├─ deny
  ├─ ask
  └─ audit
        ↓
Tools / Models / Resources
```

### 4.3 Key Properties

| Property | How |
|---|---|
| Manager is never blocked by Worker | Worker Loop runs async; Manager receives event summaries |
| Worker does not self-approve | All tool access goes through Action Loop |
| Action decisions are fast and deterministic | Policy match in < 20ms; no LLM for routine actions |
| Multi-task isolation | Each Session has its own Worker Loop; events scoped to Session |
| Recovery | Worker state in Session Runtime, not chat context |

---

## 5. What NOT to Build

> **This RFC is not an Agent Engine PaaS design. Do not use this RFC to justify building a full sandbox platform, autoscaling runtime, worker marketplace, or multi-tenant agent hosting in S100P.**

| Do NOT plan for | Why |
|---|---|
| Full remote Sandbox PaaS | Out of scope; S103P for local kernel only |
| Agent Loop instance pool with auto-scaling | Premature; Worker Loop is per-Session |
| Package management execution environment | Premature |
| Worker marketplace | Out of scope; S104P+ for Worker Registry |
| Full Agent Wall product | Action Loop covers this in a simpler form |
| Multi-tenant Agent Engine | Out of scope |
| Complex MCP ecosystem | S104P for basic MCP adapter |

---

## 6. Relationship to Existing Architecture

### 6.1 Mapping to Existing Components (S99P)

| Loop | Existing Component | Current State | Gap |
|---|---|---|---|
| Manager Loop | `llm-native-router.ts` (G0-G4 gates), `intent-classifier.ts`, `task-planner.ts` | ✅ Routing works | No explicit loop boundary; embedded in chat request lifecycle |
| Worker Loop | `slow-worker-loop.ts` (Cycle Runtime), `execute-worker-loop.ts` | ✅ Execution works | Events mixed into chat SSE stream; no Session-scoped routing |
| Action Loop | `local-manager-runtime.ts` (deterministic), `execution-policy.ts` | ⚠️ Partial | Not a unified interception point; Worker can bypass |

### 6.2 How This RFC Changes the Architecture

| Before (S99P) | After (Target) |
|---|---|
| Single chat window carries everything | Manager Workspace with Session-scoped windows |
| Worker events streamed to chat | Worker events routed to Session Detail |
| Manager decisions implicit in routing | Manager Loop with explicit Contract + Decision Feed |
| Action enforcement scattered | Action Loop as unified deterministic guard |
| Multi-task events interleaved | Each Session has isolated Worker Loop + event stream |

---

## 7. UX Implication: Manager Workspace

The architectural Loop Separation requires a corresponding UX separation. See `docs/product/TrustOS-UX-Blueprint.md` for the full Manager Workspace v1 design.

In brief:

```
┌───────────────┬──────────────────────────┬─────────────────┐
│ Session List  │ Manager Conversation     │ Session Detail  │
│               │                          │                 │
│ - Task A      │ User ↔ Manager main chat │ Delegation      │
│ - Task B      │ (Manager Loop only)      │ Worker Events   │
│ - Task C      │                          │ Approval        │
│               │                          │ Trust Report    │
└───────────────┴──────────────────────────┴─────────────────┘
```

| Area | Carries | Loop |
|---|---|---|
| Session List | Independent tasks, status, risk, pending approvals | Session Lifecycle |
| Manager Conversation | User ↔ Manager main interaction | Manager Loop |
| Session Detail | Task execution details | Worker Loop + Action Events |

---

## 8. Non-goals

- This RFC does NOT design a full Agent Engine runtime.
- This RFC does NOT define scaling, instance pools, or multi-tenancy.
- This RFC does NOT replace the Session Runtime RFC — it complements it by defining loop boundaries.
- This RFC does NOT define Worker Registry or Marketplace — those are S104P+.

---

## 9. Version History

| Version | Date | Author | Changes |
|---|---|---|---|
| 1.0 | 2026-07-03 | TrustOS Team (T100) | Initial Loop Separation RFC — three loops, event flow, non-goals |
