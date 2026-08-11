# TrustOS OS Manifesto

Version: v0.1  
Stage: T100 — OS Reframing & Architecture Planning  
Date: 2026-07-02  
Author: PM Draft

## 1. Why TrustOS Exists

Powerful AI Workers are becoming capable enough to operate over users' files, codebases, browsers, tools, accounts, APIs, and decisions.

But users do not have enough time, attention, or confidence to supervise every action manually.

Without a trusted operating layer, powerful AI Workers create several risks:

- They may access sensitive files or private context.
- They may send confidential data to cloud models.
- They may modify files beyond the intended scope.
- They may run destructive or costly commands.
- They may publish, submit, delete, or purchase without sufficient oversight.
- They may fail in long-running tasks without recoverability.
- They may create fragmented memory, audit, and permission systems across many tools.

TrustOS exists to provide a trusted operating layer between the user and powerful AI Workers.

TrustOS allows strong AI Workers to operate inside user-defined boundaries.

## 2. TrustOS Is Not Another Agent

TrustOS does not aim to be:

- the strongest coding agent,
- the strongest research agent,
- the strongest chat assistant,
- the strongest browser agent,
- or a replacement for Claude Code, Cursor, OpenClaw, ChatGPT, Gemini, or local models.

TrustOS manages strong Workers so that users can use them safely, efficiently, and continuously.

TrustOS is not valuable because it is always the smartest Worker.

TrustOS is valuable because it makes smart Workers manageable.

## 3. Core Thesis

TrustOS is the operating layer for trustworthy AI work.

Its core structure is:

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

TrustOS consists of:

- Trusted Manager
- Trust Kernel
- Worker Runtime
- Managed Resource Layer
- Manager Shell
- Context and Memory Management
- AI Syscall / Action Protocol
- Long-running Session Runtime
- Audit, Checkpoint, and Rollback System

## 4. What Trust Means

Trust means that the user can confidently delegate work to powerful Workers because TrustOS provides:

- permission boundaries,
- data boundaries,
- context boundaries,
- action auditability,
- risk explanation,
- human approval at critical points,
- rollback and recovery,
- memory of user preferences,
- cost and budget control,
- honest disclosure of what is controlled and uncontrolled.

Trust is not a slogan.

Trust must be enforced through architecture, policy, runtime, UI, and audit.

## 5. What OS Means

OS means TrustOS is not merely an app interface.

An OS manages resources, processes, permissions, scheduling, memory, system calls, observability, and recovery.

In the AI era, TrustOS must manage:

- AI Workers as processes,
- sessions as durable execution units,
- context as working memory,
- long-term memory as a cognitive filesystem,
- tools as system calls,
- models as compute devices,
- user attention as a scarce resource,
- policy as permission control,
- audit logs as system logs,
- checkpoints as recoverable snapshots.

TrustOS earns the name OS only if it provides foundational primitives for AI work.

## 6. AI-era Resources

TrustOS manages the following resources:

- models,
- Workers,
- context windows,
- memories,
- files,
- directories,
- shell access,
- browser state,
- network requests,
- cloud APIs,
- accounts,
- secrets,
- artifacts,
- tokens,
- time,
- cost,
- user attention,
- approval capacity,
- session state.

These resources must be scheduled, bounded, audited, and recovered.

## 7. Manager / Worker Model

Manager is the trusted user-side proxy.

Worker is the powerful execution process.

Manager represents the user.

Worker performs delegated execution.

The Manager is responsible for:

- understanding user intent,
- generating Delegation Contracts,
- selecting Workers,
- assigning permissions,
- assigning context,
- assigning budgets,
- supervising Worker Actions,
- allowing low-risk actions,
- denying out-of-bound actions,
- asking the user for critical approvals,
- explaining risk,
- generating Trust Reports,
- updating memory and policy.

The Worker is responsible for:

- executing delegated work,
- requesting controlled actions,
- reporting progress,
- producing artifacts,
- respecting Manager decisions.

## 8. Trust Kernel

The Trust Kernel is the enforcement layer of TrustOS.

