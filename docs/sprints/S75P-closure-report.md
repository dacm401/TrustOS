# S75P Closure Report — Cycle Runtime V0

**Sprint**: S75P
**PM 签字日期**: 2026-05-20
**Commit**: `daf3790`
**基线**: `origin/master`（远端同步待 GFW 恢复后补推）

---

## 目标回顾

S74P 产出 `ContractVerificationResult.recommendedAction`（accept / revise / rewrite / block / human_review），S75P 的目标是把这个动作接入执行周期，决定是否接受、修订、重写、阻断或上报人工审核。

---

## 交付物

### 1. `src/services/cycle/cycle-runtime.ts`（新建）

**`runCycle()`** — 合约验证-执行循环核心

| 阶段 | 条件 | 行为 |
|------|------|------|
| Cycle 1 | `recommendedAction = accept` | 立即返回，`finalStatus = "accepted"` |
| Cycle 1 | `recommendedAction = block` | 立即阻断，`finalStatus = "blocked"` |
| Cycle 1 | `recommendedAction = human_review` | 立即上报，`finalStatus = "human_review"` |
| Cycle 2+ | `prevAction = revise` | 调用 Worker，`goal = buildRevisionPrompt(...)`，循环继续 |
| Cycle 2+ | `prevAction = rewrite` | 调用 Worker，`goal = originalGoal`，循环继续 |
| — | 超过 `maxCycles` | `finalStatus = "max_cycles_exceeded"` |

**关键设计**：
- `anyRevise` flag：记录是否任何一轮使用了 revise 路径，决定 `finalStatus = "revised"` 还是 `"rewritten"`
- `buildRevisionPrompt()`：将 criterion 级别的失败信息注入 Worker prompt（`[SEVERITY] Criterion ID: reasonCode`）
- `buildCycleAuditExtract()`：Ledger 兼容的摘要输出
- **不变式保护**：`runCycle` 不修改 `qualityRouting.decision`（proof pyramid）

**`CycleAudit` 审计域**：

```typescript
interface CycleAudit {
  taskId: string;
  totalCycles: number;         // 实际运行的 cycle 数
  maxCycles: number;           // budgetPolicy 上限
  finalStatus: "accepted" | "revised" | "rewritten" | "blocked" | "human_review" | "max_cycles_exceeded";
  finalRecommendedAction: RecommendedAction;
  steps: CycleStepAudit[];     // 每轮记录，含 cycleIndex / recommendedAction / workerCalled
  totalMs: number;
}
```

### 2. `src/services/cycle/index.ts`（新建）
Barrel export：`runCycle` + `buildCycleAuditExtract`

### 3. `tests/services/cycle/cycle-runtime-s75p.test.ts`（新建）
**16 tests，16 PASS** ✅

| Test | 路径 | 验证点 |
|------|------|--------|
| T1-1 | accept | 立即返回，finalStatus=accepted |
| T2-1 | block | 立即阻断，finalStatus=blocked |
| T3-1 | human_review | 立即上报，finalStatus=human_review |
| T4-1 | revise | advisory failure → cycle 2 accept → finalStatus=revised，Worker called=1 |
| T4-2 | revise | revision prompt 包含 criterion id、severity（HIGH）、reasonCode（missing_text） |
| T5-1 | rewrite | required failure → Worker(originalGoal)，无 revisionContext |
| T6-1 | maxCycles=2 | 循环至上限后退出 |
| T6-2 | maxCycles=1 | 不重试，finalStatus 反映 cycle 1 结果 |
| T7-1/2/3 | ledger extract | accepted/blocked 字段正确 |
| T8-1/2 | finalVerification | accept/block 填充正确 |
| T9-1 | revision prompt | advisory failure → revision prompt 包含 revision header |
| T10-1 | cycle index | 3 cycles → steps[0]=1, steps[1]=2, steps[2]=3，finalStatus=revised |

### 4. `vitest.s75p.config.ts`（新建）

---

## 调试笔记：测试用例 bug（全部修复）

| Bug | 症状 | 根因 | Fix |
|-----|------|------|-----|
| T4-1 | `callCount=0` | `"Content without IMPORTANT keyword"` 里确实有 "IMPORTANT"（子串匹配） | 改 content 不含关键字 |
| T4-2 | `receivedGoal=''` | `required:true` → rewrite 路径，`goal=originalGoal` 不含 "Revision Request"；且 content 含 "signature" | 改 `required:false`，content 不含 "signature" |
| T9-1 | `receivedGoal=''` | 同 T4-2，`expected="MAGIC_WORD"`，但 content 含该词 | 改 `required:false`，content 不含 "MAGIC_WORD" |
| T10-1 | `callCount=2,finalStatus=max_cycles_exceeded` | criterion 无 `expected` → 只检查非空，内容直接 pass；closure 共享 bug | 加 `expected:"REQUIRED_TOKEN"`，用对象 ref 共享 state |
| T4-2/T9-1 | assertion 期望 "signature" | `buildRevisionPrompt` 输出 criterion **id**（非 label） | 改断言期望 `qf-1`（id）而非 label |
| cycle-runtime.ts | `finalStatus='rewritten'`（cycle 3 revise） | 条件 `cycleIndex===2 && prevAction==='revise'` 只覆盖 cycle 2 | 新增 `anyRevise` flag 追踪是否用过 revise |

---

## Regression Guard

| Suite | Result |
|-------|--------|
| S75P 单测（vitest.s75p.config.ts） | **16/16 PASS** ✅ |
| 全量单测（vitest.config.ts） | ✅ S75P 相关测试全绿 |
| 预存失败（model-gateway G-06 / S70P D3 / S69P R1a-R1b-R2） | ❌ 与 S75P 无关，历史遗留 |

---

## 已知限制

1. **revisionContext 口径**（S76P 待确认）：revise 路径的 `revisionContext` 当前传 `currentContent`，即当前待修订内容。V0 不对 revision history 做追踪。
2. **SSE cycle 事件**（留 S76P）：Cycle Runtime 目前只在返回时一次性写入 Ledger；不发送中间 SSE cycle 事件。
3. **人工审核队列**（留 S77P）：`human_review` 路径目前只记录状态，不接入实际审核队列。
4. **远端同步**：origin push 因 GFW 阻断，待网络恢复后补推。

---

## 架构链路（与 S72P–S74P 对齐）

```
S72P: TaskContractV0（合同格式，含 criteria[]）
S73P: Structured VerificationCriteria（条款结构定义 + 类型系统）
S74P: Contract-aware Verifier V1（逐条评估，产出 recommendedAction）
S75P: Cycle Runtime V0（recommendedAction → 执行行为，审计回路）
S76P: SSE Cycle Events（中间事件下发）
S77P: Human Review Queue（人工审核接入）
```
