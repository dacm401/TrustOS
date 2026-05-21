# S78P — Human Review Resolution V0

**Sprint**: S78P
**Date**: 2026-05-21
**Goal**: 将 pending 审核请求变为可处置状态，处置结果安全地暴露到 SSE/Ledger；V0 不自动续跑 Cycle。

---

## 1. 背景与目标

S74P 使 Verifier 说"需要人工验收"。
S75P 使 Cycle 在 `human_review` 停止。
S76P 使该停止点可观察。
S77P 使其进入持久化队列。

**S78P 的目标**：让 pending 请求可被处置，处置结果进入审计流。

### 1.1 处置语义（V0）

```
pending
  ↓ (resolve: action=accept)
approved     ← Cycle 放行（resume S78P/S79P 处理）
  ↓ (resolve: action=revise)
needs_revision ← 需要修改后重新提交
  ↓ (resolve: action=rewrite)
needs_revision ← 需要重写
  ↓ (resolve: action=block)
rejected      ← 拒绝
  ↓ (resolve: action=任何 action)
cancelled     ← 主动取消
```

**V0 处置只做状态写入，不自动续跑 Cycle。**

### 1.2 Non-goals

- 不实现 Admin UI
- 不实现多审核人分配
- 不实现自动 resume Cycle（留 S79P）
- 不在 resolution.note 中过滤原始内容（note 是人工填写，不受 Context Boundary 约束，但需记录"note 字段存在"）
- 不在 resolution audit 中泄漏 raw artifact/history/memory/criterion

---

## 2. 架构概览

```
resolveHumanReviewRequest(id, resolution)
        ↓
  HumanReviewRequestRepo.resolve()
        ↓
  HumanReviewRequest (updated: status, resolvedAt, resolution)
        ↓
  SSE "human_review.resolved" event
  + Ledger "humanReviewResolution" extract
```

---

## 3. Deliverables

### D1: Resolution Service Function

文件：`src/services/human-review/human-review-service.ts`

```typescript
/**
 * 处置一个 pending human review 请求。
 * V0：只做状态写入，不自动 resume Cycle。
 *
 * 语义：
 * - action=accept  → approved
 * - action=revise  → needs_revision
 * - action=rewrite → needs_revision
 * - action=block   → rejected
 *
 * throws: Error if request not found or not in pending state
 */
export function resolveHumanReviewRequest(
  id: string,
  resolution: HumanReviewResolution
): Promise<HumanReviewRequest>
```

注意：`service.resolve()` 调用 `HumanReviewRequestRepo.resolve()`（已在 S77P 实现）。

### D2: Resolution Event Type

文件：`src/services/human-review/human-review-types.ts`

```typescript
// Human Review 处置事件（用于 SSE / Ledger）
export interface HumanReviewResolutionEvent {
  type: "human_review.resolved";
  requestId: string;
  taskId: string;
  cycleIndex: number;
  previousStatus: "pending";
  newStatus: HumanReviewStatus;  // "approved" | "rejected" | "needs_revision" | "cancelled"
  action: HumanReviewResolution["action"];
  resolvedBy?: string;
  resolvedAt: string;
  // audit 不含 raw content
  reasonCode: HumanReviewReasonCode;
  severity: HumanReviewSeverity;
}
```

### D3: SSE Done Event 接入 Resolution

文件：`src/api/chat.ts`（或 `src/services/phase3/sse-events.ts`）

在 SSE `done` event payload 中增加：

```typescript
humanReviewResolution?: {
  requestId: string;
  newStatus: HumanReviewStatus;
  action: string;
  resolvedAt: string;
}
```

**条件**：只有当本次请求关联的 cycle 最终状态为 `human_review` 且该请求已被处置时，才在 done event 中携带此字段。

### D4: API Endpoint — Resolve Human Review

文件：`src/api/chat.ts` 或新建 `src/api/human-review.ts`

```typescript
// POST /human-review/:id/resolve
// Body: { action: "accept" | "revise" | "rewrite" | "block", note?: string, resolvedBy?: string }
```

返回处置后的 `HumanReviewRequest`。

**权限**：V0 无权限控制，任何请求者均可处置（权限体系留 S80P）。

**错误处理**：
- 404：请求不存在
- 409：请求不处于 pending 状态
- 400：action 无效

