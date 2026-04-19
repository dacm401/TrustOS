# Current Sprint

**Sprint 37 — Phase 3.0 Manager-Worker 路由接入（Phase 2）**
**Status:** 🔄 Phase 2 In Progress — 2026-04-19
**Commit:** `af38192` | pushed ✅

---

## Task Cards

| Task Card | Description | Status | 产出 |
|-----------|-------------|--------|------|
| S37-1 | ChatRequest 新增 use_llm_native_routing 字段 | ✅ Done | `types/index.ts` |
| S37-2 | llm-native-router.ts — Manager Prompt + 解析 + 路由分发 | ✅ Done | `services/llm-native-router.ts` |
| S37-3 | chat.ts 接入 llm-native-router | ✅ Done | `api/chat.ts` 新分支 |
| S37-4 | SSE manager_decision 事件（嵌入 ChatResponse） | ✅ Done | `clarifying` 字段入 ChatResponse |
| S37-5 | tsc --noEmit + vitest | ✅ Done | 172 tests 全绿 ✅ |
| S37-6 | Commit push + 更新 current-sprint.md | ✅ Done | `ef8a502` pushed ✅ |

---

## Phase 1 交付说明

Phase 1 实现双轨并行：现有 orchestrator 完全不受影响，LLM-Native 路由通过 `use_llm_native_routing=true` 显式激活。

### 新增文件

| 文件 | 说明 |
|------|------|
| `backend/src/services/llm-native-router.ts` | ManagerDecision 路由服务（主入口 `routeWithManagerDecision`） |

### 修改文件

| 文件 | 修改内容 |
|------|---------|
| `backend/src/types/index.ts` | ChatRequest 新增 `use_llm_native_routing?: boolean`；ChatResponse 新增 `clarifying?: ClarifyQuestion` |
| `backend/src/api/chat.ts` | 新增 Phase 3.0 LLM-Native 路由分支（`use_llm_native_routing=true` 时触发） |

### Phase 1 路由逻辑

```
body.use_llm_native_routing = true
   ↓
Fast Manager（Manager Prompt）→ JSON
   ↓
parseAndValidate() 校验
   ↓
decision_type 分支：
  - direct_answer → 直接返回 direct_response.content
  - ask_clarification → 返回澄清问题 + clarifying 字段
  - delegate_to_slow → 写 Archive + Command + 触发后台 Slow + 安抚回复
  - execute_task → fallback（Phase 2 实现）
```

### Phase 1 设计决策

- **Manager Prompt**：全新 prompt template，不复用 orchestrator 的 `buildFastModelSystemPrompt`
- **Fallback 策略**：parse 失败 → L0 direct_answer，不阻断
- **双轨并行**：`use_llm_native_routing=true` 才走新链路，其他请求完全不变
- **Phase 1 局限性**：`execute_task` 暂不实现（Phase 2）；`delegate_to_slow` 使用 Phase 1.5 SlowModelCommand 格式

### Phase 1 验证方法

```bash
# 1. 触发 LLM-Native 路由（direct_answer 场景）
curl -X POST http://localhost:3001/chat \
  -H "Content-Type: application/json" \
  -d '{"user_id":"u1","session_id":"s1","message":"你好","use_llm_native_routing":true}'

# 2. 触发 delegate_to_slow
curl -X POST http://localhost:3001/chat \
  -H "Content-Type: application/json" \
  -d '{"user_id":"u1","session_id":"s1","message":"帮我分析Python和JavaScript在后端的差异","use_llm_native_routing":true}'

# 3. 类型校验
npx tsc --noEmit

# 4. 单元测试
npx vitest run --reporter=dot
```

---

## Phase 2 交付说明（execute_task → TaskPlanner）

### 核心变化

当 `ManagerDecision.decision_type === "execute_task"` 时：
1. 调用 `TaskPlanner.plan()` 生成 `ExecutionPlan`
2. 写入 `TaskArchive`（state: `executing`）
3. 写入 `TaskCommandRepo`（Phase 3 worker 拉取）
4. 返回 `execution_plan` 字段（含步骤列表）

**Phase 2 策略**：同步规划 + 立即返回 plan（后台异步 ExecutionLoop → Phase 3）

