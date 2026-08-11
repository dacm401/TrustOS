# Local-first Hybrid Architecture Plan

Version: v0.1  
Stage: T100  
Date: 2026-07-02

## 1. Purpose

This document defines TrustOS's long-term local-first and cloud-augmented architecture.

Current testing may run Manager and Worker in the cloud.

This should not define the final architecture.

TrustOS should evolve toward:

```text
Local-first trust, cloud-augmented intelligence.
```

## 2. Core Principle

The trust root should be local where possible.

Cloud should provide intelligence, scale, collaboration, and remote Workers.

Cloud should not be the only trust authority.

## 3. Why Local-first Matters

Users need confidence that:

- sensitive files do not leave local machine by default,
- secrets are detected locally,
- policy can be enforced locally,
- audit can be stored locally,
- local tasks can run offline,
- cloud Workers receive only permitted context,
- local compute can be used when available.

## 4. Target Architecture

```text
User
  ↓
Local Manager Workspace (evolved from Manager Shell concept in T100; see S100P for product implementation)
  ↓
Local Trust Kernel
  ↓
Local / Cloud / External Worker Scheduler
  ↓
Managed Local + Cloud Resources
```

## 5. Local Trust Kernel Responsibilities

Local Trust Kernel should handle:

- policy evaluation,
- secret detection,
- file guard,
- shell guard,
- network guard,
- browser guard,
- local audit log,
- local memory index,
- context filtering,
- diff generation,
- checkpoint,
- rollback,
- local model routing,
- offline mode.

## 6. Cloud Responsibilities

Cloud may handle:

- heavy reasoning,
- large context model execution,
- remote Workers,
- team sync,
- cross-device session access,
- organization policies,
- remote audit backup,
- Worker marketplace,
- model marketplace,
- collaboration.

## 7. Hybrid Execution Modes

| Mode | Description | Use Case |
|---|---|---|
| Local-only | Manager, Worker, data all local | sensitive code/documents |
| Local Manager + Cloud Worker | local policy, cloud intelligence | normal professional work |
| Cloud Manager + Local Guard | cloud UX, local enforcement | lightweight client |
| Enterprise Managed | org policy sync, local enforcement | company teams |
| Offline Mode | local-only reduced capability | no network / high privacy |

## 8. Local Manager

Future Manager should be partially or fully local.

Local Manager may use:

- deterministic policy,
- local small model,
- local embedding index,
- local memory,
- cloud fallback when permitted.

## 9. Worker Types

TrustOS should support:

```text
local_worker
cloud_worker
external_worker
human_worker
```

### Local Worker

Best for:

- sensitive files,
- private code,
- offline tasks,
- low-latency operations,
- local automation.

### Cloud Worker

Best for:

- heavy reasoning,
- large models,
- multimodal tasks,
- large search,
- expensive planning.

### External Worker

Examples:

- Claude Code,
- Cursor,
- OpenClaw,
- browser agents,
- enterprise internal agents.

## 10. Data Routing Rules

Suggested default:

| Data Classification | Default Route |
|---|---|
| public | local or cloud |
| project_internal | authorized cloud or local |
| sensitive | local first, cloud only with redaction/approval |
| secret | local only, never sent |
| regulated | local or enterprise-approved only |

## 11. Local Daemon

A future Local TrustOS Daemon may provide:

- file proxy,
- shell proxy,
- network proxy,
- browser profile isolation,
- local audit DB,
- policy runtime,
- local Worker management,
- MCP server,
- model router.

## 12. Migration Path

### Phase 1

Cloud runtime with clear architecture.

### Phase 2

Action Protocol for internal Workers.

### Phase 3

Tool Proxy and MCP adapter.

### Phase 4

Local policy evaluator and secret scanner.

### Phase 5

Local daemon prototype.

### Phase 6

Local-first hybrid runtime.

## 13. Open Questions

- What is the minimum local component that proves local-first trust?
- Should local daemon be desktop app, CLI, background service, or browser extension first?
- How to support Windows/macOS/Linux?
- What sandbox level is required for v1?
- How to sync local audit to cloud without leaking sensitive data?
