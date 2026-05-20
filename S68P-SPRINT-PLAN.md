# Sprint 68P: Patch-first Final State Ledger V0

**目标**: 将 `patchFirstAfter`（最终状态）显式化为 ledger 字段，并将 patch-first 质量信号从 `localManager.*` 归位到 `qualityRouting.patchQuality.*`，与质量路由决策同域。

---

## 1. 基线现状（从 S67P 继承）

### 1.1 S67P 已实现的字段

| 字段 | 位置 | 状态 |
|---|---|---|
| `patchFirstBefore` | `localManager.patchFirstBefore` | ✅ S67P |
| `patchFirstDegradedByWarning` | `localManager.patchFirstDegradedByWarning` | ✅ S67P |
| `patchFirstDowngradedByQuality` | `localManager.patchFirstDowngradedByQuality` | ✅ S67P |
| `patchFirstEligible` | `localManager.patchFirstEligible`（final） | ✅ S67P |
| `effectivePatchFirstEligible` | **不存在** | ❌ 待 S68P |
| `patchFirstAfter` | **不存在** | ❌ 待 S68P |

### 1.2 架构问题（需 S68P 修正）

**问题 P1: patch-first 质量信号散在 `localManager.*`，不在 `qualityRouting.*`**
- `patchFirstBefore`、`patchFirstDegradedByWarning`、`patchFirstDowngradedByQuality` 是 quality routing 的输出
- 但它们目前在 `localManager` 里，与 quality 决策域不一致
- `qualityRouting` 是质量信号的权威来源，`localManager` 不应该持有质量信号

**问题 P2: `patchFirstAfter` / `effectivePatchFirstEligible` 未显式化**
- 当前 `patchFirstEligible`（final）存在于 `localManager.patchFirstEligible`
- 但没有对应 `patchFirstBefore` 配套的 `patchFirstAfter` 字段
- PM 无法直接查询"最终 patch-first 是否启用"，必须从 flags 组合推导

**问题 P3: advisory 字段命名可能误导**
- `patchFirstDegradedByWarning` 名字带 "Degraded"，但 advisory 不等同于 disabled
- S67P 文档化了语义，但字段名仍有歧义风险

### 1.3 S67P known limitations（接续）

| Limitation | 归属 | S68P 处置 |
|---|---|---|
| `patchFirstAfter` 未持久化 | S67P | ✅ S68P 新增 `effectivePatchFirstEligible` |
| Warning advisory 字段名歧义 | S67P | ✅ S68P 重命名为 `patchFirstWarningAdvisory` |
| patch-first 质量信号在 `localManager` | S67P | ✅ S68P 归位到 `qualityRouting.patchQuality` |
| degraded path regression tests | S67P | ✅ S68P 补 regression tests |

---

## 2. Sprint 目标

```
S67P: patch-first 质量信号可审计（before + flags）
S68P: patch-first 最终状态显式化 + 质量信号归位
```

### 2.1 核心交付

1. **新增 `effectivePatchFirstEligible`**（显式 patch-first 最终状态 = `patchFirstAfter`）
2. **将 patch-first 质量信号归入 `qualityRouting.patchQuality`**（before / warning advisory / hard downgrade）
3. **向后兼容 `localManager.*` 字段**（S68P 保留，S68P 之后可废弃）
4. **补 degraded path regression tests**
5. **S68P closure report**

### 2.2 不做的事

- 不改变 4-tier quality routing 决策阈值
- 不引入新的 LLM 调用
- 不改变 SSE done 顶层响应结构（只扩展，不破坏）
- 不废弃 `localManager.patchFirstEligible`（向后兼容）

---

## 3. 详细设计

### 3.1 D1: `effectivePatchFirstEligible` — 显式 patch-first 最终状态

**动机**：
- S67P 只能推导：组合 `patchFirstBefore` + `patchFirstDowngradedByQuality` + `patchFirstDegradedByWarning` 可推断 after 状态
- S68P 把推导结果显式化为 `effectivePatchFirstEligible`，消除任何组合推导需求
- `effectivePatchFirstEligible` = `patchFirstAfter` 的等价实现

**修改点**：

#### 3.1.1 `src/services/manager/local-manager-runtime.ts`

