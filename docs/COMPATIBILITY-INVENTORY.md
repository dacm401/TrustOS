# SmartRouter Pro — 兼容层清点

> 版本：v1.0 | 日期：2026-04-19 | Sprint：39 Card 39-E
> 状态：**冻结 — Sprint 40+ 执行**
> 关联：`SPRINT-39-RUNTIME-VALIDATION-PLAN.md` / `CURRENT-PHASE-DIRECTIVE.md`

---

## 1. 执行原则

> **不删跑不通的代码。只做"安全可延迟"清理。**

Sprint 39 期间：
- Phase 3.0 和旧路径双轨并行，不破坏旧路径
- 所有清理操作延期到 Sprint 40+（Phase 4 启动后）
- 每次清理前必须验证 tsc + vitest

---

## 2. 兼容层全量清点

### 2.1 `delegation_archive` 表

| 属性 | 值 |
|------|-----|
| **表类型** | 遗留表（Phase 3.0 后非权威） |
| **写入路径** | `orchestrator.ts:549` → `DelegationArchiveRepo.create()`（旧 orchestrator 路径） |
| **读取路径** | `chat.ts:316/577` → `DelegationArchiveRepo.hasPending()`（O-007 安抚） |
| **被依赖方** | O-007 安抚功能（`DelegationArchiveRepo.hasPending`） |
| **数据量风险** | 低 — 仅旧路径写入 |
| **Phase 3.0 写入** | ❌ 无（已修复 B39-01） |

**当前状态**：活跃写入中，供 O-007 安抚功能使用。

**→ Sprint 40 行动**：将 O-007 `hasPending` 迁移到 `task_archives` 查询，迁移完成后删除 delegation_archive 写入。

```sql
-- Sprint 40: O-007 迁移 SQL（参考）
SELECT COUNT(*) FROM task_archives
  WHERE user_id = $1 AND session_id = $2
    AND status = 'running' AND state != 'clarifying';
```

---

### 2.2 `execution_results` 表

| 属性 | 值 |
|------|-----|
| **表类型** | 活跃表（EL-003 专用） |
| **写入路径** | `chat.ts:548-559` → `ExecutionResultRepo.save()`（execute 模式） |
| **消费路径** | `chat.ts:472-486` → `ExecutionResultRepo.listByUser()`（RR-003 Planner 上下文） |
| **Phase 3.0 写入** | ❌ 无（execute-worker-loop 不写此表） |
| **结论** | **保留** — EL-003 专用表，非 Phase 3.0 遗留 |

---

### 2.3 `fast_observations` 字段（task_archives）

| 属性 | 值 |
|------|-----|
| **定义位置** | `task-archive-repo.ts:101-111` — `TaskArchiveRepo.appendFastObservation()` |
| **调用方** | **无**（死代码） |
| **表字段** | `task_archives.fast_observations`（JSONB 数组） |
| **B39-06** | 死代码，技术债务 |

**→ Sprint 40 行动**：删除 `TaskArchiveRepo.appendFastObservation` 方法 + `task_archives.fast_observations` 字段（需确认无数据残留后 ALTER TABLE）。

---

### 2.4 旧 SSE 路径（chat.ts）

| 属性 | 值 |
|------|-----|
| **文件** | `chat.ts:569-748` |
| **触发条件** | `body.stream === true && body.use_llm_native_routing !== true` |
| **SSE 事件** | `fast_reply` / `clarifying` / `chunk` / `done` / `error` |
| **主调** | `orchestrator()` → `pollArchiveAndYield()` |
| **Phase 3.0 对应** | `chat.ts:139-217`（`use_llm_native_routing=true` 分支） |

**两路并行现状**：

| 路由开关 | 触发条件 | 路径 | SSE 事件 |
|---------|---------|------|---------|
| `use_llm_native_routing=true` | Manager Decision JSON | llm-native-router.ts → pollArchiveAndYield | `manager_decision` / `clarifying_needed` / `command_issued` / `worker_completed` / `done` |
| `use_llm_native_routing=false` | analyzeAndRoute 评分 | orchestrator.ts → pollArchiveAndYield | `fast_reply` / `clarifying` / `chunk` / `done` / `error` |

**→ Sprint 40 行动**（Phase 4.1 完成后）：
- 旧 SSE 路径降级为 `use_llm_native_routing=false` 时的 fallback
- 确认旧路径仅作为紧急降级路径，不再作为主路由

---

### 2.5 旧路由路径（chat.ts → orchestrator.ts）

