# Sprint 79P — Human Review Resume Policy V0

**Status**: APPROVED TO START
**Predecessor**: S78P (`96b9599`) — Human Review Resolution V0

---

## 1. Goal

将已处置的 `HumanReviewRequest`（approved / rejected / needs_revision / cancelled）转换为明确的、可审计的 **resume decision**，但不自动执行 Cycle resume。

S79P 填补 S78P（处置）和未来 Sprint（执行 resume）之间的语义空白。

---

## 2. Non-goals

- **不**自动调用 `runCycle()`
- **不**调用 Worker / Verifier
- **不**实现 Agent Team
- **不**实现权限控制
- **不**暴露 raw artifact / history / memory / criterion 文本
- **不**把 `needs_revision` 视为自动安全可执行

---

## 3. Deliverables

### D1: HumanReviewResumeDecision schema

新增类型 `HumanReviewResumeDecision`：

```typescript
export type NextAction =
  | "accept_final"          // approved → 交付终态
  | "resume_with_revision"  // needs_revision + revise → 继续 Cycle
  | "resume_with_rewrite"   // needs_revision + rewrite → 继续 Cycle
  | "block_final"           // rejected → 阻断终态
  | "cancel_task"           // cancelled → 取消终态
  | "no_action";            // 未知/未匹配状态

export type ExecutionMode = "manual" | "queued" | "blocked";

export interface HumanReviewResumeDecision {
  id: string;
  reviewRequestId: string;
  taskId: string;
  createdAt: string;

  source: {
    reviewStatus: HumanReviewRequest["status"];
    resolutionAction: HumanReviewResolution["action"];
  };

  nextAction: NextAction;
  executionMode: ExecutionMode;

  audit: {
    cycleIndex: number;
    reasonCode: HumanReviewReasonCode;
    severity: HumanReviewSeverity;
    hasSecurityIssue: boolean;
    requiresOperatorConfirmation: boolean;
  };
}
```

### D2: Resume policy builder

新增函数 `buildHumanReviewResumeDecision(reviewRequest)`：

**Mapping 规则**：

| reviewStatus | resolutionAction | nextAction | executionMode |
|---|---|---|---|
| approved | accept | accept_final | queued |
| needs_revision | revise | resume_with_revision | queued |
| needs_revision | rewrite | resume_with_rewrite | queued |
| rejected | block | block_final | blocked |
| cancelled | — | cancel_task | blocked |

**Security override**：
如果 `severity === "security"` 或 `hasSecurityIssue === true`：
- `executionMode` → `"manual"`
- `audit.requiresOperatorConfirmation` → `true`
- **不改变** `nextAction`（由 status/action 映射决定）

### D3: Safe audit extract

`HumanReviewResumeDecision.audit` 只含 safe metadata：
- `cycleIndex` / `reasonCode` / `severity` / `hasSecurityIssue` / `requiresOperatorConfirmation`
- 不含 raw artifact / history / memory / criterion text

### D4: API endpoint

新增端点：

```
GET /v1/human-review/:id/resume-decision
```

- 读取已处置的 `HumanReviewRequest`
- 调用 `buildHumanReviewResumeDecision(request)`
- 返回 `{ request, decision }`
- 404: not found
- 409: status 仍为 pending（未处置，无法生成 decision）

### D5: Tests

**Service 单元测试**（mock repo, `vi.fn()`）：
- T1: approved+accept → accept_final, queued
- T2: needs_revision+revise → resume_with_revision, queued
- T3: needs_revision+rewrite → resume_with_rewrite, queued
- T4: rejected+block → block_final, blocked
- T5: cancelled → cancel_task, blocked
- T6: security severity → executionMode=manual, requiresOperatorConfirmation=true
- T7: hasSecurityIssue=true → executionMode=manual
- T8: pending request → throws
- T9: non-existent → throws
- T10: buildHumanReviewResumeDecision shape validation

**Boundary sentinel**：
- B1: decision audit 不含 raw artifact 敏感内容
- B2: decision shape 稳定（无 undefined 字段）

**E2E 真实 DB**：
- E1: create → resolve(accept) → resume-decision → accept_final
- E2: create → resolve(revise) → resume-decision → resume_with_revision
- E3: create → resolve(block) → resume-decision → block_final
- E4: create → resume-decision on pending → 409 error

**Regression**: S75P–S78P 全量回归

---

## 4. File Plan

| File | Change |
|---|---|
| `src/services/human-review/human-review-types.ts` | 新增 `HumanReviewResumeDecision` / `NextAction` / `ExecutionMode` |
| `src/services/human-review/human-review-service.ts` | 新增 `buildHumanReviewResumeDecision()` |
| `src/api/human-review.ts` | 新增 `GET /:id/resume-decision` |
| `vitest.s79p.config.ts` | 新建 S79P vitest 配置 |
| `tests/services/human-review/human-review-resume.test.ts` | 单元测试 |
| `tests/services/human-review/human-review-resume-boundary.test.ts` | 边界测试 |
| `tests/services/human-review/human-review-resume-e2e.test.ts` | E2E 测试 |

---

## 5. Test Target

| Suite | Count |
|---|---:|
| S79P Service | 10 |
| S79P Boundary | 2 |
| S79P E2E | 4 |
| S78P Regression | 17 |
| S77P Regression | 19 |
| S76P Regression | 9 |
| S75P Regression | 16 |
| **Total** | **77** |
