# TRST-0 TrustOS Architecture Thesis

Version: v0.1
Stage: TRST-0 — Strategic Architecture Thesis
Date: 2026-07-10
Status: PM Review

---

## 1. Executive Thesis

**TrustOS is not an agent management platform. TrustOS is an AI-native operating system that manages model compute, context, memory, communication, and trust boundaries.**

Short form:

```text
TrustOS is the operating layer for trusted AI work.
```

The key distinction is not "agent orchestration" — it is **resource governance at the OS level**:

- Abstract underlying AI resources (models, context, memory, tools)
- Schedule and allocate those resources per task
- Isolate permissions, data, and context boundaries
- Audit every significant action
- Provide a stable runtime for AI work that users can trust

### Why not an agent platform

| Agent Platform Approach | TrustOS OS Approach |
|---|---|
| Builds better single-agent loops | Manages resource allocation across agents/models |
| Competes on model intelligence | Competes on safe, efficient resource governance |
| Focus: "make the agent smarter" | Focus: "make smart agents manageable" |
| Same layer as Claude Code, OpenClaw, Dify | Layer below — the OS that those agents run on |

TrustOS does not compete with Claude Code on coding quality. TrustOS competes by providing the trustworthy runtime that lets Claude Code, Cursor, local models, and human workers operate within defined boundaries.

---

## 2. Historical OS Analogy

To understand what an AI-native OS must do, we examine three generations of operating systems: PC OS, Cloud OS, and Mini-app/Browser Platform OS. Each reveals a pattern: **an OS manages a specific class of resources, provides isolation, and offers a stable interface to applications.**

### 2.1 PC OS

| PC OS Resource | Management Responsibility | TrustOS Mapping |
|---|---|---|
| CPU / GPU | Compute scheduling, time-slicing, priority | **Model Compute** — model selection, routing, fallback |
| RAM | Working memory, paging, protection | **Context** — prompt assembly, compression, privacy filtering |
| Disk / File System | Persistent storage, files, permissions | **Memory / Artifact Store** — namespaced, permissioned storage |
| Process | Program lifecycle, isolation, signals | **Agent Runtime** — spawn, pause, resume, cancel, sandbox |
| IPC / Network | Inter-process communication, sockets | **Agent / Tool Communication** — messaging, tool call routing |
| User / Permission | Identity, access control, groups | **Identity / Policy / Capability** — who can do what |

**PC OS performance core:** CPU utilization, memory management, I/O throughput, process scheduling.

**TrustOS performance core:** Model call efficiency, context utilization, memory retrieval quality, tool call latency, trust check cost.

### 2.2 Cloud OS

| Cloud OS Capability | Management Responsibility | TrustOS Mapping |
|---|---|---|
| Compute | VM, container, serverless | Model / agent runtime |
| Storage | Object store, database, CDN | Memory, artifact, vector index |
| Network | VPC, routing, service mesh | Agent mesh, model-tool communication |
| IAM | Identity, role, permission | Human-agent-tool-memory policy |
| Scheduler | Placement, autoscaling | Model routing, worker scheduling |
| Observability | Metrics, tracing, logs | Reasoning/action/evidence trace |
| Billing | Cost accounting, quotas | Token, latency, tool cost accounting |

**Cloud OS essence:** Let enterprises use compute resources safely, elastically, and observably.

**TrustOS essence:** Let individuals and organizations use AI cognitive resources safely, controllably, and observably.

### 2.3 Mini-app / Browser Platform OS

| Platform OS Capability | Management Responsibility | TrustOS Mapping |
|---|---|---|
| App sandbox | Application isolation | Agent sandbox / Worker isolation |
| API permission | Camera, location, payment authorization | Tool, memory, external action permission |
| Runtime | JS, WebView, mini runtime | Agent runtime, prompt runtime |
| Store / Distribution | App discovery and distribution | Skill, agent, workflow marketplace |
| Review policy | App review and approval | Tool/agent capability certification |
| User consent | Sensitive permission dialogs | Human approval gates |
| Platform account | Identity system | Human/agent identity |

