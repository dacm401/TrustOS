# S94P — Private Beta Readiness & Product Reliability

**Status**: IN PROGRESS  
**Sprint**: S94P  
**Start**: 2026-06-17  
**Target**: Private Beta Candidate  
**Predecessor**: S93P (Real LLM E2E Productization Baseline, CLOSED ✅ at e28aac4)

---

## 1. Sprint Goal

让 5-10 个真实内测用户可以稳定试用 TrustOS 网页生成能力。

S93P 已经证明 **TrustOS 能在真实 provider 下完成完整用户路径**。S94P 的目标是把这条路从「封闭测试道路」铺成「可以接客的路」：加上仪表盘（可观测性）、安全带（限流）、计价器（成本追踪）、行车记录（任务历史）、备用胎（长任务可靠性）。

---

## 2. Scope & Acceptance Criteria

### 2.1 任务历史与用户会话持久化 (Task History & Session Persistence)

**现状分析**：
- `sessions` 表 + `session_summaries` 表已存在，session API (`/v1/sessions/*`) 已实现摘要生成
- `task_archives` 表 + `tasks` 表存在，task API (`/v1/tasks/*`) 已实现 CRUD
- 前端 `SessionSwitcher` 组件存在但功能有限
- **缺口**：用户无法方便地浏览历史任务、查看任务结果、从历史中恢复上下文

**验收标准**：
- [ ] 前端 `SessionSwitcher` 可显示最近 20 个会话（含主题摘要）
- [ ] 前端 `TasksView` 可展示用户历史任务列表（含状态、时间、摘要）
- [ ] 点击历史任务可查看完整结果（CodeBlock + PreviewPane）
- [ ] 前端新增「继续编辑」按钮，可把历史任务结果带回输入框
- [ ] Session/Task 分页 API（cursor-based pagination）
- [ ] 后端 `GET /v1/tasks/recent` 新增 API（含分页、状态过滤）

### 2.2 成本与限流 (Cost Tracking & Rate Limiting)

**现状分析**：
- `config/pricing.ts` 已有完整定价表（7 个模型）
- `CallLedger` 系统已追踪每次调用的 token 和成本
- `rate-limit.ts` 中间件已实现滑动窗口限流（默认关闭）
- Prometheus metrics 已有 `costTotalUsd` / `costSavedUsd` gauge
- Dashboard 已有 `cost-stats` API
- **缺口**：限流默认关闭、成本对用户不可见、无用户级配额

**验收标准**：
- [ ] 限流默认启用 (`RATE_LIMIT_ENABLED=true`)，默认 60 req/min per user
- [ ] SSE 请求单独限流通道（10 req/min，避免长连接占满窗口）
- [ ] 前端 Dashboard 显示用户成本统计（今日/本周/本月）
- [ ] 每次 SSE done 事件返回 `cost` 字段（input/output tokens + estimated USD）
- [ ] 前端 MessageBubble 底部显示本次请求成本（小字、灰色）
- [ ] 429 限流响应在前端有友好提示（非技术错误）

### 2.3 真实任务质量 Benchmark (Quality Benchmark)

**现状分析**：
- 测试套件覆盖功能正确性（340/340 PASS）
- 无真实任务质量评估体系
- 无生成质量自动化判断

**验收标准**：
- [ ] 创建 `evaluation/tasks/` 目录，包含 10-20 条中文网页生成任务
- [ ] 每个任务有：输入 prompt、期望关键词、质量评分标准（1-5）
- [ ] 创建 `scripts/s94p-benchmark.ts`：批量运行任务、自动评分
- [ ] 评分维度：关键词覆盖、HTML 有效性、内容相关性、代码可执行性
- [ ] Benchmark 结果输出为 `docs/sprints/S94P-benchmark-results.md`
- [ ] 目标：平均分 ≥ 3.5/5，关键任务 ≥ 4/5

### 2.4 长任务可靠性 (Long-task Reliability)

**现状分析**：
- S90P 已实现 cancel/timeout 基础功能
- `task_archives` 支持 `cancelled` 状态
- **缺口**：超时默认值未产品化调优、取消体验不够友好、无重试机制、无进度持久化

**验收标准**：
- [ ] Worker 超时默认 120s（从配置读取，可覆盖）
- [ ] 超时后 SSE 发 `error` + `done`，前端展示友好超时消息
- [ ] 取消按钮即时响应（< 2s 内 SSE 收到 cancel 事件）
- [ ] 取消后任务状态持久化为 `cancelled`，历史列表可见
- [ ] 新增「重试」按钮：复用原始 prompt 重新发起请求
- [ ] 进度事件（worker_execution 5s/15s/30s/60s/90s）在 UI 可见

