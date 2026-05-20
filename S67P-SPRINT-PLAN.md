# Sprint 67P: Quality Ledger Hardening V0

**目标**: 把 S66P 的质量路由从"能用"变成"更可审计"，统一字段语义，消除隐性状态。

---

## 1. 基线现状（从 S66P 继承）

### 1.1 关键发现

| # | 发现 | 状态 | 行动 |
|---|---|---|---|
| F1 | `patchFirstBefore` / `patchFirstDegradedByWarning` **不存在** | ❌ | 新增 |
| F2 | `patchFirstDowngradedByQuality` 逻辑正确，但缺少"降级前"快照 | ⚠️ | 新增 patchFirstBefore |
| F3 | SSE done 顶层 `qualityRouting` 与 `ledger.qualityRouting` 重复 | ⚠️ | 确认语义，文档化 |
| F4 | SSE done 顶层 `verification` 与 `ledger` 内 verification 重复 | ⚠️ | 确认语义，文档化 |
| F5 | SSE done 顶层 `budget` 与 `ledger.budget` 重复 | ⚠️ | 确认语义，文档化 |
| F6 | `targetType` 在 revision+patch path = "patch"，revision+full rewrite = "artifact" | ✅ | 已在 artifact-verifier.ts line 236 实现，无需变更 |
| F7 | `module-level Map` 标注为 cache only，`history meta.verification` 为 durable source | ⚠️ | 文档化（quality-router.ts） |
| F8 | Warning case (`prefer_full_rewrite`) = advisory，不触发 `patchFirstDowngradedByQuality` | ⚠️ | V0 口径需文档化 |

---

## 2. Sprint 目标

### 2.1 核心目标

S67P 不扩能力，先把 S66P 的质量路由账本语义打磨干净：

```
S66P: 质量路由"能用"
S67P: 质量路由"可审计 + 语义清晰"
```

### 2.2 不做的事

- 不引入新的 LLM 调用
- 不改变 Quality Routing 的 4-tier 决策阈值（0.8 / 0.7 / VF-006）
- 不重构 SSE event 重复字段（顶层 vs ledger 均保留，文档化即可）
- 不引入数据库 schema 变更

---

## 3. 交付物清单

| # | 交付物 | 类型 | 优先级 |
|---|---|---|---|
| D1 | `patchFirstBefore` 新增到 `LocalManagerDecision` + ledger | 类型 + 逻辑 | P0 |
| D2 | `patchFirstDegradedByWarning` 新增（prefer_full_rewrite advisory 语义显式标记） | 类型 + 逻辑 | P0 |
| D3 | SSE done event field audit 文档（重复字段语义确认） | 文档 | P1 |
| D4 | `quality-router.ts` 文档完善（module-level Map cache 边界明确） | 注释 | P1 |
| D5 | `patchFirstBefore/After` E2E proof（2-case） | 测试 | P0 |
| D6 | `prefer_full_rewrite` advisory degraded E2E proof | 测试 | P0 |
| D7 | S67P closure report | 文档 | P0 |

---

## 4. 详细设计

### 4.1 D1: `patchFirstBefore` — 质量路由决策前的 patch-first 初始状态

**动机**：
- 当前只有 `patchFirstDowngradedByQuality`（降级结果），没有"降级前是什么"的快照
- PM 要求固化此字段，用于审计：质量路由是否真的改变了路由行为

**修改点**：

#### 4.1.1 `src/services/manager/local-manager-runtime.ts`