**Key insight:** A platform OS does not need to be a kernel. It can start as a runtime platform — but it must have unified runtime, permission system, capability interface, and audit mechanism. Without these, it is a SaaS app, not an OS.

### 2.4 What Changes in the AI Era

| Traditional Program | AI / LLM Agent |
|---|---|
| Deterministic code | Probabilistic reasoning |
| Explicit input/output | Context-driven behavior |
| Finite, explicit state | Implicit state in conversation |
| Static permissions | Dynamic, language-level permission risks |
| CPU/memory/IO bottlenecks | Context quality, retrieval relevance, trust bottlenecks |
| Debuggable with breakpoints | Observable only through evidence traces |
| Repeatable execution | Non-deterministic output |

These differences mean TrustOS must manage resources that traditional OSes never concerned themselves with: context windows, prompt provenance, memory trust scores, model privacy routing, and language-level security.

---

## 3. TrustOS Six-Resource Model

Building on the OS Primitives defined in T100 (`docs/architecture/TrustOS-OS-Primitives.md`), TrustOS manages six categories of AI-era resources:

### 3.1 Model Compute

The CPU of AI OS.

**Managed objects:** models, providers, capabilities, cost tiers, latency tiers, context lengths, privacy levels, reliability profiles.

**Core capabilities:**
- Model registry — what models are available
- Model routing — which model for which task
- Fallback — what happens when a model fails
- Multi-model role assignment — fast model for classification, strong model for reasoning
- Cost-aware scheduling — don't use GPT-4 for "hello world"
- Privacy-aware routing — don't send PII to cloud models
- Verification routing — reviewer model for critical outputs

**Key questions:**
- Which model should process this task?
- Which context can go to a cloud model?
- When should a local model be used?
- When should a reviewer model verify output?

### 3.2 Context

The RAM of AI OS. **This is the most critical performance resource.**

**Managed objects:** current prompt, session history, retrieved memory, tool results, user instructions, system policies, working notes.

**Core capabilities:**
- Context assembly — what goes into the model's input window
- Context compression — reducing long histories to essential summaries
- Context priority — ordering by relevance, freshness, trust
- Context isolation — preventing cross-task context leakage
- Context provenance — tagging every piece with source, trust score, age
- Context budget — token limits per task, model, privacy level
- Context invalidation — marking stale or incorrect context
- Context refresh — updating retrieved memory

**Key questions:**
- What content enters the model context?
- What must NOT enter?
- How much? In what order?
- Is it trusted? Is it fresh? Is it within permission scope?

**Context is the bottleneck.** Every quality, cost, and security problem in LLM systems converges on context management. This is why Context Efficiency is the primary performance thesis (see Section 6).

### 3.3 Memory

The disk/storage of AI OS.

**Managed objects:** private memory, project memory, team memory, organization memory, public knowledge, temporary memory, artifact archive.

**Core capabilities:**
- Namespace — hierarchical memory organization
- Ownership — who owns which memory
- ACL / RBAC — who can read/write
- Provenance — where did this memory come from
- Retention — how long is it kept
- Versioning — what changed
- Retrieval policy — when and how to fetch
- Forgetting / revocation — removing incorrect or sensitive memory
- Trust score — how reliable is this memory
- Memory promotion — from temporary to permanent

**Key questions:**
- What should be remembered?
- Where should it be stored?
- Who can access it?
- When does it expire?
- Is it trusted enough to enter future context?

### 3.4 Agent Runtime

The process/container of AI OS.

**Managed objects:** agent, worker, task, tool session, execution state, runtime context, capability set.

**Core capabilities:**
- Spawn — create new agent/worker instance
- Pause — suspend execution
- Resume — continue from saved state
- Cancel — terminate with cleanup
- Retry — restart with or without state
- Handoff — transfer between workers
- Sandbox — isolate execution environment
- Resource quota — limit token, time, tool calls
- Lifecycle management — full create-to-archive

**Key questions:**
- What is the agent's lifecycle?
- What resources can it access?
- How does it recover from failure?
- How do multiple agents divide work?

### 3.5 Communication

The network/IPC of AI OS.