It must not rely solely on LLM judgment.

The Trust Kernel enforces:

- hard policies,
- Delegation Contracts,
- action guards,
- sensitive data boundaries,
- context routing,
- audit logs,
- budget limits,
- approvals,
- checkpoints,
- rollback rules,
- Worker trust levels.

Hard boundaries must be deterministic.

LLMs may assist in explanation, classification, and planning, but must not override hard deny rules.

## 9. AI Syscall Layer

Workers access resources through Action Requests.

Examples:

- file.read
- file.write
- file.delete
- shell.exec
- network.request
- browser.action
- model.send
- memory.read
- memory.write
- artifact.create
- artifact.commit
- dependency.install
- git.operation
- cloud.operation
- secret.access

This is the AI-era equivalent of system calls.

A Worker should not directly access sensitive resources without passing through TrustOS controls.

## 10. Performance Principle

TrustOS must not become a bottleneck.

The trust layer must be:

- fast on safe paths,
- strict on dangerous paths,
- mostly deterministic,
- local-first where possible,
- asynchronous where safe,
- blocking only where necessary.

Low-risk actions should use fast path.

High-risk actions should be blocked or require explicit approval.

LLM judgment must not be used for every action.

User approval must not be requested for every low-risk operation.

## 11. Long-running Session Principle

AI tasks are durable sessions, not HTTP requests.

A TrustOS Session must support:

- start,
- pause,
- resume,
- cancel,
- inspect,
- approve,
- reject,
- checkpoint,
- rollback,
- recover,
- archive.

A long-running AI task must survive:

- page refresh,
- worker timeout,
- approval delay,
- partial failure,
- model failure,
- network interruption.

## 12. Local-first Principle

Trust root should be local where possible.

Cloud should provide intelligence and scale, not become the only trust authority.

Local TrustOS components should eventually handle:

- policy evaluation,
- secret detection,
- local audit,
- context filtering,
- file diff,
- snapshot,
- local memory index,
- sandbox controls,
- local model routing.

Cloud components may provide:

- heavy reasoning,
- large model execution,
- team sync,
- cross-device sessions,
- remote Workers,
- marketplace,
- organization policy sync.

## 13. External Worker Principle

TrustOS should collaborate with strong Workers, not replace them.

External Workers may include:

- Claude Code,
- Cursor Agent,
- OpenClaw,
- ChatGPT-style agents,
- local models,
- browser agents,
- enterprise internal agents,
- human expert Workers.

TrustOS should expose controlled interfaces:

- Action Protocol,
- Tool Proxy,
- MCP Server,
- Worker Adapter SDK,
- Capability Registry,
- Audit Event Schema.

## 14. Product Experience Principle

Users should feel:

- The Manager stands on my side.
- The Worker is powerful but bounded.
- Normal work is fast.
- Risky actions are explained.
- Critical actions require my approval.
- Low-risk actions do not bother me.
- Everything important is auditable.
- Mistakes can be recovered.
- My preferences are remembered.
- I understand what TrustOS can and cannot control.

## 15. Non-goals

TrustOS is not:

- a ChatGPT clone,
- a generic agent app,
- a web research app,
- a pure security scanner,
- a pure admin dashboard,
- a model provider replacement,
- a cloud-only automation tool,
- a demo-first agent toy.

## 16. Roadmap Principle

T100 defines the OS architecture.

After T100:

- S100P: Manager Shell v1 — Make the Manager Visible
- S101P: AI Syscall v1 — Controlled Worker Actions
- S102P: Durable Session Runtime
- S103P: Local Trust Kernel Prototype
- S104P: External Worker Integration
- S105P: Hybrid TrustOS Runtime

The project must not return to feature-first development until the OS primitives are clear.

## 17. Final Statement

TrustOS turns powerful AI Workers from uncontrolled black-box tools into manageable AI processes operating inside user-defined boundaries.

PC OS manages applications and hardware.

Cloud OS manages services and infrastructure.

TrustOS manages AI Workers, context, memory, tools, models, permissions, attention, and long-running work.

TrustOS is the operating layer for trustworthy AI work.
