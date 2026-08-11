# TrustOS 前端模块产品价值审计 & 清理基线

> **版本**: v2.0 — PM + Agent + Boss 三方共识  
> **日期**: 2026-08-07  
> **状态**: 决策基线已确立，待执行  
> **文件层级**: `trustos/docs/frontend-module-audit-2026-08-06.md`

---

## 一、背景

当前前端导航混入了多轮试验性模块。有些是 TrustOS 核心产品，有些是早期 growth/beta/admin 实验，有些 API 已不存在，有些 API 存在但无真实数据。需要做一次 **UI/API/Product Value Rebaseline**。

**核心原则**：

> TrustOS = AI Gateway + Event Capture + Risk/Control Assessment + Evidence Report + Reviewer Handoff  
> TrustOS 不是通用 admin SaaS dashboard，不是 beta growth analytics 产品。

---

## 二、三面板 Bug 现状（实测）

| 面板 | 后端 API | 结果 | 根因 |
|------|----------|------|------|
| **Dashboard** | `/v1/dashboard`, `/v1/growth` | **404** | 后端无这两个接口 — DashboardView 是死代码 |
| **Beta** | `/v1/beta/stats/*`, `/v1/beta/feedback/*` | **200 OK 但数据全零** | 统计管线未接入真实使用数据 |
| **Admin** | `/v1/admin/*` | **401** | page.tsx 从空 localStorage 取 `admin_key`，传空字符串 |

---

## 三、设计文档对照 — 产品初心 vs 现状

### 3.1 关键设计文档

| 设计文档 | 定义的前端 | 结论 |
|----------|-----------|------|
| **[UX Blueprint](product/TrustOS-UX-Blueprint.md)** (T100) | 仅三栏布局：Session List / Manager Conversation / Session Detail | Dashboard/Beta/Admin **不在产品设计中** |
| **[S100P Development Plan](sprints/S100P-development-plan.md)** (PM ACCEPTED) | 10 条退出标准全部关于 Manager Workspace | Manager Workspace 是 S100P 产品入口 |
| **[T100 Planning Report](sprints/T100-planning-report.md)** | 明确纠正：TrustOS 不是 "admin dashboard" | Dashboard/Beta/Admin 是被否决的方向 |
| **[Loop Separation RFC](architecture/Loop-Separation-RFC.md)** | 核心原则：分离 Manager/Worker/Action Loop | 三栏布局是架构必然 |

### 3.2 现状 vs 设计

| Sidebar 导航项 | 现状 | 设计文档定义？ | 结论 |
|---------------|------|:---:|------|
| Chat → ManagerWorkspace | ✅ 有数据，S100P 实现 | ✅ UX Blueprint 核心 | Agent Mode，保留 |
| Tasks → TasksView | ⚠️ 待确认 | ❌ 未提及 | **应删除** |
| Memory → MemoryView | ⚠️ 待确认 | ✅ T100 核心资源列表有 memory | **保留为 OS 能力层**（见第五节） |
| Dashboard → DashboardView | ❌ API 404 | ❌ 明确排除 | **应删除/重建** |
| Beta → BetaPanel | ❌ 数据全零 | ❌ 从未定义 | **隐藏，保留代码** |
| Admin → AdminPanel | ⚠️ 前端 bug | ❌ 未提及 | **隐藏到 Advanced** |

---

## 四、最终模块分类（Boss 终裁）

### A 类：核心产品 — 必须保留

| 模块 | 价值 | 行动 |
|------|------|------|
| **Evidence Report** | **最高** — TRST-4A 已封板，reviewer 入口 | 保留并强化为第一优先级 |
| **Events & Traces** | **高** — TRST-3/4 核心闭环 | 保留，统一 API |
| **Gateway Health / Runtime Status** | **高** — reviewer/operator 必需 | 保留，只展示真实状态 |
| **Memory** | **高 — OS 核心能力层** | 保留架构定位，当前隐藏 UI，未来重点建设 |
| **Dashboard → 重建为 TrustOS Overview** | **入口有价值，但当前内容不合理** | 删除旧组件依赖，重建为真实数据驱动 |
| **Hash Verification / Privacy Guide** | **高** — TrustOS 产品差异化核心 | 保留为 Overview 内的说明区 |

