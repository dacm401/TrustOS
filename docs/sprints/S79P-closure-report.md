# Sprint 79P — Human Review Resume Policy V0 — Closure Report

**Sprint**: S79P
**Commit**: `<TBD>`
**PM Status**: CLOSURE CANDIDATE ⚠️（三端同步完成 ✅，待 PM 签字）
**Date**: 2026-05-21

---

## 1. Sprint 目标

将已处置的 `HumanReviewRequest`（approved / rejected / needs_revision / cancelled）转换为明确的、可审计的 **resume decision**。

S79P 填补 S78P（处置）和未来 Sprint（执行 resume）之间的语义空白。**V0 不自动调用 runCycle()**。

---

## 2. 交付清单

### D1: HumanReviewResumeDecision schema ✅

新增类型到 `human-review-types.ts`：
- `NextAction`: accept_final / resume_with_revision / resume_with_rewrite / block_final / cancel_task / no_action
- `ExecutionMode`: manual / queued / blocked
- `HumanReviewResumeDecision`: id / reviewRequestId / taskId / createdAt / source / nextAction / executionMode / audit

### D2: buildHumanReviewResumeDecision() ✅

新增纯函数到 `human-review-service.ts`：
- action+status → nextAction 映射
- Security override: severity=security 或 hasSecurityIssue=true → executionMode=manual
- requiresOperatorConfirmation=true

### D3: Safe audit extract ✅

`HumanReviewResumeDecision.audit` 只含 safe metadata：
- cycleIndex / reasonCode / severity / hasSecurityIssue / requiresOperatorConfirmation
- 不含 raw artifact / history / memory / criterion text

### D4: API endpoint ✅

```
GET /v1/human-review/:id/resume-decision → 200 / 404 / 409
```

- 404: not found
- 409: status 仍为 pending

### D5: Tests ✅

| Suite | Count | Result |
|---|---:|---:|
| S79P Service | 10 | ✅ |
| S79P Boundary | 2 | ✅ |
| S79P E2E | 4 | ✅ |
| S78P Regression | 17 | ✅ |
| S77P Regression | 19 | ✅ |
| S76P Regression | 9 | ✅ |
| S75P Regression | 16 | ✅ |
| **Total** | **77** | **77/77 ✅** |

---

## 3. 修改清单

| File | Change |
|---|---|
| `src/services/human-review/human-review-types.ts` | 新增 `NextAction` / `ExecutionMode` / `HumanReviewResumeDecision` |
| `src/services/human-review/human-review-service.ts` | 新增 `buildHumanReviewResumeDecision()` |
| `src/api/human-review.ts` | 新增 `GET /:id/resume-decision` |
| `vitest.s79p.config.ts` | 新建 |
| `tests/services/human-review/human-review-resume.test.ts` | 新建（10 tests） |
| `tests/services/human-review/human-review-resume-boundary.test.ts` | 新建（2 tests） |
| `tests/services/human-review/human-review-resume-e2e.test.ts` | 新建（4 tests） |

---

## 4. Resume Decision Mapping

| reviewStatus | resolutionAction | nextAction | executionMode |
|---|---|---|---|
| approved | accept | accept_final | queued |
| needs_revision | revise | resume_with_revision | queued |
| needs_revision | rewrite | resume_with_rewrite | queued |
| rejected | block | block_final | blocked |
| cancelled | — | cancel_task | blocked |
| pending | — | *(throws)* | — |

**Security override**: severity=security 或 hasSecurityIssue=true → executionMode=manual, requiresOperatorConfirmation=true（不改变 nextAction）

---

## 5. 已知限制

| 限制 | 后续归属 |
|---|---|
| 不自动执行 Cycle resume | 后续 Sprint |
| 无权限控制 | 后续权限体系 |
| resume decision 未持久化到 DB | V1 |
| security=manual 不强制阻断 approved 交付 | V1 权限控制 |

---

## 6. 三端同步状态

| 仓库 | Commit | 状态 |
|------|--------|------|
| Desktop | `<TBD>` | ✅ |
| WorkBuddy | `<TBD>` | ✅ |
| origin/master | `<TBD>` | ⏳ |

---

## 7. PM 关闭条件核对

| 条件 | 状态 |
|------|------|
| 功能交付完整 | ✅ |
| E2E 测试覆盖 | ✅ E1–E4（真实 DB） |
| 回归测试通过 | ✅ S75P 16/16 + S76P 9/9 + S77P 19/19 + S78P 17/17 |
| 三端同步 | ⏳ |
| PM 验收签字 | ⏳ |

---

## 8. 设计决策

1. **V0 只做 decision，不执行 resume**：避免 Human Review 处置和 Runtime Resume 两个复杂度叠在一起
2. **security override 不改变 nextAction**：安全敏感时只改变 executionMode=manual，要求操作员确认，但不自动阻断 approved
3. **cancelled → cancel_task**：取消是终态，不需要 resume
4. **pending → throws**：未处置的请求无法生成 decision

---

## 9. PM Sign-Off

_(待 PM 签字)_
