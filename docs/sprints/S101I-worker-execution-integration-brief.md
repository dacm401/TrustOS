# S101I — Worker Execution Integration Brief

**Sprint**: S101I (Integration)
**Phase**: Planning → Audit → Implementation
**Date**: 2026-07-08
**Status**: AUDIT COMPLETE — READY FOR PM APPROVAL

---

## 1. Executive Summary

S101R (Batches A/B/C) 完成了 Reliable Polling 的主干 hardening：协议一致性、终态可靠性、Worker lifecycle/cancellation/cost。基础设施已足够支撑真实 Worker execution 闭环。

S101I 的目标是：**打通 command → worker → archive → SSE → frontend 的最小闭环，并验证 E2E 可工作**。

本 brief 基于完整代码审计，识别当前集成状态、缺口和最小实施计划。

---

## 2. 全链路架构（当前状态）

### 2.1 链路总览

```
用户输入 (ChatInterface)
  │
  ├─ POST /api/chat { stream: true }
  │     │
  │     ├─ routeWithManagerDecision() [llm-native-router.ts:247]
  │     │     │
  │     │     ├─ L0/L1: direct_answer → SSE fast_reply → done
  │     │     │
  │     │     └─ L2/L3: delegate_to_slow / execute_task
  │     │           │
  │     │           ├─ writeTaskArchiveAndCommand() [llm-native-router.ts:1895]
  │     │           │     ├─ TaskArchiveRepo.create() → task_archives (state="delegated")
  │     │           │     └─ TaskCommandRepo.create() → task_commands (status="queued")
  │     │           │
  │     │           └─ [返回安抚消息给 SSE]
  │     │
  │     └─ [SSE 流保持打开，poller 轮询 archive 状态]
  │
  ├─ [后台 Worker] startSlowWorker() / startExecuteWorker() [index.ts:191-192]
  │     │
  │     ├─ Slow Worker Loop [slow-worker-loop.ts]
  │     │     ├─ 轮询: task_commands WHERE status='queued' AND command_type NOT LIKE 'execute%'
  │     │     ├─ 处理: delegate_analysis, delegate_summarization
  │     │     ├─ 写回: TaskArchiveRepo.setSlowExecution({ result, tokens, cost })
  │     │     ├─ 写回: TaskWorkerResultRepo.create()
  │     │     └─ 终态: TaskArchiveRepo.updateStateWithIntegrity("completed")
  │     │
  │     └─ Execute Worker Loop [execute-worker-loop.ts]
  │           ├─ 轮询: task_commands WHERE status='queued' AND command_type IN ('execute_plan','execute_research')
  │           ├─ 处理: taskPlanner.plan() → executionLoop.run()
  │           ├─ 写回: TaskArchiveRepo.setSlowExecution({ result, completed_steps, ... })
  │           ├─ 写回: TaskWorkerResultRepo.create()
  │           └─ 终态: TaskArchiveRepo.updateStateWithIntegrity("completed")
  │
  └─ [SSE Poller] pollArchiveAndYield() [sse-poller.ts:342]
        ├─ 轮询: SELECT * FROM task_archives WHERE id = $1
        ├─ 检测 state 变化:
        │     ├─ executing/delegated → progress / partial_result / status
        │     ├─ completed → read slow_execution.result → optional Manager Synthesis
        │     │     → SSE: chunk (streaming) → result → done
        │     ├─ failed/cancelled/timed_out → error → done
        │     └─ timeout → error → done
        └─ markDelivered() → delivered=true
```

### 2.2 当前集成状态矩阵

| 链路节点 | Slow Worker (delegate_to_slow) | Execute Worker (execute_task) |
|---|---|---|
| Command 创建 | ✅ `writeTaskArchiveAndCommand()` | ✅ `writeTaskArchiveAndCommand()` |
| Worker 领取 | ✅ Poll `command_type NOT LIKE 'execute%'` | ✅ Poll `command_type IN ('execute_plan','execute_research')` |
| 结果写回 archive | ✅ `setSlowExecution()` | ✅ `setSlowExecution()` (同一字段) |
| 状态终态化 | ✅ `updateStateWithIntegrity("completed")` | ✅ `updateStateWithIntegrity("completed")` |
| SSE Poller 感知 | ✅ 读取 `slow_execution.result` | ✅ 读取 `slow_execution.result` (同一路径) |
| SSE 推送到前端 | ✅ `result` / `done` 事件 | ✅ 理论通过同一路径 |
| 前端展示 | ✅ `MessageBubble.content` | ✅ 理论通过同一组件 |
| 前端消费 progress/partial_result | ❌ 未实现 | ❌ 未实现 |
| 前端消费 usage (token/cost) | ❌ 未实现 | ❌ 未实现 |
| E2E 验证/smoke | ❌ 不存在 | ❌ 不存在 |

