# TrustOS Performance Model

Version: v0.1  
Stage: T100  
Date: 2026-07-02

## 1. Purpose

TrustOS must behave like an OS.

An OS cannot slow down every application.

TrustOS cannot slow down every Worker.

This document defines performance principles, latency budgets, fast paths, slow paths, critical paths, and optimization rules.

## 2. Core Principle

```text
The trust layer must be low-latency on safe paths and strict on dangerous paths.
```

TrustOS should be:

- deterministic by default,
- local-first where possible,
- LLM-assisted only when useful,
- asynchronous where safe,
- blocking only when necessary.

## 3. Path Model

TrustOS decisions are divided into:

```text
Fast Path
Slow Path
Critical Path
Background Path
```

## 4. Fast Path

Fast Path handles low-risk, frequent actions.

Examples:

- file.read within allowed project scope,
- memory.read for non-sensitive user preference,
- model.send with public context,
- artifact.update for draft artifact,
- reading files already approved in current session.

### Requirements

- no LLM call,
- no user approval,
- deterministic decision,
- cache-friendly,
- p95 under 100ms.

## 5. Slow Path

Slow Path handles ambiguous or medium-risk actions.

Examples:

- cross-directory access,
- dependency installation proposal,
- large model context egress,
- unclear task relevance,
- sensitive but possibly necessary context.

### Requirements

- may call Manager model,
- may require risk explanation,
- may request grouped user approval,
- p95 for Manager judgment under 3s where possible.

## 6. Critical Path

Critical Path handles high-risk actions.

Examples:

- secret.access,
- file.delete,
- git.push,
- npm publish,
- production deploy,
- payment action,
- cloud resource mutation,
- email send,
- browser submit with account consequences.

### Requirements

- block or ask,
- no silent execution,
- full audit,
- user-visible explanation,
- performance is secondary to safety.

## 7. Background Path

Background Path handles non-blocking analysis.

Examples:

- summarizing audit logs,
- generating Trust Report,
- updating Worker reputation,
- indexing memory,
- compressing context,
- analyzing failure causes.

### Requirements

- must not block Worker execution,
- should be retryable,
- should be resumable.

## 8. Latency Budget

| Operation | p50 Target | p95 Target | Notes |
|---|---:|---:|---|
| policy match | < 2ms | < 5ms | in-memory/local |
| path allow/deny | < 5ms | < 20ms | glob/rule match |
| small secret scan | < 30ms | < 100ms | small text |
| audit append | < 10ms | < 50ms | durable buffer |
| fast path decision | < 20ms | < 100ms | no LLM |
| risk scoring | < 100ms | < 300ms | local rules |
| Manager LLM judgment | 1s | 3s | only ambiguous cases |
| approval wait | n/a | n/a | async session state |

## 9. Red Lines

TrustOS must not:

- call LLM for every file.read,
- show approval for every low-risk action,
- block Worker on non-critical audit summarization,
- rescan unchanged context repeatedly,
- hold HTTP request open during approval wait,
- make cloud roundtrip for local hard deny policy,
- hide long delays behind vague "thinking" messages.

### 9.1 Loop Separation Performance Red Lines

```text
Manager Loop latency budget is separate from Worker Loop duration.
Worker Loop may run long, but Manager Loop must remain responsive.
Action Loop fast path must not call Manager LLM for low-risk actions.
Approval waits are asynchronous session states, not blocking calls.
```

Additional red lines from Loop Separation:

- Do NOT run long Worker tasks inside the user-facing Manager Loop
- Do NOT stream all Worker events into the main chat
- Do NOT invoke LLM judgment for every ActionLoop decision
- Do NOT let one Session block another Session
- Do NOT store WorkerLoop state only in chat history

## 10. Caching Strategy

TrustOS should use:

- session-scoped permission cache,
- policy snapshot,
- context hash cache,
- secret scan cache,
- Worker reputation cache,
- batch action decision cache,
- artifact diff cache,
- model routing cache.

## 11. Batch Strategy

Workers often perform bursty actions.

TrustOS must support:

- batch file preflight,
- grouped approval,
- risk grouping,
- bulk audit append,
- batch context classification.

Example:

```text
Worker requests reading 32 files.
30 are within allowed scope.
2 are auth-related.
TrustOS allows 30 and asks/denies 2.
```

## 12. Audit Performance

Audit must be durable but efficient.

Possible strategy:

- critical deny/ask events are written synchronously,
- low-risk allow events may use durable async buffer,
- batch audit insert for high-volume actions,
- Trust Report generated from audit events asynchronously.

## 13. Secret Scan Performance

Secret scanning rules:

- path-based deny is fastest,
- small file content scan inline,
- large files require streaming scan,
- binary files are classified separately,
- scan results cached by content hash,
- cloud upload blocked until scan result available.

## 14. User Attention Performance

User attention is a scarce resource.

Metrics:

```text
approval_interrupt_count
approval_grouping_ratio
auto_allowed_low_risk_ratio
blocked_high_risk_count
time_to_first_trust_event
```

Rules:

- low-risk actions should not interrupt,
- repeated approvals should be remembered when user allows,
- critical actions must interrupt,
- Manager should provide recommendation, not just options.

## 15. Monitoring Metrics

TrustOS should track:

```text
action_decision_p50
action_decision_p95
fast_path_ratio
slow_path_ratio
critical_path_count
llm_judgment_count
approval_wait_count
audit_append_latency
session_resume_success_rate
rollback_success_rate
worker_overhead_ratio
```

## 16. Performance Success Criteria

A good TrustOS experience means:

- normal Worker actions feel nearly as fast as direct execution,
- risky actions are meaningfully controlled,
- user is not spammed,
- long tasks remain responsive,
- audit and report generation do not block work,
- trust overhead is measurable and bounded.