**Managed objects:** agent messages, tool calls, model calls, event streams, worker queues, external API calls.

**Core capabilities:**
- Message routing — who sends what to whom
- Tool broker — all tool calls through a central mediation layer
- Event bus — publish/subscribe for execution events
- Agent-to-agent protocol — structured inter-agent communication
- Retry — handle transient failures
- Timeout — prevent hanging calls
- Tracing — end-to-end call chain visibility
- Rate limit — prevent abuse
- Policy gate — check permissions before routing

**Key questions:**
- Who can call whom?
- Is the call authorized?
- How does it recover from failure?
- Are results captured as evidence?

### 3.6 Trust / Security

The security kernel of AI OS.

**Managed objects:** identity, policy, capability, approval, risk, audit, evidence, verification, secrets.

**Core capabilities:**
- Identity — human and agent identity
- Capability token — what an agent is allowed to do
- Policy engine — rule evaluation (allow/deny/ask/redact/sandbox)
- Approval gates — human-in-the-loop at critical points
- Audit trail — tamper-resistant execution record
- Secrets vault — API keys, credentials isolation
- Risk scoring — per-action risk assessment
- Verification evidence — proof that work was done correctly
- Tamper-resistant logs — append-only, cryptographically verifiable

**Key questions:**
- What can AI do? What can't it do?
- When must it ask a human?
- What proves it didn't exceed its bounds?
- How is the outcome verified?

---

## 4. AI Kernel Architecture

The AI Kernel is the core control plane of TrustOS. It is not a monolithic kernel in the Linux sense, but a set of seven coordinated subsystems that together provide OS-level resource governance.

```text
TrustOS AI Kernel
├── Model Scheduler      — Which model? At what cost? With what privacy?
├── Context Manager      — What goes into the model's working memory?
├── Memory Manager       — What should be remembered, for whom, for how long?
├── Tool Broker          — All tool calls through a secure mediation layer
├── Agent Runtime        — Lifecycle management for agents/workers
├── Policy Engine        — Is this action allowed, denied, or needs approval?
└── Evidence Log         — What happened? Can we prove it?
```

### 4.1 Model Scheduler

```text
model.invoke(task, context, policy) → response
```

- Provider abstraction (OpenAI, Anthropic, SiliconFlow, local)
- Role-based routing (classifier, reasoner, reviewer, synthesizer)
- Fallback chain (primary → secondary → degraded)
- Privacy-aware routing (PII → local model only)
- Cost cap enforcement per session
- Latency budget per call

### 4.2 Context Manager

```text
context.assemble(task, budget, policy) → assembledContext
context.compress(history) → compressedSummary
context.inject(memoryRefs) → enrichedContext
context.redact(privateFields) → safeContext
```

- Context budget (max tokens per task/model)
- Relevance ranking (what matters most now)
- Policy filtering (remove unauthorized data)
- Compression (summarize long histories)
- Source tagging (provenance for every context block)
- Freshness check (is this memory stale?)
- Trust scoring (how reliable is this source?)

**This is the performance core of TrustOS.** More detail in Section 6.

### 4.3 Memory Manager

```text
memory.read(namespace, query, policy) → results
memory.write(namespace, content, metadata) → memoryId
memory.promote(artifactId, scope) → memoryRef
memory.revoke(memoryId) → void
```

- Hierarchical namespace (`/user/...`, `/project/...`, `/team/...`)
- ACL per namespace
- Provenance tracking
- Version history
- Retention policy
- Retrieval policy
- Trust score assignment

### 4.4 Tool Broker

```text
tool.call(name, args, capabilityToken) → result
```

All Worker tool calls pass through the Tool Broker — never directly to the tool:

1. Worker requests tool call
2. Broker checks capability token
3. Policy Engine evaluates: allow / deny / ask / redact / sandbox
4. If "ask": generate approval request for Manager
5. If allowed: execute with injected secrets, capture result
6. Write evidence event

**This is the AI-era equivalent of syscall mediation.**

### 4.5 Agent Runtime