```typescript
// LocalManagerDecision.patchFirstBefore 新增
export interface LocalManagerDecision {
  // ...现有字段...
  patchFirstEligible: boolean;
  /** Sprint 67P: 质量路由决策前，patch-first 初始 eligibility（降级前快照） */
  patchFirstBefore: boolean;
  /** Sprint 67P: prefer_full_rewrite advisory 标记（soft preference，不强制降级） */
  patchFirstDegradedByWarning?: boolean;
  patchFirstDowngradedByQuality?: boolean; // 重命名语义：force/block 强制降级
}

// runLocalManager 逻辑调整
let patchFirstBefore =
  nextAction === "direct_artifact_revision" && !managerLlmRequired;

// 4.1.2 Quality routing 降级逻辑
let patchFirstDowngradedByQuality = false;
let patchFirstDegradedByWarning = false;

if (patchFirstBefore) {
  if (qualityRouting?.decision === "force_full_rewrite" ||
      qualityRouting?.decision === "block_or_full_rewrite") {
    patchFirstEligible = false;
    patchFirstDowngradedByQuality = true;
  } else if (qualityRouting?.decision === "prefer_full_rewrite") {
    // V0: prefer 不强制降级，但标记 advisory
    patchFirstDegradedByWarning = true;
    // patchFirstEligible 保持 true（soft preference）
  }
}
```

**语义澄清**：
- `patchFirstBefore = true` 且 `patchFirstDowngradedByQuality = true` → 初始 eligible，被强制降级
- `patchFirstBefore = true` 且 `patchFirstDegradedByWarning = true` → 初始 eligible，advisory preference（不降级）
- `patchFirstBefore = false` → 初始即 ineligible（revision 不存在 / manager required）
- `patchFirstBefore = true` 且两者皆 false → 全链路 eligible，未触发质量门

#### 4.1.2 `src/types/call-ledger.ts` — LocalManager ledger extract

```typescript
localManager?: {
  // ...现有字段...
  patchFirstEligible?: boolean;
  /** Sprint 67P: 质量路由决策前 patch-first 初始状态 */
  patchFirstBefore?: boolean;
  /** Sprint 67P: prefer_full_rewrite advisory 标记 */
  patchFirstDegradedByWarning?: boolean;
  patchFirstDowngradedByQuality?: boolean;
};
```

#### 4.1.3 `src/services/llm-native-router.ts` — buildRequestLedger

在 `localManagerExtract` 构建处添加：
```typescript
patchFirstBefore: localManagerExtract.patchFirstBefore as boolean | undefined,
patchFirstDegradedByWarning: localManagerExtract.patchFirstDegradedByWarning as boolean | undefined,
```

---

### 4.2 D2: SSE Done Event Field Audit

**当前 SSE done 事件结构**：

```
done.qualityRouting         ← 顶层（chat.ts line 622）
done.ledger.qualityRouting ← ledger 内（RequestLedger.qualityRouting）
done.verification           ← 顶层（chat.ts line 620）
done.budget                ← 顶层（chat.ts line 618）
done.ledger.budget         ← ledger 内
done.ledger.patch          ← ledger 内（patch 路径结果）
done.ledger.localManager   ← ledger 内
```

**审计结论**：

| 字段 | 顶层 | ledger | 消费者用途 | 结论 |
|---|---|---|---|---|
| `qualityRouting` | ✅ | ✅ | 快速诊断 / ledger 归档 | **保留双位置** |
| `verification` | ✅ | ❌ 无独立 key | SSE 即时展示 | **仅顶层** |
| `budget` | ✅ | ✅ | 快速诊断 / ledger 归档 | **保留双位置** |
| `patch` | ❌ 无顶层 | ✅ | 归档 | **仅 ledger** |
| `localManager` | ❌ 无顶层 | ✅ | 归档 | **仅 ledger** |

写入文档：`docs/SSE-DONE-FIELD-AUDIT.md`

---

### 4.3 D3: `quality-router.ts` 文档完善

在模块头部注释末尾添加：

```typescript
/**
 * Per-artifact Verification Store（Module-level Map）
 * ==========================================
 * 此 Map 是运行时 cache，仅在当前进程生命周期内有效。
 * 用途：SSE done 后写入，下一轮请求读取（生产流程无持久化 history.verification）。
 *
 * 重要：replay / SSR / 跨进程场景必须使用 history meta.verification 作为 durable source。
 * 查看：extractLastVerificationFromHistory() 优先顺序。
 *
 * Durable source: history[role=assistant][meta.verification]
 * Runtime cache:  module-level Map<string, VerificationLedgerEntry>
 */
```

