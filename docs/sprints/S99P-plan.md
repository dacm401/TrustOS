# S99P Plan — Beta Operations, Observability & Triage Loop

| Field | Value |
|---|---|
| Sprint | S99P |
| Baseline | `e4db7b2` (S98P closure) |
| 目标 | 让 TrustOS Private Beta 可稳定运营 1-2 周，形成每日复盘、问题可定位、反馈可转任务、成本可追踪的运营闭环 |
| 状态 | IN PROGRESS |
| 日期 | 2026-06-30 |

---

## 路线图定位

```text
S97P = 收集反馈（feedback_events 表 + beta stats API）
S98P = 加安全护栏（cost cap + quota + beta invite + admin panel）
S99P = 运营反馈和问题分诊 ← 当前 Sprint
S100P = Public Beta readiness
```

S97P 建了"乘客投诉箱"，S98P 加了护栏。S99P 要做的是：**把反馈和日志变成运营动作**——工单台、每日航班报告、事故分级、处理备注、运营复盘。

---

## 现有基础设施评估（S98P 基线）

### 已有能力

| 能力 | 状态 | 细节 |
|---|---|---|
| 反馈收集 | ✅ | `feedback_events` 表 + `POST /api/feedback` + 前端 thumbs_up/down UI |
| 反馈查询 | ✅ 基础 | `GET /v1/beta/stats/:userId` + `/feedback/:userId`（仅按用户查） |
| 决策日志 | ✅ | `decision_logs` 表含 user_id/session_id/query_preview/model_used/cost |
| Admin 面板 | ✅ | Health / Usage / Errors 三模块，有 X-Admin-Key 保护 |
| Admin API | ✅ | `/v1/admin/health` `/usage` `/errors` |
| 成本护栏 | ✅ | cost-cap / quota 中间件 |
| Beta 邀请 | ✅ | beta-invite 中间件 |
| 数据库 | ✅ | PostgreSQL + JSONB，手动迁移 |

### S99P 缺口

| 缺口 | 优先级 | 说明 |
|---|---|---|
| 反馈无 triage status/severity | P0 | feedback_events 表没有状态字段，无法标记"已处理/调查中" |
| 反馈无处理备注 | P0 | 无法记录 PM/工程的处理过程 |
| 反馈详情无 API | P0 | Admin 无法查看单条反馈的完整信息 |
| 反馈不直接关联 task | P0 | feedback_events 仅关联 decision_id，要通过 JOIN decision_logs 才能拿到 session_id |
| 无每日运营摘要 API | P1 | 缺 users/sessions/tasks/feedback/cost 的日汇总端点 |
| 无 Markdown 报告生成 | P1 | 无法一键生成 daily beta report |
| Admin 面板无反馈/运营视图 | P1 | 当前仅 health/usage/errors，缺 feedback triage + daily ops |
| 无失败归因/差评原因聚合 | P1 | 差评原因仅存在 raw_data JSONB 中，无聚合查询 |
| 无轻量告警 | P2 | 缺成本/错误/差评的阈值标记 |
| 无 invite 管理 UI | P3 | beta-invite 中间件存在但无可视化管理 |
| 无用户备注/状态管理 | P3 | 用户表仅有基本信息，无法标记 active/paused/blocked |
| 无 CSV 导出 | P3 | 缺数据导出能力 |

---

## DB Schema 现状（关键表）

### feedback_events（已有）

