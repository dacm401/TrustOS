# TrustOS — Phase 3 设计草案：Local Trust Gateway

> 版本：v0.1 | 日期：2026-04-24 | 状态：**规划中**

---

## 背景与目标

### Phase 3 定位

Phase 1 + Phase 2 建立了两层架构（Fast Manager / Slow Worker）和信息分离（Task Brief 不含历史），
但**信息边界的控制仍然是隐式的**——没有任何机制强制执行"什么信息可以发给云端"。

Phase 3 的目标：**把信息边界变成显式的、可审计的、可干预的。**

核心主张：
> TrustOS 的价值不在于 AI 有多聪明，而在于它**守得住信息边界**。
> 审计日志是信任的证明，不是事后诸葛亮。

---

## 核心设计：三横两纵

```
┌─────────────────────────────────────────────────────────┐
│                    Fast Manager（本地层）                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │ Classifier│  │ TrustPolicy│ │Sanitizer │  │ AuditLog │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘ │
└───────┼─────────────┼─────────────┼─────────────┼───────┘
        │  Task Brief │  Policy Check│  Sanitized │ Audit Entry
        ▼             ▼             ▼            ▼
┌─────────────────────────────────────────────────────────┐
│                  Slow Worker（云端层）                   │
│            只接收：脱敏后的 Task Brief                    │
└─────────────────────────────────────────────────────────┘
```

---

## T3-1：TrustPolicy Engine（策略评估接口）

### 核心接口

```typescript
// 信任策略评估结果
type PolicyDecision = "allow" | "deny" | "transform" | "ask_user";

// 单条数据请求的策略评估
interface PolicyCheckRequest {
  /** 要传输的数据 */
  data: unknown;
  /** 数据类型 */
  dataType: "user_message" | "memory" | "task_archive" | "command" | "result";
  /** 请求方 */
  recipient: "slow_worker" | "fast_manager" | "user" | "external_api";
  /** 用户上下文 */
  userId: string;
  sessionId: string;
}

interface PolicyCheckResult {
  decision: PolicyDecision;
  /** 当 decision=transform 时，描述需要的转换 */
  transforms?: DataTransform[];
  /** 拒绝原因（当 decision=deny 时） */
  reason?: string;
  /** 需要用户确认的提示（当 decision=ask_user 时） */
  prompt?: string;
}

// 数据转换类型
type DataTransform =
  | { type: "redact"; path: string[] }                          // 删除字段
  | { type: "mask"; path: string[]; maskChar: string }          // 遮罩
  | { type: "generalize"; path: string[] }                       // 泛化
  | { type: "replace"; path: string[]; with: unknown };         // 替换

// 策略引擎本体
interface TrustPolicyEngine {
  /** 评估单条数据请求 */
  check(request: PolicyCheckRequest): Promise<PolicyCheckResult>;

  /** 批量评估（用于 Task Brief 组装前） */
  checkAll(requests: PolicyCheckRequest[]): Promise<PolicyCheckResult[]>;
}
```

### 默认策略（内建）

```typescript
// 数据分类级别
type DataClassification = "public" | "internal" | "confidential" | "strictly_private";

interface DataClassificationMap {
  // Task Brief 相关
  "task.type": "internal";
  "task.constraints": "internal";
  "task.relevantFacts": "confidential";   // 可能含用户敏感信息
  "task.userPreferenceSummary": "confidential";
  "command.queryKeys": "internal";

  // 用户消息
  "message.raw": "confidential";
  "message.userId": "strictly_private";

  // Memory
  "memory.entries": "confidential";
  "memory.preferences": "strictly_private";

  // Worker 输出
  "worker.result": "internal";   // Worker 输出给用户，本身无隐私
}

// 默认策略规则
const DEFAULT_RULES: PolicyRule[] = [
  // Rule 1: 严格私密数据永不上云
  {
    id: "strictly-private-no-cloud",
    condition: (req) => getClassification(req) === "strictly_private",
    action: "deny",
    reason: "strictly_private 数据禁止传输到云端",
  },
  // Rule 2: confidential 数据需要用户确认
  {
    id: "confidential-ask-user",
    condition: (req) => getClassification(req) === "confidential" && req.recipient === "slow_worker",
    action: "ask_user",
    prompt: "即将发送部分个人信息给云端模型处理，是否继续？",
  },
  // Rule 3: 外部 API 永远需要用户确认
  {
    id: "external-api-always-ask",
    condition: (req) => req.recipient === "external_api",
    action: "ask_user",
    prompt: "应用需要访问外部服务，是否继续？",
  },
  // Rule 4: internal 和 public 数据直接放行
  {
    id: "internal-allow",
    condition: (req) =>
      getClassification(req) === "internal" || getClassification(req) === "public",
    action: "allow",
  },
];
```

---

## T3-2：Data Classification System（数据分级标注）

### 现有字段标注（基于 schema.sql）

对 `task_archives` / `task_commands` / `delegation_archives` 各字段进行分类：

