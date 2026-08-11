# TrustOS OS Primitives

Version: v0.1  
Stage: T100  
Date: 2026-07-02

## 1. Purpose

This document defines the core OS primitives of TrustOS.

These primitives provide a shared language for product, architecture, database design, API design, frontend design, Worker integration, and future local runtime development.

TrustOS must not be designed as a list of features.

TrustOS must be designed around stable primitives.

## 2. Primitive Overview

| Primitive | Meaning |
|---|---|
| User | Owner of intent, authority, preference, and responsibility |
| Manager | Trusted user-side proxy and scheduler |
| Worker | AI execution process |
| ManagerLoop | Fast user-facing control loop |
| WorkerLoop | Delegated long-running execution loop |
| ActionLoop | Deterministic tool/resource access loop |
| WorkerEvent | Progress/result/error/artifact update from WorkerLoop |
| SessionEvent | Durable event scoped to one Session |
| Session | Durable AI work process |
| Capability | Declared ability of a Worker |
| Resource | Object accessed or changed by a Worker |
| Action | Controlled request made by a Worker |
| Decision | TrustOS judgment on an Action |
| Policy | Rule defining permission boundary |
| Delegation Contract | Task-specific authority boundary |
| Context | Short-term working memory |
| Memory | Long-term managed knowledge and preference |
| Artifact | Persistent task output |
| Audit Event | Durable record of important behavior |
| Checkpoint | Recoverable state snapshot |
| Budget | Limit on cost, time, token, attention, or risk |
| Trust Report | User-readable execution report |
| ManagerWorkspace | Product surface that separates chat, sessions, and task details |

## 3. User

A User owns goals, authorization, preferences, and responsibility.

### Fields

```text
userId
trustPreferences
riskTolerance
approvalPreferences
memoryNamespace
policyOverrides
createdAt
updatedAt
```

### Responsibilities

The User:

- defines goals,
- grants authority,
- sets preferences,
- approves critical actions,
- owns memory and policy,
- receives Trust Reports.

## 4. Manager

A Manager is the trusted user-side proxy.

It represents the User when delegating work to Workers.

### Fields

```text
managerId
ownerUserId
mode
policyAccess
memoryAccess
decisionAuthority
modelBackend
createdAt
updatedAt
```

### Responsibilities

The Manager:

- understands User intent,
- generates Delegation Contracts,
- selects Workers,
- allocates context,
- allocates budget,
- explains risk,
- manages user attention,
- summarizes results,
- updates memory.

### Non-responsibilities

The Manager must not:

- override hard deny policy,
- hide Worker actions,
- approve critical actions without authority,
- claim control over unmanaged Workers.

## 5. Worker

A Worker is an AI execution process.

A Worker can be internal, local, cloud, external, or human.

### Fields

```text
workerId
workerType
capabilities
trustLevel
runtimeLocation
costProfile
latencyProfile
riskProfile
adapterType
createdAt
updatedAt
```

### Worker Types

```text
internal_llm
local_llm
cloud_llm
external_agent
browser_agent
shell_agent
coding_agent
human_worker
```

### Runtime Locations

```text
local
cloud
external
hybrid
unknown
```

## 6. Worker Trust Level

Worker trust level defines how much TrustOS can control or observe a Worker.

| Level | Name | Meaning |
|---|---|---|
| T0 | Unmanaged | TrustOS cannot control the Worker |
| T1 | Observed | TrustOS can observe partial behavior |
| T2 | Proxied | Worker accesses resources through TrustOS tools |
| T3 | Sandboxed | Worker runs inside controlled environment |
| T4 | Trusted Local | Worker is locally controlled and fully governed |

Product UI must disclose Worker trust level honestly.

## 7. Session

A Session is a durable AI work process.

It is the AI-era equivalent of a process instance.

### Fields

```text
sessionId
ownerUserId
goal
status
managerId
workers
delegationContractId
policySnapshotId
memorySnapshotId
budgetId
createdAt
updatedAt
exitStatus
```

### Status

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

## 7.1 ManagerLoop

ManagerLoop is the fast user-facing control loop that interprets user intent, creates Delegation Contracts, manages approvals, and summarizes Worker execution.

### Characteristics

- Fast and lightweight
- User-facing
- Does NOT perform heavy execution
- Does NOT block for long durations
- Manages user attention and risk explanation

### Responsibilities

- Receive user input
- Understand user goal
- Decide whether to create a Session
- Generate Delegation Contract
- Select / delegate Worker
- Handle critical approvals
- Summarize Worker results
- Generate Trust Report

## 7.2 WorkerLoop

WorkerLoop is the delegated execution loop that performs long-running work under a Delegation Contract.

### Characteristics

- May be slow and long-running
- Pausable, retryable, replaceable
- Does NOT own final authorization
- Runs asynchronously from ManagerLoop

### Responsibilities

- Execute task per Delegation Contract
- Decompose sub-tasks
- Request tool calls via ActionLoop
- Report progress
- Generate final artifacts

## 7.3 ActionLoop

ActionLoop is the deterministic tool/resource access loop that evaluates Worker Action Requests and produces decisions, audit events, and tool results.

### Characteristics

- Deterministic
- High performance
- Auditable
- Avoids LLM usage
- Does NOT chat with users

### Responsibilities

- Receive Worker Action Requests
- Execute policy check
- Execute risk / sensitive / budget check
- Return allow / deny / ask / redact / sandbox / defer
- Call real tools
- Write audit events
- Generate approval requests when needed

## 7.4 WorkerEvent