| 属性 | 值 |
|------|-----|
| **路径 1** | `chat.ts:310-425` — 普通 HTTP（`execute≠true && stream≠true && use_llm_native_routing≠true`） |
| **路径 2** | `chat.ts:569-748` — SSE 流式（`stream=true && use_llm_native_routing≠true`） |
| **主调函数** | `orchestrator()` — chat.ts:328-337 / 588-598 |
| **向后兼容** | ✅ 保留 — Phase 3.0 双轨过渡期 |
| **Phase 3.0 主路径** | `llm-native-router.ts` — chat.ts:135-307 |

**→ Sprint 41+ 行动**：Phase 4 稳定后，`use_llm_native_routing=false` 路径完全降级为 read-only 兼容模式。

---

### 2.6 `triggerSlowModelBackground` 函数

| 属性 | 值 |
|------|-----|
| **定义位置** | `orchestrator.ts:483-591` |
| **调用方** | `orchestrator.ts:449-456`（旧 orchestrator 路径内） |
| **llm-native-router.ts** | ❌ 已移除调用（`delegate_to_slow` 不再触发） |
| **遗留问题** | `llm-native-router.ts:25` 仍导入 `triggerSlowModelBackground`，但无调用方 |
| **delegation_archive 写入** | `triggerSlowModelBackground` 内 → `DelegationArchiveRepo.create()`（Step 6） |
| **Phase 3.0 写入** | ❌ 无 |

**→ Sprint 40 行动**：
1. 删除 `llm-native-router.ts:25` 的 `triggerSlowModelBackground` 导入（死导入）
2. 确认 `triggerSlowModelBackground` 仅被旧 `orchestrator` 路径调用

---

### 2.7 O-007 安抚功能

| 属性 | 值 |
|------|-----|
| **检测方法** | `DelegationArchiveRepo.hasPending(userId, sessionId)` |
| **调用位置** | `chat.ts:316-326`（普通路径） / `chat.ts:577-586`（SSE 路径） |
| **安抚消息** | 慢模型处理期间用户再发消息时，检测 pending 任务并回复安抚 |
| **Phase 3.0 对应** | Phase 3.0 中 `task_archives` 的 pending 状态可替代 |

**→ Sprint 40 行动**：
1. 将 O-007 迁移到 `task_archives` 查询：
   ```sql
   SELECT COUNT(*) FROM task_archives
     WHERE user_id = $1 AND session_id = $2
       AND status NOT IN ('done', 'failed', 'cancelled');
   ```
2. 迁移验证通过后，删除 `chat.ts` 中的 `DelegationArchiveRepo.hasPending` 调用

---

## 3. 清理路线图

| Sprint | 清理项 | 前提条件 | 风险 |
|--------|--------|---------|------|
| **Sprint 40** | 删除 llm-native-router.ts:25 死导入 | tsc + vitest | 🟢 无风险 |
| **Sprint 40** | 删除 `DelegationArchiveRepo.complete()`（无调用方） | — | 🟢 死方法 |
| **Sprint 40** | B39-06：`TaskArchiveRepo.appendFastObservation` + `fast_observations` 字段 | 确认无数据残留 | 🟡 需 DB migration |
| **Sprint 41** | O-007 迁移到 task_archives，安抚逻辑改写 | Phase 4.1 稳定 | 🟡 需集成测试 |
| **Sprint 41** | O-007 迁移完成后：删除 `delegation_archive` 写入（`orchestrator.ts:548-557`） | O-007 迁移验证通过 | 🔴 需灰度验证 |
| **Sprint 42+** | 旧 SSE 路径降级为 read-only fallback | Phase 4.1+ 稳定运行 | 🔴 需完整回归测试 |

---

## 4. 禁止清理项（Sprint 39 冻结）

以下代码**禁止在 Sprint 39 期间修改**，直到明确替代方案就绪：

| 禁止项 | 理由 |
|--------|------|
| `orchestrator.ts` 函数整体删除 | 旧路径 fallback 需要 |
| `delegation_archive` 表DROP | O-007 依赖，迁移前不可删 |
| `chat.ts:310-425` 旧路径代码 | 双轨过渡期必须保留 |
| `chat.ts:569-748` 旧 SSE 代码 | 同上 |

---

## 5. 死代码清单（待清理）

| 位置 | 类型 | 说明 |
|------|------|------|
| `llm-native-router.ts:25` | 死导入 | `triggerSlowModelBackground` 导入但无调用方 |
| `task-archive-repo.ts:101-111` | 死方法 | `appendFastObservation` 无调用方（B39-06） |
| `repositories.ts:902-907` | 死方法 | `DelegationArchiveRepo.complete()` 无外部调用 |

---

_兼容层清点完成：2026-04-19 | by 蟹小钳 🦀_