```typescript
// src/trust/field-classification.ts

export const TASK_ARCHIVE_FIELD_CLASSIFICATION: Record<string, DataClassification> = {
  // task_archives 表
  "task_archives.task_id": "internal",
  "task_archives.session_id": "internal",
  "task_archives.user_input": "confidential",     // 用户原始消息，可能含敏感内容
  "task_archives.fast_observations": "confidential", // Fast 模型提取的事实
  "task_archives.status": "internal",
  "task_archives.delivered": "internal",
  "task_archives.created_at": "internal",
  "task_archives.updated_at": "internal",

  // task_commands 表
  "task_commands.action": "internal",
  "task_commands.task": "confidential",           // 任务描述，可能含上下文
  "task_commands.constraints": "internal",
  "task_commands.query_keys": "internal",
  "task_commands.relevant_facts": "confidential", // Fast 提取的事实，可能含隐私
  "task_commands.user_preference_summary": "strictly_private", // 用户偏好

  // task_worker_results 表
  "task_worker_results.result": "internal",      // Worker 输出，给用户，无隐私
  "task_worker_results.started_at": "internal",
  "task_worker_results.completed_at": "internal",
  "task_worker_results.processing_ms": "internal",

  // task_archive_events 表
  "task_archive_events.event_type": "internal",
  "task_archive_events.event_data": "internal",
};
```

### 自动分类工具函数

```typescript
/**
 * 自动推断未知字段的分类级别
 * 启发式规则：
 * - 含 "name", "email", "phone", "address" → strictly_private
 * - 含 "preference", "bias", "opinion", "feeling" → confidential
 * - 含 "result", "summary", "conclusion", "output" → internal
 * - 含 "id", "status", "timestamp", "type" → public
 */
function inferClassification(fieldName: string, value: unknown): DataClassification {
  const lower = fieldName.toLowerCase();
  if (/name|email|phone|address|password|token|secret|key/.test(lower)) {
    return "strictly_private";
  }
  if (/preference|bias|opinion|feeling|personal|private/.test(lower)) {
    return "confidential";
  }
  if (/result|summary|conclusion|output|analysis|report/.test(lower)) {
    return "internal";
  }
  return "internal"; // 保守默认
}
```

---

## T3-3：Sanitization Engine（脱敏引擎）

### 核心接口

```typescript
interface Sanitizer {
  /**
   * 对数据进行脱敏处理
   * @param data 原始数据
   * @param transforms 需要的转换规则（来自 PolicyCheckResult.transforms）
   * @returns 脱敏后的数据（原始数据不变）
   */
  sanitize(data: unknown, transforms: DataTransform[]): unknown;
}

// 内建脱敏策略
const BUILTIN_REDACTORS: Record<string, Redactor> = {
  // 邮箱：laura.zhang@company.com → l***@***.com
  email: (v: string) => v.replace(/^(.{1,2}).*@/, "$1***@***."),

  // 手机号：13812345678 → ******5678
  phone: (v: string) => v.replace(/\d(?=\d{4})/g, "*"),

  // 姓名：张三 → 张*
  name: (v: string) => v.length <= 2 ? v[0] + "*" : v[0] + "*".repeat(v.length - 1),

  // 日期泛化：2024-03-15 → 2024年
  date: (v: string) => v.replace(/^(\d{4})-\d+-\d+$/, "$1年"),

  // 数字泛化：价格 / 金额 → 保留数量级
  money: (v: string) => {
    const num = parseFloat(v);
    if (isNaN(num)) return v;
    if (num >= 1000000) return "百万级";
    if (num >= 1000) return "千级";
    return "个位级";
  },
};
```

### Worker Prompt 脱敏示例

```typescript
// 原始 relevant_facts
const rawFacts = [
  "用户最近在关注 AI Agent 赛道",
  "用户的邮箱是 laura.zhang@startup.io，正在融资",
  "用户偏好简洁的输出风格",
];

// Policy 评估后需要：
// - 邮箱 confidential → transform（脱敏）
// - 偏好 confidential → ask_user

// Sanitizer 应用转换后
const sanitizedFacts = sanitize(rawFacts, [
  { type: "mask", path: ["relevant_facts", "1"], maskChar: "*" },
]);
// 结果：["用户最近在关注 AI Agent 赛道", "la***@***.io，正在融资", "..."]
```

---

## T3-4：Audit Log（审计日志）

### 数据库 Schema

```sql
-- trust_audit_log 表
CREATE TABLE trust_audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      VARCHAR(64) UNIQUE NOT NULL,  -- 幂等 key（如 taskId + action）
  event_type    VARCHAR(32) NOT NULL,
  user_id       VARCHAR(64) NOT NULL,
  session_id    VARCHAR(64),
  action        VARCHAR(32) NOT NULL,  -- data_sent | data_classified | policy_triggered | user_consent
  recipient     VARCHAR(32),             -- slow_worker | external_api | user
  data_type     VARCHAR(32),             -- task_brief | memory | command | result
  classification VARCHAR(32),              -- public | internal | confidential | strictly_private
  policy_rule   VARCHAR(64),             -- 命中的策略 ID
  policy_decision VARCHAR(32),           -- allow | deny | transform | ask_user
  data_hash     VARCHAR(128),            -- 传输数据的 SHA-256（不含值本身，仅用于审计对账）
  transforms_applied JSONB,               -- 应用的脱敏转换
  consent_given BOOLEAN,                  -- 用户是否授权（ask_user 场景）
  reason        TEXT,                     -- 拒绝/询问原因
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_audit_user ON trust_audit_log(user_id, created_at DESC);
CREATE INDEX idx_audit_event_type ON trust_audit_log(event_type, created_at DESC);
CREATE INDEX idx_audit_session ON trust_audit_log(session_id);
```