### 修改文件

| 文件 | 修改内容 |
|------|---------|
| `backend/src/services/llm-native-router.ts` | execute_task 分支接入 TaskPlanner |
| `backend/src/services/orchestrator.ts` | 导出 `triggerSlowModelBackground` |
| `backend/src/models/model-gateway.ts` | 导出 `callOpenAIWithOptions` |
| `backend/src/api/chat.ts` | 返回 `execution_plan` 字段 |

### Phase 2 路由逻辑（execute_task）

```
ManagerDecision { decision_type: "execute_task", command: CommandPayload }
   ↓
TaskPlanner.plan({ goal, taskId, userId, sessionId })
   ↓
ExecutionPlan { task_id, steps[] }
   ↓
TaskArchiveRepo.create(state: "executing")
TaskCommandRepo.create(command: queued)
   ↓
返回 execution_plan + 快速安抚消息
```

### Phase 2 验证方法

```bash
# 触发 execute_task（Manager 判断需要工具调用）
curl -X POST http://localhost:3001/chat \
  -H "Content-Type: application/json" \
  -d '{"user_id":"u1","session_id":"s1","message":"帮我搜索最新的AI新闻","use_llm_native_routing":true}'

# 期望：返回 execution_plan 字段（steps 列表）
```

---

## Sprint 36 — ✅ Phase 0 Complete

**Commit:** `f326249` | pushed ✅

Phase 0 不改主链路，只落基础设施。现有 Fast/Slow/L0/L1/L2/L3 路由完全不受影响。

### 新增文件

| 文件 | 说明 |
|------|------|
| `backend/src/types/index.ts` | ManagerDecision / CommandPayload / WorkerResult / SSE Phase 3 types |
| `backend/src/db/task-archive-repo.ts` | TaskArchiveRepo + TaskCommandRepo + TaskWorkerResultRepo |
| `backend/src/db/migrations/010_task_archive_phase3.sql` | task_commands + task_worker_results 建表 |
| `backend/src/orchestrator/decision-validator.ts` | zod 校验 + parseAndValidate() |

### 核心设计决策

- **zod 而非 ajv**：已安装，无新依赖
- **幂等插入**：ON CONFLICT (idempotency_key) 防重
- **旧 task_archives 表复用**：Phase 1.5 已有建表，新增字段不破坏现有逻辑
- **无 chat.ts 接入**：Phase 0 只落基础设施，Phase 1 才接主链路

### Phase 0 验证方法

```bash
# 1. 执行 migration
psql $DATABASE_URL -f backend/src/db/migrations/010_task_archive_phase3.sql

# 2. 类型校验
npx tsc --noEmit

# 3. 单元测试
npx vitest run --reporter=dot
```

---

## Sprint 35 — ✅ Complete

**R1 测试套件全通过 + vitest NTFS 稳定化**
- Commits: `28d2475`, `b27d318`
- 单元测试：8 files / 172 tests ✅
- R1 API 测试：4 files / 35 tests ✅
- 总计：207 passed

---

## Sprint 34 — ✅ Complete

**L1 Benchmark 扩测完成。** routing-benchmark.json 扩充至 L0:20 / L1:10 / L2:36 合计 66 条。
Commit `1217f27` pushed ✅

---

## Sprint 33 — ✅ Complete

**Phase 2.0 流量分级上线完成。** 三层路由（L0/L1/L2）从内部实现正式暴露为可观测、可评测的生产级功能。
Commit `82f2703` pushed ✅

---

## Sprint 32 — ✅ Complete

**Phase 1.5 任务卡片 + Clarifying 流程 + Slow 只读优化**
- Commits: `7574415`, `e1223b3`, `51bb297`, `aff2ac5`, `eb9dbc7`, `6e29011`, `c49c88a`
- Phase 1.5 任务卡片 Schema（task_type / task_brief / state）
- Phase 1.5 Clarifying 流程（CLARIFYING_STATE + SSE clarifying 事件）
- Memory/Evidence 效果增强（intent-aware boost）
- SSE done 事件两路推送 + SSEEvent stream 字段统一

---

## 早期 Sprint

See `docs/sprint-XX-review.md`
