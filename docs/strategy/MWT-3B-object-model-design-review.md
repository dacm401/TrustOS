# MWT-3B Object Model Design Review

**Status**: ACCEPTED ✅ — PM DECISION RECORDED  
**Date**: 2026-08-10 (v1.1 — PM decision appended)  
**Phase**: MWT-3B (Object Model Correlation Fields)  
**Parent**: MWT-3 Session / Task / Trace Unification (v2.0 Brief)  
**Dependency**: MWT-3A SEALED ✅ (2026-08-10)  
**PM Decision**: Option C selected — nullable task_id only, run_id/trace_id deferred

---

## 1. Purpose

This document defines the semantic boundaries and design decisions for object model correlation fields (`task_id`, `run_id`, `trace_id`) before any implementation begins. It compares three design options, recommends a path, and establishes no-code decision gates.

**Current State (pre-MWT-3B)**:
- `session_id` — already exists as top-level interaction grouping (X-TrustOS-Session-Id header)
- `event_id` / `event_hash` — Trust-owned, already in event envelope
- `task_id` / `run_id` / `trace_id` — NOT yet defined or implemented

---

## 2. Object Identity Taxonomy

### 2.1 Proposed Definitions

| Field | Owner | Creates | Mutates | Nullable | Definition |
|-------|-------|---------|---------|----------|------------|
| `session_id` | Interaction Layer | Client/Manager | Never | No | Top-level grouping of API interactions (chat session, tool session) |
| `task_id` | Manager | Manager (or external caller) | Never after creation | **Yes** (pre-task events) | Correlation key linking events to a Manager Task |
| `run_id` | Manager | Manager on task execution | Never after creation | Yes (no-run events) | Identifies a specific execution attempt of a Task |
| `trace_id` | Trust Layer | Trust Observation | Never | Yes (non-traced events) | Distributed tracing identity across Gateway hops |
| `event_id` | Trust Layer | Gateway at observation | Never | No | Immutable Trust-owned event identity (hash-derived) |

### 2.2 Ownership Principle

```text
Manager owns Task/Run semantics (what the user asked for, which attempt).
Trust Layer owns Event/Trace semantics (what was observed, how it flowed).
Gateway does NOT create tasks — it observes and attaches.
```

---

## 3. Option Comparison

### Option A: Full Correlation (task_id + run_id + trace_id)

**Scope**: All three correlation fields added to event envelope and event index simultaneously.

| Pros | Cons |
|------|------|
| Complete correlation model from day one | Largest implementation surface |
| No future migration needed | run_id requires formal Manager Run model (not yet designed) |
| | trace_id requires Trust Trace semantics (not yet designed) |
| | Highest risk of premature design |
| | Three fields = three new nullable columns, three new query paths |

**Files affected**: `event-envelope.ts`, `event-index.ts`, `llm-gateway-server.ts`, `openai.ts`, possibly `task_archives`, possibly migration script.

**PM Verdict**: ❌ TOO LARGE. run_id/trace_id are premature.

---

### Option B: task_id + run_id (no trace_id)

**Scope**: task_id and run_id added; trace_id deferred.

| Pros | Cons |
|------|------|
| Links tasks to execution attempts | run_id still requires Manager Run model |
| Simpler than Option A | Still adds two nullable columns |
| | Design question: does every run have a task? What about ad-hoc calls? |

**PM Verdict**: ❌ STILL TOO LARGE. run_id premature without Manager Run design.

---

### Option C: task_id Only (nullable) — PM PREFERRED

**Scope**: Single `task_id: string | null` added to event envelope and event index.

| Pros | Cons |
|------|------|
| Minimal surface — one field | Cannot query by run |
| task_id already in `task_archives` semantic | Cannot do distributed tracing |
| Enables task ↔ events query (core need) | Backfill: pre-existing events will be null |
| Nullable by design — pre-task events naturally null | |
| No run_id / trace_id premature design | |
| Smallest migration surface | |