---

## 5. E2E Proof 设计

### 5.1 Case P1: `patchFirstBefore` = true, `patchFirstDowngradedByQuality` = true

**注入**: `verification.passed=true, score=0.4, issues=[VF-001]`
**期望**:
- `patchFirstBefore = true`（初始 eligible）
- `patchFirstDowngradedByQuality = true`（被 force_full_rewrite 强制降级）
- `patchFirstEligible = false`（最终结果）
- `qualityRouting.decision = force_full_rewrite`

### 5.2 Case P2: `patchFirstBefore` = true, `patchFirstDegradedByWarning` = true, `patchFirstDowngradedByQuality` = false

**注入**: `verification.passed=true, score=0.75, issues=[VF-003]`
**期望**:
- `patchFirstBefore = true`（初始 eligible）
- `patchFirstDegradedByWarning = true`（advisory preference）
- `patchFirstDowngradedByQuality = false`（不强制降级）
- `patchFirstEligible = true`（V0 保持 eligible）
- `qualityRouting.decision = prefer_full_rewrite`

### 5.3 Case P3: `patchFirstBefore` = false（初始 ineligible）

**注入**: `verification.passed=true, score=0.9, issues=[]`，但 `activeArtifact = null`（revision 不存在）
**期望**:
- `patchFirstBefore = false`（初始 ineligible）
- `patchFirstDowngradedByQuality = false`
- `patchFirstDegradedByWarning = false`

---

## 6. 测试矩阵

| Case | Score | Decision | patchFirstBefore | patchFirstDowngradedByQuality | patchFirstDegradedByWarning | Status |
|---|---|---|---|---|---|---|
| P1 (强制降级) | 0.4 | force_full_rewrite | true | true | false | — |
| P2 (advisory) | 0.75 | prefer_full_rewrite | true | false | true | — |
| P3 (初始 ineligible) | 0.9 | allow_patch_first | false | false | false | — |
| Good (继承 S66P) | 0.9 | allow_patch_first | true | false | false | ✅ |
| Bad (继承 S66P) | 0.4 | force_full_rewrite | true | true | false | ✅ |
| Security (继承 S66P) | 0.1 | block_or_full_rewrite | true | true | false | ✅ |

---

## 7. 架构链路（S67P 后）

```
User Request
  ↓
Policy-first Router
  ↓
Local Manager / Manager Bypass
  ↓
ContextPackage
  ↓
BudgetPreflight
  ↓
Patch-first Worker / Artifact Create
  ↓
Verifier V0
  ↓
Quality-aware Routing Signal
  ↓
Archive / Ledger / SSE done
       ↕
  patchFirstBefore（快照） + patchFirstDowngradedByQuality（结果）
```

**新增可审计字段**：
- `patchFirstBefore`：质量路由决策前的初始状态
- `patchFirstDegradedByWarning`：advisory preference 显式标记
- `patchFirstDowngradedByQuality`：强制降级标记

---

## 8. 预计工作量

| 交付物 | 文件数 | 预计行数 |
|---|---|---|
| D1 类型 + 逻辑修改 | 3 | ~40 |
| D2 E2E proof | 1 | ~120 |
| D3 文档 | 1 | ~60 |
| D4 注释 | 1 | ~15 |
| 测试 + 验证 | 2 | ~40 |
| **总计** | ~8 | ~275 |

---

## 9. PM Sign-off Checklist（关闭条件）

- [ ] D1: `patchFirstBefore` + `patchFirstDegradedByWarning` 实现
- [ ] D2: E2E proof 3/3 PASS
- [ ] D3: SSE field audit 文档完成
- [ ] D4: `quality-router.ts` 注释完善
- [ ] `prefer_full_rewrite` advisory 语义已文档化
- [ ] `origin/master` 已推送
- [ ] 无"待验证"条目
- [ ] PM 签字验收
