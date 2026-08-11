# 提案：前端 UI 清理 — 混杂原始页面与新 UI

> **状态**: 待 PM 审核
> **日期**: 2026-07-21
> **分支**: `s101t-typescript-debt-cleanup`
> **作者**: Agent (基于 dev-current-state.md 待处理项 #1)

---

## 问题概述

当前前端存在 **原始 TrustOS 页面** 和 **新 Manager Workspace** 混杂的问题，导致代码库膨胀、维护困难、首屏加载慢。

## 现状发现（实测）

| 问题 | 严重度 | 影响 |
|------|--------|------|
| `ChatInterface` 被导入但从未渲染 | P2 | 死代码，增大 bundle |
| 6 个视图同时渲染（`display: none/block`） | P1 | 首屏加载时 6 个视图全部 mount + fetch |
| `/dashboard` 独立页面与 SPA DashboardView 重复 | P1 | 两套仪表盘，维护两倍成本 |
| ChatInterface 引用的 4-6 个子组件全为死代码 | P2 | 额外 ~300 行死代码 |
| 旧视图（Archive/Permissions/Tasks/Memory）可能无用户使用 | P3 | 代码膨胀 |
| Workbench 面板（5个）始终挂载 | P2 | 额外 fetch 请求 |

---

## 详情分析

### 1. ChatInterface 死代码链

`app/page.tsx` L5 导入 `ChatInterface` 但在 JSX 中从未渲染 — Chat 视图已切换为 `ManagerWorkspace`（S100P Phase 3）。

```
ChatInterface.tsx (364 行) ─ 仅自身使用
  ├── MessageBubble.tsx       — 仅 ChatInterface 用
  ├── ModelSwitchAnim.tsx     — 仅 ChatInterface 用
  └── ThinkingIndicator.tsx   — 仅 ChatInterface 用
```

### 2. 6 视图同时渲染问题

`app/page.tsx` 中 Chat / Tasks / Dashboard / Memory / Archive / Permissions 六个视图用 `display: none/block` 切换。这意味着：
- 所有 6 个视图在首次加载时全部 **mount**
- 每个视图的 `useEffect` 全部触发，并行 fetch
- 用户只看到 1 个视图，却为 6 个视图付费（带宽 + 渲染）

### 3. 双仪表盘

| 特性 | SPA DashboardView | /dashboard 独立页面 |
|------|------------------|---------------------|
| 组件 | PerformanceCharts, TokenSankey, LearningPanel, Phase4Panel, BetaPanel, AdminPanel | StatsCards, TokenSankey, DecisionTimeline, GrowthChart, LearningPanel, ObservabilityPanel |
| 入口 | Sidebar "概览" tab | 独立 URL |
| 状态 | 功能混杂（Beta/Admin 混在用户仪表盘） | 可能无人访问 |

两个仪表盘使用不同的组件组合但功能大量重叠。

### 4. 当前仍在使用的共享组件

| 组件 | 使用者 | 保留？ |
|------|--------|--------|
| `ExecutionMetadata` | ManagerConversation | ✅ 共享组件 |
| `SettingsModal` | page.tsx (全局弹窗) | ✅ 共享组件 |
| 其余 `components/chat/*` | ChatInterface（死代码） | ❌ 可删 |

---

## 建议方案（两个选项）

### 方案 A：保守清理（推荐，低风险）

**范围**: 仅删除确认死代码 + 修复渲染策略

| 步骤 | 操作 | 风险 |
|------|------|------|
| A1 | 移除 `page.tsx` 中 ChatInterface 的 dead import | 零风险 |
| A2 | 删除 `ChatInterface.tsx` + 其独生子组件 (MessageBubble, ModelSwitchAnim, ThinkingIndicator) | 低风险 — 确认无其他引用 |
| A3 | 将 6 视图从 `display:none` 改为条件渲染 (`activeView === 'chat' && <ManagerWorkspace />`) | 低风险 — 性能优化 |
| A4 | 检查 `ActionBar/CodeBlock/DecisionCard/PreviewPane/TaskProgress` 是否被 ChatInterface 唯一引用，若是则一并删除 | 低风险 |
| A5 | 合并 `/dashboard` 独立页面到 SPA DashboardView，移除独立路由 | 中风险 — 需确认无外部链接依赖 |

**预计**: 删除 ~800-1200 行死代码，首屏加载减少 5-6 个组件的 mount/fetch。

### 方案 B：激进清理（需 PM 确认业务需求）

在 A 的基础上额外：

| 步骤 | 操作 | 风险 |
|------|------|------|
| B1 | 确认 Archive/Permissions/Tasks/Memory 是否有用户使用 → 如无则删除 | 中风险 |
| B2 | 精简 DashboardView：移除 Beta/Admin 子标签到独立管理页面 | 中风险 |
| B3 | 精简 Workbench 面板：按需加载，非当前视图不挂载 | 低风险 |
| B4 | 删除 `frontend/src/` 下为 ChatInterface 服务的旧类型/旧 hook（如有） | 低风险 |

---

## 影响评估

| 指标 | 方案 A | 方案 B |
|------|--------|--------|
| 删除代码行数 | ~800-1200 | ~2000+ |
| 首屏组件挂载数 | 从 6 → 1 | 从 6 → 1 |
| 被动依赖风险 | 低 | 中 |
| 需 PM 确认项 | 0 | 3 (哪些视图/面板仍需保留) |

---

## PM 决策点

请 PM 确认以下事项：

1. **方案选择**: A（保守）还是 B（激进）？
2. **独立 /dashboard 页面**: 是否仍在外部使用？可以删除吗？
3. **旧视图（Archive/Permissions/Tasks/Memory）**: 是否有用户在使用？哪些可以砍？
4. **DashboardView 内嵌 Admin/Beta**: 是需要保留在仪表盘内，还是可以拆到独立管理区？
5. **Workbench 面板（Task/Evidence/Trace/Health/Debug）**: 哪些仍需保留？

---

## 下一步

PM 确认后，我将：
1. 按选定方案执行清理
2. 前端 tsc 验证（0 errors）
3. 前端 build 验证（6/6 静态页）
4. 回归 smoke test