```typescript
// LocalManagerDecision — 新增字段
export interface LocalManagerDecision {
  // ...现有字段...
  patchFirstEligible: boolean;         // S63P：最终 eligibility（含质量降级）
  /** Sprint 68P: 显式 patch-first 最终状态（等同于 patchFirstAfter） */
  effectivePatchFirstEligible: boolean;
  /** Sprint 68P: 质量路由决策前 patch-first 初始状态 */
  patchFirstBefore: boolean;
  patchFirstWarningAdvisory?: boolean;   // S68P: 重命名 patchFirstDegradedByWarning
  patchFirstHardDowngrade?: boolean;     // S68P: 重命名 patchFirstDowngradedByQuality
}

// patchFirstBefore 逻辑保持不变

// S68P: 计算 effectivePatchFirstEligible（显式最终状态）
let effectivePatchFirstEligible = patchFirstEligible; // 由降级逻辑已决定

return {
  // ...现有字段...
  patchFirstEligible,
  effectivePatchFirstEligible,   // S68P: 显式 after
  patchFirstBefore,
  patchFirstWarningAdvisory: patchFirstDegradedByWarning,  // S68P: 别名
  patchFirstHardDowngrade: patchFirstDowngradedByQuality,   // S68P: 别名
  // ...现有字段...
};
```

**语义澄清**：
- `effectivePatchFirstEligible = patchFirstEligible`（两者等价）
- S68P 同时保留两者：`patchFirstEligible` 为历史兼容，`effectivePatchFirstEligible` 为显式语义
- `effectivePatchFirstEligible = patchFirstBefore`（无降级时）
- `effectivePatchFirstEligible = false`（hard downgrade 时）
- `effectivePatchFirstEligible = true`（warning advisory 时，V0 advisory 不阻断）

#### 3.1.2 `src/types/call-ledger.ts` — ledger schema 扩展

```typescript
export interface QualityRoutingLedgerEntry {
  enabled: boolean;
  source: "last_verification" | "no_prior_verification" | "disabled";
  lastScore: number | null;
  decision: "allow_patch_first" | "prefer_full_rewrite" | "force_full_rewrite" | "block_or_full_rewrite";
  reason: string;
  decisionMs: number;
  /** Sprint 68P: patch-first 质量信号包 */
  patchQuality?: {
    /** 质量路由决策前，patch-first 初始 eligibility */
    before: boolean;
    /** 质量路由决策后，patch-first 最终 eligibility（显式 after 状态） */
    after: boolean;
    /** advisory warning 标记（soft preference，不强制降级） */
    warningAdvisory?: boolean;
    /** hard downgrade 标记（force/block 强制降级） */
    hardDowngrade?: boolean;
    /** 降级原因（可读） */
    degradeReason?: string;
  };
}

// localManager 保留旧字段（向后兼容），但 patchQuality 质量信号归位到 qualityRouting
```

#### 3.1.3 `src/services/llm-native-router.ts` — ledger 构建

在 `buildRequestLedger()` 中，`qualityRoutingDecision` 注入 `patchQuality`：

```typescript
// qualityRoutingDecision → patchQuality 注入
if (qualityRoutingDecision) {
  const lm = localManagerExtract;
  ledger.qualityRouting = {
    enabled: qualityRoutingDecision.enabled,
    source: qualityRoutingDecision.source,
    lastScore: qualityRoutingDecision.lastScore,
    decision: qualityRoutingDecision.decision,
    reason: qualityRoutingDecision.reason,
    decisionMs: qualityRoutingDecision.decisionMs,
    // S68P: patch-first 质量信号归位到 qualityRouting
    patchQuality: {
      before: lm.patchFirstBefore as boolean,
      after: lm.effectivePatchFirstEligible as boolean,
      warningAdvisory: lm.patchFirstWarningAdvisory as boolean | undefined,
      hardDowngrade: lm.patchFirstHardDowngrade as boolean | undefined,
      degradeReason: lm.patchFirstEligible !== lm.patchFirstBefore
        ? `quality downgrade: ${qualityRoutingDecision.decision}`
        : lm.patchFirstWarningAdvisory
          ? `advisory warning: ${qualityRoutingDecision.decision}`
          : undefined,
    },
  };
}

// localManagerExtract 保留旧字段（向后兼容）
```

---

### 3.2 D2: 向后兼容与迁移策略

**向后兼容原则**：
- `localManager.patchFirstEligible` ✅ 保留（S67P 已有）
- `localManager.patchFirstBefore` ✅ 保留（S67P 已有）
- `localManager.patchFirstDegradedByWarning` ✅ 保留（别名）
- `localManager.patchFirstDowngradedByQuality` ✅ 保留（别名）
- `localManager.effectivePatchFirstEligible` ✅ 新增（S68P）