### 审计事件类型

| event_type | 说明 | 触发时机 |
|-----------|------|---------|
| `data_sent` | 数据跨边界传输 | Task Brief 发送给 Slow Worker 前 |
| `data_classified` | 数据被分类 | 任何数据写入 Archive 前 |
| `policy_triggered` | 策略被触发 | Policy 返回 deny / transform / ask_user 时 |
| `user_consent` | 用户授权决策 | 用户对 ask_user 场景做出响应 |
| `sanitization_applied` | 脱敏已应用 | Sanitizer 修改了数据 |

### 审计查询接口

```typescript
// GET /trust/audit?user_id=&session_id=&event_type=&from=&to=
interface AuditQuery {
  user_id?: string;
  session_id?: string;
  event_type?: string;
  from?: string;   // ISO timestamp
  to?: string;
  limit?: number;
  offset?: number;
}
```

---

## Task Brief 组装流程（Phase 3 改造）

```
用户消息
    │
    ▼
Fast Manager 解析 → ManagerDecision
    │
    ├─ action=direct_answer → 直接回复（无需审计）
    │
    ├─ action=ask_clarification → 直接询问（无需审计）
    │
    ├─ action=execute_task → 执行模式（数据不离开本地，无需审计）
    │
    └─ action=delegate_to_slow → 委托慢模型
              │
              ▼
        TrustPolicyEngine.checkAll([
          { data: delegation.task, dataType: "command", recipient: "slow_worker" },
          { data: delegation.relevantFacts, dataType: "memory", recipient: "slow_worker" },
          { data: delegation.userPreferenceSummary, dataType: "memory", recipient: "slow_worker" },
        ])
              │
              ▼
        ┌─────┴─────┐
        │ allow?    │
        └─────┬─────┘
              │
      ┌───────┼───────┐
      ▼       ▼       ▼
    allow   deny   ask_user
      │       │       │
      ▼       ▼       ▼
   组装     拒绝    弹窗
   Task    委托    授权
   Brief   (日志)  (日志)
      │       │       │
      └───────┼───────┘
              ▼
        AuditLog.write("data_sent")
              │
              ▼
        Slow Worker 执行
              │
              ▼
        AuditLog.write("result_received")
```

---

## 实施计划

### T3-1: TrustPolicy Engine 骨架
- [ ] `src/trust/policy-engine.ts` — 核心接口 + 默认策略
- [ ] `src/trust/policy-rules.ts` — 策略规则注册表
- [ ] 单元测试 `tests/trust/policy-engine.test.ts`

### T3-2: Data Classification
- [ ] `src/trust/field-classification.ts` — 字段分类标注
- [ ] `src/trust/classifier.ts` — 自动推断分类
- [ ] Schema 注释对齐（schema.sql 字段加注释）

### T3-3: Sanitization Engine
- [ ] `src/trust/sanitizer.ts` — 脱敏核心 + 内建 redactor
- [ ] 集成到 `orchestrator.ts` 的 `triggerSlowModelBackground()` 前
- [ ] 单元测试 `tests/trust/sanitizer.test.ts`

### T3-4: Audit Log
- [ ] `src/db/schema.sql` — 新增 `trust_audit_log` 表
- [ ] `src/db/repositories.ts` — 新增 `TrustAuditRepo`
- [ ] `src/api/audit.ts` — GET `/trust/audit` 查询接口
- [ ] `orchestrator.ts` — 在 Task Brief 发送前写入审计日志
- [ ] 集成测试 `tests/api/audit.test.ts`

### 验收标准

| 标准 | 描述 |
|------|------|
| A1 | strictly_private 字段永远不进入 Worker Prompt |
| A2 | confidential 字段发送前必须记录用户授权 |
| A3 | 每次数据跨边界传输都有对应 audit log 条目 |
| A4 | 所有 trust 模块有单元测试覆盖 |
| A5 | 旧路径（无 Policy）平滑降级，不阻断现有功能 |
| A6 | `npm run test:r1` 全量通过（零回归）|

---

## 关键约束

1. **向后兼容**：Phase 1/2 的所有行为不变，Policy/Sanitizer 是可选拦截层
2. **Fail open vs fail closed**：策略引擎不可用时，默认 **fail closed**（拒绝传输）
3. **无用户干预不阻断**：对于 async 委托路径，Policy ask_user 可以走默认拒绝（需要用户主动授权）
4. **隐私最小化**：审计日志只存 data_hash，不存数据内容本身