WorkerEvent is a progress, result, error, or artifact update emitted by WorkerLoop to Session Runtime and surfaced to ManagerLoop as summaries. WorkerEvents are scoped to a Session and must not be streamed directly into the main Manager chat.

## 7.5 SessionEvent

SessionEvent is a durable event associated with one Session, used to avoid mixing multiple task loops in one conversation stream. SessionEvents include contract generation, state transitions, approval requests, and WorkerEvents.

## 7.6 ManagerWorkspace

ManagerWorkspace is the user-facing product surface that represents Loop Separation in UX.

A single chat window forces Manager control, Worker execution, Action decisions, approvals, and multiple delegated tasks into one mixed stream. ManagerWorkspace separates these concerns into distinct panels:

- **Session List**: independent task cards with status, risk, pending approvals
- **Manager Conversation**: user ↔ Manager main chat, carrying only Manager Loop content
- **Session Detail**: task execution details, carrying Worker Loop and Action Events

ManagerWorkspace is the product manifestation of the architectural principle that Manager Loop, Worker Loop, and Action Loop must not share one monolithic interface.

## 8. Capability

Capability describes what a Worker can do.

### Examples

```text
code.edit
code.review
file.read
file.write
shell.exec
browser.operate
web.search
model.reason
image.generate
data.analyze
memory.read
memory.write
```

### Fields

```text
capabilityId
workerId
name
description
riskLevel
requiresProxy
requiresApproval
createdAt
updatedAt
```

## 9. Resource

A Resource is an object accessed or changed by a Worker.

### Resource Types

```text
file
directory
shell
network
browser
model
memory
secret
artifact
git
cloud
account
database
api
```

### Fields

```text
resourceId
type
uri
classification
owner
projectId
sensitivity
createdAt
updatedAt
```

## 10. Action

An Action is a controlled request made by a Worker.

It is the AI-era equivalent of a system call.

### Action Types

```text
file.read
file.write
file.delete
shell.exec
network.request
browser.action
model.send
memory.read
memory.write
artifact.create
artifact.update
artifact.commit
secret.access
dependency.install
git.operation
cloud.operation
```

### Fields

```text
actionId
sessionId
workerId
type
resource
reason
payloadPreview
riskSignals
createdAt
```

## 11. Decision

A Decision is TrustOS's judgment on an Action.

### Decision Types

```text
allow
deny
ask
redact
sandbox
defer
```

### Fields

```text
decisionId
actionId
decision
riskLevel
reasonCode
policyRefs
requiresUser
managerMessage
createdAt
```

### Rule

Hard deny policies must not be overridden by LLM-generated Manager judgment.

## 12. Policy

Policy defines permission boundaries.

### Scope

```text
user
project
organization
session
worker
resource
```

### Fields

```text
policyId
scope
subject
resource
action
effect
conditions
priority
createdBy
createdAt
updatedAt
```

### Effects

```text
allow
deny
ask
redact
sandbox
```

## 13. Delegation Contract

A Delegation Contract defines task-specific authority granted to Workers.

### Fields

```text
contractId
sessionId
goal
allowedActions
deniedActions
approvalRequiredActions
contextScope
budget
successCriteria
reportingRequirements
createdAt
updatedAt
```

### Purpose

The Delegation Contract is the central artifact that turns user intent into bounded Worker authority.

## 14. Context

Context is short-term working memory injected into a Worker.

### Fields

```text
contextId
sessionId
source
classification
contentHash
allowedDestinations
expiry
redactionState
createdAt
updatedAt
```

### Classification

```text
public
project_internal
sensitive
secret
regulated
```

## 15. Memory

Memory is long-term managed knowledge and preference.

Memory is not merely chat history.

### Memory Types

```text
user.preference
project.context
policy.history
worker.reputation
decision.history
artifact.history
incident.history
```

### Namespace Examples

```text
/user/preferences/security
/user/preferences/cost
/project/{id}/policy
/project/{id}/context
/project/{id}/sensitive_paths
/session/{id}/audit
/session/{id}/artifacts
/workers/{id}/reputation
```

## 16. Artifact

Artifact is a persistent task output.

### Types

```text
code_patch
document
report
image
dataset
config
diff
plan
summary
```

### Fields

```text
artifactId
sessionId
type
title
contentRef
version
references
createdBy
createdAt
updatedAt
```

## 17. Audit Event

Audit Event is a durable record of important behavior.

### Fields

```text
eventId
sessionId
actorType
actorId
eventType
resource
decision
riskLevel
summary
rawRef
timestamp
```

### Event Types

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
session.rolled_back
```

## 18. Checkpoint

Checkpoint is a recoverable state snapshot.

### Fields

```text
checkpointId
sessionId
stateHash
fileSnapshotRefs
artifactRefs
memoryRefs
createdAt
```

## 19. Budget

Budget defines limits on resources.

### Budget Types

```text
token
cost
time
user_interruptions
risk
model_calls
network_calls
file_writes
```

### Fields

```text
budgetId
sessionId
maxCostUsd
maxDurationMin
maxTokens
maxUserInterruptions
maxRiskLevel
createdAt
updatedAt
```

## 20. Trust Report

Trust Report is the user-readable summary of a Session.

It should include:

- goal,
- Workers used,
- actions allowed,
- actions denied,
- approvals requested,
- files read,
- files changed,
- context sent,
- sensitive data handling,
- cost,
- duration,
- artifacts,
- rollback availability,
- Manager assessment.

## 21. Design Rule

Every future TrustOS feature must map to one or more OS primitives.

If a feature cannot be mapped to these primitives, it should be treated as non-core until proven otherwise.