**质量信号双写**：
- `qualityRouting.patchQuality` ✅ S68P 新增（权威域）
- `localManager.patchFirstWarningAdvisory` ✅ S68P 新增（别名）
- `localManager.patchFirstHardDowngrade` ✅ S68P 新增（别名）

**S89P 可选废弃路径**（非 S68P 范围）：
- `localManager.patchFirstWarningAdvisory` / `patchFirstHardDowngrade` → 迁移到 `qualityRouting.patchQuality`
- `localManager.patchFirstDegradedByWarning` / `patchFirstDowngradedByQuality` → 废弃

---

### 3.3 D3: Regression Tests — Degraded Path Coverage

**背景**：S67P 的 6 个 E2E case 覆盖了 happy path 和 degraded path 的 runtime proof，但缺少单元级别的 degraded path regression tests。

**目标**：在 `quality-router.test.ts` 中新增 3 个 degraded path 回归 case：

```typescript
describe("Quality Router — Degraded Path Regression (S68P)", () => {
  it("C7: Warning advisory → effectiveAfter=true, warningAdvisory=true", () => {
    // score=0.75 → prefer_full_rewrite
    // expect: patchQuality.before=true, after=true, warningAdvisory=true
  });

  it("C8: Bad quality hard downgrade → effectiveAfter=false, hardDowngrade=true", () => {
    // score=0.4 → force_full_rewrite
    // expect: patchQuality.before=true, after=false, hardDowngrade=true
  });

  it("C9: Security issue hard downgrade → effectiveAfter=false, hardDowngrade=true", () => {
    // VF-006 → block_or_full_rewrite
    // expect: patchQuality.before=true, after=false, hardDowngrade=true
  });
});
```

**S68P 测试矩阵**：

| Case | 覆盖 | Score/Input | Decision | before | after | warningAdvisory | hardDowngrade |
|---|---|---|---|---|---|---|---|
| C7 | advisory | 0.75 | prefer_full_rewrite | true | true | true | false |
| C8 | hard downgrade | 0.4 | force_full_rewrite | true | false | false | true |
| C9 | security | VF-006 | block_or_full_rewrite | true | false | false | true |
| C10 | initial ineligible | null/no-artifact | allow_patch_first | false | false | false | false |

---

## 4. E2E Proof 设计

S68P E2E 在 S67P 6-case 基础上新增 2-case：

| Case | 验证目标 | Input | Expected | PASS |
|---|---|---|---|---:|
| E7 | `qualityRouting.patchQuality.after` 显式化 | Bad quality | `patchQuality.after=false` | 待验证 |
| E8 | `qualityRouting.patchQuality.warningAdvisory` 归位 | Warning score | `patchQuality.warningAdvisory=true` | 待验证 |

---

## 5. 交付物清单

| # | 交付物 | 类型 | 优先级 |
|---|---|---|---|
| D1 | `effectivePatchFirstEligible` + 别名字段新增 | 类型 + 逻辑 | P0 |
| D2 | `qualityRouting.patchQuality` schema + 注入 | 类型 + 逻辑 | P0 |
| D3 | Degraded path regression tests（4-case） | 测试 | P0 |
| D4 | E2E E7/E8 验证 | 测试 | P0 |
| D5 | S68P closure report | 文档 | P0 |

---

## 6. 预计工作量

| 交付物 | 文件数 | 预计行数 |
|---|---|---|
| D1 类型 + 逻辑修改 | 2 | ~60 |
| D2 schema + 注入 | 2 | ~80 |
| D3 regression tests | 1 | ~100 |
| D4 E2E proof | 1 | ~60 |
| D5 closure report | 1 | ~120 |
| **总计** | ~7 | ~420 |

---

## 7. 架构链路（S68P 后）

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
Quality Router
  ↓
  qualityRouting.patchQuality:
    before (初始 eligibility)
    after  (最终 eligibility) ← S68P 显式化
    warningAdvisory / hardDowngrade ← S68P 归位
  ↓
Archive / Ledger / SSE done
```

---

## 8. PM Sign-off Checklist（关闭条件）

- [ ] D1: `effectivePatchFirstEligible` 实现并进入 ledger
- [ ] D2: `qualityRouting.patchQuality` schema + 注入完整
- [ ] D3: degraded path regression 4-case PASS
- [ ] D4: E2E E7/E8 PASS
- [ ] `localManager.*` 旧字段保持向后兼容
- [ ] `origin/master` 已推送（三端同步）
- [ ] 无"待验证"条目
- [ ] PM 签字验收