### 2.5 可观测性 Dashboard (Observability Dashboard)

**现状分析**：
- Prometheus metrics 已覆盖 HTTP/LLM/路由/缓存/DB/任务/熔断器/SSE/成本
- Dashboard API 已有 cost-stats / delegation-stats / system-stats
- 前端 Dashboard 页面存在但偏工程化
- **缺口**：成功率/失败率/provider 错误率不可见、无可观测 Dashboard 前端

**验收标准**：
- [ ] 后端新增 `GET /v1/observability/summary` API（含：总请求数、成功率、平均延迟、P95、今日成本）
- [ ] 后端新增 `GET /v1/observability/errors` API（按 provider 错误类型分组统计）
- [ ] 前端新增 ObservabilityPanel 组件（显示实时成功率、延迟分布、成本趋势）
- [ ] 前端 Dashboard 新增「系统健康」卡片（绿/黄/红状态）
- [ ] 前端 Dashboard 新增「Provider 错误率」图表

---

## 3. Technical Design

### 3.1 API 新增

| 方法 | 路径 | 功能 | 认证 |
|------|------|------|------|
| GET | `/v1/tasks/recent` | 分页获取用户历史任务 | ✅ |
| GET | `/v1/tasks/:id/result` | 获取任务完整结果 | ✅ |
| GET | `/v1/observability/summary` | 系统可观测摘要 | ✅ |
| GET | `/v1/observability/errors` | Provider 错误分组统计 | ✅ |

### 3.2 SSE done 事件扩展

```typescript
// S94P: done 事件新增成本字段
{
  type: "done",
  stream: "...",
  routing_layer: "...",
  cost: {                    // NEW
    input_tokens: number,
    output_tokens: number,
    estimated_cost_usd: number | null,
    model: string,
  },
  terminalSummary: "...",    // existing
  // ... other existing fields
}
```

### 3.3 数据库变更

无需新表。利用现有表：
- `task_archives` — 已有 `status`, `user_id`, `session_id`, `created_at`
- `decision_logs` — 已有 `total_cost_usd`, `exec_input_tokens`, `exec_output_tokens`
- `sessions` — 已有完整结构

可能需要新增索引：
```sql
CREATE INDEX IF NOT EXISTS idx_task_archives_user_status 
  ON task_archives(user_id, status, created_at DESC);
```

### 3.4 前端组件新增/修改

| 组件 | 变更 |
|------|------|
| `SessionSwitcher` | 增强：显示主题摘要、支持 20 条分页 |
| `TasksView` | 增强：显示状态图标、时间、摘要、可点击查看 |
| `MessageBubble` | 新增：底部成本小字 |
| `ActionBar` | 新增：重试按钮、继续编辑按钮 |
| `ObservabilityPanel` | **NEW**：成功率/延迟/成本趋势 |
| `Dashboard` | 新增：系统健康卡片、Provider 错误率图表 |
| `ChatInterface` | 修改：进度事件 UI 显示（worker_execution 时间点） |

---

## 4. Regression Baseline

S93P baseline: **340/340 PASS** (S87P-S92P targeted + model-gateway)

S94P 回归范围：
- S87P-S92P targeted: 340/340
- model-gateway: 16/16
- 新增 S94P targeted tests
- frontend build
- App-level real E2E smoke

---

## 5. Risk & Mitigation

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 限流误伤正常用户 | 用户体验下降 | 默认值保守（60/min），可配置 |
| Benchmark 质量评估不准确 | 误判生成质量 | 多维度评分 + 人工抽检 |
| 长任务超时体验差 | 用户等待焦虑 | 进度事件 + 预估剩余时间 |
| Dashboard 性能影响 | 数据库查询压力 | 使用物化视图或缓存 |

---

## 6. Timeline

| Phase | 内容 | 预估 |
|-------|------|------|
| Phase 1 | 任务历史 + 会话持久化 | — |
| Phase 2 | 成本追踪 + 限流启用 | — |
| Phase 3 | Benchmark 体系 | — |
| Phase 4 | 长任务可靠性 | — |
| Phase 5 | 可观测性 Dashboard | — |
| Phase 6 | 回归测试 + 验证报告 | — |

---

## 7. Sign-off

| 角色 | 签核 | 日期 |
|------|------|------|
| 开发 | Pending | — |
| PM | Pending | — |
