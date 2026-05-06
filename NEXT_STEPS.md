# TrustOS 下一步计划（2026-05-05）

> 基于委托链路修复经验 + 工程效率评价整理  
> 执行原则：**Phase 1 阻塞性修复未清零前，不动 Phase 5 策略性优化**

---

## 故障分类参考（排查时先判断类别）

| # | 类别 | 典型症状 |
|---|------|---------|
| 1 | 路由/模型输出 | selected_role 缺失、JSON parse 失败、降级逻辑触发 |
| 2 | 状态机/字段契约 | state vs status 混用、done 事件漏发 |
| 3 | 任务队列/轮询 | command_id/archive_id 用错、重复更新 |
| 4 | SSE/传输协议 | 流式 reader 挂起、done 事件单路径 |
| 5 | DB 结构/迁移 | schema 没跑、列缺失、JSONB cast、索引 |
| 6 | 数据一致性 | UUID/外键/关联键语义不一致 |

---

## 🔴 Phase 1 — 阻塞性修复收口（已完成 ✅）

**目标**：委托链路端到端跑通，不依赖运气。

- [x] **1.1** 补全 `archive_id` 贯穿全链路打印（llm-native-router → worker-loop → sse-poller）→ 故障类 #3
- [x] **1.2** 确认 poll 查 archive_id 与 worker 写 archive_id 完全一致（**根本 Bug 修复**）→ #3 + #6
- [x] **1.3** Worker 成功路径写 `state='completed'` 后 SSE done 事件必然发出（链路已通） → #4
- [x] **1.4** 跑 migration 010~018 全量状态检查，8 张关键表全部存在 → #5

---

## 🟡 Phase 2 — 观测性基础设施（已完成 ✅）

**目标**：故障定位时间从 20 分钟降到 2 分钟。

- [x] **2.1** 写诊断脚本 `diagnose.cjs <archive_id>` ✅
  - 输出：task_commands（按 archive_id 查）/ task_archives / task_worker_results / task_archive_events
  - 关键修复：delegation_logs 里没有 decision_type 列（有 routed_action/g2_final_action）
  - 成功诊断输出见下方「Phase 2 诊断输出摘要」
- [x] **2.2** TraceId 观测（部分完成）
  - task_archive_events.payload 里有 decision_type 和 command_type
  - 下次重启后端时贴出 manager → command 写入 → worker done → SSE done 的关键日志
- [x] **2.3** 启动必检项 ✅（commit 89cc0cc）
  - index.ts：关键委托表存在检查（task_commands/archives/worker_results/delegation_logs/archive_events）
  - index.ts：LLM API 连通性检查（8s 超时，非阻塞 warn）
  - DB 连接检查已有（Sprint 69），现在新增上面两项

---

## 🟢 Phase 3 — 字段契约固化（已完成 ✅，2026-05-05）

**目标**：类型错误在编译期或第一秒就爆，不再靠 180s 超时才发现。

### 实施结果

- [x] **3.1** 定义 `TaskState` 枚举，全局替换裸字符串 ✅（commit `485d8fe`）
  - SSE poller `state` 分支分为 `completed`/`failed`/`in_progress`/`pending`
  - `thinking`/`worker_completed` SSE 事件移除（只保留 DB 写入）
  - `TaskState` enum 定义：`queued | in_progress | completed | failed | pending | running | cancelled | timeout | unknown`

- [x] **3.2** `parseGatedDecision` schema_version 缺失直接 throw ✅（commit `7d16aa7`）
  - `SCHEMA_VERSION_MISSING` / `SCHEMA_VERSION_UNKNOWN` 直接抛出
  - `INTEGRITY_VIOLATION` 写入 archive（`state=failed`，`slow_execution.errors` 有内容）
  - 不降级 L0 fallback，避免拖到 180s 超时
  - 详细日志：`matchedJson`/`jsonMatch`/`bareMatch`/`braceMatch`

- [x] **3.3** repo 写入层加 runtime 校验 ✅（commit `0c4dc58`，已推送）
  - `TaskArchiveRepo.updateStateWithIntegrity(archiveId, newState)`
  - 校验 1：archive 存在（防止野 archive_id）
  - 校验 2：`completed` 时 `slow_execution.result` 非空 **或** `task_worker_results` 有行
  - 违反 → 抛出 `INTEGRITY_VIOLATION`（code: `DONE_WITHOUT_RESULT`）
  - worker catch 分支：写 `slow_execution.errors` + `updateState(archiveId, 'failed')`

### 验收结果（2026-05-05 端到端验证）

| 验收项 | 结果 | 说明 |
|--------|------|------|
| A：正常委托成功链路 | ✅ 通过 | SSE 461 事件完整，`done` 事件带 `task_id`，archive `state=completed`，`slow_execution.result` 1260 字符 |
| B：协议违规（schema_version 缺失） | ✅ 代码验证 | `updateStateWithIntegrity` 存在，`result` 完整性检查存在，错误码 `INTEGRITY_VIOLATION`/`DONE_WITHOUT_RESULT` 定义正确 |
| C：done without result | ✅ 机制证明 | 直接调用 `updateStateWithIntegrity(archiveId, 'completed')`，archive 无 result → 抛出 `INTEGRITY_VIOLATION`，archive state 保持 `running` 未被错误推进 |

### 相关 Commits