```text
agent.spawn(role, task, capabilities) → agentId
agent.pause(id) → void
agent.resume(id) → void
agent.cancel(id) → void
agent.message(id, payload) → void
```

- Full lifecycle (create → run → pause → resume → complete/fail/cancel)
- State persistence
- Resource quota enforcement
- Retry strategy
- Worker assignment
- Handoff between workers
- Isolation per agent

### 4.6 Policy Engine

```text
policy.check(actor, action, resource, context) → decision
```

- Identity-based rules
- Capability-based rules
- Risk-based rules
- Budget-based rules
- Data classification rules
- Tool-specific rules
- Model privacy rules
- Approval escalation rules

**Hard deny rules must not be overridden by LLM judgment.** This is a design invariant.

### 4.7 Evidence Log

```text
evidence.record(event) → eventId
```

Append-only, tamper-resistant event log capturing:
- Model call metadata (model, tokens, cost, latency)
- Context references (what was injected, from where, with what trust score)
- Tool call trace (request, decision, result)
- Artifact versions (diffs, creation, updates)
- Verification results (smoke tests, acceptance)
- Approval records (who approved what, when)
- Session lifecycle events

**Evidence transforms AI work from "chat output" to "auditable execution record."**

---

## 5. TrustOS Architecture Sketch

```text
TrustOS
├── AI Kernel
│   ├── Model Scheduler
│   ├── Context Manager
│   ├── Memory Manager
│   ├── Tool Broker
│   ├── Agent Runtime
│   ├── Policy Engine
│   └── Evidence Log
│
├── Resource Layer
│   ├── Model Registry
│   ├── Context Store
│   ├── Private Memory
│   ├── Project Memory
│   ├── Team Memory
│   ├── Public Knowledge
│   └── Artifact Archive
│
├── Communication Layer
│   ├── Agent Messaging
│   ├── Tool Call Routing
│   ├── Event Bus
│   ├── SSE / Streaming
│   └── External Connectors
│
├── Trust Layer
│   ├── Identity
│   ├── Capability Tokens
│   ├── Policy Rules
│   ├── Approval Gates
│   ├── Risk Scoring
│   ├── Secrets Vault
│   └── Audit Trail
│
├── Runtime Services
│   ├── Task / Delegation Service
│   ├── Session Service
│   ├── Verification Service
│   ├── Cost Service
│   ├── Notification Service
│   └── Artifact Service
│
└── User Surfaces
    ├── Chat Shell
    ├── Manager Workspace
    ├── Trust Card / Context Inspector
    ├── Memory Browser
    ├── Artifact / Evidence Viewer
    └── Policy Console
```

**Key architectural principle:** User Surfaces are the shell. The real OS is:
`AI Kernel + Resource Layer + Trust Layer + Communication Layer`

---

## 6. Performance Thesis: Context Efficiency

### 6.1 The Core Claim

```text
TrustOS optimizes for Context Efficiency before raw speed.
```

Traditional systems optimize for QPS, latency, CPU utilization, memory bandwidth, I/O throughput.

In AI work systems, the biggest waste is not slow computation — it is:

- Irrelevant context injected into model prompts
- Stale or incorrect memory retrieved
- Overpowered models used for trivial tasks
- Low-risk tasks going through heavy approval
- High-risk tasks not blocked
- Agent retry loops burning tokens
- Tool call failures with repeated consumption
- Unverifiable results requiring human rework
- Historical work not reusable

**TrustOS performance = Effective Intelligence Throughput.**

### 6.2 Definition

```text
Effective Intelligence Throughput =
  The system's ability to complete trusted work
  within given cost, time, risk, and context budgets.
```

Or more concretely:

```text
With the fewest tokens, lowest privacy exposure,
highest relevance and trustworthiness,
assemble enough context for the model to succeed.
```

### 6.3 Why Context Is the Bottleneck

Nearly every quality, cost, and security problem in LLM systems converges on context:

