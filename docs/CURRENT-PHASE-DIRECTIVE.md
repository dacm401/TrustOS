# SmartRouter Pro — 当前阶段执行指令

> 版本：v1.0 | 日期：2026-04-19 | 状态：**ACTIVE EXECUTION DIRECTIVE**
> 优先级：本文档高于旧阶段拆分理解，以本文档为准。
> 关联：`ARCHITECTURE-VISION.md`（长期愿景）/ `PHASE-4-IMPLEMENTATION-PLAN.md`（Phase 4 实施路线）

---

## 1. 总方向不变

项目总方向仍然是：

> **从"可观测的快慢模型路由器"升级为"Task-first、Manager-Worker、Archive-driven，并为 Local Trust Gateway 做准备的通用 AI Runtime"。**

总原则继续有效：
- 默认轻，不默认重
- 任务优先于对话
- 上下文最小暴露
- 能力与权限分离
- 先建立边界，再增强智能

---

## 2. 当前实际进展（既成事实）

以下事项已视为"已完成"，不再作为主要任务：

### 已完成的架构主线
| 原文档定义 | 实际完成 Sprint |
|-----------|----------------|
| Phase 0：路线收口与兼容止血 | ✅ Sprint 36 前后 |
| Phase 1：ManagerDecision MVP | ✅ Sprint 37 |
| Phase 2：Task Archive 基础设施 | ✅ Sprint 38 |
| Phase 3：Worker 执行闭环 + SSE | ✅ Sprint 38 Phase 3 |
| Phase 4（旧文档）：旧 router 退役 | ✅ Sprint 38 Phase 4 |

### 已落地的能力清单
- `ManagerDecision` 四类动作：direct_answer / ask_clarification / delegate_to_slow / execute_task
- `task_archives` / `task_commands` / `task_worker_results` 三张表
- Slow Worker Loop + Execute Worker Loop
- `use_llm_native_routing=true` + SSE streaming
- SSE 事件链路：manager_decision → clarifying_needed → command_issued → worker_completed
- 旧 router 三件套已退役
- tsc --noEmit 零错误，vitest 172 全绿

---

## 3. 当前阶段判断

> **当前 Sprint 不再做"架构搭建"，而改做"新架构验收与收口"。**

禁止跳去 Auth v1 或继续分散修补。所有新能力扩充暂停。

---

## 4. Sprint 39 唯一主线：Runtime Validation & Stabilization

### 4.1 核心目标

验证并收口以下四条完整链路：

1. **direct_answer** — Fast 直接回复
2. **ask_clarification** — 澄清流程闭环
3. **delegate_to_slow** — Slow Worker 执行 + 回写 + SSE 推送
4. **execute_task** — Execute Worker 执行 + 回写

并确保在以下维度上成立：
- 非流式 / 流式 SSE 双路径
- Archive 状态更新正确
- Worker 执行与回写正确
- 最终回复输出正确
- 兼容 fallback 存在

### 4.2 六步执行顺序（必须遵守）

**Step 1 — 先审计，后代码**
产出：`docs/SPRINT-39-RUNTIME-VALIDATION-PLAN.md`
- 四条主链路图（含入口/manager decision/archive写入/command写入/worker行为/状态变化/SSE输出/final response）
- 数据表字段清单（task_archives / task_commands / task_worker_results / delegation_archive / execution_results）
- SSE 事件清单（event name / payload来源 / 触发条件 / 消费方 / 是否稳定）
- 兼容层与风险清单（双写/legacy表/状态语义一致性）

**Step 2 — 统一权威数据源（Card 39-A）**
- Slow 路径：确定 `task_worker_results` 还是 `task_archives.slow_execution` 作为主来源
- Execute 路径：确定 `task_worker_results` 还是 `execution_results` 作为主来源
- 写清原因，更新读取路径

**Step 3 — 统一状态语义（Card 39-B）**
- 明确 archive / command / worker / SSE 的状态集：queued / running / waiting_result / completed / failed
- 写清由谁写入 / 何时写入 / 谁读取 / SSE 如何映射 / 前端如何映射
- 禁止同一任务在多个表中各写一套不一致的状态含义

**Step 4 — 冻结 SSE 协议（Card 39-C）**
产出：`docs/SSE-EVENT-PROTOCOL-v1.md`
冻结事件：manager_decision / clarifying_needed / archive_written / worker_started / worker_progress / worker_completed / final_response / done / error
每个事件定义：event name / payload schema / required fields / optional fields / producer / consumer / backward compatibility notes

**Step 5 — Runtime E2E 验收（Card 39-D）**
- 每条主链路 3-5 个核心 E2E 用例（非完整 benchmark suite）
- 断言：manager decision / archive 写入 / 状态流转 / worker 完成 / final response
- benchmark 覆盖率是 Sprint 40 目标，不是 Sprint 39 目标

**Step 6 — 兼容层清单（Card 39-E）**
产出：`docs/COMPATIBILITY-INVENTORY.md`
- 列出仍在使用的 legacy repo / table / function
- 写清为什么保留 / 谁依赖 / 何时能删 / 删除前置条件

---

## 5. Sprint 39 收口标准

只有满足以下条件，才允许进入 Sprint 40：

1. 四条主路径全部通过正式验收（非流式 + SSE）
2. 权威结果源明确（不允许多个表都像"主结果来源"）
3. 状态语义统一（archive / command / worker / SSE 不再说不同的话）
4. SSE 协议冻结（前后端对事件含义达成一致）
5. 兼容层清单写清楚

---

## 6. Sprint 39 之后的明确路线

Sprint 39 完成后，下一步**已拍板**，不再悬着：

### Sprint 40 — Phase 4.1（数据分级 + 权限层基础）
- 定义 local_only / local_summary_shareable / cloud_allowed
- outbound request 脱敏 hook（不求完美，先求可观测）
- 详见 `PHASE-4-IMPLEMENTATION-PLAN.md`

### Auth v1 推后
在新主链路稳定 + Phase 4.1 完成后才接入 Auth，避免 runtime bug 与 auth bug 混在一起。

---

## 7. 明确禁止的事项

| 禁止 | 原因 |
|------|------|
| 直接转去做 Auth v1 | 打断新架构验收，混淆 runtime/auth bug |
| 继续扩功能（工具/UI/多 agent 编排） | Sprint 39 期间禁止主线扩张 |
| 回头重做 ManagerDecision / Archive / Worker 基础 | 这些已验收完毕 |
| 把局部修补伪装成主线推进 | bugfix 须明确标注 short-term fix / stabilization work |

---

## 8. Agent 汇报格式要求

每次汇报必须包含：
- Sprint / Card 编号 / 所属阶段 / 主线还是兼容修补
- 改动内容：新增 / 修改 / 删除文件；数据结构 / SSE / 测试变化
- 架构影响：是否改变权威数据源 / 状态语义 / SSE 协议 / fallback
- 风险与遗留：临时兼容层 / 双写 / 待收口处
- 验证证据：tsc / vitest / benchmark / curl / SSE 验证记录

---

## 9. 最终指令

> **总纲继续沿用 ARCHITECTURE-VISION，但当前阶段专注于 Manager-Worker Runtime 的正式验收、协议冻结、状态收口与兼容层盘点。Sprint 39 收口后，Sprint 40 首选 Phase 4.1 数据分级。**

如与此原则冲突，以本文档为最高执行依据。

---

_指令日期：2026-04-19 | by 蟹小钳 🦀_
