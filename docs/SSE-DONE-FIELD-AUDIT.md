# SSE Done Event Field Audit — Sprint 67P

**日期**: 2026-05-20
**Sprint**: 67P
**目的**: 确认 SSE done 事件字段分布，消除隐性重复，记录消费者视角

---

## 1. SSE Done 事件完整结构

```typescript
{
  type: "done",
  stream: "✅ 完成",
  routing_layer: "L0",
  task_id: "archive-xxx",
  artifactMeta: ArtifactMeta | null,
  meta: { origin: "system", contentKind: "status" },

  // ── Ledger（完整请求账本）────────────────────────────────
  ledger: {
    traceId, sessionId, userId,
    policyRoute, managerLlmBypassed, bypassReason,
    totalLatencyMs, totalModelCalls,
    securityScope: { ... },

    // Sprint 62P
    patch?: {
      attempted: boolean;
      applied: boolean;
      fallbackToFullRewrite: boolean;
      sourceBytes: number;
      outputBytes: number;
    },

    // Sprint 63P
    localManager?: {
      enabled, mode, policyRoute,
      managerLlmRequired, managerLlmBypassed, nextAction,
      patchFirstEligible?: boolean,
      patchFirstBefore?: boolean,          // S67P
      patchFirstDegradedByWarning?: boolean, // S67P
      patchFirstDowngradedByQuality?: boolean,
      decisionMs,
    },

    // Sprint 64P
    budget?: {
      enabled, action, reason,
      estimatedInputTokens, estimatedOutputTokens,
      estimatedCostUsd, pricingKnown,
      requestBudgetUsd, selectedModel,
      downgraded, preferPatch, requiresUserConfirm, blocked,
    },

    // Sprint 66P
    qualityRouting?: {
      enabled, source, lastScore,
      decision: QualityRoutingDecision,
      reason, decisionMs,
    },

    // ...
    entries: CallLedgerEntry[],
  },

  // ── 顶层字段（快捷访问 / 即时展示）───────────────────────
  contextPackage: ContextPackageV1 | null,  // S61P
  budget: RequestLedger.budget | null,      // S64P
  verification: VerificationLedgerEntry | null,  // S65P
  qualityRouting: RequestLedger.qualityRouting | null, // S66P
}
```

---

## 2. 字段位置矩阵

| 字段 | 顶层 (done.xxx) | ledger 内 (done.ledger.xxx) | 说明 |
|---|---|---|---|
| `policyRoute` | ❌ | ✅ | 仅 ledger |
| `patch` | ❌ | ✅ | 仅 ledger |
| `localManager` | ❌ | ✅ | 仅 ledger |
| `budget` | ✅ | ✅ | **双位置**：顶层快捷访问 + ledger 归档 |
| `qualityRouting` | ✅ | ✅ | **双位置**：顶层快捷访问 + ledger 归档 |
| `verification` | ✅ | ❌ | **仅顶层** |
| `contextPackage` | ✅ | ❌ | 仅顶层（ledger 有 contextPackageExtract） |
| `entries` (CallLedgerEntry[]) | ❌ | ✅ | 仅 ledger |

---

## 3. 双位置字段语义确认

### 3.1 `budget`（双位置）

| 位置 | 消费者 | 用途 |
|---|---|---|
| `done.budget` | SSE 即时消费（前端 / proof script） | 快速读取当前请求的预算决策 |
| `done.ledger.budget` | 账本归档（离线分析 / benchmark） | 持久化记录，包含完整字段 |

**结论**: 保留双位置。`done.budget` = 即时快捷路径，`done.ledger.budget` = 归档路径。

### 3.2 `qualityRouting`（双位置）

| 位置 | 消费者 | 用途 |
|---|---|---|
| `done.qualityRouting` | SSE 即时消费（前端 / proof script） | 快速读取当前轮的 quality routing 决策 |
| `done.ledger.qualityRouting` | 账本归档（离线分析 / benchmark） | 持久化记录 |

**结论**: 保留双位置。

### 3.3 `verification`（仅顶层）

| 位置 | 消费者 | 用途 |
|---|---|---|
| `done.verification` | SSE 即时消费（前端 / proof script） | 展示 Verifier 结果 |
| `done.ledger.verification` | — | **不存在** |

**原因**: `verification` 在 SSE done 时才有值（Verifier 在 Worker 返回后执行），
不会经过 ledger 构建流程，因此只有顶层字段。

**结论**: 保持仅顶层。

---

## 4. 消费者视角

| 消费者 | 常用字段 | 读取位置 |
|---|---|---|
| 前端 SSE 展示 | `verification`, `qualityRouting`, `budget` | `done.xxx`（顶层） |
| Proof script | `done.ledger.localManager.patchFirstBefore` | `done.ledger.xxx` |
| E2E harness | `done.qualityRouting.decision` | 顶层 |
| 离线分析 | `done.ledger` 全量 | ledger 内 |
| Archive DB | `done.ledger` | ledger 内 |

---

## 5. 修改历史

| 日期 | Sprint | 变更 |
|---|---|---|
| 2026-05-15 | S65P | `verification` 首次加入 SSE done 顶层 |
| 2026-05-19 | S66P | `qualityRouting` 加入 SSE done 顶层 + ledger |
| 2026-05-20 | S67P | `patchFirstBefore`, `patchFirstDegradedByWarning` 加入 `done.ledger.localManager` |

---

## 6. 设计原则

> **原则**: 账本核心字段（ledger 内）保证归档完整性；高频消费字段额外在顶层暴露快捷访问路径。

- `budget` / `qualityRouting` 两处都有 → 有归档需求 + 有即时展示需求
- `verification` 仅顶层 → 只有即时展示需求，无独立 ledger key
- `patch` / `localManager` 仅 ledger → 只有归档需求，无即时展示需求
