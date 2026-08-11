# MWT-4 Task Evidence — Pre-Brief (Pre-Research)

**Status**: DRAFT — PENDING PM REVIEW  
**Date**: 2026-08-10  
**Phase**: MWT-4 Task Evidence (Pre-Research)  
**Dependency**: MWT-3B1 (nullable task_id) implemented  
**Classification**: Planning document only — NO implementation authorized

---

## 1. Purpose

This pre-brief defines what Task Evidence could be, establishes design principles, and identifies open questions that must be answered before a full MWT-4 implementation brief can be written. No code is authorized.

**Core Question**: What does it mean to have "evidence for a task" rather than "evidence for a single event"?

---

## 2. What Is Task Evidence?

### 2.1 Current State (MWT-3A)

Today, evidence is **event-scoped**: the EvidenceReportPanel shows a single event's evidence bundle (hashes, timestamps, control decision, model metadata). Each event is independently evidenced.

### 2.2 Target State (MWT-4)

Task Evidence is a **task-scoped execution report** that aggregates evidence across all events belonging to a task:

```text
Task Evidence = {
  task_id, task_title, task_status,
  event_count, total_tokens, total_cost,
  control_summary (allow/deny distribution),
  risk_summary (risk levels across events),
  event_timeline (ordered events with key metadata),
  evidence_bundles (per-event, privacy-safe),
  verification_hashes (for audit/prove)
}
```

---

## 3. PM Initial Direction

```text
MWT-4A Task Evidence Projection:
  - read-only
  - generated on demand (no durable storage)
  - source from event index + raw events
  - no durable evidence report table
  - frontend report view only
  - event-scoped fallback if no task_id
```

This maps to: **query projection, not new storage**.

---

## 4. Key Design Questions

### Q1: Is Task Evidence just a query projection?

**Preliminary Answer**: Yes, for MWT-4A. Task Evidence is what you get when you `SELECT * FROM events WHERE task_id = ?` and format the result. It is NOT a new durable artifact — it's a computed view.

**Implication**: No new storage. No new durable report. Just a query + formatting layer.

### Q2: Should Task Evidence generate a durable report?

**Preliminary Answer**: No, for MWT-4A. Durable task evidence reports (PDF, signed JSON, exportable artifact) are a separate concern. MWT-4A should focus on the in-app read-only projection. Durable export can be MWT-4B or a separate brief.

### Q3: What is the source of truth for Task Evidence?

**Preliminary Answer**: JSONL (raw events) is the ultimate source. The event index (SQLite) provides efficient querying. Task Evidence is derived from the event index + raw events, and should be verifiable against JSONL.

### Q4: What happens when task_id is missing?

**Preliminary Answer**: Fall back to event-scoped evidence (current behavior). If no `task_id` is set on any events, Task Evidence is unavailable. The UI should degrade gracefully to the existing event-scoped EvidenceReportPanel.

### Q5: Should the EvidenceReportPanel change?

**Preliminary Answer**: **No, for MWT-4A**. The existing `EvidenceReportPanel` stays as the event-scoped evidence view. Task Evidence is a **new view** (e.g., `TaskEvidenceView`) that appears when a task is selected in the Tasks navigation. It does not replace or modify the existing panel.

### Q6: Can users export Task Evidence?

**Preliminary Answer**: Not in MWT-4A. Export (PDF, signed JSON, clipboard) is a separate concern. MWT-4A is view-only. If export is needed, it's MWT-4B or later.

### Q7: Should Task Evidence include Worker lifecycle cycles?

**Preliminary Answer**: If a task has an associated Worker run (MWT-2), yes — the task evidence should include Worker lifecycle data (cycles, tool calls, final output). But this depends on MWT-3B1 being complete (task_id allows linking task ↔ worker run). If no worker run exists, task evidence is purely event-scoped aggregation.

### Q8: How does Task Evidence relate to the existing Shadow Report?