#### 🔴 Memory 的专项说明（Boss 裁决，2026-08-07）

**初始误判回顾**：

- PM 判断：Memory 不在 TRST-3/4 主线 → 疑似遗留 → 建议删除
- Agent 初始同意（受 PM 报告影响）
- **Boss 纠正**：Memory 是 OS 的基础设施级能力，不能从 UI 面板反推其价值

**为什么 Memory 是 A 类**：

```
TrustOS 作为 OS 的三要素:
  计算 = Worker Runtime（模型推理/工具执行）
  存储 = Memory（上下文持久化、知识积累、检索）
  网络 = Gateway（请求路由、事件捕获）
```

没有 Memory，TrustOS 就是无状态的请求代理。T100 Planning Report 列出的 TrustOS 管理资源中，memory 排在第三位。

**Memory 应该是什么**（不是当前的 MemoryView UI 空壳）：

| 能力 | 说明 |
|------|------|
| Session Memory | 会话内上下文持久化（Session Runtime RFC 已定义） |
| Cross-Session Memory | 跨会话知识积累 |
| Memory Policy | 什么该记、什么不该记 |
| Memory Evidence | 记忆的可审计证明 |
| Memory Governance | 访问控制和生命周期管理 |
| Memory Retrieval | RAG for TrustOS |

**行动**：
- ✅ **保留 Memory 在产品路线图中的位置**（作为未来核心能力层）
- ❌ **当前 MemoryView UI 如果只有空壳，隐藏但不删除代码**
- ✅ **TrustOS Overview 中预留 Memory 状态展示位**
- ✅ **架构文档中明确 Memory 层的定义和接口**

---

### B 类：有价值但当前不应暴露 — 隐藏/降级

| 模块 | 价值 | 行动 |
|------|------|------|
| **Manager Workspace** | High — S100P/S101P 核心产品工程，Loop Separation 的实现 | 保留为 Experimental Agent Mode，不在主导航展示 |
| **Admin Panel** | 中 — 内部诊断有价值，但非用户主路径 | 隐藏到 Advanced，修复 admin key bug |
| **Beta Panel** | 未来可能用于 reviewer feedback 管理 | 隐藏但不删除代码，等真实数据管线 |
| **Debug + Health Panel** | 中 — developer/operator 诊断 | 合并到 Advanced Diagnostics |

#### Manager Workspace 的专项说明（Agent 坚持，Boss 同意）

Manager Workspace 不是遗留代码。它是 T100→S100P→S101P 阶段投入最大的产品工程。当前不在主导航展示的原因是 **TrustOS 当前处于 Console 模式（适合 reviewer）而非 Agent 模式（适合日常用户）**。两个模式未来可以共存：

```
Console 模式（当前默认）:   Overview → Evidence → Events → Gateway
Agent 模式（未来激活）:     Manager Workspace 三栏布局
```

**不删除**，保留为可切换模式，标记 "Experimental"。

---

### C 类：明确删除

| 模块 | 理由 |
|------|------|
| **ChatInterface + 死代码链**（MessageBubble, ModelSwitchAnim, ThinkingIndicator） | 已被 ManagerWorkspace 替代，无其他引用 |
| **DashboardView（旧）** | API 404，组件混杂，拆解后废弃 |
| **独立 /dashboard 页面** | 功能与 SPA DashboardView 重叠 |
| **TasksView** | 非 TrustOS 主线，无设计文档定义 |
| **GrowthChart / PerformanceCharts / TokenSankey / LearningPanel / Phase4Panel** 等无数据源组件 | 依赖不存在 API，或数据恒为零 |
| **`/v1/dashboard` `/v1/growth` 前端调用** | 后端不存在，不应补无意义 API |

---

### D 类：API 策略

**应该保留/标准化的 API**：

