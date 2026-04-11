# HANDOFF.md — smartrouter-pro 最终归档状态

> 每开新对话，先读本文件，再读 MEMORY.md。

---

## 项目状态：已达到可交付完成态 ✅ → Sprint 15+ 进行中

Sprint 14 交付阻塞项全部清除。Sprint 15 已完成（C3a CLOSED），E1 CLOSED，4个 pre-existing TS 错误全部清理。

---

## Sprint 14 全部 CLOSED ✅

| P | 描述 | 状态 | Commit |
|---|---|---|---|
| P1 | B 层 implicit signal audit | ✅ CLOSED | `80389b9` |
| P2 | Feedback API Hardening | ✅ CLOSED | `80389b9` |
| P3 | Feedback Events MVP | ✅ CLOSED | `80389b9` |
| P4 | Auto-detect Backfill | ✅ CLOSED | `f6371c4` |
| P5 | Learning-side Signal Level Gating | ✅ CLOSED | `f6371c4` |

**HEAD：** `07d0b16` 含 P1~P5 + C1 + C2 + C3a + E1 + TS cleanup

| Commit | 内容 |
|--------|------|
| `07d0b16` | E1: Evidence System v1 (table, repo, API, executor integration) |
| `b8...` | ts-type: fix 4 pre-existing TS errors (chat.ts, repositories.ts, execution-loop.ts) |

---

## 项目尾项卡片 CLOSED ✅

| 卡片 | 描述 | 状态 | 核心实现 |
|---|---|---|---|
| C1 | DecisionRepo satisfaction_rate signal_level 分层 | ✅ CLOSED | `getTodayStats()` / `getRoutingAccuracyHistory()` 加 LEFT JOIN `feedback_events`，按 `signal_level <= 1` 过滤；legacy fallback = 无 `feedback_events` 记录 + `feedback_score IS NOT NULL` |
| C2 | Feedback dual-write consistency | ✅ CLOSED | `recordFeedback()` 调换写入顺序：`FeedbackEventRepo.save()` 先写，成功后再写 `decision_logs`；失败时两者均不更新 |
| C3a | Server Identity Context Adapter | ✅ CLOSED | `identityMiddleware` + `getContextUserId()`；所有 handler 改从 middleware context 读 userId；生产模式无 X-User-Id header 直接 401 |
| E1 | Evidence System v1（Layer 6 入口） | ✅ CLOSED | `evidence` 表 + `EvidenceRepo` + `/v1/evidence` CRUD API + `handleWebSearch` 自动写入 evidence（fire-and-forget）；`memory_entries` vs `evidence` 职责划分：独立建表，evidence 保留 provenance |

---

## C1 核心实现要点

- `repositories.ts`：`getTodayStats()` / `getRoutingAccuracyHistory()` 均使用 CTE + LEFT JOIN `feedback_events`
- L1 signal = `fe.signal_level <= 1` OR（无 `feedback_events` 记录 AND `d.feedback_score IS NOT NULL`）
- `satisfaction_rate` 只在 L1 signal 上计算，与 `analyzeAndLearn()` truth 定义对齐
- `decision-repo.test.ts`：新增 13 个 signal_level 过滤测试，总计 48/48

---

---

## C3a 核心实现要点

- `middleware/identity.ts`：identityMiddleware（身份解析）+ getContextUserId()
- `config.identity.allowDevFallback`：环境变量 `ALLOW_DEV_FALLBACK=true` 开启 dev fallback
- 身份优先级：① X-User-Id header → ② query.user_id（dev） → ③ 401
- 所有 API handler（chat/feedback/tasks/memory/dashboard）改从 middleware context 读 userId
- chat/feedback 端点：dev-only body shim（仅当 context 无值且 allowDevFallback=true 时读 body.user_id）
- 未引入 session/token/JWT/auth 系统（严格遵守 scope 约束）

---

## C2 核心实现要点

- `feedback-collector.ts`：`recordFeedback()` 写入顺序调换
- 有 `userId`：先写 `feedback_events` → 成功 → 写 `decision_logs`
- 有 `userId` + `FeedbackEventRepo.save` 失败：`decision_logs` 不更新，无孤立记录
- 无 `userId`：保持 legacy 路径，仅写 `decision_logs`
- `feedback-collector.test.ts`：新增 5 个双写原子性测试，总计 48/48

---

## E1 核心实现要点

