# T100 Planning Report

Stage: T100 — TrustOS OS Reframing & Architecture Planning  
Date: 2026-07-02  
Status: Freeze Candidate  
Freeze Candidate Date: 2026-07-03  
Next Stage: S100P — Manager Workspace v1: Loop Separation in UX

## 1. Background

S99P completed important operational foundations:

- feedback triage,
- daily ops,
- alerts,
- user management,
- runtime reliability fixes,
- smoke test coverage.

However, these improvements mainly prove that TrustOS can manage itself operationally.

They do not yet prove that TrustOS can help users manage powerful AI Workers.

The project requires an OS-level reframing before S100P development begins.

## 2. Core Correction

Previous direction risked framing TrustOS as:

- another agent app,
- a stronger chat assistant,
- a web research tool,
- an admin dashboard,
- or a security wrapper.

The corrected direction:

```text
TrustOS is the operating layer for trustworthy AI work.
```

TrustOS should manage:

- AI Workers,
- context,
- memory,
- tools,
- models,
- files,
- shell,
- browser,
- network,
- secrets,
- user attention,
- cost,
- long-running sessions,
- audit,
- recovery.

## 3. TrustOS Core Model

```text
User
  ↕
Trusted Manager
  ↕
Trust Kernel
  ↕
Worker Runtime
  ↕
Managed Resources
```

Manager represents the User.

Worker executes delegated tasks.

Trust Kernel enforces boundaries.

## 4. T100 Deliverables

The following documents are created or planned:

1. `docs/strategy/TrustOS-OS-Manifesto.md`
2. `docs/architecture/TrustOS-OS-Primitives.md`
3. `docs/architecture/Manager-Worker-Trust-Model.md`
4. `docs/architecture/Trust-Kernel-RFC.md`
5. `docs/architecture/AI-Syscall-Action-Protocol.md`
6. `docs/architecture/TrustOS-Performance-Model.md`
7. `docs/architecture/Session-Runtime-RFC.md`
8. `docs/architecture/Local-First-Hybrid-Architecture.md`
9. `docs/architecture/Loop-Separation-RFC.md`
10. `docs/product/TrustOS-UX-Blueprint.md`
11. `docs/sprints/T100-planning-report.md`

## 5. Key Decisions

### 5.1 S100P Should Not Start as Public Beta

S100P should not focus on public beta hardening before the core product direction is corrected.

### 5.2 S100P Should Be Manager Workspace v1: Loop Separation in UX

Recommended:

```text
S100P — Manager/Worker Loop Separation + Manager Workspace v1
```

The key insight: a single chat window forces Manager control, Worker execution, Action decisions, approvals, and multiple delegated tasks into one mixed stream. S100P must separate these in both architecture and UX.

### 5.3 S101P Should Be AI Syscall v1

Recommended:

```text
S101P — AI Syscall v1: Controlled Worker Actions
```

### 5.4 S102P Should Be Durable Session Runtime

Recommended:

```text
S102P — Durable Session Runtime
```

### 5.5 S103P Should Be Local Trust Kernel Prototype

Recommended:

```text
S103P — Local Trust Kernel Prototype
```

## 6. Roadmap

| Phase | Name | Goal |
|---|---|---|
| T100 | OS Reframing | Define product and architecture foundation |
| S100P | Manager Workspace v1: Loop Separation in UX | Separate Manager/Worker/Action loops in product |
| S101P | AI Syscall v1 | Wrap Worker actions through Action Protocol |
| S102P | Session Runtime | Support durable long-running execution |
| S103P | Local Trust Kernel | Establish local trust root prototype |
| S104P | External Worker Integration | Connect external Workers via Tool Proxy/MCP |
| S105P | Hybrid TrustOS | Local-first, cloud-augmented runtime |

## 7. S100P Proposed Scope

S100P should deliver (P0):

1. Session List (left panel) — independent task cards with status, risk, approvals
2. Manager Conversation (center panel) — user/Manager main chat, Manager Loop only
3. Session Detail (right panel) — Delegation, Worker Events, Approval, Trust Report
4. Session creation on task delegation — Worker Events enter Session, not main chat
5. Approval Cards bound to corresponding Session
6. Trust Reports bound to corresponding Session
7. Main chat shows Manager summaries only, not Worker execution details

S100P should not attempt:

- Full remote Sandbox PaaS
- Auto-scaling runtime
- Package management execution environment
- Full Agent Engine platform
- Worker Marketplace
- Complex MCP ecosystem
- Floating window system
- Multi-desktop system
- full sandbox,
- local daemon,
- all external Worker integrations,
- full workflow engine,
- model marketplace,
- complex multi-agent orchestration.

## 8. Required Codebase Audit

Before S100P implementation, audit:

1. Current Manager-related modules.
2. Current Worker-related modules.
3. Current runtime/session/task tables.
4. Current logs/audit/feedback tables.
5. Current guardrails/policy/cost modules.
6. Current Worker access paths to model/file/network.
7. Current frontend components that can become Manager Workspace.
8. Current blockers for durable sessions.
9. Current SSR/localStorage blockers.
10. Current internal naming that leaks implementation details to users.

## 9. Product Success Criteria

TrustOS product direction succeeds when users understand:

- Manager stands on their side,
- Workers are powerful but bounded,
- normal work remains fast,
- risky actions are explained,
- critical actions require approval,
- final work is auditable,
- rollback is possible,
- long tasks can resume.

## 10. Architecture Success Criteria

TrustOS architecture succeeds when:

- core primitives are stable,
- Worker actions can be represented as Action Requests,
- Trust Kernel can make deterministic decisions,
- policy is separated from LLM judgment,
- audit events can reconstruct sessions,
- performance fast path is measurable,
- session runtime supports pause/resume,
- local-first direction is technically credible.

## 11. Open Questions

### Product

- Who is the first target user?
- What is the first must-win scenario?
- How much friction will users accept for trust?
- Which risk matters most to early users?

### Architecture

- Which current modules map to Manager?
- Which current modules map to Worker?
- Which actions can be controlled today?
- Which are only observable?
- What is the smallest Action Protocol implementation?

### Performance

- What is current Worker action latency?
- Where is current runtime bottleneck?
- How to implement permission cache?
- How to batch file reads?
- How to avoid approval fatigue?

### Local-first

- What is the first local component?
- Secret scanner?
- Policy evaluator?
- Local audit store?
- File proxy?
- MCP server?

## 12. Final Recommendation

Do not start feature coding under the old roadmap.

Proceed as follows:

1. Commit T100 planning documents.
2. Conduct codebase audit against OS primitives.
3. Update S100P scope to Manager Workspace v1: Loop Separation in UX.
4. Implement only user-visible Manager trust loop first.
5. Then implement Action Protocol.
6. Then implement durable Session Runtime.
7. Then move toward Local Trust Kernel.

TrustOS must become an OS, not another Agent.

---

## 13. T100 Freeze Candidate Notes

T100 documentation is considered freeze candidate after:

- Loop Separation RFC completed
- Manager Workspace v1 defined
- T100 documentation consistency check completed
- Codebase audit completed
- S100P development plan completed

No further architectural expansion should be added before S100P implementation unless approved by PM.
