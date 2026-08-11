# Long-running Session Runtime RFC

Version: v0.1  
Stage: T100  
Date: 2026-07-02

## 1. Purpose

TrustOS tasks must be durable AI work processes, not one-off HTTP requests.

This RFC defines the Session Runtime required for long-running, recoverable, auditable AI execution.

## 2. Core Principle

```text
Agent Session = AI Process
```

A Session must survive:

- page refresh,
- network interruption,
- approval delay,
- Worker timeout,
- partial failure,
- model failure,
- user pause,
- system restart.

### 2.1 Session as Loop Boundary

Session Runtime is the boundary that prevents long-running Worker Loop state from being stored inside the Manager chat context.

```text
Manager Loop: short-lived, user-facing, manages delegation and summarization
Worker Loop:  long-running, asynchronous, executes under Delegation Contract
Session Runtime: persists WorkerLoop state, WorkerEvents, ActionRequests, approvals, artifacts, Trust Reports
```

**Constraints**:

- Manager response must not be blocked by long Worker execution
- Approval wait must not hold a request thread
- Worker Events must be scoped to a Session, not streamed into the main chat
- Multiple Sessions isolate their Worker Loops from each other

## 3. Session Responsibilities

A Session stores:

- user goal,
- Manager identity,
- Worker set,
- Delegation Contract,
- policy snapshot,
- memory snapshot,
- context state,
- budget state,
- action history,
- decisions,
- approvals,
- checkpoints,
- artifacts,
- exit status.

## 4. Session State Machine

```text
created
planning
delegating
running
waiting_approval
paused
recovering
completed
failed
cancelled
rolled_back
archived
```

## 5. State Definitions

### created

Session object exists but planning has not started.

### planning

Manager is interpreting user intent and generating Delegation Contract.

### delegating

Manager is selecting Worker and preparing context/budget.

### running

Worker is executing under TrustOS supervision.

### waiting_approval

Session is paused waiting for user approval.

This state must not occupy a request thread.

### paused

User or system has paused the Session.

### recovering

System is recovering from failure or timeout.

### completed

Session reached successful exit.

### failed

Session ended with unrecovered failure.

### cancelled

User or system cancelled the Session.

### rolled_back

Session changes have been rolled back where possible.

### archived

Session is retained for audit/history but no longer active.

## 6. Required Operations

```text
start
pause
resume
cancel
kill
inspect
tail
approve
reject
rollback
change_policy
handoff_worker
archive
```

## 7. Event Model

Sessions should be event-driven.

Core events:

```text
session.created
contract.generated
worker.selected
worker.started
action.requested
decision.made
approval.requested
approval.resolved
action.executed
checkpoint.created
artifact.created
artifact.updated
budget.updated
session.paused
session.resumed
session.completed
session.failed
session.cancelled
session.rolled_back
```

## 8. Data Model Draft

Potential tables:

```text
agent_sessions
delegation_contracts
worker_runs
action_requests
manager_decisions
approval_requests
audit_events
session_checkpoints
session_artifacts
rollback_bundles
session_budgets
manager_messages
session_events
trust_reports
```

## 9. agent_sessions

Suggested fields:

```text
id
user_id
goal
status
manager_id
delegation_contract_id
policy_snapshot_id
memory_snapshot_id
budget_id
created_at
updated_at
completed_at
exit_status
error_summary
```

## 10. worker_runs

Suggested fields:

```text
id
session_id
worker_id
worker_type
trust_level
status
started_at
updated_at
ended_at
heartbeat_at
error_summary
```

## 11. action_requests

Suggested fields:

```text
id
session_id
worker_run_id
action_type
resource_type
resource_uri
reason
payload_preview_ref
risk_signals
status
created_at
```

## 12. manager_decisions

Suggested fields:

```text
id
action_request_id
decision
risk_level
reason_code
policy_refs
requires_user
manager_message
created_at
```

## 13. approval_requests

Suggested fields:

```text
id
session_id
action_request_id
status
risk_level
title
description
manager_recommendation
options
resolved_by
resolved_at
created_at
expires_at
```

## 14. audit_events

Suggested fields:

```text
id
session_id
actor_type
actor_id
event_type
resource_type
resource_uri
decision
risk_level
summary
raw_ref
created_at
```

## 15. session_checkpoints

Suggested fields:

```text
id
session_id
state_hash
file_snapshot_refs
artifact_refs
memory_refs
budget_state_ref
created_at
```

## 16. rollback_bundles

Suggested fields:

```text
id
session_id
checkpoint_id
rollback_type
diff_refs
status
created_at
completed_at
```

## 17. Approval Pause / Resume

When an action requires approval:

```text
1. Worker sends Action Request.
2. Trust Kernel returns ask.
3. Approval Request is created.
4. Session state becomes waiting_approval.
5. Worker run pauses or waits.
6. User approves or denies.
7. Decision is recorded.
8. Session resumes or adapts.
```

## 18. Checkpoint Strategy

Checkpoints should be created:

- before file writes,
- before destructive actions,
- before dependency installation,
- before external publish/deploy,
- at major planning transitions,
- at user-approved milestones.

## 19. Rollback Strategy

Initial rollback can be limited to:

- artifact rollback,
- file diff rollback,
- session cancellation,
- memory update rollback.

Full environment rollback can be future work.

## 20. Worker Heartbeat

Worker heartbeat is required for long-running tasks.

If heartbeat expires:

```text
1. Session enters recovering.
2. Runtime attempts reconnect or restart.
3. If recovery fails, Session enters failed.
4. Trust Report includes failure cause.
```

## 21. Idempotency

Actions must be idempotent where possible.

Action Requests should include stable IDs.

Retries must not duplicate destructive effects.

## 22. manager_messages

Suggested fields:

```text
id
conversation_id
role
content
related_session_id nullable
created_at
```

Notes:

- `related_session_id` links a Manager message to a specific Session when the message is a task summary, approval reminder, or completion notice.
- Messages without a `related_session_id` are general Manager conversation entries.

## 23. session_events

Suggested fields:

```text
id
session_id
type
summary
severity
visibility
raw_ref nullable
created_at
```

`visibility`:

```text
silent_audit
session_timeline
approval_required
manager_chat_summary
trust_report_only
critical_alert
```

Session events are scoped to a single Session and must not be mixed into the global Manager chat stream.

## 24. trust_reports

Suggested fields:

```text
id
session_id
summary
allowed_actions_count
denied_actions_count
approval_count
sensitive_data_summary
artifact_refs
rollback_available
manager_assessment
created_at
```

A Trust Report is generated per completed Session. It is displayed in Session Detail, not as a raw chat message. The Manager Conversation shows only a short summary referencing the report.

## 25. Workflow Engine Consideration

Short-term:

```text
Postgres-backed state machine
```

Medium-term evaluation:

```text
Temporal
Hatchet
BullMQ
pg-boss
```

Selection criteria:

- reliable recovery,
- low operational complexity,
- TypeScript/Node compatibility,
- Postgres compatibility,
- observability,
- cancellation support,
- pause/resume support.

## 26. Success Criteria

Session Runtime v1 succeeds when:

- a task can wait for approval without blocking request thread,
- user can resume after delay,
- audit can reconstruct what happened,
- failed task has clear error summary,
- file/artifact changes can be rolled back where supported,
- Trust Report can be generated from durable events.
