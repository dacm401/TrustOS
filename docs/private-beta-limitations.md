# TrustOS — Private Beta Limitations

```text
Version: v0.3 (TRST-4B)
Date: 2026-08-05
Baseline: TRST-4A SEALED, TRST-4B Streaming Validated
Maturity: Private Beta Candidate
```

---

## What TrustOS Currently Supports

TrustOS is an AI governance observation layer. In Private Beta, it provides:

| Capability | Description |
|---|---|
| **Observation** | Record AI gateway events with hashes and trace labels |
| **Event Hashing** | SHA256 hashes for events, inputs, and outputs |
| **Trace Labeling** | Group events by `trace_id` for correlation |
| **Risk Assessment** | Automated governance signal detection (privacy, operational, evidence-integrity) |
| **Dry-Run Control** | Recommend allow/review actions without blocking or modifying requests |
| **Evidence Bundles** | Privacy-safe evidence export with hashes and metadata |
| **Hash Verification** | Reviewer-side SHA256 verification of output consistency |

---

## What TrustOS Does Not Yet Provide

The following capabilities are **not available** in Private Beta:

| Limitation | Detail |
|---|---|
| **Request Blocking** | Control is dry-run only. No requests are blocked, modified, or remediated. |
| **Authenticated Identity** | `agent_id` is a label, not an authenticated identity. No identity verification is performed. |
| **RBAC / Access Control** | No user roles, permissions, or enterprise access control. |
| **Tenant Isolation** | Single-environment. No multi-tenant data or policy separation. |
| **Durable Compliance Archive** | Events are file-based (`events.jsonl`). No database-backed persistence or long-term retention. |
| **Cryptographic Signing** | Evidence bundles are not signed, notarized, or timestamped. |
| **Legal-Grade Attestation** | Evidence bundles support reviewer-side hash verification, not legal compliance recording. |
| **Production Gateway SLOs** | No availability guarantees, rate limiting, failover, or traffic shaping. |
| **Streaming Support** | Streaming SSE responses are supported and validated for completed streams (TRST-4B). Failed, cancelled, or interrupted streams are recorded without `output_hash` by design. Not production-grade — no delivery guarantee, no chunk-level evidence. |

---

## Key Concepts

### Dry-Run Control

TrustOS recommends actions — allow or review — but **does not enforce them**.

```
dry-run means: no request was blocked, modified, or remediated.
```

Reviewers must independently decide whether to act on recommendations.

### Agent Identity

The `agent_id` field is a **source label** set by the caller (via `x-trustos-agent-id` header or default). It is not:

- An authenticated identity
- Verified by any authority
- Tamper-proof

Use it for trace labeling, not for identity assurance.

### Evidence

Evidence bundles are **privacy-safe by design**:

- **Included**: event hashes, metadata, assessment, dry-run control outcome
- **Excluded**: raw prompts, raw outputs, raw model responses
- **Export**: copy-only (frontend), not persisted by TrustOS backend
- **Verification**: reviewer-side SHA256 hash comparison (requires independent access to original content)

Evidence bundles are **not signed or notarized** compliance records.

---

## Private Beta Operator Notes

> **这些是 Private Beta 运行说明，不是生产部署指南。**

| 事项 | 说明 |
|:---|:---|
| Gateway 运行方式 | `npx tsx --env-file=.env` — 本地开发模式，非生产容器化部署 |
| 事件存储 | 本地文件写入 (`.trustos/events.jsonl`)，采用 JSONL 追加格式；无数据库持久化 |
| 日志轮转 | **当前版本无自动日志轮转**；events.jsonl 会持续增长 |
| 证据持久化 | 证据包由前端复制到剪贴板；TrustOS 后端不做证据持久化 |
| 运行环境 | 应在受控的本地/测试环境中运行；不建议暴露到公网 |
| 会话重置 | 事件文件可在 sessions 之间手动清空 |
| 可用性保障 | **不提供** SLO/SLA；不提供高可用、故障转移或流量整形 |
| 进程管理 | 无 pm2/systemd/Docker 支持；建议在终端窗口手动管理 |

---

## Forbidden Terminology

In all TrustOS documentation, code, and copy, the following wording must **not** appear:

| Forbidden | Allowed Alternative |
|---|---|
| "blocks unsafe requests" | recommends review |
| "enforces policy" | recommends dry-run action |
| "authenticated agent identity" | agent label / source label |
| "tamper-proof evidence" | hash-verifiable evidence |
| "notarized audit trail" | event trace / governance log |
| "legal compliance record" | reviewer evidence bundle |
| "production-grade gateway" | private beta gateway |
| "enterprise-ready RBAC" | not available |