**Preliminary Answer**: The Shadow Report is a CLI tool that generates a markdown report from JSONL. Task Evidence is an in-app frontend view. They serve different use cases:

| Aspect | Shadow Report | Task Evidence |
|--------|--------------|---------------|
| Interface | CLI (`npm run trst1:report`) | Frontend UI |
| Scope | All events in JSONL | Events for a specific task |
| Format | Markdown file | In-app view |
| Audience | Developer/operator | Manager user |

They should NOT be merged. Shadow Report remains a developer tool.

---

## 5. Proposed MWT-4A Scope (Tentative)

### In Scope

```text
✅ TaskEvidenceView component (new, frontend only)
✅ Query: SELECT events WHERE task_id = ?
✅ Aggregate: event count, total tokens, total cost, control summary
✅ Event timeline: ordered list of task events
✅ Evidence bundle per event (privacy-safe, existing format)
✅ Hash verification (per-event, existing mechanism)
✅ Event-scoped fallback: when no task selected, show event-scoped evidence
✅ No backend changes — pure frontend query + aggregation
```

### Out of Scope

```text
❌ Durable evidence report table (no new storage)
❌ Export (PDF, signed JSON, clipboard) — MWT-4B+
❌ Report approval workflow — MWT-5
❌ Policy binding — MWT-5
❌ Memory integration — MWT-6
❌ Task evidence signing — future
❌ EvidenceReportPanel modification
❌ Backend evidence service
```

---

## 6. Dependency Chain

```text
MWT-3B1 (task_id correlation) → MWT-4A (task evidence projection)
                              → MWT-4B+ (export, durable report, signing)
```

MWT-4A **cannot start** until MWT-3B1 is implemented and `task_id` is queryable.

---

## 7. Open Questions for Full Brief

These questions must be answered before MWT-4 moves from pre-brief to implementation brief:

| # | Question | Who Decides |
|---|----------|-------------|
| 1 | Should task evidence include control decisions? (allow/deny per event) | PM |
| 2 | Should task evidence show risk assessment per event? | PM |
| 3 | Display format: timeline, table, summary card, or all? | PM + UX |
| 4 | Should task evidence show cost ($) or just tokens? | PM |
| 5 | Should task evidence be accessible from Chat view (not just Tasks view)? | PM |
| 6 | Is there a "download evidence" button? If so, what format? | PM |
| 7 | Should changelog/history be shown (evidence reports are immutable views)? | PM |
| 8 | Does task evidence need its own nav item, or is it embedded in Task detail? | PM |

---

## 8. Estimated Implementation Surface (MWT-4A)

| Component | Type | Lines (est.) |
|-----------|------|-------------|
| `TaskEvidenceView.tsx` | New frontend component | ~150 |
| `useTaskEvidence` hook | New React hook (query + aggregate) | ~60 |
| `TaskEvidence` type | New TypeScript type | ~30 |
| Integration in Tasks page | Frontend routing | ~5 |

**Estimated total**: 3-4 files, ~250 lines, frontend only.

---

## 9. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| MWT-3B1 not implemented | Medium | Blocking | Cannot start MWT-4A before 3B1 |
| Scope creep to durable storage | Medium | High | Explicitly out of scope in AC |
| "Just add an export button" | High | Medium | Explicitly out of scope, defer to MWT-4B |
| Event-scoped panel confusion | Low | Medium | Separate component, don't replace existing panel |
| Performance with many events | Low | Medium | Pagination + virtualized list |

---

## 10. Next Steps

```text
1. PM review this pre-brief
2. Resolve open questions (Section 7)
3. After MWT-3B1 implemented: draft full MWT-4A implementation brief
4. PM approve MWT-4A brief
5. PM issue MWT-4A IMPLEMENTATION_AUTHORIZED
```

**Current Status**: Pre-Research only. No implementation authorized.

---

*Draft: 2026-08-10. Version 1.0. PENDING PM REVIEW.*
