# Trust Kernel Architecture RFC

Version: v0.1  
Stage: T100  
Date: 2026-07-02  
Author: PM Draft

## 1. Purpose

This RFC defines the Trust Kernel, the enforcement core of TrustOS.

The Trust Kernel is responsible for deterministic policy enforcement, action guarding, sensitive data boundaries, audit, budget control, approvals, checkpoints, and rollback support.

The Trust Kernel is what makes TrustOS an operating layer rather than a chat app.

## 2. Design Goals

The Trust Kernel must be:

- enforceable,
- low-latency,
- auditable,
- policy-driven,
- local-first where possible,
- independent of LLM judgment for hard boundaries,
- compatible with cloud and local Workers,
- extensible to external Worker adapters.

## 3. Non-goals

The Trust Kernel is not:

- a general LLM planner,
- a chat interface,
- a pure logging system,
- a policy suggestion tool,
- a cloud-only gateway,
- a replacement for all sandboxes in v1.

## 4. Core Modules

```text
Policy Engine
Action Guard
Decision Engine
Sensitive Data Guard
Audit Log
Budget Manager
Context Manager
Memory Manager
Approval Queue
Checkpoint Manager
Rollback Manager
Worker Registry
Session Runtime
```

## 5. Policy Engine

The Policy Engine evaluates policies.

### Inputs

```text
Action Request
Delegation Contract
User Policy
Project Policy
Organization Policy
Worker Trust Level
Context Classification
Budget State
Session State
```

### Outputs

```text
allow
deny
ask
redact
sandbox
defer
```

### Policy Hierarchy

Suggested priority:

```text
1. Organization hard deny
2. User hard deny
3. Project hard deny
4. Session Delegation Contract deny
5. Sensitive data rule
6. Budget rule
7. Session Delegation Contract allow
8. User preference allow
9. Manager judgment
10. Default behavior
```

Hard deny rules must not be overridden by Manager LLM judgment.

## 6. Action Guard

Action Guard receives Worker Action Requests and returns Decisions.

### Responsibilities

- validate action schema,
- normalize resource identifiers,
- classify resource,
- call Policy Engine,
- call Sensitive Data Guard when needed,
- call Budget Manager,
- generate Decision,
- append Audit Event,
- return Decision to Worker.

## 7. Decision Engine

Decision Engine resolves final action judgment.

### Decision Types

```text
allow
deny
ask
redact
sandbox
defer
```

### Decision Example

```json
{
  "actionId": "act_123",
  "decision": "deny",
  "riskLevel": "high",
  "reasonCode": "secret_like_path",
  "policyRefs": ["deny_secret_files_default"],
  "requiresUser": false,
  "managerMessage": "我拦下了 Worker 读取 .env.local 的请求，因为它通常包含密钥，且与当前任务无关。"
}
```

## 8. Sensitive Data Guard

Sensitive Data Guard detects and classifies sensitive data.

### Responsibilities

- path-based sensitive detection,
- pattern-based secret detection,
- content classification,
- redaction,
- data egress control,
- context routing decision.

### Classifications

```text
public
project_internal
sensitive
secret
regulated
```

### Rules

- secret must not be sent to cloud Workers by default,
- sensitive data may require redaction,
- large files require streaming or sampled scanning,
- secret detection must be local-first.

## 9. Audit Log

Audit Log records important behavior.

### Requirements

- durable,
- append-only where possible,
- queryable by session,
- safe to summarize,
- usable for Trust Report,
- usable for incident investigation.

### Event Examples

```text
session.created
contract.generated
worker.started
action.requested
decision.made
approval.requested
approval.resolved
action.executed
checkpoint.created
artifact.updated
session.completed
session.failed
```

## 10. Budget Manager

Budget Manager enforces limits.

### Budget Types

```text
cost
token
time
user_interruptions
model_calls
file_writes
network_calls
risk
```

### Behavior

- allow if within budget,
- ask if budget increase requires approval,
- deny if hard budget exceeded,
- summarize budget use in Trust Report.

## 11. Context Manager

Context Manager decides what context goes to which Worker.

### Responsibilities

- context selection,
- context classification,
- context compression,
- context redaction,
- cloud/local routing,
- context expiry,
- context audit.

## 12. Memory Manager

Memory Manager stores long-term knowledge and preferences.

Memory must be namespaced and permissioned.

### Namespaces

```text
/user/preferences/security
/user/preferences/cost
/project/{id}/policy
/project/{id}/context
/session/{id}/audit
/workers/{id}/reputation
```

## 13. Approval Queue

Approval Queue handles user approvals asynchronously.

### Requirements

- approval must not occupy request thread,
- session can enter waiting_approval,
- user can approve later,
- decision resumes session,
- approval result must be audited.

### Approval States

```text
pending
approved
denied
expired
cancelled
```

## 14. Checkpoint Manager

Checkpoint Manager creates recoverable snapshots.

### Checkpoint Content

```text
session state
worker state reference
file diff reference
artifact reference
memory reference
approval state
budget state
```

## 15. Rollback Manager

Rollback Manager restores state when possible.

### Rollback Types

```text
artifact rollback
file diff rollback
session cancellation
policy rollback
memory rollback
```

Initial versions may support file/artifact rollback before full environment rollback.

## 16. Worker Registry

Worker Registry stores Worker capabilities, trust level, cost, and runtime location.

### Fields

```text
workerId
workerType
trustLevel
capabilities
runtimeLocation
adapterType
latencyProfile
costProfile
riskProfile
```

## 17. Session Runtime

Session Runtime manages long-running AI processes.

It must support:

```text
start
pause
resume
cancel
recover
rollback
archive
```

## 18. Performance Requirements

Fast path must not call LLM.

Low-risk action decisions should be under 100ms p95.

Hard deny should be deterministic.

Audit should be durable but optimized.

Approval waits must be asynchronous.

## 19. Local-first Direction

In future architecture, Trust Kernel should run locally where possible.

Local Kernel should handle:

- policy,
- secret detection,
- file/shell/network guards,
- audit,
- context filtering,
- memory index,
- checkpoint.

Cloud may assist with:

- heavy reasoning,
- team sync,
- remote Workers,
- marketplace,
- cross-device access.

## 20. Open Questions

- Which Trust Kernel components can be implemented using current cloud runtime?
- What is the first local component to extract?
- How much sandboxing is required for v1?
- Which existing guardrails can become Policy Engine v1?
- Which existing logs can become Audit Event v1?