**PM Verdict**: ✅ PREFERRED. This is the minimal viable correlation path.

---

## 4. PM Selected Path: MWT-3B1 (Option C) ✅

**PM Decision (2026-08-10)**:

```text
MWT-3B path: Option C first ✅

MWT-3B1 = nullable task_id correlation only
run_id = DEFERRED
trace_id = DEFERRED
```

### 4.1 Rationale

1. `task_id` already exists in `task_archives` semantics — minimal conceptual expansion
2. `run_id` needs a formal Manager Run object — cannot pre-create it
3. `trace_id` is Trust Layer semantics — should be defined in Trust Trace design, not here
4. Core product need: task ↔ events queryable (MWT-4 depends on this)
5. Avoids making Gateway a product object creator

---

## 5. Key Design Questions (Answered)

### Q1: What is `session_id`?

**Answer**: Existing top-level interaction grouping. A session may contain multiple tasks and multiple events. `session_id` is created by the client/Manager (or auto-generated), propagated via `X-TrustOS-Session-Id` header. Already implemented and working.

### Q2: Who creates `task_id`?

**Answer**: The **Manager** (or an external caller integrating with Manager). The Manager creates a Task (in `task_archives` or equivalent) and passes its `task_id` to the Gateway as context. Gateway observes and attaches it to events — Gateway does NOT create task_id.

### Q3: Is `run_id` needed now?

**Answer**: **No**. `run_id` identifies a specific execution attempt of a Task. This requires a formal Manager Run model (task → run1, run2, ...). This model does not yet exist. Defer until Manager Run object is designed.

### Q4: Is `trace_id` needed now?

**Answer**: **No**. `trace_id` is a distributed tracing identity for following events across Gateway hops. This is Trust Layer semantics and should be defined in a Trust Trace design, not in MWT-3B. Defer.

### Q5: What is the relationship between `event_id` and `event_hash`?

**Answer**: Already defined and implemented. `event_id` = hash-derived immutable identity of an event. `event_hash` = the hash value itself. Both are Trust-owned, already in the event envelope. No change needed.

### Q6: How are pre-task events represented?

**Answer**: Events that occur before a task is created (or that are never assigned to a task) have `task_id = null`. This is the natural state for system events, pre-task setup events, and unassigned model calls.

### Q7: How are unassigned events queried?

**Answer**: Query `WHERE task_id IS NULL`. All pre-existing events in JSONL will be `task_id = null` unless backfilled. The event index should support this null-safe query.

### Q8: Should `task_id` enter the wire event envelope?

**Answer**: **Yes, additive only**. `task_id` is an optional field in the event envelope. It does not change existing fields. It does not change event hashing (event_hash is computed on existing fields, not on task_id). It is metadata attached at observation time.

### Q9: Should `task_id` enter the SQLite derived index?

**Answer**: **Yes, as a nullable column**. The SQLite event index is a derived (lossy) index for query performance. Adding a nullable `task_id` column enables `SELECT ... WHERE task_id = ?` and `SELECT ... WHERE task_id IS NULL`. It does not change the JSONL source of truth.

### Q10: Is JSONL rebuild/backfill required?

**Answer**: **No automatic backfill**. Pre-MWT-3B1 events will have `task_id = null`. A backfill script could be written (mapping known sessions to tasks from `task_archives`), but this is a separate operation with its own PM approval gate. The initial implementation should NOT force backfill.

---

## 6. JSONL vs SQLite Responsibilities

| Responsibility | JSONL | SQLite (event-index) |
|----------------|-------|----------------------|
| Source of truth | ✅ Primary | ❌ Derived |
| Event content | ✅ Full (sealedEvent) | ❌ Indexed fields only |
| task_id storage | ✅ Additive field in envelope | ✅ Nullable column |
| Query by task_id | ❌ Not efficient (sequential scan) | ✅ Efficient (index) |
| Tamper-evident | ✅ Hash-chained | ❌ Not chain-verified |
| Rebuild-able | ❌ Source | ✅ Rebuild from JSONL |