```sql
CREATE TABLE feedback_events (
  id              VARCHAR(36) PRIMARY KEY,
  decision_id     VARCHAR(36) NOT NULL,
  user_id         VARCHAR(36) NOT NULL,
  event_type      VARCHAR(50) NOT NULL,  -- thumbs_up | thumbs_down | accepted | ...
  signal_level    SMALLINT NOT NULL,     -- 1=L1(strong), 2=L2(weak), 3=L3(noise)
  source          VARCHAR(20) NOT NULL,  -- 'ui' | 'auto_detect' | 'system'
  raw_data        JSONB,                 -- { reason: "..." }
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### decision_logs（已有，关联用）

```sql
-- 关键字段：
-- id, user_id, session_id, query_preview, model_used,
-- exec_input_tokens, exec_output_tokens, total_cost_usd,
-- feedback_type, feedback_score
```

### sessions（已有，但 total_cost 从未写入 ⚠️）

```sql
-- 字段: id, user_id, total_cost DECIMAL(10,6) DEFAULT 0
-- ⚠️ total_cost 列存在但无代码写入，cost-cap 中间件依赖此列查询
```

### tasks（已有）

```sql
-- 字段: id, user_id, session_id, status, goal, created_at, updated_at
```

---

## Deliverables

### P0: Beta Triage Loop（反馈可处理）

| ID | Deliverable | 描述 | 文件 |
|---|---|---|---|
| D1 | Feedback triage DB migration | feedback_events 增加 triage_status / severity / triage_notes 字段（JSONB 扩展） | `src/db/migrations/022_feedback_triage.sql` |
| D2 | Feedback triage API | PATCH feedback_events 的 triage_status / severity / notes；GET 单条反馈详情（含关联 user/session/task/decision） | `src/api/admin.ts` 扩展 |
| D3 | Feedback detail API | GET /v1/admin/feedback/:id 返回反馈完整信息 + 关联的 decision/session/task | `src/api/admin.ts` 扩展 |
| D4 | Admin feedback list API | GET /v1/admin/feedback?status=open&severity=high 分页列表 | `src/api/admin.ts` 扩展 |
| D5 | Admin feedback detail UI | Admin 面板增加反馈详情视图：显示单条反馈的 user/session/task/decision 链 | `frontend/src/components/dashboard/AdminPanel.tsx` |
| D6 | Triage status/severity editor | Admin 面板中可修改 triage_status 和 severity | `frontend/src/components/dashboard/AdminPanel.tsx` |
| D7 | Triage notes support | Admin 面板中可添加/查看 triage notes | `frontend/src/components/dashboard/AdminPanel.tsx` |

### P1: Daily Beta Report（每日可复盘）

| ID | Deliverable | 描述 | 文件 |
|---|---|---|---|
| D8 | Daily summary API | GET /v1/admin/daily-summary?date=YYYY-MM-DD 返回 users/sessions/tasks/feedback/cost 日汇总 | `src/api/admin.ts` 扩展 |
| D9 | Cost by user/day API | GET /v1/admin/cost-trend?days=7 返回每日每用户成本趋势 | `src/api/admin.ts` 扩展 |
| D10 | Satisfaction trend API | GET /v1/admin/satisfaction-trend?days=7 返回每日满意率趋势 | `src/api/admin.ts` 扩展 |
| D11 | Top failure reasons API | 聚合 thumbs_down 的 raw_data.reason 关键词，返回差评原因 Top N | `src/api/admin.ts` 扩展 |
| D12 | Markdown report generator | `scripts/reports/generate-daily-report.mjs` — 调 API 生成 Markdown 每日报告 | `scripts/reports/generate-daily-report.mjs` |
| D13 | Admin daily ops panel | Admin 面板增加 Daily Ops 视图：展示 daily summary + open feedback + alerts | `frontend/src/components/dashboard/AdminPanel.tsx` |

### P2: Operational Alerts（轻量告警）

| ID | Deliverable | 描述 | 文件 |
|---|---|---|---|
| D14 | Alert thresholds config | 配置成本/错误/差评告警阈值 | `src/config.ts` |
| D15 | Alert detection service | 定时检测：high cost / error spike / negative feedback burst | `src/services/alert-detector.ts` |
| D16 | Alerts storage | alerts 表（或 JSONB 文件存储），记录告警事件 | `src/db/migrations/023_alerts.sql` |
| D17 | Admin alert panel | Admin 面板展示近期 alerts | `frontend/src/components/dashboard/AdminPanel.tsx` |

### P3: Beta User Management（用户管理）

| ID | Deliverable | 描述 | 文件 |
|---|---|---|---|
| D18 | Invite list API | GET/POST/DELETE /v1/admin/invites 管理 invite tokens | `src/api/admin.ts` 扩展 |
| D19 | User notes API | PATCH /v1/admin/users/:id/notes 添加用户备注 | `src/api/admin.ts` 扩展 |
| D20 | User status API | PATCH /v1/admin/users/:id/status 设置 active/paused/blocked | `src/api/admin.ts` 扩展 |
| D21 | CSV export API | GET /v1/admin/export?type=users|feedback|cost 导出 CSV | `src/api/admin.ts` 扩展 |
| D22 | Admin user management UI | Admin 面板增加用户管理视图 | `frontend/src/components/dashboard/AdminPanel.tsx` |

### 验证 & 文档

| ID | Deliverable | 描述 | 文件 |
|---|---|---|---|
| D23 | S97P feedback regression smoke | 验证 S97P 反馈流程无回归 | `scripts/smoke/s99p-regression-smoke.mjs` |
| D24 | S98P guardrails regression smoke | 验证 S98P cost cap/quota/invite 无回归 | 复用 `scripts/smoke/s98p-hardening-smoke.mjs` |
| D25 | S99P closure report | 封板报告 | `docs/sprints/S99P-closure-report.md` |

---

## Acceptance Criteria

| # | Criteria | Priority |
|---|---|---|
| AC-1 | Admin 可查看反馈详情（含关联 user/session/task/decision） | P0 |
| AC-2 | 每条反馈可设置 triage status（open/investigating/resolved/wontfix） | P0 |
| AC-3 | 每条反馈可设置 severity（low/medium/high/blocker） | P0 |
| AC-4 | 每条反馈可添加 triage note | P0 |
| AC-5 | Daily beta summary API 返回 users/sessions/tasks/feedback/cost | P1 |
| AC-6 | Daily report generator 可生成 Markdown | P1 |
| AC-7 | Admin 面板展示 daily summary + open feedback | P1 |
| AC-8 | Top failure reasons 可从差评 raw_data 聚合 | P1 |
| AC-9 | S97P feedback flow regression PASS | P0 |
| AC-10 | S98P guardrails smoke PASS | P0 |
| AC-11 | Frontend build PASS | P0 |
| AC-12 | Internal leakage = 0 | P0 |

---

## 排除范围

以下明确不纳入 S99P：

| 项目 | 原因 |
|---|---|
| Public Beta 发布 | S100P |
| 付费系统 | S101P |
| 复杂权限 RBAC | S101P |
| Slack/Email/Webhook 告警 | S102P |
| 多租户企业管理 | S101P |
| 自动模型调参 | 后续 |
| 全量数据仓库 | 后续 |
| 分布式限流 | 当前单节点可满足私测规模 |

---

## 执行顺序建议

```text
Phase 1 (P0): D1 → D2-D4 → D5-D7
  DB migration → API → UI
  目标：反馈可被 triage

