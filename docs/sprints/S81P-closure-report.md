# Sprint 81P — Resume Execution V0 — Closure Report

**Sprint**: S81P
**Commit**: `aac4b3d`
**PM Status**: CLOSED ✅（三端同步完成，PM 签字 2026-05-25）
**Date**: 2026-05-25

---

## 1. Sprint 目标

Execute persisted HumanReviewResumeDecision records for terminal next actions only.

S81P supports:
- `accept_final`
- `block_final`
- `cancel_task`

S81P explicitly does not execute:
- `resume_with_revision`
- `resume_with_rewrite`

S81P does not call `runCycle()`, Worker, or Verifier.

---

## 2. Deliverables

### D1: Execution Result Schema ✅

新增类型到 `human-review-types.ts`：
- `ResumeExecutionStatus`: executed / blocked / requires_confirmation / unsupported
- `ExecutedResumeAction`: accept_final / block_final / cancel_task / none
- `HumanReviewResumeExecutionResult`: 完整执行结果接口
- `HumanReviewResumeExecutionRepo`: Repository 接口

### D2: Execution Policy Service ✅

新增纯函数 `buildHumanReviewResumeExecutionResult()` 到 `human-review-service.ts`：
- manual/security → requires_confirmation / none
- resume_with_revision/rewrite → unsupported / none
- accept_final + queued → executed / accept_final
- block_final + blocked → blocked / block_final
- cancel_task + blocked → blocked / cancel_task

### D3: Execution Persistence ✅

新增 `human_review_resume_executions` 表（通过 `ensureTable()` 内联创建）：
- `id` TEXT PRIMARY KEY
- `decision_id` TEXT NOT NULL UNIQUE（幂等保证）
- `review_request_id` TEXT NOT NULL
- `task_id` TEXT NOT NULL
- `status` TEXT NOT NULL
- `executed_action` TEXT NOT NULL
- `audit_json` TEXT NOT NULL
- `created_at` TEXT NOT NULL
- `executed_at` TEXT

### D4: Execution Repository ✅

`src/db/human-review-execution-repo.ts`：
- `create(result)` — 幂等（UNIQUE decision_id，23505 fallback）
- `getById(id)`
- `getByDecisionId(decisionId)`
- `list(opts)` — 支持 status / executedAction 过滤

### D5: Execution Service Integration ✅

新增 `createOrGetResumeExecution(reviewRequestId, decisionId)`：
- 先查 DB 幂等（已有记录时：executed/blocked → return；requires_confirmation/unsupported → re-throw）
- 不存在则调用 `buildHumanReviewResumeExecutionResult()` 计算 + 持久化
- **requires_confirmation / unsupported 也持久化**（执行尝试本身是审计事实），持久化后再 throw
- 错误码：NOT_FOUND / REVIEW_MISMATCH / REQUIRES_CONFIRMATION / UNSUPPORTED

### D6: API Endpoint ✅

```
POST /v1/human-review/:id/resume-decision/:decisionId/execute
```

返回 payload：
```json
{
  "request": HumanReviewRequest,
  "decision": HumanReviewResumeDecision,
  "execution": HumanReviewResumeExecutionResult
}
```

HTTP 行为：

| Case | HTTP | 说明 |
|------|-----:|------|
| accept_final + queued | 200 | executed，返回 execution 记录 |
| block_final + blocked | 200 | blocked，返回 execution 记录 |
| cancel_task + blocked | 200 | blocked，返回 execution 记录 |
| executionMode=manual | 409 | requires_confirmation（先持久化 execution 记录，再 throw） |
| resume_with_revision | 422 | unsupported（先持久化 execution 记录，再 throw） |
| resume_with_rewrite | 422 | unsupported（先持久化 execution 记录，再 throw） |
| decision not found | 404 | NOT_FOUND，无持久化 |
| review id mismatch | 409 | REVIEW_MISMATCH，无持久化 |

---

## 3. Execution Mapping

| nextAction | executionMode | status | executedAction |
|---|---|---|---|
| accept_final | queued | executed | accept_final |
| block_final | blocked | blocked | block_final |
| cancel_task | blocked | blocked | cancel_task |
| any | manual | requires_confirmation | none |
| resume_with_revision | queued | unsupported | none |
| resume_with_rewrite | queued | unsupported | none |

---

## 4. P1 Fix — Persist then Throw Semantics

`createOrGetResumeExecution()` persists execution attempts before returning or throwing.

Rules:
- `requires_confirmation` is persisted, then returned as HTTP 409.
- `unsupported` is persisted, then returned as HTTP 422.
- `executed` and `blocked` are persisted and returned as HTTP 200.
- Existing persisted `requires_confirmation` / `unsupported` executions re-throw the same HTTP semantics on repeated calls.

This preserves auditability while preventing manual or unsupported actions from being treated as successful execution.

---

## 5. Tests

### 5.1 S81P 功能测试