### 2.3 Worker 分工

| 维度 | Slow Worker | Execute Worker |
|---|---|---|
| 命令类型 | `delegate_analysis`, `delegate_summarization` | `execute_plan`, `execute_research` |
| 路由触发 | `routeByDecision → case "delegate_to_slow"` | `routeByDecision → case "execute_task"` |
| 执行引擎 | `callModelFull(slowModel)` + Cycle Runtime | `taskPlanner.plan()` + `executionLoop.run()` |
| 结果字段 | `slow_execution.result` (文本) | `slow_execution.result` (文本) + `plan_steps`/`completed_steps` |
| 取消/超时防护 | ✅ S90P/S91P + S101R-C6 exports | ✅ S101R-C6 (imported from slow-worker) |
| Stop/Restart | ✅ S101R-C5 | ✅ S101R-C5 |

---

## 3. 审计发现 — 已有集成点（PASS）

### 3.1 Execute Worker → SSE Poller 路径已验证

Execute worker 写回 `task_archives.slow_execution` 字段（与 slow worker 相同），因此 SSE poller 的 `pollArchiveAndYield()` 在检测到 `state="completed"` 时，会自然读取到 execute worker 写入的 `result`。

```typescript:151:152:trustos/src/services/phase3/execute-worker-loop.ts
    // 写 task_archives.slow_execution（供 pollArchiveAndYield 轮询感知）
    await TaskArchiveRepo.setSlowExecution(archive_id, {
```

✅ **数据路径存在且统一。**

### 3.2 integrity 校验已在位

`updateStateWithIntegrity()` 确保 `completed` 状态必须伴随 result 数据，防止"静默成功"。

```typescript
// task-archive-repo.ts - updateStateWithIntegrity
// 检查: slow_execution.result IS NOT NULL OR task_worker_results 有记录
```

✅ **终态可靠性已覆盖。**

### 3.3 Worker lifecycle 已加固 (S101R-C5/C6)

- C5: Stop 后可 restart（`workerStarted = false` 重置）
- C6: Execute worker 入口/plan/run 三处 cancellation/timeout 检查
- C6: Cancel/timout 错误分类处理，正确设置终态

✅ **Worker 执行安全已 hardened。**

---

## 4. 审计发现 — 缺口 (GAP)

### G1: 前端未消费 `progress` / `partial_result` SSE 事件

**影响**: 用户在执行期间看不到进度反馈，只能看到最终的 result/done。

**现状**:
- `sse-poller.ts` 正确推送 `progress` (每 5s) 和 `partial_result` (有新内容时)
- `ChatInterface.tsx` 的 `sendStreaming()` 没有处理这两种事件类型

**修复方式**: 在 ChatInterface 中添加 `case "progress"` 和 `case "partial_result"` 处理，更新 `statusMsg` 或 delegation status 指示器。

### G2: 前端未消费 `usage` (token/cost) 数据

**影响**: 用户无法在 Chat 界面看到每轮对话的 Token 消耗和费用。

**现状**:
- `done` 事件包含:
  ```json
  { "usage": { "tokens": {...}, "cost": {...} } }
  ```
- `ChatInterface.tsx` 未提取 `data.usage` 字段

**修复方式**: 在 `done` 事件处理中提取 `usage`，传递给 `DecisionCard` 或 `MessageBubble` 展示。

### G3: 前端未消费 `terminalSummary` (S92P)

**影响**: S92P 实现的终态摘要数据未被前端展示。

**现状**: `done` 事件包含 `terminalSummary` 字段，前端未解析。

**修复方式**: 同 G2，在 `done` 事件中提取并展示。

### G4: 无可执行的 E2E smoke test

**影响**: 无法自动化验证全链路闭合。

**现状**: 项目中有 `scripts/smoke/s98p-hardening-smoke.mjs` 这样的 smoke 脚本，但没有针对 worker execution 的 E2E smoke。

**修复方式**: 创建 `scripts/smoke/s101i-integration-smoke.mjs`，发送 `/api/chat` 请求 + 验证 SSE 流包含 `result`/`done` 事件 + 验证 `task_archives` 状态。

### G5: 前端未知 task_id 时的回退行为未验证

**影响**: SSE `archive_written` 事件后才设置 `taskId`，在此之前 Workbench 面板无法按 task_id 查询详情。

