# S98P Plan — Beta Hardening, Safety & Cost Guardrails

| Field | Value |
|---|---|
| Baseline | `52bc4da` (S97P closure) |
| 目标 | 让 TrustOS 可安全地开放给小范围外部用户 |
| 状态 | IN PROGRESS |
| 日期 | 2026-06-30 |

---

## 现有基础设施评估

| 能力 | 状态 | 细节 |
|---|---|---|
| Rate limiting | ✅ 已有 | 滑动窗口，内存 Map，60/min 通用 + 10/min SSE |
| Cost tracking | ✅ 已有 | 定价表、预算管理器(preflight)、SSE usage payload、DB cost 字段 |
| Auth/Identity | ✅ 已有 | JWT Bearer + X-User-Id header + query fallback |
| Logging | ✅ 已有 | Winston logger，结构化日志 |
| DB schema | ✅ 已有 | PostgreSQL，sessions/tasks/feedback/delegation_logs |
| Config | ✅ 已有 | 环境变量驱动，config.ts 统一入口 |

## S98P 缺口

| 缺口 | 优先级 |
|---|---|
| 无 per-user daily cost cap（仅 session 级 preflight） | P0 |
| 无 user/session quota 概念 | P0 |
| 日志中可能含 PII（prompt/messages/API keys） | P0 |
| 无 Admin 面板（health/usage/errors 总览） | P0 |
| 无隐私声明 | P0 |
| 无 Beta 访问控制 / invite token | P0 |
| 速率限制是单节点内存方案（无分布式） | P1 |
| 成本数据分散在多表，无总览聚合 | P1 |

---

## Deliverables

### Phase 1: 隐私声明 + 计划 (D1-D3)

| ID | Deliverable | 描述 |
|---|---|---|
| D1 | S98P 计划文档 | 本文档 |
| D2 | 隐私声明页面 | `/privacy` 路由，说明数据收集范围 |
| D3 | 隐私声明链接 | 在 Chat 页面底部添加隐私声明链接 |

### Phase 2: 成本上限 + 用户配额 (D4-D6)

| ID | Deliverable | 描述 |
|---|---|---|
| D4 | Daily cost cap 中间件 | `CostCapMiddleware`，检查 `sessions` 表当日总成本 |
| D5 | User/session quota | 可配置的每日最大会话数/任务数 |
| D6 | 配额 API 响应 | 429 时返回 quota 信息（`X-Quota-Remaining` 等） |

### Phase 3: 日志脱敏审计 (D7)

| ID | Deliverable | 描述 |
|---|---|---|
| D7 | 日志脱敏审计 + 修复 | 审计所有 `logger.*` 调用，识别 PII 泄漏点并脱敏 |

### Phase 4: Admin 面板 + 访问控制 (D8-D10)

| ID | Deliverable | 描述 |
|---|---|---|
| D8 | Admin API | `GET /api/admin/health`, `GET /api/admin/usage`, `GET /api/admin/errors` |
| D9 | Admin 前端面板 | Dashboard 新增 Admin Tab，显示系统健康/用量/错误 |
| D10 | Beta 邀请码访问控制 | `X-Beta-Invite` header 或 `?invite=` query 参数验证 |

### Phase 5: 回归验证 + 封板 (D11-D12)

| ID | Deliverable | 描述 |
|---|---|---|
| D11 | S97P 反馈面板回归 | 确认 S97P Beta 面板在改动后正常工作 |
| D12 | S98P closure report | 封板报告 |

---

## Non-goals

- Public launch
- Payment/billing system
- Multi-tenant isolation hardening
- Full security audit
- Redis distributed rate limiting (P1, deferred)
- Cost aggregation table refactor (P1, deferred)

---

## Key Design Decisions

### D4: Daily Cost Cap

- 在 `POST /api/chat` 入口前检查 `sessions` 表当日 `SUM(total_cost)`
- 阈值：`TRUSTOS_DAILY_COST_CAP_USD`，默认 `$1.00`
- 超限返回 429 + `X-Cost-Cap-Exceeded: true`
- 复用已有 `sessionRepo` 查询，不新建表

### D5: User/Session Quota

- 每日最多会话数：`TRUSTOS_DAILY_SESSION_QUOTA`，默认 20
- 每日最多任务数：`TRUSTOS_DAILY_TASK_QUOTA`，默认 50
- 在 `POST /api/chat` 入口检查 `sessions` + `tasks` 表 COUNT
- 超限返回 429 + quota headers

### D7: Log Redaction

- 审计策略：搜索所有 `logger.info/debug/warn/error` 调用
- 重点检查：是否记录了 prompt 内容、user message、API response body、API keys
- 修复：脱敏为 `[REDACTED:prompt]`、`[REDACTED:content]` 等标记
- 保留结构化字段（taskId、sessionId、userId）不脱敏

### D8-D9: Admin Panel

- Admin API 路由受 `X-Admin-Key` header 保护
- Health: DB 连通性、活跃 worker 数、pending 任务数
- Usage: 今日/本周用户数、会话数、任务数、总成本
- Errors: 最近错误日志聚合（按类型分组）
- 前端 Admin Tab 仅在检测到 admin key 时显示

### D10: Beta Invite

- `TRUSTOS_BETA_INVITE_REQUIRED=true` 时启用
- 有效邀请码存储在 `TRUSTOS_BETA_INVITE_CODES`（逗号分隔）
- 无有效邀请码的用户看到 "Private Beta — Invite Required" 页面
- 邀请码通过 `X-Beta-Invite` header 或 `?invite=` query 传入
- 验证后设置 session cookie 避免重复输入

---

## Modified Files (预期)

| 文件 | 变更 |
|---|---|
| `src/index.ts` | 注册 costCap/quotas/adminRouter，invite middleware |
| `src/api/chat.ts` | cost cap + quota 检查点 |
| `src/config.ts` | 新增配置项 |
| `src/middleware/` | cost-cap.ts, quota.ts, admin-auth.ts, beta-invite.ts (新建) |
| `src/api/admin.ts` | Admin API (新建) |
| `frontend/src/app/page.tsx` | AdminPanel 渲染 |
| `frontend/src/components/layout/Sidebar.tsx` | Admin nav tab |
| `frontend/src/app/privacy/` | 隐私声明页面 (新建) |
| `src/services/` | 日志脱敏修复 |
| `frontend/src/components/dashboard/BetaPanel.tsx` | S97P 回归确认 |

---

## Success Criteria

1. 用户超每日成本上限时被拒绝，返回清晰错误信息
2. 用户超配额时被拒绝，返回剩余配额
3. 日志中不再包含 prompt/message/API key 原文
4. Admin 面板可查看系统健康/用量/错误
5. 无邀请码用户无法使用
6. 隐私声明页面可访问
7. S97P Beta 面板功能不受影响
8. 回归 benchmark ≥ 8/10 usable，无 fatal error/internal leakage