| Suite | Count | Result |
|---|---:|---:|
| S81P Service (T1-T8) | 8 | ✅ |
| S81P Persistence (P1-P5) | 5 | ✅ |
| S81P Boundary (B1-B6) | 6 | ✅ |
| S81P E2E (E1-E6) | 6 | ✅ |

### 5.2 S80P Regression

| Suite | Count | Result |
|---|---:|---:|
| S80P Decision Persist | 10 | ✅ |
| S80P Decision Persist Boundary | 5 | ✅ |
| S80P Decision Persist E2E | 4 | ✅ |

### 5.3 S79P Regression

| Suite | Count | Result |
|---|---:|---:|
| S79P Resume Service | 10 | ✅ |
| S79P Resume Boundary | 2 | ✅ |
| S79P Resume E2E | 4 | ✅ |

### 5.4 S78P Regression

| Suite | Count | Result |
|---|---:|---:|
| S78P Resolution Service | 10 | ✅ |
| S78P Resolution Boundary | 2 | ✅ |
| S78P Resolution E2E | 5 | ✅ |

### 5.5 S77P Regression

| Suite | Count | Result |
|---|---:|---:|
| S77P Service | 9 | ✅ |
| S77P Boundary | 5 | ✅ |
| S77P E2E | 5 | ✅ |

### 5.6 S76P Regression

| Suite | Count | Result |
|---|---:|---:|
| S76P Cycle Runtime | 9 | ✅ |

### 5.7 S75P Regression

| Suite | Count | Result |
|---|---:|---:|
| S75P Cycle Runtime | 16 | ✅ |

### 5.8 汇总

| 类别 | 数量 | 结果 |
|------|------|------|
| S81P Service | 8 | ✅ |
| S81P Persistence | 5 | ✅ |
| S81P Boundary | 6 | ✅ |
| S81P E2E (real DB) | 6 | ✅ |
| S80P Regression | 19 | ✅ |
| S79P Regression | 16 | ✅ |
| S78P Regression | 17 | ✅ |
| S77P Regression | 19 | ✅ |
| S76P Regression | 9 | ✅ |
| S75P Regression | 16 | ✅ |
| **总计** | **121** | **121/121 ✅** |

> 97/97 excludes E2E; 121/121 is the final full-suite result including all E2E regression paths.

---

## 6. Context Boundary

Execution audit does not contain:
- raw artifact
- raw history
- raw memory
- criterion text/label/description/expected
- resolution.note

---

## 7. PM 红线检查

| 红线 | 状态 |
|------|------|
| 调用 `runCycle()` | ❌ 未调用 |
| 执行 `resume_with_revision` | ❌ 未执行，返回 unsupported |
| 执行 `resume_with_rewrite` | ❌ 未执行，返回 unsupported |
| manual/security 自动执行 | ❌ 持久化后 throw 409 |
| execution 不绑定 decisionId | ❌ 绑定 decisionId |
| 重复 execute 产生多条 execution | ❌ 幂等（UNIQUE constraint） |
| audit 含 raw context | ❌ 只含 safe metadata |
| audit 含 `resolution.note` | ❌ 不含 |

---

## 8. 已知限制（V0 接受）

- Does not execute revise/rewrite resume.
- Does not call runCycle(), Worker, or Verifier.
- Does not implement permission control.
- Manual confirmation flow not implemented.

---

## 9. 三端同步状态

| Repo | Commit | Status |
|---|---|---:|
| Desktop | `aac4b3d` | ✅ |
| WorkBuddy | `aac4b3d` | ✅ |
| origin/master | `aac4b3d` | ✅ |

---

## 10. PM Sign-Off

```
Sprint 81P — Resume Execution V0
Status: CLOSED ✅
Commit: aac4b3d
Validation: 121/121 PASS (including E2E real DB)

PM Sign-Off Statement:
S81P now persists HumanReviewResumeExecution records with correct HTTP semantics:
manual/security decisions are persisted then rejected (409),
unsupported revise/rewrite decisions are persisted then rejected (422),
terminal accept/block/cancel decisions are persisted and returned (200).
Audit chain integrity is maintained. Context boundary is enforced.
Three-end sync confirmed at aac4b3d.

Signed: PM, 2026-05-25
```

---

## 11. 修改清单

```
Modified files:
 M  src/services/human-review/human-review-types.ts           (+72)
 M  src/services/human-review/human-review-service.ts        (+165)
 M  src/db/repositories/index.ts                              (+3)
 A  src/db/human-review-execution-repo.ts                     (new)
 M  src/api/human-review.ts                                   (+37)
 A  tests/services/human-review/human-review-execution.test.ts (new, 8 tests)
 A  tests/services/human-review/human-review-execution-boundary.test.ts (new, 6 tests)
 A  tests/services/human-review/human-review-execution-persistence.test.ts (new, 5 tests)
 A  tests/services/human-review/human-review-execution-e2e.test.ts (new, 6 tests)
 A  vitest.s81p.config.ts                                     (new)
 A  docs/sprints/S81P-closure-report.md                       (new)
```
