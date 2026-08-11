# Frontend ↔ Backend API Contract

> **生成日期**: 2026-08-07  
> **目的**: 防止前端调用不存在 API、API 存在但无数据源、或新组件引入未对齐的接口  
> **维护规则**: 任何 UI 视图新增 API 调用时，必须更新本表

---

## UI 视图 → API 映射

### 主导航

| UI View | 组件 | API Endpoint | 存在？ | 数据状态 | 备注 |
|---------|------|-------------|:---:|------|------|
| **Overview** | `OverviewView` | — | — | — | 组合视图，自身无独立 API |
| | → `GatewayStatusCard` | `GET {GATEWAY_URL}/health` | ✅ | ✅ 真实数据 | GatewayHealth 类型 |
| | → `useGatewayEvents()` | `GET {GATEWAY_URL}/events?limit=50` | ✅ | ✅ 真实数据 | GatewayEventsResponse |
| | → `useGatewayHealth()` | `GET {GATEWAY_URL}/health` | ✅ | ✅ 真实数据 | GatewayHealth.status |
| | → `EvidenceReportPanel` | `GET {GATEWAY_URL}/report`, `/report?format=html\|md` | ✅ | ✅ 真实数据 | TRST-4A |
| | → Memory placeholder | 无 API | — | Coming Soon | 未来能力，无后端 |
| **Evidence** | `EvidenceReportPanel` | `GET {GATEWAY_URL}/report` | ✅ | ✅ 真实数据 | TRST-4A |
| | `EvidencePanel` | `GET {apiBase}/v1/tasks/{taskId}/evidence` | ✅ | ⚠️ 需 taskId | 任务级 evidence |
| **Events** | `EventChainViewer` | `GET {GATEWAY_URL}/events?limit=N` | ✅ | ✅ 真实数据 | TRST-2E |
| **Gateway** | `GatewayStatusCard` | `GET {GATEWAY_URL}/health` | ✅ | ✅ 真实数据 | |
| | `HealthPanel` | `GET {apiBase}/v1/health` | ✅ | ✅ 真实数据 | |
| **Advanced → Diagnostics** | `DebugPanel` | `GET {apiBase}/v1/decision/{taskId}` | ✅ | ⚠️ 需 taskId | useDecision |
| | `HealthPanel` | `GET {apiBase}/v1/health` | ✅ | ✅ 真实数据 | |
| **Advanced → Admin** | `AdminPanel` | `GET {apiBase}/v1/admin/health` 等 | ✅ | ✅ (需 adminKey) | X-Admin-Key header |

### 隐藏（不在主导航，代码保留）

| 模块 | 文件 | API 依赖 | 状态 |
|------|------|---------|------|
| **Agent Mode** | `ManagerWorkspace.tsx`, `ManagerConversation.tsx`, `SessionList.tsx`, `SessionDetail.tsx` | `/v1/agent-sessions/*` | ✅ B类保留 |
| **Memory** | `MemoryView.tsx` | `/v1/memory/*` | ✅ A类保留，未来建设 |
| **Beta** | `BetaPanel.tsx` | `/v1/beta/stats/*`, `/v1/beta/feedback/*` | ⚠️ API 存在但数据为零 |

---

## 已删除的 API 调用（不再使用）

| 原 UI | API | 删除原因 |
|-------|-----|---------|
| `DashboardView` | `GET /api/dashboard/{userId}` | 后端不存在，返回 404 |
| `DashboardView` | `GET /api/growth/{userId}` | 后端不存在，返回 404 |
| `GrowthChart` | `GET /api/growth/{userId}` | 组件已删除 |
| `PerformanceCharts` | (内部计算) | 组件已删除，无数据源 |
| `TokenSankey` | (内部计算) | 组件已删除，无数据源 |
| `StatsCards` | 无独立 API | 组件已删除 |
| `DecisionTimeline` | 无独立 API | 组件已删除 |
| `LearningPanel` | 无独立 API | 组件已删除 |
| `ObservabilityPanel` | 无独立 API | 组件已删除 |
| `Phase4Panel` | 无独立 API | 组件已删除 |
| `TasksView` | `/v1/tasks` | 组件已删除，非 TrustOS 主线 |

---

## 已验证的后端路由 (trustos/src/index.ts)

| 路由前缀 | 说明 |
|---------|------|
| `/v1/tasks` | Task CRUD |
| `/v1/agent-sessions` | Agent session (ManagerWorkspace 使用) |
| `/v1/memory` | Memory entries |
| `/v1/health` | 后端 health check |
| `/v1/decision` | Decision data (DebugPanel 使用) |
| `/v1/admin` | Admin 接口 (需 X-Admin-Key) |
| `/v1/beta` | Beta stats/feedback (数据为空) |

**不存在且已移除前端调用的路由**: `/v1/dashboard`, `/v1/growth`, `/api/dashboard`, `/api/growth`

---

## Gateway 端点 (独立进程)

| Endpoint | 前端使用 | 状态 |
|----------|---------|:---:|
| `GET /health` | GatewayStatusCard, Overview stats | ✅ |
| `GET /events?limit=N` | EventChainViewer, Overview stats | ✅ |
| `GET /report` | EvidenceReportPanel | ✅ |
| `GET /report?format=html` | Evidence HTML export | ✅ |
| `GET /report?format=md` | Evidence MD export | ✅ |
| `GET /report/summary` | (可用，当前未直接调用) | ✅ |
