# AI Syscall / Action Protocol

Version: v0.1  
Stage: T100  
Date: 2026-07-02

## 1. Purpose

This document defines the Action Protocol, the AI-era equivalent of system calls.

Workers must not directly access sensitive resources.

Workers request Actions.

TrustOS evaluates Actions.

TrustOS returns Decisions.

### 1.1 Loop Ownership

The Action Protocol belongs to the **Action Loop**, not the Manager Loop:

```text
WorkerLoop sends ActionRequests
ActionLoop evaluates and executes
ManagerLoop is notified only for user-relevant events or approvals
```

Manager Loop should not be involved in every Action decision. Low-risk actions must flow through the Action Loop's deterministic fast path without Manager LLM invocation.

## 2. Core Flow

```text
WorkerLoop
  ↓ Action Request
ActionLoop / Trust Kernel
  ↓ Decision
WorkerLoop
  ↓ Tool Execution if allowed
ActionLoop / Trust Kernel
  ↓ Audit Event + SessionEvent
Session Detail
  ↓ User-visible event when relevant
ManagerLoop
  ↓ Summary / Approval / Trust Report when needed
User
```

## 3. Action Request Schema

```json
{
  "actionId": "act_123",
  "sessionId": "sess_123",
  "workerId": "worker_abc",
  "type": "file.read",
  "resource": {
    "type": "file",
    "uri": ".env.local"
  },
  "reason": "Inspect environment configuration",
  "payloadPreview": null,
  "riskSignals": [],
  "createdAt": "2026-07-02T16:00:00Z"
}
```

## 4. Decision Schema

```json
{
  "decisionId": "dec_123",
  "actionId": "act_123",
  "decision": "deny",
  "riskLevel": "high",
  "reasonCode": "secret_like_path",
  "policyRefs": ["deny_secret_files_default"],
  "requiresUser": false,
  "managerMessage": "我拦下了 Worker 读取 .env.local 的请求，因为它通常包含密钥，且与当前任务无关。",
  "createdAt": "2026-07-02T16:00:01Z"
}
```

## 5. Decision Types

| Decision | Meaning |
|---|---|
| allow | Action is allowed |
| deny | Action is denied |
| ask | User approval required |
| redact | Action allowed after data redaction |
| sandbox | Action allowed only in sandboxed environment |
| defer | Action postponed pending more information |

## 6. Action Types

### File

```text
file.read
file.write
file.delete
file.list
file.move
file.copy
```

### Shell

```text
shell.exec
shell.read_output
shell.kill_process
```

### Network

```text
network.request
network.download
network.upload
```

### Browser

```text
browser.open
browser.click
browser.type
browser.submit
browser.read
browser.download
```

### Model

```text
model.send
model.receive
model.tool_call
```

### Memory

```text
memory.read
memory.write
memory.update
memory.delete
```

### Artifact

```text
artifact.create
artifact.update
artifact.commit
artifact.publish
```

### Git

```text
git.diff
git.commit
git.push
git.checkout
git.merge
```

### Cloud

```text
cloud.read
cloud.write
cloud.deploy
cloud.delete
```

### Secret

```text
secret.access
secret.inject
secret.rotate
```

## 7. Risk Signals

Risk signals may include:

```text
secret_like_path
large_data_egress
destructive_operation
external_network
production_resource
payment_related
auth_related
dependency_change
unknown_domain
cross_project_access
high_cost_action
user_attention_required
```

## 8. Batch Action Request

Workers may request batches for performance.

```json
{
  "batchId": "batch_123",
  "sessionId": "sess_123",
  "workerId": "worker_abc",
  "actions": [
    {
      "type": "file.read",
      "resource": {
        "type": "file",
        "uri": "frontend/src/app/login/page.tsx"
      },
      "reason": "Inspect login page"
    },
    {
      "type": "file.read",
      "resource": {
        "type": "file",
        "uri": ".env.local"
      },
      "reason": "Inspect environment"
    }
  ]
}
```

TrustOS may return mixed decisions.

```json
{
  "batchId": "batch_123",
  "decisions": [
    {
      "resource": "frontend/src/app/login/page.tsx",
      "decision": "allow"
    },
    {
      "resource": ".env.local",
      "decision": "deny",
      "reasonCode": "secret_like_path"
    }
  ]
}
```

## 9. Performance Rules

- Low-risk file.read within allowed scope should use fast path.
- Batch action preflight should be supported.
- LLM judgment must not be used for every action.
- Audit should be async where safe but durable.
- User approval should be grouped where possible.

## 10. Audit Event

Every important Action and Decision should produce an Audit Event.

```json
{
  "eventId": "evt_123",
  "sessionId": "sess_123",
  "actorType": "worker",
  "actorId": "worker_abc",
  "eventType": "decision.made",
  "resource": ".env.local",
  "decision": "deny",
  "riskLevel": "high",
  "summary": "Blocked secret-like file access",
  "timestamp": "2026-07-02T16:00:01Z"
}
```

## 11. User Visibility

Not every Action should interrupt the User.

Visibility levels:

```text
silent_audit
session_timeline
approval_required
manager_chat_summary
trust_report_only
critical_alert
```

| Visibility | Meaning | Loop Destination |
|---|---|---|
| silent_audit | Record in audit log only; no user notification | Action Loop → Audit |
| session_timeline | Display in Session Detail timeline; not in main chat | Action Loop → Session Detail |
| approval_required | Show Approval Card; requires user action | Action Loop → Manager Loop → User |
| manager_chat_summary | Brief summary in Manager conversation | Action Loop → Manager Loop |
| trust_report_only | Include in final Trust Report only | Action Loop → Session → Trust Report |
| critical_alert | Immediate high-priority notification | Action Loop → Manager Loop → User |

Examples:

- allowed low-risk read → silent_audit or session_timeline
- blocked secret read → session_timeline
- dependency install → approval_required
- git push → approval_required
- repeated allowed read → trust_report_only
- Worker heartbeat → hidden unless issue

## 12. Compatibility Strategy

Stage A:

- internal Workers use Action Protocol.

Stage B:

- tool proxy exposes controlled file/shell/model APIs.

Stage C:

- MCP adapter enables external Workers.

Stage D:

- local daemon enforces resource access.

Stage E:

- sandbox/runtime controls unmanaged execution.

## 13. Open Questions

- Which existing Worker actions can be wrapped first?
- How to prevent bypass in cloud-only Worker runtime?
- How to map external Agent tool calls to Action Protocol?
- What is the minimum viable set for S101P?