**现状**: TracePanel / EvidencePanel 在 task 未完成时每 3s 轮询，但对新建 task 需要在 `done` 事件后才拿到 task_id。

**風險**: 低。SSE `archive_written` 事件已经包含 `task_id` 字段。

---

## 5. 最小实施计划

### Phase A: 前端展示缺口补全（低风险）

| ID | 任务 | 文件 | 预计改动 |
|---|---|---|---|
| I1 | 前端消费 `progress` 事件 | `ChatInterface.tsx` | +~15 行 |
| I2 | 前端消费 `partial_result` 事件 | `ChatInterface.tsx` | +~15 行 |
| I3 | 前端消费 `usage` (done 事件) | `ChatInterface.tsx` + `MessageBubble.tsx` | +~20 行 |
| I4 | 前端页展示 terminalSummary | `ChatInterface.tsx` + `DecisionCard.tsx` | +~20 行 |

**预计改动**: ~70 行，一个 commit

### Phase B: E2E Smoke（基础设施）

| ID | 任务 | 文件 | 预计改动 |
|---|---|---|---|
| I5 | 创建 `s101i-integration-smoke.mjs` | `scripts/smoke/` | ~150 行 |
| I6 | 验证 smoke 可运行 | — | 手动运行 |

**预计改动**: ~150 行，一个 commit

### Phase C: 集成验证 + 文档

| ID | 任务 | 文件 | 预计改动 |
|---|---|---|---|
| I7 | 运行 tsc + 前端 build 验证 | — | 命令行 |
| I8 | 编写 completion note | `docs/sprints/S101I-batch-a-completion-note.md` | ~50 行 |

### 不做（暂缓）

| 项目 | 原因 |
|---|---|
| 修复 SSE poller execute-worker 特定处理 | 已通过 `slow_execution` 同一字段工作 |
| 为 progress/partial_result 设计新 UI 组件 | 超出最小闭环范围，属于 S101P session detail |
| 大幅重构 ChatInterface SSE 处理逻辑 | 风险高，不在最小闭环范围内 |
| execute-worker 多轮对话支持 | 需要 architecture discussion |

---

## 6. 验收标准

### E2E 闭环验证

```text
1. 启动后端: npx tsx src/index.ts
2. 发送 POST /api/chat { stream: true, message: "帮我写一个计算器网页" }
3. SSE 流应收到:
   a. manager_decision / archive_written / worker_started 事件
   b. progress / partial_result 事件（有间隔）
   c. chunk (Manager Synthesis 流式输出)
   d. result 事件（含 worker 原始结果）
   e. done 事件（含 usage + terminalSummary）
4. 数据库验证:
   a. task_archives 存在行，state = 'completed', delivered = true
   b. task_commands 存在行，status = 'completed'
   c. task_worker_results 存在行
   d. slow_execution.result 非空
5. 前端验证:
   a. Chat 界面显示最终回复（含 worker 产物）
   b. DecisionCard 显示 token/cost（I3 实施后）
   c. 右侧 TasksView 可查到新任务
6. Smoke 脚本: `node scripts/smoke/s101i-integration-smoke.mjs` → PASS
```

---

## 7. 风险 & 依赖

| 风险 | 等级 | 缓解 |
|---|---|---|
| execute_task 路由在生产中触发率低 | 中 | 用 `direct_create_artifact` 策略旁路可触发 execute_task 路径；smoke 测试覆盖此场景 |
| Manager Synthesis 流式化可能引入不稳定 | 低 | S99P 已验证 Manager 模型稳定性；S101R B/C 已加固 timeout/cancellation |
| 前端新增组件可能在 build 时引入 TS 错误 | 低 | npx tsc + next build 前置验证 |
| SSE 大响应可能超时 | 低 | S101R-B timeout consistency 已对齐 |

---

## 8. 建议提交

```text
Phase A: git commit -m "s101i batch-a frontend gap fill"
Phase B: git commit -m "s101i batch-a e2e smoke"
Phase C: git commit -m "s101i batch-a completion note"
```

---

## 9. 项目状态

```text
S100P: CLOSED / ACCEPTED
S101T: CLOSED / ACCEPTED
S101R Batch A: ACCEPTED
S101R Batch B: ACCEPTED
S101R Batch C: ACCEPTED
S101R Batch D: HOLD
S101I: PLANNING (this document)
S101P: NOT STARTED
```

---

**审计完成**。Brief 已就绪，等待 PM Review 和 Implementation 授权。