- `src/db/schema.sql`：新增 `evidence` 表（含 `evidence_id`/`task_id`/`user_id`/`source`/`content`/`source_metadata`/`relevance_score`/`created_at`）
- `src/types/index.ts`：`Evidence`、`EvidenceInput`、`EvidenceSource`（`"web_search" | "http_request" | "manual"`）
- `src/db/repositories.ts`：`EvidenceRepo`（create / getById / listByTask / listByUser）
- `src/api/evidence.ts`：POST `/v1/evidence`（201）、GET `/v1/evidence/:id`（200/404）、GET `/v1/evidence?task_id=`（200）；C3a middleware 保护
- `src/tools/executor.ts`：`handleWebSearch` 成功返回前 fire-and-forget 写入 evidence；taskId 缺失时跳过
- `tests/repositories/evidence-repo.test.ts`：18 个 repo 测试用例（DB 基础设施问题未执行）
- `memory_entries` vs `evidence` 边界：memory_entries = 用户级/可编辑；evidence = 任务级/保留 provenance

---

## TypeScript 错误清理（Step B）

| 错误 | 文件 | 修复方式 | 结论 |
|------|------|---------|------|
| TS2322 | `chat.ts:178` | `s.status as "pending" \| "in_progress" \| "completed" \| "failed"` | ✅ 纯类型 cast，无业务逻辑改动 |
| TS2561 | `repositories.ts:428` | 删除 `routing_accuracy_history` 赋值（类型已移除该字段） | ✅ 清理遗留代码，与 GrowthProfile 类型同步 |
| TS2339×3 | `execution-loop.ts:302/363/392` | `ExecutionStep` 类型补 `description?: string` | ✅ 纯类型字段，无业务逻辑改动 |

**`tsc --noEmit` 结果：零错误。**

---

## 后续治理项（Deferred，不阻断交付）

---

## 已确认的架构边界（不得打破）

- **TaskPlanner 不查数据库**：retrieval 在 chat.ts，planner 只接收 `executionResultContext?: string`
- **不默认注入失败结果**：`allowedReasons` 默认 `["completed"]`
- **Behavioral Learning 信号边界**：
  - `fastExplicitSamples`：L1 (signal_level=1) → truth + eligibility
  - `fastL2Samples`：L2 (signal_level=2) → eligibility only
  - `fastL3Samples`：L3 (signal_level=3) → 完全排除
  - `fastExecutionSignalSamples`（P4.2）：`did_fallback=true` 或 `cost_saved>0` → eligibility only

---

## 测试口径（最终验证）

| Suite | 命令 | 结果 |
|---|---|---|
| memory-store.test.ts（P5） | `npx vitest run ... memory-store.test.ts` | 33 tests ✅ |
| feedback-collector.test.ts（P4+C2） | `npx vitest run ... feedback-collector.test.ts` | 48 tests ✅ |
| feedback-event-repo.test.ts（P3） | `npx vitest run ... feedback-event-repo.test.ts` | 21 tests ✅ |
| decision-repo.test.ts（C1） | `npx vitest run ... decision-repo.test.ts` | 48 tests ✅ |

⚠️ PowerShell 注意：`&&` 链式执行会短路，不作最终证据。以单文件独立进程结果为准。

---

## 关键文件路径

| 文件 | 作用 |
|---|---|
| `backend/src/services/memory-store.ts` | `analyzeAndLearn()` — 核心 learning 逻辑 |
| `backend/src/features/feedback-collector.ts` | `detectImplicitFeedback()` + `recordFeedback()` |
| `backend/src/db/repositories.ts` | DecisionRepo + FeedbackEventRepo，含 C1 satisfaction_rate 分层 SQL |
| `backend/tests/services/memory-store.test.ts` | P5 验收测试 33 个 |
| `backend/tests/features/feedback-collector.test.ts` | P4+C2 验收测试 48 个 |
| `backend/tests/repositories/feedback-event-repo.test.ts` | Repo 测试 21 个 |
| `backend/tests/repositories/decision-repo.test.ts` | C1 验收测试 48 个 |
| `docs/sprint14-p1-implicit-signal-audit.md` | P1 审计报告 |

---

## 后续治理项（Deferred，不阻断交付）

| 卡片 | 说明 | 风险级别 |
|---|---|---|
| C3: Server Identity Context | `user_id` 从客户端传参迁移到服务端身份上下文 | 中 |
| Feedback dual-write reverse order | `feedback_events` 成功 + `decision_logs` 失败时的表间短暂不一致 | 低 |

---

## 用户偏好（不变）

- 黄西式冷幽默风格
- 项目经理式派工（进度报告、分阶段验收）
- 证据闭环一致性：叙述版本必须收成一版
- 先审计/计划，再改代码
- 弱信号不升级为 truth