| Problem | Context Relationship |
|---|---|
| High cost | Too many tokens, redundant context |
| Slow response | Overly long prompts, model overload |
| Poor quality | Missing context or too much noise |
| Hallucination | Lack of trusted evidence/references |
| Data leakage | Private context sent to wrong model |
| Agent misbehavior | Scope/policy not in context or not enforced |
| Unreusable work | Historical output not structured as retrievable context |
| Poor multi-agent collaboration | Inconsistent context across agents |

### 6.4 Context Efficiency Metrics

| Metric | Definition |
|---|---|
| **Context Relevance Ratio** | Proportion of injected context actually needed for the task |
| **Context Waste Ratio** | Irrelevant or redundant token proportion |
| **Context Freshness** | Whether context is up-to-date or stale |
| **Context Trust Score** | Source reliability and verification status |
| **Private Exposure Rate** | Proportion of private data sent to external models |
| **Retrieval Hit Quality** | Whether retrieved content actually helped complete the task |
| **Token-to-Outcome Efficiency** | Effective result per unit token consumed |
| **Verification Pass per Cost** | Probability of passing verification at a given cost |
| **Human Review Load** | Time spent on human review per task |
| **Rework Rate** | Proportion of tasks requiring re-execution due to context errors |

### 6.5 Context Efficiency Implementation Path

| Layer | Capability | Description |
|---|---|---|
| **L1: Context Trace** | Record | Log every context source, token count, privacy flag, trust score per model call |
| **L2: Context Budget** | Limit | Per-task caps on tokens, private exposure, stale memory age |
| **L3: Context Selection** | Choose | Task-aware assembly: instruction, session, memory, artifacts, policy |
| **L4: Context Compression** | Reduce | Dynamic summarization of long sessions, decisions, artifacts |
| **L5: Context Evaluation** | Assess | Did the model use the context? Was the result verified? Rework rate? |
| **L6: Context Learning** | Improve | Which memories are useful? Which are noise? Template per task type |

**L1 (Context Trace) is the critical first step.** Without trace data, all optimization is speculation.

### 6.6 OS Analogy for Context Optimization

| Traditional OS Optimization | TrustOS Context Manager Equivalent |
|---|---|
| CPU cache | Hot context / frequently used memory |
| Memory paging | Context compression / retrieval |
| Memory protection | Privacy filter / policy gate |
| Process scheduling | Context budget allocation |
| I/O optimization | Retrieval query optimization |
| Process isolation | Session/task context isolation |
| Profiling / perf | Context trace |

If TrustOS builds this, its performance advantage is not "faster responses" — it is:

```text
Fewer tokens, lower cost, lower leak risk, higher task success rate, less human rework.
```

---

## 7. Competitive Positioning

### 7.1 The Landscape

| Category | Examples | Strength | TrustOS Position |
|---|---|---|---|
| Coding Agents | Claude Code, Cursor, Windsurf | Developer UX, code editing loop, model quality | Not competing on "who writes better code" — TrustOS manages the runtime those agents operate within |
| Agent Platforms | OpenClaw, LangGraph, CrewAI, Dify | Agent orchestration, workflow builder, tool chaining | Not competing on "who builds more complex workflows" — TrustOS provides OS primitives beneath workflow |
| Cloud AI Platforms | AWS Bedrock, Azure AI, GCP Vertex | Infrastructure scale, IAM, enterprise integration | TrustOS is lighter, product-led, model-neutral, focused on work experience not cloud infra |
| Model Providers | OpenAI, Anthropic, Google | Model intelligence, API access | Not competing — TrustOS routes and manages model usage, doesn't replace models |

### 7.2 TrustOS's Competitive Moat

TrustOS's defensibility comes from four system-level capabilities, not from single-agent intelligence:

| Moat | Description |
|---|---|
| **Context Graph** | Graph of task-memory-artifact-event-tool-decision relationships, not flat chat history. Answers: why does the AI know this? Where did this come from? What influenced the result? |
| **Policy-Aware Memory** | Memory = content + namespace + owner + permission + provenance + trust score + lifecycle. Not a generic vector DB. |
| **Tool Syscall Layer** | Workers cannot call tools directly. All calls go through Tool Broker → Policy Engine → Approval Gate → Evidence Log. This is the OS security model. |
| **Evidence-Backed Execution** | Every AI work unit has a verifiable chain: context used, model invoked, tools called, artifacts produced, verification passed, approval granted, cost incurred, acceptance status. |

