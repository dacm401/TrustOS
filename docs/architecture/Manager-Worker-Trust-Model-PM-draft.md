# Manager / Worker Trust Model

Version: v0.1  
Stage: T100  
Date: 2026-07-02  
Author: PM Draft

## 1. Purpose

This document defines the trust relationship between User, Manager, Worker, and Trust Kernel.

The central idea:

```text
User owns authority.
Manager represents the User.
Worker executes delegated work.
Trust Kernel enforces boundaries.
```

## 2. Core Relationship

```text
User
  ↕ intent / authority / preferences
Manager
  ↕ delegation / supervision / explanation
Trust Kernel
  ↕ policy / action guard / audit / recovery
Worker
  ↕ controlled actions
Managed Resources
```

The Worker is powerful but not fully trusted.

The Manager is trusted because it represents the User and operates through enforceable Trust Kernel boundaries.

## 3. User

The User provides:

- goal,
- constraints,
- preferences,
- authorization,
- approvals,
- feedback.

The User should not be forced to supervise every low-risk action.

The User should be involved only when risk, ambiguity, or authority requires it.

## 4. Manager

The Manager is the trusted user-side proxy.

It is responsible for:

- interpreting user intent,
- generating Delegation Contracts,
- selecting Workers,
- assigning context,
- assigning budget,
- supervising Worker Actions,
- explaining risk,
- managing user attention,
- generating Trust Reports,
- updating Trust Memory.

## 5. Worker

The Worker is an AI execution process.

A Worker may be:

- powerful,
- fast,
- specialized,
- external,
- cloud-based,
- local,
- partially observable,
- partially controllable.

Therefore, Worker authority must be delegated, limited, and audited.

## 6. Trust Kernel

The Trust Kernel enforces:

- hard deny rules,
- policy hierarchy,
- action decisions,
- audit durability,
- sensitive data boundaries,
- budgets,
- approval states,
- checkpoint and rollback rules.

The Trust Kernel is not merely advisory.

It must be able to block actions.

## 7. Delegation Contract

Before a Worker begins work, the Manager creates a Delegation Contract.

A Delegation Contract includes:

- user goal,
- allowed actions,
- denied actions,
- approval-required actions,
- context scope,
- budget,
- success criteria,
- reporting requirements.

Example:

```json
{
  "goal": "Fix login page UI issue",
  "allowedActions": [
    {
      "action": "file.read",
      "scope": "frontend/src/**"
    },
    {
      "action": "file.write",
      "scope": "frontend/src/app/login/**"
    }
  ],
  "deniedActions": [
    {
      "action": "file.read",
      "scope": ".env*"
    },
    {
      "action": "file.write",
      "scope": "src/auth/**"
    }
  ],
  "approvalRequiredActions": [
    {
      "action": "dependency.install"
    },
    {
      "action": "file.delete"
    }
  ],
  "successCriteria": [
    "Login UI renders correctly",
    "No auth logic changed",
    "Rollback available"
  ]
}
```

## 8. Manager Decision Authority

The Manager may automatically allow:

- low-risk actions within the Delegation Contract,
- actions already covered by user preference,
- repeated actions covered by session-scoped permission,
- harmless reads inside allowed project scope.

The Manager may automatically deny:

- hard policy violations,
- sensitive file access unrelated to task,
- destructive actions outside scope,
- known dangerous commands,
- Worker attempts to bypass TrustOS.

The Manager must ask the User for:

- dependency installation,
- destructive file operations,
- git push / publish / deploy,
- payment or purchase,
- external account action,
- sensitive data egress,
- cloud resource mutation,
- ambiguous high-impact action.

The Manager must not:

- override hard deny policy,
- hide risky Worker behavior,
- approve critical actions without authority,
- pretend an unmanaged Worker is fully controlled.

## 9. Worker Trust Levels

| Level | Name | Meaning | Product Disclosure |
|---|---|---|---|
| T0 | Unmanaged | TrustOS cannot control Worker actions | "Not controlled by TrustOS" |
| T1 | Observed | TrustOS can observe partial behavior | "Partially observed" |
| T2 | Proxied | Worker uses TrustOS tools for resource access | "Managed through proxy" |
| T3 | Sandboxed | Worker runs in a constrained runtime | "Sandboxed" |
| T4 | Trusted Local | Worker is locally controlled by Trust Kernel | "Fully locally governed" |

TrustOS must display Worker trust level honestly.

## 10. Action Decision Flow

```text
Worker requests Action
  ↓
Trust Kernel receives Action Request
  ↓
Policy Engine checks hard policies
  ↓
Delegation Contract check
  ↓
Sensitive Data Guard check
  ↓
Budget check
  ↓
Risk scoring
  ↓
Decision:
  - allow
  - deny
  - ask
  - redact
  - sandbox
  - defer
  ↓
Audit Event appended
  ↓
Worker receives decision
  ↓
User sees relevant events through Manager Shell
```

## 11. Attention Principle

User attention is a scarce resource.

TrustOS must avoid approval fatigue.

Rules:

- low-risk actions should be automatically allowed,
- repeated allowed actions should be cached within session,
- similar actions should be batched,
- only critical actions should interrupt immediately,
- informational events may appear in Decision Feed,
- low-value events may only appear in Trust Report.

## 12. Honesty Principle

TrustOS must clearly distinguish:

- controlled actions,
- observed actions,
- inferred actions,
- unmanaged external behavior.

The product must never imply full control when only partial observation exists.

## 13. Trust Report

At the end of a Session, the Manager produces a Trust Report.

It should answer:

- What was the goal?
- Which Worker did the work?
- What was allowed?
- What was denied?
- What required approval?
- What files were read?
- What files were changed?
- Was sensitive data accessed or sent?
- What artifacts were produced?
- Is rollback available?
- Did the Worker stay within bounds?

## 14. Final Principle

The Manager does not replace the User.

The Manager represents the User.

The Worker does not own authority.

The Worker receives delegated authority.

TrustOS does not depend on trust in the Worker.

TrustOS creates trust through enforceable boundaries.
