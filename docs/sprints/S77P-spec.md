# S77P — Human Review Queue V0

**Sprint**: S77P
**Date**: 2026-05-21
**Goal**: 将 `human_review` 终态从"运行时停止点"升级为"持久化审核队列"

---

## 1. 背景与目标

S74P 使 Verifier 能够说"需要人工验收"。
S75P 使 Cycle 在 `human_review` 处停止。
S76P 使该停止点可被 SSE 观察。

**S77P 的目标**：在该停止点之后，创建一个可列举、可查阅、可处置的持久化审核队列。

### 1.1 Non-goals

- 不实现完整 Admin UI
- 不实现多审核人分配
- 不实现 Agent Team
- 不实现任务中断/追加要求
- 不修改 QualityRouter 阈值
- 不将 raw artifact / history / memory 泄漏进审核队列摘要
- 不自动 approve human_review 项

---

## 2. 架构概览

```
runCycle() → finalStatus = "human_review"
                    ↓
         createHumanReviewRequest(result, taskContract)
                    ↓
         HumanReviewRequestRepo.create() → DB
                    ↓
         SSE done event / Ledger audit
```

---

## 3. Deliverables

### D1: HumanReviewRequest Schema

文件：`src/services/human-review/human-review-types.ts`

```typescript
// ── 状态 ────────────────────────────────────────────────────────────

export type HumanReviewStatus =
  | "pending"      // 待处理
  | "approved"     // 人工放行
  | "rejected"     // 人工拒绝
  | "needs_revision" // 需要修改后重新提交
  | "cancelled";   // 取消

// ── 原因码 ─────────────────────────────────────────────────────────

export type HumanReviewReasonCode =
  | "required_human_review"  // contract 条款声明需要人工验收
  | "llm_uncertain"          // LLM 判断不确定
  | "high_risk"             // 高风险操作
  | "security_sensitive"   // 安全敏感
  | "manual_escalation";    // 手动升级

// ── 审核请求 ───────────────────────────────────────────────────────

export interface HumanReviewRequest {
  /** 唯一 ID */
  id: string;
  /** 关联任务 ID（task_archive id） */
  taskId: string;
  /** 关联 contract ID（若有） */
  contractId?: string;
  /** 触发该请求的 cycle 序号 */
  cycleIndex: number;
  /** 当前状态 */
  status: HumanReviewStatus;
  /** 原因码 */
  reasonCode: HumanReviewReasonCode;
  /** 严重程度 */
  severity: "low" | "medium" | "high" | "security";
  /** 创建时间 */
  createdAt: string;
  /** 处置时间 */
  resolvedAt?: string;
  /** 处置结果 */
  resolution?: {
    action: "accept" | "revise" | "rewrite" | "block";
    note?: string;
    resolvedBy?: string;
  };
  /** 安全审计域（不含 raw content） */
  audit: {
    taskId: string;
    riskLevel?: string;
    recommendedAction: "human_review";
    criteriaCount: number;
    blockingIssues: number;
    hasSecurityIssue: boolean;
  };
}

// ── 创建参数 ───────────────────────────────────────────────────────

export interface CreateHumanReviewRequestParams {
  taskId: string;
  contractId?: string;
  cycleIndex: number;
  reasonCode: HumanReviewReasonCode;
  severity: "low" | "medium" | "high" | "security";
  contractVerificationResult: {
    criteriaCount: number;
    blockingIssues: number;
    hasSecurityIssue: boolean;
    riskLevel?: string;
  };
}

// ── Repository 接口 ─────────────────────────────────────────────────

export interface HumanReviewRequestRepo {
  create(req: Omit<HumanReviewRequest, "id" | "status" | "createdAt">): Promise<HumanReviewRequest>;
  getById(id: string): Promise<HumanReviewRequest | null>;
  list(opts?: { status?: HumanReviewStatus; limit?: number }): Promise<HumanReviewRequest[]>;
  resolve(id: string, resolution: HumanReviewRequest["resolution"]): Promise<HumanReviewRequest>;
  updateStatus(id: string, status: HumanReviewStatus): Promise<void>;
}
```

**设计原则**：
- `audit` 域只含 safe metadata，不含 `label` / `description` / `expected` / `artifact` / `history` / `memory`
- `resolution` V0 只做状态写入，不自动续跑 Cycle（S78P/S79P 再处理 resume）

---

### D2: Repository 层实现

文件：`src/db/human-review-repo.ts`

V0 存储方案：**SQLite `human_review_requests` 表**（复用现有 `repositories.ts` 连接池）。

```sql
CREATE TABLE IF NOT EXISTS human_review_requests (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  contract_id TEXT,
  cycle_index INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reason_code TEXT NOT NULL,
  severity TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution TEXT,
  audit TEXT NOT NULL  -- JSON，不含 raw content
);
```

幂等性：`create` 前检查 `task_id + cycle_index` 是否已存在；若存在则返回现有记录。

---

### D3: Service 层

文件：`src/services/human-review/human-review-service.ts`

核心函数：

```typescript
export function createHumanReviewRequestFromCycle(
  cycleResult: CycleRunResult,
  taskContract?: TaskContractV0
): Omit<HumanReviewRequest, "id" | "status" | "createdAt">
```

输入：
- `cycleResult.finalVerification.recommendedAction === "human_review"`
- `cycleResult.cycleAudit.finalStatus === "human_review"`