### 7.3 The Strategic Position

```text
TrustOS is not a better agent — it's the operating layer
that makes all agents trustworthy enough for real work.
```

Claude Code, Cursor, and OpenClaw can all be Workers within TrustOS. The competitive advantage is not being smarter than them — it's being the layer that governs how they are used, with what data, under what permissions, producing what evidence.

---

## 8. Current Codebase → Primitive Mapping

Based on the S101 series (S101T, S101R, S101I, S101P), the current codebase has initial implementations for several TrustOS primitives:

### 8.1 What We Have

| S101 Capability | Files | TrustOS Primitive | Maturity |
|---|---|---|---|
| Worker execution loop | `src/services/phase3/slow-worker-loop.ts`, `execute-worker-loop.ts` | Agent Runtime (spawn, run, cancel) | **Operational** — linear execution, cancel/timeout, delegation contract |
| SSE event streaming | `src/services/phase3/sse-poller.ts`, `src/api/chat.ts` | Event Bus / Streaming | **Operational** — 14 event types, status/progress/result/done |
| Session lifecycle | `src/db/agent-session.ts` | Session (created→completed/failed/cancelled) | **Operational** — 9 status states, worker-to-session binding |
| Archive / artifacts | `src/api/archive.ts`, `src/db/task-archive-repo.ts` | Artifact Store | **Operational** — persistent storage, metadata |
| Usage / cost tracking | `src/types/dashboard.ts` (UsageInfo) | Cost Service (partial) | **Operational** — token counts, model info, estimated cost |
| Execution visibility | `frontend/src/components/chat/ExecutionMetadata.tsx` | Execution Summary / Trust Card (partial) | **Operational** — terminalSummary, usage, executionProgress in UI |
| Session events | `src/types/delegation.ts` (40 event types) | Evidence Log (partial) | **Operational** — event stream, but no structured evidence object model |
| Smoke verification | `scripts/smoke/s101i-*.mjs` | Verification Service (partial) | **Operational** — SSE contract + Worker execution smoke |

### 8.2 What We Have in Primitive Terms

| Primitive (from T100) | S101 Status | Notes |
|---|---|---|
| User | ✅ Identity exists | Basic auth, no preference/policy model |
| Manager | ✅ Manager routing exists | `routeManagerMessage`, but Manager Loop vs Worker Loop not fully separated in data model |
| Worker | ✅ Worker loop operational | Linear execution, cancel/timeout, SSE progress. Missing: parallel workers, health checks |
| Session | ✅ Durable sessions | 9 states, events, archive. Missing: pause/resume, checkpoint/rollback |
| Context | ❌ Not managed | Context is assembled ad-hoc, not traced, budgeted, or scored |
| Memory | ❌ Not managed | No namespace, no ACL, no provenance, no trust score |
| Action | ❌ Not mediated | Tool calls are direct, not through a Tool Broker |
| Decision | ❌ Not mediated | No Policy Engine evaluations |
| Policy | ❌ Not enforced | No policy rules engine |
| Delegation Contract | ⚠️ Partial | Worker delegation exists but contract is implicit |
| Artifact | ✅ Operational | Archive with metadata |
| Audit Event | ⚠️ Partial | SessionEvent stream exists but not structured as evidence objects |
| Budget | ⚠️ Partial | Cost cap (S101R-C6), no token/time/risk budgets |
| Trust Report | ⚠️ Partial | `terminalSummary` in UI, not structured Trust Report |
| Checkpoint | ❌ Not implemented | No state snapshot or rollback |

### 8.3 Summary

```text
Current state: S101 delivered a working Agent Runtime + Event Stream + Artifact Store.
TrustOS has operational proof of Worker execution, SSE visibility, and Archive.
But it lacks the OS-level primitives: Context Manager, Memory Manager, Tool Broker,
Policy Engine, and Evidence Object Model.
```

---

## 9. Strategic Gaps

