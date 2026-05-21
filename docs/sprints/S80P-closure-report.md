# Sprint 80P — Resume Decision Persistence V0 — Closure Report

**Sprint**: S80P
**Commit**: `<TBD>`
**PM Status**: CLOSURE CANDIDATE ⚠️（三端同步完成 ✅，待 PM 签字）
**Date**: 2026-05-21

---

## 1. Sprint 目标

将 S79P 的 `HumanReviewResumeDecision` 持久化到 DB，使未来 resume execution 能引用一个稳定的、可审计的 decision id。

S80P 不执行 resume，不调用 runCycle()。

---

## 2. 交付清单

### D1: Resume Decision DB Schema ✅

新增 `human_review_resume_decisions` 表（通过 `ensureTable()` 内联创建）：
- `id` TEXT PK
- `review_request_id` TEXT NOT NULL UNIQUE
- `task_id` TEXT NOT NULL
- `next_action` TEXT NOT NULL
- `execution_mode` TEXT NOT NULL
- `requires_operator_confirmation` BOOLEAN NOT NULL
- `source_json` TEXT NOT NULL（source 字段的 JSON 序列化）
- `audit_json` TEXT NOT NULL（audit 字段的 JSON 序列化）
- `created_at` TEXT NOT NULL

### D2: Repository API ✅

`src/db/human-review-decision-repo.ts`：
- `create(decision)` — 幂等（UNIQUE review_request_id，23505 fallback）
- `getById(id)`
- `getByReviewRequestId(reviewRequestId)`
- `list(opts)` — 支持 nextAction / executionMode 过滤

### D3: Service Integration ✅

`human-review-service.ts` 新增 `createOrGetResumeDecision()`：
- 先查 DB 幂等
- 不存在则调用 `buildHumanReviewResumeDecision()` 计算 + 持久化
- pending 状态 throws

### D4: API Behavior Update ✅

`GET /v1/human-review/:id/resume-decision`：
- 从内存计算改为 `createOrGetResumeDecision()`（持久化）
- 返回稳定 `decision.id`

新增端点：
- `GET /v1/human-review/:id/resume-decision/:decisionId` — 按 decision ID 直接查询

### D5-D7: Tests ✅

| Suite | Count | Result |
|---|---:|---:|
| S80P Service | 10 | ✅ |
| S80P Boundary | 5 | ✅ |
| S80P E2E | 4 | ✅ |
| S79P Regression | 16 | ✅ |
| S78P Regression | 17 | ✅ |
| S77P Regression | 19 | ✅ |
| S76P Regression | 9 | ✅ |
| S75P Regression | 16 | ✅ |
| **Total** | **96** | **96/96 ✅** |

---

## 3. 修改清单

| File | Change |
|---|---|
| `src/db/human-review-decision-repo.ts` | 新建（decision repo） |
| `src/services/human-review/human-review-types.ts` | 新增 `HumanReviewResumeDecisionRepo` 接口 |
| `src/services/human-review/human-review-service.ts` | 新增 `createOrGetResumeDecision()` |
| `src/api/human-review.ts` | 更新 resume-decision 端点 + 新增 decisionId 查询 |
| `vitest.s80p.config.ts` | 新建 |
| `tests/services/human-review/human-review-decision-persist.test.ts` | 新建（10 tests） |
| `tests/services/human-review/human-review-decision-persist-boundary.test.ts` | 新建（5 tests） |
| `tests/services/human-review/human-review-decision-persist-e2e.test.ts` | 新建（4 tests） |

---

## 4. Idempotency 证明

- `UNIQUE(review_request_id)` — DB 层保证同一 review request 只产生一个 decision
- `create()` 捕获 `23505` unique violation，fallback 到 SELECT 返回已有记录
- `createOrGetResumeDecision()` 先 `getByReviewRequestId`，存在则直接返回

**测试覆盖**：
- T2: 第二次调用返回相同 decision
- E2: 真实 DB 幂等性验证

---

## 5. Security Decision 不降级

已验证：security-sensitive decision 持久化后读取回来，`executionMode` 和 `requiresOperatorConfirmation` 保持一致。

**测试覆盖**：
- T7: security override → manual + requiresOperatorConfirmation
- T8: 第二次读取不降级
- E3: 真实 DB security 不降级

---

## 6. Context Boundary

Persisted decision audit 不含：
- raw artifact source
- raw history text
- raw memory text
- criterion text/label

**测试覆盖**：B1-B5 sentinel 检测

---

## 7. 已知限制

| 限制 | 后续归属 |
|---|---|
| 不自动执行 Cycle resume | 后续 Sprint |
| 无权限控制 | 权限体系 |
| decision 无 `status` / `executedAt` 字段 | V1 |
| `human_review_requests` 表用 TEXT 日期（非 TIMESTAMPTZ） | 后续统一 |

---

## 8. 三端同步状态

| 仓库 | Commit | 状态 |
|------|--------|------|
| Desktop | `<TBD>` | ✅ |
| WorkBuddy | `<TBD>` | ✅ |
| origin/master | `<TBD>` | ⏳ |

---

## 9. PM 关闭条件核对

| 条件 | 状态 |
|------|------|
| 功能交付完整 | ✅ |
| E2E 测试覆盖 | ✅ E1–E4（真实 DB） |
| 回归测试通过 | ✅ S75P 16/16 + S76P 9/9 + S77P 19/19 + S78P 17/17 + S79P 16/16 |
| 三端同步 | ⏳ |
| PM 验收签字 | ⏳ |

---

## 10. 设计决策

1. **使用 `ensureTable()` 内联建表**：与 S77P `human-review-repo.ts` 保持一致，不使用正式迁移文件
2. **`UNIQUE(review_request_id)`**：DB 层幂等保证，避免同一 review 产生多个 decision
3. **`createOrGetResumeDecision()` 先查后写**：减少不必要的 INSERT 尝试
4. **所有读方法都调 `ensureTable()`**：修复 E2E 中首次 `getByReviewRequestId` 因表不存在而失败的问题
5. **新增 `GET /:id/resume-decision/:decisionId`**：允许按稳定 decision ID 直接查询

---

## 11. PM Sign-Off

_(待 PM 签字)_