推断 `reasonCode`：
- `contractVerification.hasSecurityFailure === true` → `"security_sensitive"`
- `severity === "security"` → `"security_sensitive"`
- `contractVerification.hasHumanReviewRequired === true` → `"required_human_review"`
- fallback → `"manual_escalation"`

推断 `severity`：取触发 `human_review` 的 criterion 中最高 severity。

---

### D4: 接入 Cycle Terminal

文件：`src/services/phase3/slow-worker-loop.ts`

在 `runCycle()` 返回后（line ~427），增加：

```typescript
// S77P: human_review 终态 → 创建审核队列记录
if (cycleResult.finalVerification?.recommendedAction === "human_review") {
  try {
    const request = createHumanReviewRequestFromCycle(cycleResult, taskContract);
    const saved = await HumanReviewRequestRepo.create(request);
    console.log(JSON.stringify({
      msg: "[HUMAN_REVIEW] Request created",
      requestId: saved.id,
      taskId: saved.taskId,
      severity: saved.severity,
      reasonCode: saved.reasonCode,
    }));
  } catch (err: any) {
    console.warn("[HUMAN_REVIEW] Failed to create request:", err.message);
  }
}
```

**幂等保证**：即使 `runCycle()` 重跑，也不会重复创建记录。

---

### D5: Safe Audit Extract for SSE / Ledger

文件：`src/services/human-review/human-review-audit.ts`

```typescript
export interface HumanReviewAudit {
  requestId: string;
  status: HumanReviewStatus;
  reasonCode: HumanReviewReasonCode;
  severity: "low" | "medium" | "high" | "security";
  cycleIndex: number;
  createdAt: string;
}
```

**禁止出现在 audit 中**：
- raw artifact content
- raw history text
- raw memory text
- criterion label / description / expected（若含敏感信息）
- full contract terms

在 `chat.ts` SSE done event 中接入 `HumanReviewAudit`。

---

### D6: Context Boundary Sentinel Tests

文件：`tests/services/human-review/human-review-boundary.test.ts`

验证 `HumanReviewRequest.audit` / SSE audit 不含以下泄漏：

| Sentinel | 注入 | 验证 |
|----------|------|------|
| B1 | raw artifact 含 `SECRET_TOKEN=abc123` | audit 不含 "SECRET_TOKEN" |
| B2 | history 含 `password=supersecret` | audit 不含 "password" |
| B3 | memory 含 `api_key=xyz789` | audit 不含 "api_key" |
| B4 | criterion label 含 `API_KEY_REQUIRED` | audit 不含 "API_KEY_REQUIRED" |
| B5 | criterion description 含 `must include SSN` | audit 不含 "SSN" |

---

## 4. 测试计划

### 4.1 S77P 单元测试

文件：`tests/services/human-review/human-review-service.test.ts`

| Test | 场景 | 验证点 |
|------|------|--------|
| T1 | `createHumanReviewRequestFromCycle` 基本路径 | 返回正确 `HumanReviewRequest` |
| T2 | 推断 `reasonCode = "security_sensitive"` | `hasSecurityFailure=true` → security_sensitive |
| T3 | 推断 `reasonCode = "required_human_review"` | 无 security failure 但 hasHumanReviewRequired=true |
| T4 | 推断 `severity = "security"` | 最高 severity criterion = security |
| T5 | 推断 `severity = "high"` | 最高 severity criterion = high |
| T6 | `create` 幂等（同一 taskId+cycleIndex） | 第二次 create 返回现有记录，不报错 |
| T7 | `resolve` 路径 | pending → approved，resolvedAt 被写入 |
| T8 | `resolve` 后 `list({ status: "approved" })` | 只返回 approved 记录 |
| T9 | `getById` 不存在 | 返回 null |

### 4.2 S77P 边界测试

文件：`tests/services/human-review/human-review-boundary.test.ts`

| Test | 场景 | 验证点 |
|------|------|--------|
| B1 | artifact 含 SECRET_TOKEN | audit 不含 "SECRET_TOKEN" |
| B2 | history 含 password | audit 不含 "password" |
| B3 | memory 含 api_key | audit 不含 "api_key" |
| B4 | criterion label 含 API_KEY | audit 不含 "API_KEY" |
| B5 | criterion description 含 SSN | audit 不含 "SSN" |

### 4.3 回归测试

- `cycle-runtime-s75p.test.ts`: 16/16 PASS
- `cycle-runtime-s76p.test.ts`: 9/9 PASS

---

## 5. 已知限制

1. **无 UI**：V0 只建后端队列，不提供列表/处置 UI
2. **无 resume**：resolve 后不自动续跑 Cycle（S78P+ 再处理）
3. **单表存储**：V0 用 SQLite，未处理高并发多实例写冲突

---

## 6. 文件清单

```
src/services/human-review/
  human-review-types.ts        (new)
  human-review-service.ts      (new)
  human-review-audit.ts        (new)
src/db/
  human-review-repo.ts         (new)
  repositories.ts              (+ import)
tests/services/human-review/
  human-review-service.test.ts (new)
  human-review-boundary.test.ts (new)
src/services/phase3/
  slow-worker-loop.ts          (+ human_review queue creation)
src/api/
  chat.ts                      (+ HumanReviewAudit in SSE done)
vitest.s77p.config.ts          (new)
docs/sprints/S77P-spec.md      (this file)
```