The following gaps are ordered by strategic importance — not by implementation effort:

### Priority 1: Context Manager

**Gap:** Context is assembled ad-hoc. No trace, no budget, no relevance scoring, no privacy filtering, no source tagging.

**Why this is #1:**
- Directly impacts cost (token waste)
- Directly impacts quality (irrelevant context degrades output)
- Directly impacts privacy (unfiltered data goes to models)
- Feeds into Memory, Policy, and Evidence
- Competitors have not made this an OS primitive

**First step:** Context Trace — record what context was used per model call, with source, token count, and privacy level.

### Priority 2: Memory Namespace & Permission

**Gap:** No structured memory system. No namespace, no ACL, no provenance, no trust scoring, no retrieval policy.

**Why this is #2:**
- Memory without governance is dangerous
- Enterprise/professional users need memory permission boundaries
- Memory quality directly affects context quality

### Priority 3: Tool Broker

**Gap:** Worker tool calls are direct, not mediated. No centralized permission check, no approval gate, no dry-run.

**Why this is #3:**
- This is the AI-era syscall layer
- Without it, tool security is per-agent, not system-wide
- Combined with Policy Engine, enables enterprise trust

### Priority 4: Policy Engine

**Gap:** No rules-based policy evaluation. Trust decisions rely on Manager LLM judgment.

**Why this is #4:**
- Hard policies must be deterministic, not LLM-dependent
- Needed for enterprise compliance
- Complements Tool Broker for complete security

### Priority 5: Evidence Object Model

**Gap:** SessionEvent stream is operational but unstructured. No evidence linking (context→model→tool→artifact→verification).

**Why this is #5:**
- Current events are chronological, not relational
- Audit requires linked evidence, not scattered events
- Trust Card / Context Inspector UI depends on structured evidence

### Priority 6: Model Scheduler

**Gap:** Model selection is hardcoded per worker, not task-aware. No fallback, no privacy routing, no cost-aware scheduling.

**Why this is #6:**
- Model routing is the CPU scheduler of AI OS
- Without it, single-model-failure blocks all work
- Enables cost optimization (small model for classification, large model for reasoning)

### Priority 7: Agent Communication Layer

**Gap:** Multi-agent communication is ad-hoc. No structured agent-to-agent protocol, no message routing.

**Why this is #7:**
- Required for complex multi-agent workflows
- Lower priority than single-agent governance (1-6)

---

## 10. TRST-1 Recommendation: Context Trace & Context Manager

### 10.1 Why TRST-1 Should Be Context Manager

| Criterion | Context Manager |
|---|---|
| **Performance impact** | Directly reduces token waste, cost, and latency |
| **Quality impact** | Better context → better model output |
| **Privacy impact** | Controls what data enters which model |
| **Strategic differentiation** | Competitors treat context as a string, not a managed resource |
| **Feeds other primitives** | Context Manager data feeds Memory quality, Policy decisions, Evidence trace |
| **Measurable** | Context Efficiency metrics are quantifiable |
| **Builds on S101** | SSE events provide the stream; Context Manager adds structure and policy |

### 10.2 TRST-1 MVP Scope (L1: Context Trace)

**Phase 1 — Context Trace (observability first):**

Record per model call:
- Model, provider, task/session
- Context blocks (source type, token count, privacy level, trust level)
- Inclusion/exclusion reason
- Retrieval query (for memory-sourced context)
- Final prompt hash
- Cost, latency, outcome

**Phase 2 — Context Blocks:**

Structure context into typed blocks:
```text
system_instruction, user_intent, session_summary, recent_messages,
memory_ref, artifact_ref, tool_result, policy_rule, approval_state, worker_state
```

Each block has metadata: source, owner, namespace, tokens, trustScore, privacyLevel, freshness, priority.

**Phase 3 — Context Budgeting:**

Per-task budget: maxTokens, maxCost, maxPrivateExposure, requiredEvidence, preferredModel, riskLevel.

**Phase 4 — Context Selection:**

Task-aware assembly: must_include, should_include, exclude, compress, redact, retrieve.

**Phase 5 — Context Inspector (UI):**