Phase 2 (P1): D8-D11 → D12 → D13
  API → 报告生成器 → Admin ops panel
  目标：每日可复盘

Phase 3 (P2): D14-D15 → D16 → D17
  Config → Detector → Storage → UI
  目标：异常可感知

Phase 4 (P3): D18-D20 → D21 → D22
  API → Export → UI
  目标：用户可管理

Phase 5 (验证): D23-D25
  Smoke → Regression → Closure
  目标：质量确认
```

---

## 技术决策记录

### TD-1: triage 字段存储方案

**决策**: 使用 JSONB 扩展 feedback_events.raw_data，新增 `triage` 子对象。

```json
{
  "reason": "用户填写的差评原因",
  "triage": {
    "status": "open",
    "severity": "medium",
    "notes": [
      { "author": "pm", "text": "正在排查", "at": "2026-07-01T10:00:00Z" }
    ],
    "updated_at": "2026-07-01T10:00:00Z",
    "updated_by": "pm"
  }
}
```

**理由**: 
- 避免 ALTER TABLE 新增多列（与现有 migration 风格一致——feedback_events 已用 JSONB 存储 raw_data）
- triage 数据本质上是半结构化的元数据
- 查询 triage status 可用 PostgreSQL JSONB 操作符：`raw_data->'triage'->>'status'`

### TD-2: 反馈-task 关联方案

**决策**: 通过 decision_logs.session_id 间接关联 tasks，不做 schema 变更。

**理由**:
- feedback_events → decision_logs (decision_id) → session_id → tasks (session_id)
- 这是现有的 JOIN 路径，beta.ts 中已使用
- 直接加 task_id 到 feedback_events 会引入 FK 复杂度（一个 feedback 可能关联多个 tasks）

### TD-3: Admin API 认证

**决策**: 复用 S98P 的 adminAuthMiddleware（X-Admin-Key header），所有新 admin 端点挂同一认证。

### TD-4: Alert 存储

**决策**: 新建 `alerts` 表，而非复用现有表。

```sql
CREATE TABLE alerts (
  id          VARCHAR(36) PRIMARY KEY,
  type        VARCHAR(50) NOT NULL,  -- high_cost | error_spike | negative_feedback_burst
  severity    VARCHAR(20) NOT NULL,  -- warning | critical
  title       TEXT NOT NULL,
  detail      JSONB,
  acknowledged BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

### TD-5: sessions.total_cost 写入

**决策**: S99P 中修复 cost-cap 中间件依赖的 `sessions.total_cost` 写入问题。

**现状**: cost-cap 查询 `sessions.total_cost` 但无代码写入该字段。应在 decision_logs 写入时同步更新 sessions.total_cost。

---

## 风险 & 缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| JSONB triage 查询性能 | 大量反馈时 raw_data->'triage' 查询慢 | 可后续加 GIN 索引；私测规模（<100 用户）无需担心 |
| Admin 面板复杂度膨胀 | 单文件 AdminPanel.tsx 过大 | 按视图拆分子组件（FeedbackTriage / DailyOps / Alerts / UserMgmt） |
| sessions.total_cost 修复影响 cost-cap | 修复后 cost-cap 行为变化 | S98P smoke 验证回归 |
| P3 用户管理范围过大 | 影响 P0/P1 交付 | P3 严格按 MVP 做，排除复杂 RBAC |

---

## 下一 Sprint 预览

```text
S100P — Public Beta Readiness
  - 性能压测
  - 安全审计
  - 文档完善
  - 公开 landing page
  - Public Beta 发布
```