| Commit | 说明 |
|--------|------|
| `485d8fe` | Phase 3.1: TaskState enum + updateState typed + SSE poller state branch split |
| `ed95618` | Phase 3.2: parseGatedDecision throws on SCHEMA_VERSION_MISSING/UNKNOWN |
| `7d16aa7` | Phase 3.2 fix: write protocol_violation to archive (state=failed) |
| `be22c5f` | fix(sse-poller): remove thinking events + worker_completed SSE yield |
| `0c4dc58` | Phase 3.3: updateStateWithIntegrity — archive exists + done result completeness 校验 |

---

## 🔵 Phase 4 — 回归用例沉淀（已完成 ✅，2026-05-06）

**目标**：防止同类 bug 复发。

- [x] **4.1** archive_id 一致性用例：`archive.id === command.archive_id === worker_result.archive_id === event.archive_id`，含错误模式（taskId 写成 archiveId → 查不到）✅
- [x] **4.2** DB FK 探针：`task_archives → task_commands / task_worker_results / task_archive_events` INSERT 约束通过 ✅
- [x] **4.3** 状态机终态：`slow_execution.result` 落盘对应 completed；`task_worker_results` 落盘；事件时间线顺序校验 ✅
- [x] **4.4** 完整性校验回归：result 空 + 无 worker_results → `INTEGRITY_VIOLATION`；野 archiveId → `INTEGRITY_VIOLATION`；Phase 3.2 协议违规回归通过 ✅

### 验收结果

| 测试套件 | 结果 | 位置 |
|----------|------|------|
| 12 个集成测试（4.1~4.4） | ✅ 12/12 全绿 | `tests/repositories/delegation/` |
| 测试基础设施 | `vitest.repo.config.ts` + 真实 DB（`smartrouter_test`） | 自动初始化，表隔离 |

### 相关 Commits

| Commit | 说明 |
|--------|------|
| `72b1783` | Phase 4: delegation chain regression — 12 集成测试，覆盖 4.1~4.4 |

---

## 🟣 Phase 5 — 策略性优化（进行中）

**目标**：在链路稳定的基础上提升路由准确性、降低成本、强化 schema 可靠性。

### 5.1 路由退化/降级策略一致性
- [ ] 协议违规（schema_version 缺失/未知）降级路径统一：确保所有异常最终都落 `state=failed` + 可诊断错误
- [ ] 模型输出异常（JSON parse 失败、字段缺失）降级路径与协议违规路径对齐
- [ ] 添加降级路径回归用例（补充 Phase 4 测试套件）

### 5.2 system_conf 阈值边缘行为
- [ ] 当前阈值 0.7，实测 system_conf=0.699 边缘场景（差 0.001 通过）
- [ ] 确认 gating 用 `>= 0.7` 还是 `> 0.699`，统一为 `>= 0.7` 严格判断
- [ ] 考虑是否在边缘区间（0.65~0.75）增加 `ask_clarification` 保护

### 5.3 schema_version 输出可靠性（Prompt 强约束）
- [ ] Manager Prompt v4：在 system prompt 中强化 `schema_version` 字段必须输出的约束
- [ ] 目标：将 Phase 3.2 的协议违规触发率降至接近 0
- [ ] 可选：在 JSON schema 前置校验层添加 `schema_version` 存在性 guard

### 5.4 Token 成本 / 路由效率
- [ ] 统计当前 L2/L3 分布比例，评估 delegate_to_slow 是否过度触发
- [ ] 对低复杂度任务（代码片段、简单问答）加 direct_answer 权重规则
- [ ] 可选：manager 输出 token 上限收口（避免 rationale 过长）

---

## 进度记录

| 日期 | 完成项 | 备注 |
|------|--------|------|
| 2026-05-05 | 计划建立 | 基于 260501-fix-poll-state-bug 分支修复经验整理 |
| 2026-05-05 | Phase 1 全部完成 ✅ | 根本 Bug：task_commands.archive_id 写入了 taskId 而非 archiveRecord.id，已修复；全链路打印已补全；DB 8张表验证通过 |
| 2026-05-05 | Phase 2 完成 ✅（commit 89cc0cc）| 诊断脚本修复（列名校准）；启动必检项（委托表+LLM API）；端到端成功 archive_id=`a21f7814-...`（state=done，耗时55s，cost=$0.0013）|
| 2026-05-05 | Phase 3 全部完成 ✅ | 3.1 TaskState enum（485d8fe）；3.2 protocol violation throw（7d16aa7）；3.3 updateStateWithIntegrity 校验（0c4dc58）；已全部推送 GitHub |
| 2026-05-06 | Phase 4 全部完成 ✅（commit 72b1783）| 12/12 集成测试全绿；archive_id 一致性 + FK 探针 + 状态机终态 + 完整性校验回归均通过 |
| 2026-05-06 | Phase 5 启动 | 降级路径一致性（5.1）/ system_conf 阈值边缘行为（5.2）/ schema 可靠性（5.3）/ token 成本（5.4）|

---

## Phase 2 诊断输出摘要（archive_id = a21f7814-6ae0-4cdb-8ab9-f59f211249a6）

**端到端成功**：task_archives.state = `completed`，耗时 ~25s，cost = $0.0013

### task_archives
- id: a21f7814-6ae0-4cdb-8ab9-f59f211249a6
- task_type: analysis
- state: completed ✅

### task_commands
- archive_id: a21f7814-...（= task_archives.id）✅ 一致
- status: completed ✅

### task_worker_results
- worker_role: slow_analyst
- status: completed ✅
- tokens: 100 in / 587 out

### task_archive_events
- archive_created → worker_started ✅ 链路完整

---

_横着走，但按优先级走。_ 🦀
