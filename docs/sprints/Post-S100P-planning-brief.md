# Post-S100P Planning Brief

Date: 2026-07-07
Status: Planning — Awaiting Direction Decision
Predecessor: S100P ACCEPTED (snapshot `4e64752`)

---

## 1. Context

S100P — Manager Workspace v1 / Loop Separation in UX — is **ACCEPTED**. The MVP delivers:

- Three-column Manager Workspace layout
- Independent Session creation per delegated task
- manager_messages / session_events data boundary separation
- Backend routing (5-way intent + 6-tier visibility)
- 125/125 smoke + unit tests pass

The architecture foundation for Manager Loop ↔ Session Loop separation is in place across schema, API, and UI layers. This brief outlines candidate directions for the next sprint.

---

## 2. Candidate Sprint Directions

| # | Candidate | Goal | Dependencies | Risk |
|---|---|---|---|---|
| **S101T** | TypeScript Debt Cleanup | Zero TS errors project-wide | None | Low — purely engineering |
| **S101I** | Worker Execution Integration | Real Worker produces real session_events | Slow Worker loop exists | Medium — may need infra |
| **S101P** | Session Detail Deepening | Worker Timeline, Approval Card, Trust Report Shell | S100P Phase 3 Shell | Medium — UI-heavy |

### 2.1 S101T — TypeScript Debt Cleanup

**Goal**: Eliminate all pre-existing TypeScript errors across the project.

**Current state**: ~36 pre-existing TS errors (non-S100P). S100P itself has 0 TS errors.

**Scope**:
- Run `tsc --noEmit` on whole project
- Fix type errors in pre-existing files (not S100P code)
- Add missing type declarations
- Clean up `any` usage where feasible
- Ensure build and lint pass clean

**Deliverables**:
- 0 TypeScript errors project-wide
- `next build` passes without warnings
- TS config hardened (stricter flags as feasible)

**Estimated effort**: 1-2 days

**Rationale**: Every feature added with pre-existing TS errors increases regression cost. Clean baseline before adding more complexity.

---

### 2.2 S101I — Worker Execution Integration

**Goal**: Connect real Worker execution (Slow Worker / Agent) to session_events, making Session Detail show live progress instead of static shells.

**Current state**: `manager_messages` + `session_events` tables exist. `route-message` writes `session.created` events. But no real Worker produces subsequent events (no `action.*`, `progress.*`, `artifact.*`, `approval.*` events).

**Scope**:
- Wire Slow Worker or Agent loop into session_events pipeline
- Worker produces events tagged with `session_id`
- Session List shows real status transitions (created → running → completed/failed)
- Session Detail timeline shows real progress events
- Worker completion triggers Session status updates

**Deliverables**:
- Real Session progress visible in UI
- Session status transitions driven by actual Worker output
- At least 1 Worker type integrated (Slow Worker or equivalent)

**Estimated effort**: 3-5 days

**Rationale**: Without real execution, Session Detail is a shell. This sprint makes Sessions meaningful by connecting them to actual Worker work.

---

### 2.3 S101P — Session Detail Deepening

**Goal**: Implement Worker Timeline UI, Approval Card, and Trust Report Shell — the deferred S100P exit criteria.

**Current state**: Session Detail shows minimal summary + event list. No styled timeline, no Approval Card, no Trust Report.

**Scope**:
- Worker Timeline: styled event cards with type icons, visibility badges, expandable details
- Approval Card: accept/deny buttons, approval history, session binding
- Trust Report Shell: post-session summary panel with risk metrics
- Visibility wiring: `approval_required` → Approval Card, `manager_chat_summary` → center panel summary

**Deliverables**:
- S100P exit criteria #7, #8 met
- Manager Workspace UX feels complete for demo
- Approval Card and Trust Report basic UI functional

**Estimated effort**: 3-5 days

**Rationale**: Completes the deferred S100P exit criteria and makes the workspace feel like a complete product.

---

## 3. PM-Recommended Priority

```
1. S101T — TypeScript Debt Cleanup  (engineering health)
2. S101I — Worker Execution Integration  (making Sessions meaningful)
3. S101P — Session Detail Deepening  (UI completeness)
```

**Reasoning**:
- If whole-project TypeScript still has pre-existing errors, every new feature adds regression cost
- Without real Worker execution, Session Detail remains a shell regardless of UI polish
- After a clean TS baseline + real execution, Session Detail deepening will be more impactful

---

## 4. Combined Sprint Option

An alternative is a combined sprint:

**S101T+I**: TypeScript Cleanup (Day 1) + Worker Execution Integration (Days 2-4) + light smoke (Day 5)

This front-loads the engineering health fix and then immediately ships meaningful execution.

---

## 5. What is NOT in Scope for Next Sprint

Regardless of chosen direction:
- No Agent Engine implementation
- No Sandbox / remote execution environment
- No MCP / Worker Marketplace
- No floating windows or desktop daemon
- No complex multi-Session orchestration
- No LLM-based intelligent routing (current heuristic is sufficient)

---

## 6. Decision Required

PM to select one of:
- **S101T** (TypeScript cleanup only)
- **S101I** (Worker integration only)
- **S101P** (Session Detail UI only)
- **S101T+I** (Combined: TS cleanup + Worker integration)

No S100P code changes are authorized. Await direction before opening any new PR.

---

## 7. Reference

- S100P Acceptance Report: `docs/sprints/S100P-acceptance-report.md`
- S100P Development Plan: `docs/sprints/S100P-development-plan.md`
- S100P Demo Script: `docs/sprints/S100P-demo-script.md`
- Acceptance Snapshot: `4e64752`
