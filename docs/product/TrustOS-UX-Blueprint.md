# TrustOS UX Blueprint

Version: v0.1  
Stage: T100  
Date: 2026-07-02

## 1. Purpose

This document defines the user experience principles for TrustOS.

The core UX goal:

```text
Users should feel that the Manager stands on their side and manages powerful Workers on their behalf.
```

## 2. Core User Perception

Within 30 seconds, the user should understand:

- Manager understands my goal.
- Manager sets boundaries before delegating.
- Worker is powerful but constrained.
- Low-risk work continues without bothering me.
- Risky actions are explained.
- Critical actions require approval.
- Everything important is auditable.
- The task can be recovered or rolled back.

## 3. Manager Workspace v1

TrustOS should not feel like a generic chat box.

A single chat window forces Manager control, Worker execution, Action decisions, approvals, and multiple delegated tasks into one mixed stream. The UX must reflect the architectural Loop Separation.

### 3.1 Three-Panel Layout

```text
┌────────────────────────────────────────────────────────────┐
│ Top Bar: TrustOS / User / Active Sessions / Alerts         │
├───────────────┬──────────────────────────┬─────────────────┤
│ Session List  │ Manager Conversation     │ Session Detail  │
│               │                          │                 │
│ - Task A      │ User ↔ Manager main chat │ Delegation      │
│ - Task B      │ (Manager Loop only)      │ Worker Events   │
│ - Task C      │                          │ Approval        │
│               │                          │ Trust Report    │
└───────────────┴──────────────────────────┴─────────────────┘
```

### 3.2 Panel Responsibilities

| Area | Carries | Loop |
|---|---|---|
| Session List | Independent tasks, status, risk, pending approvals | Session Lifecycle |
| Manager Conversation | User ↔ Manager main interaction | Manager Loop |
| Session Detail | Task execution details | Worker Loop + Action Events |

### 3.3 Manager Conversation — What Belongs

- User input
- Manager understanding and responses
- Decision to create task / Session
- Delegation Contract summary
- Critical approval reminders
- Task completion summaries
- Cross-task summaries
- User follow-up questions

### 3.4 Manager Conversation — What Does NOT Belong

- Every file.read event
- Every tool log
- Worker thought process
- Long execution details
- Repetitive progress updates
- Low-risk action decisions

### 3.5 Session Detail — What Belongs

- Task goal
- Delegation Contract
- Worker current status
- Worker progress events
- Action decisions (allow/deny/ask)
- Approval cards
- Artifacts
- Diff
- Trust Report
- Rollback controls

### 3.6 Session List — Each Task Shows

```text
Title
Status
Worker
Risk Level
Progress
Pending Approval?
Completed?
Rollback Available?
```

Example:

```text
Fix login page UI   Running · 2 files changed · 1 blocked
Organize feedback   Waiting Approval · Export CSV
Competitor report   Completed · Trust Report ready
```

### 3.7 Session Detail Structure

```text
1. Task Overview
   - Goal
   - Worker
   - Trust Level
   - Status
   - Budget

2. Delegation Contract
   - Allowed
   - Denied
   - Requires approval
   - Success criteria

3. Live Worker Timeline
   - Important WorkerEvents
   - ActionLoop decisions
   - Approvals
   - Artifacts

4. Approval Area
   - Approval cards

5. Artifacts / Diff / Trust Report
   - Completion outputs
   - Rollback
```

### 3.8 Deeper Audit View

Low-level audit logs go to a separate "View Audit" panel, not the default user view. Do not spam users with raw audit entries.

## 4. Task Start Experience

When the user starts a task, Manager should respond with:

- understood goal,
- selected Worker,
- allowed scope,
- denied scope,
- approval-required actions,
- cost/time estimate if available,
- assurance about low-risk automation and high-risk approval.

### Example

User:

```text
让 Worker 修登录页 UI，不要碰认证逻辑，也不要读密钥。
```

Manager:

```text
我会把任务交给 Worker，并设置以下边界：

允许：
- 读取 frontend/src/**
- 修改登录页和相关 UI 组件

禁止：
- 读取 .env、secrets/**
- 修改认证/session 逻辑
- 执行 git push 或发布操作

需要你确认：
- 安装新依赖
- 删除文件
- 修改 package.json

我会自动放行低风险操作，只在关键风险点打扰你。
```

### Creating a New Task

When the user says:

```text
Fix the login page UI. Don't touch authentication logic.
```

Manager (in main chat):

```text
I'll create an independent task to handle the login page UI, with the Worker restricted from touching authentication logic. Task progress will appear on the right.
```

System behavior:

```text
- Session created
- Delegation Contract generated
- Session Card appears in left panel
- Session Detail opens in right panel
- Worker Events enter that Session, NOT the main chat
```

### Multi-Task Parallel Execution

If the user then says:

```text
Also organize yesterday's user feedback.
```

Manager creates a second Session. The main chat:

```text
I've created a second task "Organize user feedback". It will run independently and will not mix into the "Fix login page UI" execution stream.
```

Left panel:

```text
Fix login page UI     Running
Organize feedback     Planning
```

### Adding to an Existing Task

User:

```text
For the login page task, don't change the button text either.
```

Manager identifies and updates the corresponding Session:

```text
Updated "Fix login page UI" task boundary: do not modify button text.
```