```
GET /health
GET /report
GET /report/summary
GET /events/recent
GET /events/:id
GET /traces/:traceId
GET /config/runtime
```

**不应该补的 API**：

```
GET /v1/dashboard
GET /v1/growth
GET /v1/beta/stats/:userId
GET /v1/beta/feedback/:userId
```

---

## 五、推荐导航结构

### 主导航（TrustOS Console）

```
🏠  Overview          — Gateway 状态 + 事件概览 + 报告摘要 + Memory 状态占位
📋  Evidence Report   — TRST-4A 核心交付（查看/下载/验证）
🔗  Events & Traces   — 事件时间线 + Trace 关联 + Hash 验证
⚙️  Gateway           — 运行时状态 + 配置
```

### 次级/隐藏

```
🔧  Advanced（折叠）
    ├── Diagnostics    — Debug + Health 合并
    └── Admin          — 标注 "Local diagnostic only"

实验模式（Feature-flag 控制，默认不渲染到导航）:
    🧠  Memory         — OS 核心能力，待建设
    💬  Agent Mode     — Manager Workspace
    🧪  Beta           — Reviewer feedback（等真实数据管线）
```

---

## 六、TRST-4X Console Cleanup 建议范围

在 TRST-4C (Durable Evidence Store) 之前插入轻量清理 Sprint。

| WP | 内容 | 预估影响 |
|----|------|---------|
| **WP1** | Navigation Rebaseline — 改 page.tsx + Sidebar.tsx，实现 4+Advanced 导航 | 2-3 文件修改 |
| **WP2** | Dashboard → Overview 重建 — 拆解 DashboardView，提取有价值组件到 Overview | 3-5 文件 |
| **WP3** | 删除死代码 — ChatInterface 链 + Tasks + DashboardView + Growth/Performance 等无数据组件 | 10-15 文件删除 |
| **WP4** | Admin key 修复 + 移到 Advanced | 1 文件 |
| **WP5** | 生成 `frontend-api-contract.md` — UI↔API 映射表，防止未来断链 | 1 新文件 |

**预计总变更**：~20 文件，删除 ~1500-2000 行，新增 ~500 行。

---

## 七、执行顺序

| 顺序 | 行动 | 类型 |
|------|------|------|
| 1 | 本文件作为决策基线冻结 | 文档 |
| 2 | Admin key 一行修复 | Bug |
| 3 | 删除 ChatInterface 死代码链 | Cleanup |
| 4 | Navigation Rebaseline（WP1） | 重构 |
| 5 | Dashboard → Overview 重建（WP2） | 重构 |
| 6 | 删除 C 类模块（WP3） | Cleanup |
| 7 | 生成 frontend-api-contract.md（WP5） | 文档 |
| 8 | 前端 tsc 0 error + build 验证 | 验证 |

---

## 八、参考文件

| 文件 | 用途 |
|------|------|
| `trustos/docs/proposals/frontend-cleanup-v1.md` | 清理方案 A/B（方案 A 已确认） |
| `trustos/docs/product/TrustOS-UX-Blueprint.md` | UX 蓝图（T100） |
| `trustos/docs/sprints/S100P-development-plan.md` | Manager Workspace v1 开发计划 |
| `trustos/docs/sprints/T100-planning-report.md` | T100 OS 重定义规划 |
| `trustos/docs/architecture/Loop-Separation-RFC.md` | Loop 分离架构原则 |
| `trustos/docs/strategy/TRST-0-trustos-architecture-thesis.md` | TrustOS 架构论文 |
| `trustos/docs/CODE-REVIEW-2026-05-11.md` | 前端+后端全面审查 (42 问题) |

---

## 九、修订记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-08-06 | v1.0 | 初始审计：三面板 Bug + 模块分类 + 设计文档对照 |
| 2026-08-07 | v1.1 | 新增设计文档对照章节（第五节） |
| 2026-08-07 | v2.0 | **Boss 终裁**：Memory 从 C 类提升至 A 类；Manager Workspace 明确保留为 Experimental；确立 4+Advanced 导航结构；TRST-4X 范围定义 |