User-facing panel: "What context did the AI use? Why? What was excluded? What's the privacy risk? What did it cost?"

### 10.3 What TRST-1 Explicitly Does NOT Do

- No full Context Manager with compression/selection (that's TRST-2+)
- No Memory namespace redesign (separate milestone)
- No Policy Engine (separate milestone)
- No Tool Broker (separate milestone)
- No model scheduler (separate milestone)

**TRST-1 = make context observable first. Optimization follows from visibility.**

---

## 11. Product Surface Strategy

TrustOS product surfaces should mirror OS resource management, not chat features:

| Stage | Product Surface | OS Primitive Exposed |
|---|---|---|
| **Current (S101P)** | Chat Shell, Manager Workspace, Session Detail | Agent Runtime visibility, Artifact Store, basic Execution Summary |
| **TRST-1** | Context Inspector | Context Manager — "What does the AI know right now and why?" |
| **TRST-2** | Memory Browser | Memory Manager — "What does TrustOS remember about me, my projects, my preferences?" |
| **TRST-3** | Policy Console | Policy Engine — "What are my AI allowed to do?" |
| **TRST-4** | Trust Card / Evidence Viewer | Evidence Log — "Prove the AI did what I asked, within bounds." |
| **TRST-5** | Model Dashboard | Model Scheduler — "Which model is doing what, at what cost?" |

Each surface incrementally makes TrustOS feel like an OS, not a chatbot.

---

## 12. Non-Goals

TRST-0 is a strategic architecture thesis. It does not include:

- Implementation code or schema changes
- Sprint execution plans
- UI design specifications
- Database migration scripts
- API contract definitions
- Performance benchmarks
- Vendor selection
- Team/resource planning

These belong in subsequent TRST-1+ planning documents.

---

## 13. Relationship to Existing T100 Documents

TRST-0 builds on, but does not replace:

| T100 Document | Relationship |
|---|---|
| `TrustOS-OS-Manifesto.md` | TRST-0 accepts the Manifesto's core thesis and extends it with historical OS analogy, Context Efficiency performance model, and competitive positioning |
| `TrustOS-OS-Primitives.md` | TRST-0 references Primitives and maps current S101 code to them |
| `TrustOS-Performance-Model.md` | TRST-0 extends the path-based performance model with Context Efficiency as the primary optimization target |
| `Loop-Separation-RFC.md` | TRST-0's AI Kernel architecture is consistent with Loop Separation; Context Manager operates across all loops |

**TRST-0 is a thesis document — it argues for a specific performance and architecture direction, grounded in OS principles and competitive analysis.** It does not duplicate existing T100 design detail.

---

## 14. Final Statement

```text
PC OS manages compute, memory, storage, network, and security.
Cloud OS manages services, infrastructure, IAM, and billing.
TrustOS manages model compute, context, memory, agent communication, and trust boundaries.

The primary performance lever is Context Efficiency —
optimizing what enters the model's working memory
for relevance, trust, freshness, privacy, and cost.

The first strategic milestone is Context Trace —
making context observable before making it optimizable.
```

TrustOS is not a better agent. TrustOS is the operating layer that makes all agents trustworthy.

---

## Appendix: Reference Documents

- `docs/strategy/TrustOS-OS-Manifesto.md` — OS existence thesis and core principles
- `docs/architecture/TrustOS-OS-Primitives.md` — 22 OS primitive definitions
- `docs/architecture/TrustOS-Performance-Model.md` — Fast/Slow/Critical/Background path model
- `docs/architecture/Loop-Separation-RFC.md` — Manager/Worker/Action loop separation design
- `docs/architecture/Trust-Kernel-RFC.md` — Trust Kernel enforcement design
- `docs/architecture/AI-Syscall-Action-Protocol-PM-draft.md` — Action/Decision schema
- `docs/architecture/Session-Runtime-RFC.md` — Durable session design
- `docs/architecture/Manager-Worker-Trust-Model.md` — Trust model and L0-L6 decision pipeline
- `docs/T100-DOCS-INDEX.md` — T100 document index and cross-reference