### D5: Resolution Audit Extract for Ledger

文件：`src/types/call-ledger.ts`

```typescript
// Sprint 78P: Human Review Resolution
humanReviewResolution?: {
  requestId: string;
  previousStatus: "pending";
  newStatus: HumanReviewStatus;
  action: string;
  resolvedBy?: string;
  resolvedAt: string;
  reasonCode: HumanReviewReasonCode;
  severity: HumanReviewSeverity;
};
```

---

## 4. 测试计划

### 4.1 S78P 单元测试

文件：`tests/services/human-review/human-review-resolution.test.ts`

| Test | 场景 | 验证点 |
|------|------|--------|
| T1 | resolve: action=accept | → approved, resolvedAt 写入 |
| T2 | resolve: action=revise | → needs_revision |
| T3 | resolve: action=rewrite | → needs_revision |
| T4 | resolve: action=block | → rejected |
| T5 | resolve cancelled | → cancelled |
| T6 | resolve 时 note 透传 | note 写入 resolution.note |
| T7 | resolve 时 resolvedBy 透传 | resolvedBy 写入 resolution.resolvedBy |
| T8 | resolve 两次抛错 | pending 才能 resolve，resolved 不能再 resolve |
| T9 | resolve 不存在的 id | 抛 Error |

### 4.2 S78P 边界测试

| Test | 场景 | 验证点 |
|------|------|--------|
| B1 | resolution.note 含 SECRET_TOKEN | event.audit 不含 SECRET_TOKEN（event.note 是 safe 字段，note 本身不禁用） |
| B2 | resolved request 再次 resolve | 抛 Conflict 错误（409） |
| B3 | action=unknown | 400 Bad Request |

### 4.3 S78P E2E 真实 DB 测试

文件：`tests/services/human-review/human-review-resolution-e2e.test.ts`

| Test | 场景 |
|------|------|
| E1 | 创建 pending 请求 → resolve → 查 DB 确认 status/resolvedAt/resolution |
| E2 | resolve 同一请求两次 → 第二次 409 |
| E3 | getById(resolved) → 返回含 resolution 字段 |
| E4 | list({ status: "approved" }) → 不含 pending 请求 |
| E5 | resolve + SSE event payload 验证 |

### 4.4 回归测试

- S77P human-review-service.test.ts: 9/9 PASS
- S77P human-review-boundary.test.ts: 5/5 PASS
- S77P human-review-e2e.test.ts: 5/5 PASS
- S76P cycle-runtime: 9/9 PASS
- S75P cycle-runtime: 16/16 PASS

---

## 5. 已知限制

1. **无权限控制**：V0 任何人都可处置请求（S80P 权限体系）
2. **无自动 resume**：resolve 后 Cycle 不自动续跑（S79P 处理）
3. **resolve.note 无过滤**：note 是人工填写，V0 不做内容过滤（与 raw content 泄漏不同）
4. **单表存储**：同 S77P

---

## 6. 文件清单

```
src/services/human-review/
  human-review-types.ts          (+ HumanReviewResolutionEvent)
  human-review-service.ts         (+ resolveHumanReviewRequest)
src/api/
  chat.ts                         (+ /human-review/:id/resolve endpoint)
  OR new: src/api/human-review.ts
src/types/
  call-ledger.ts                  (+ humanReviewResolution field)
tests/services/human-review/
  human-review-resolution.test.ts  (new)
  human-review-resolution-e2e.test.ts (new)
vitest.s78p.config.ts             (new, extends vitest.config.ts)
docs/sprints/S78P-spec.md         (this file)
```

---

## 7. PM 验收条件

- [ ] D1: resolveHumanReviewRequest service function implemented
- [ ] D2: HumanReviewResolutionEvent type defined
- [ ] D3: Resolution exposed in SSE done event
- [ ] D4: POST /human-review/:id/resolve endpoint
- [ ] D5: Ledger humanReviewResolution field added
- [ ] Service tests: 9/9 PASS
- [ ] Boundary tests: 3/3 PASS
- [ ] E2E tests: 5/5 PASS
- [ ] S77P regression: 19/19 PASS
- [ ] S76P regression: 9/9 PASS
- [ ] S75P regression: 16/16 PASS
- [ ] Three-end sync: Desktop = WorkBuddy = origin/master
- [ ] PM sign-off