This supplement enters the Session as a SessionEvent, not as global chat context polluting other tasks.

### Ambiguous References

User:

```text
Don't change that file.
```

When multiple active Sessions exist, Manager must ask:

```text
Are you referring to a file in "Fix login page UI" or "Organize feedback"?
```

Do not guess.

## 5. Delegation Contract UI

The Delegation Contract should show:

- goal,
- Worker,
- allowed actions,
- denied actions,
- approval-required actions,
- context scope,
- budget,
- success criteria.

It should be understandable to non-technical users where possible.

## 6. Execution Experience

During execution, the user should see a Decision Feed — the Session-scoped timeline of Worker Events and Action decisions displayed in Session Detail. It is not a global chat stream; events are routed per visibility level (see §7).

Examples:

```text
✅ Worker 读取了登录页文件，符合任务范围。
⛔ 我拦截了 Worker 读取 .env.local 的请求，因为它通常包含密钥。
⚠️ Worker 请求安装新依赖。我建议先拒绝，让它用现有 CSS 实现。
✅ Worker 修改了 2 个 UI 文件，未触碰认证逻辑。
```

## 7. Decision Feed Visibility

Decision Feed should not show every low-value event. Events are routed to the appropriate panel based on their visibility level, not all streamed into the main chat.

Visibility levels:

```text
silent_audit
session_timeline
approval_required
manager_chat_summary
trust_report_only
critical_alert
```

| Visibility | Destination |
|---|---|
| silent_audit | Audit log only |
| session_timeline | Session Detail timeline |
| approval_required | Approval Card (Manager Chat + Session Detail) |
| manager_chat_summary | Brief summary in Manager Conversation |
| trust_report_only | Final Trust Report |
| critical_alert | Immediate notification in Manager Chat |

Recommended mapping:

| Event | Visibility |
|---|---|
| low-risk allowed file read | silent_audit or trust_report_only |
| first allowed file write | session_timeline |
| secret access denied | session_timeline |
| dependency install | approval_required |
| git push | approval_required |
| repeated safe reads | trust_report_only |
| Worker heartbeat | hidden unless issue |
| failure recovery | session_timeline |

## 8. Approval Card

Approval Card should include:

- requested action,
- Worker reason,
- risk explanation,
- Manager recommendation,
- possible consequences,
- buttons.

### Buttons

```text
Approve once
Deny
Remember this choice
View details
```

### Example

```text
Worker 想安装 framer-motion。

原因：
它想用动画库修复登录页动效。

风险：
这会修改 package.json，并增加依赖体积。

Manager 建议：
先拒绝，让 Worker 使用现有 CSS 实现。

[拒绝并要求替代方案] [批准一次] [查看详情]
```

## 9. Trust Report

At completion, Manager should generate Trust Report.

### Content

- task goal,
- Worker used,
- duration,
- cost,
- files read,
- files changed,
- actions allowed,
- actions denied,
- approvals requested,
- sensitive data handling,
- artifacts,
- rollback availability,
- Manager assessment.

### Example

```text
任务完成。

本次 Worker：
- 读取 6 个允许文件
- 修改 2 个 UI 文件
- 未触碰认证逻辑
- 被拦截 1 次敏感文件读取
- 有 1 次安装依赖请求被拒绝
- 所有修改已生成 diff，可查看或回滚

Manager 评估：
Worker 基本遵守了委托边界，未发现敏感数据外发。
```

## 10. Policy and Memory UX

Users should be able to configure:

- never read .env,
- ask before installing dependencies,
- ask before deleting files,
- deny git push by default,
- prefer local processing for sensitive context,
- allow specific Worker in specific project scope,
- remember approval decisions.

## 11. Worker Trust Level UX

Worker trust level must be visible.

Examples:

```text
Claude Code Adapter — T2 Proxied
Local Worker — T4 Trusted Local
External Browser Agent — T1 Observed
Unmanaged Tool — T0 Unmanaged
```

The UI must not imply full control over T0/T1 Workers.

## 12. Tone Principles

Manager tone should be:

- clear,
- protective,
- concise,
- non-alarmist,
- recommendation-oriented,
- honest about limits.

Avoid:

```text
Policy violation: rule 3 failed.
```

Prefer:

```text
我拦下了这次操作，因为 Worker 想读取 .env.local。这个文件通常包含密钥，且与当前任务无关。
```

## 13. Anti-patterns

Do not:

- show raw internal runtime names to users,
- spam every file read,
- hide risky actions,
- ask user for obvious low-risk actions,
- claim unmanaged Workers are controlled,
- show vague "processing" for long tasks,
- end tasks without Trust Report,
- show technical logs as product experience.

## 14. First Wow Moment

The first TrustOS wow moment should be:

```text
A powerful Worker attempts to go out of bounds, and the Manager blocks it clearly, calmly, and usefully.
```

Example:

```text
Worker tried to read .env.local.
Manager blocked it.
User understands why.
Task continues without breaking.
Final Trust Report includes the event.
```

## 15. UX Success Criteria

TrustOS UX succeeds when users say:

- I understand what the Manager is doing.
- I feel safer using powerful Workers.
- I am not bothered by trivial actions.
- I can see important decisions.
- I know what changed.
- I know what was blocked.
- I can recover if needed.
- I trust the system more than using Workers directly.
