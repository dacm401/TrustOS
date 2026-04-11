# HANDOFF.md — smartrouter-pro 当前状态

> 每开新对话，先读本文件，再读 MEMORY.md。

---

## Sprint 14 全部完成 ✅

| P | 描述 | 状态 | Commit |
|---|---|---|---|
| P1 | B 层 implicit signal audit | ✅ | `80389b9` |
| P2 | Feedback API Hardening | ✅ | `80389b9` |
| P3 | Feedback Events MVP | ✅ | `80389b9` |
| P4 | Auto-detect Backfill | ✅ | `f6371c4` |
| P5 | Learning-side Signal Level Gating | ✅ | `f6371c4` |

**当前 HEAD：** `f6371c4` Sprint 14 P4+P5

---

## 下一张卡

**Sprint 14 P6（待开）：服务端身份上下文**

### 目标
把 `user_id` 从客户端传参迁移到服务端身份上下文（session/auth middleware），消除当前临时方案的归属风险。

### 约束
- 不改动 feedback_events 表结构
- 保持向后兼容，现有历史数据不动
- 优先用现有 middleware 框架，不新引入认证库

### 先做的事
1. 读 `MEMORY.md`
2. 读 `backend/src/api/chat.ts`，找 `userId` 来源
3. 调研现有 auth middleware 或 session 处理方式
4. 给出改动计划和风险评估

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

## 测试口径（已验证）

| Suite | 命令 | 预期结果 |
|---|---|---|
| 主 suite | `npm run test:run` | 171/171 ✅ |
| Repo（独立进程） | 单文件 `npx vitest run --config vitest.repo.config.ts tests/repositories/<file>.test.ts` | 全部绿 |
| API integration | `npm run test:api` | 133/134（1 pre-existing flaky）|

**⚠️ PowerShell 注意**：`&&` 链式执行会短路，不作最终证据。以单文件独立进程结果为准。

---

## 关键文件路径

| 文件 | 作用 |
|---|---|
| `backend/src/services/memory-store.ts` | analyzeAndLearn() — 核心 learning 逻辑 |
| `backend/src/features/feedback-collector.ts` | detectImplicitFeedback() + recordFeedback() |
| `backend/src/db/repositories.ts` | FeedbackEventRepo.getByDecisionIds() |
| `backend/tests/services/memory-store.test.ts` | P5 测试 33 个 |
| `backend/tests/features/feedback-collector.test.ts` | P4 测试 43 个 |
| `backend/tests/repositories/feedback-event-repo.test.ts` | Repo 测试 21 个 |
| `docs/sprint14-p1-implicit-signal-audit.md` | P1 审计报告 |

---

## 用户偏好（不变）

- 黄西式冷幽默风格
- 项目经理式派工（进度报告、分阶段验收）
- 证据闭环一致性：叙述版本必须收成一版
- 先审计/计划，再改代码
- 弱信号不升级为 truth