**Principle**: JSONL is the raw truth. SQLite is a derived query index. Never derive truth from SQLite — always verify against JSONL.

---

## 7. Null Handling Design

### 7.1 Null Semantics

| Scenario | task_id value |
|----------|---------------|
| System event (Gateway startup, health check) | `null` |
| Pre-task user message (before task creation) | `null` |
| Task-associated model_call | `task_id = "task-abc123"` |
| Post-task cleanup event | `task_id = "task-abc123"` (inherits from session context) |
| Unassigned event (orphan) | `null` |

### 7.2 Query Patterns

```text
All events for a task:        WHERE task_id = ?
Unassigned events:            WHERE task_id IS NULL
All events (task-agnostic):   WHERE 1=1 (no task_id filter)
Events by session + task:     WHERE session_id = ? AND task_id = ?
```

---

## 8. No-Code Decision Gates

The following are **design decisions only** — no code may be written until PM explicitly authorizes `MWT-3B1 IMPLEMENTATION_AUTHORIZED`.

| Gate | Decision |
|------|----------|
| G1: task_id is nullable | ✅ DESIGN CONFIRMED |
| G2: task_id is additive (does not change hashing) | ✅ DESIGN CONFIRMED |
| G3: run_id deferred | ✅ DESIGN CONFIRMED |
| G4: trace_id deferred | ✅ DESIGN CONFIRMED |
| G5: Gateway does NOT create task_id | ✅ DESIGN CONFIRMED |
| G6: JSONL is source of truth, SQLite is derived index | ✅ DESIGN CONFIRMED |
| G7: No automatic backfill | ✅ DESIGN CONFIRMED |
| G8: No Evidence report changes in MWT-3B1 | ✅ DESIGN CONFIRMED |

---

## 9. Files Potentially Affected (MWT-3B1 — NOT YET AUTHORIZED)

**For planning reference only. Implementation NOT authorized.**

| File | Proposed Change | Risk |
|------|-----------------|------|
| `src/services/trst1/event-envelope.ts` | Add `task_id?: string \| null` to envelope type | Low — additive field |
| `src/services/trst1/event-index.ts` | Add nullable `task_id` column + query support | Medium — schema change |
| `src/services/trst1/llm-gateway-server.ts` | Accept task_id context, attach to events | Low — observation passthrough |
| `frontend` (if needed) | task_id filter in event query UI | Low — read-only filter |
| Migration script (if needed) | SQLite ALTER TABLE ADD COLUMN | Medium — one-time |

---

## 10. Pre-Implementation Checklist (PM Gate)

Before any MWT-3B1 implementation can begin:

- [ ] PM approves this design review document
- [ ] PM approves MWT-3B1 minimal task correlation brief
- [ ] PM issues `MWT-3B1 IMPLEMENTATION_AUTHORIZED`
- [ ] Object model definitions (Section 2) confirmed
- [ ] Null handling design (Section 7) confirmed
- [ ] Decision gates (Section 8) all confirmed
- [ ] v1 stash remains isolated and NOT merged

**Current Status**: DESIGN_REVIEW_REQUIRED. Awaiting PM review of this document.

---

## 11. PM Decision Recorded (2026-08-10)

```text
PM DECISION:
  ✅ MWT-3B Object Model Design Review: ACCEPTED
  ✅ Path selected: Option C first — nullable task_id only
  ✅ run_id: DEFERRED (requires Manager Run model)
  ✅ trace_id: DEFERRED (requires Trust Trace design)
  ✅ Formal object semantics confirmed (Section 2.1)
  ✅ JSONL = source of truth confirmed (Section 6)
  ✅ task_id in SQLite = indexable projection, not source-of-truth ownership

Next step:
  MWT-3B1 minimal task_id correlation brief → PATCH CONFIRMATION → IMPLEMENTATION_AUTHORIZED
```

---

*Draft: 2026-08-10. Version 1.1 — PM Decision Recorded. Option C selected.*
