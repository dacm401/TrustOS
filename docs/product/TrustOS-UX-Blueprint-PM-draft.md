# TrustOS UX Blueprint

Version: v0.1  
Stage: T100  
Date: 2026-07-02  
Author: PM Draft

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

## 3. Manager Shell

TrustOS should not feel like a generic chat box.

Manager Shell should include:

- task input,
- active sessions,
- Delegation Contract view,
- Decision Feed,
- Approval Inbox,
- Trust Report,
- Worker status,
- Policy and Memory settings.

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

During execution, the user should see a Decision Feed.

Examples:

```text
✅ Worker 读取了登录页文件，符合任务范围。
⛔ 我拦截了 Worker 读取 .env.local 的请求，因为它通常包含密钥。
⚠️ Worker 请求安装新依赖。我建议先拒绝，让它用现有 CSS 实现。
✅ Worker 修改了 2 个 UI 文件，未触碰认证逻辑。
```

## 7. Decision Feed Visibility

Decision Feed should not show every low-value event.

Visibility levels:

```text
silent_audit
decision_feed
approval_required
trust_report_only
critical_alert
```

Recommended mapping:

| Event | Visibility |
|---|---|
| low-risk allowed file read | silent_audit or trust_report_only |
| first allowed file write | decision_feed |
| secret access denied | decision_feed |
| dependency install | approval_required |
| git push | approval_required |
| repeated safe reads | trust_report_only |
| Worker heartbeat | hidden unless issue |
| failure recovery | decision_feed |

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
