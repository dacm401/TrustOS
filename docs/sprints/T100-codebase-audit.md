# T100 Codebase Audit — S100P Readiness Assessment

Version: v0.1
Date: 2026-07-03
Status: Complete

---

## 1. Audit Summary

| Category | Assets Found | Ready | Needs Adaptation | Missing |
|---|---|---|---|---|
| Layout/UI | 4 | 1 | 3 | 0 |
| Data Models | 10 | 2 | 6 | 2 |
| API Routes | 16 | 10 | 4 | 2 |
| Worker/Events | 5 | 1 | 3 | 1 |
| Streaming | 3 | 0 | 3 | 0 |
| **Total** | **38** | **14** | **19** | **5** |

~37% ready, ~50% needs adaptation, ~13% missing.

---

## 2. Capability-to-Module Mapping

### 2.1 Layout / UI Components

| Capability Needed | Current Module | Current State | Gap | Recommended Change |
|---|---|---|---|---|
| **ManagerWorkspace layout** | `trustos/frontend/src/app/page.tsx` | 已有三栏: Sidebar(52px) + Main(flex-1) + Workbench(w-96) | 当前三栏语义不对: 左=导航, 中=内容, 右=工具面板 | 重构为: SessionList / ManagerConversation / SessionDetail |
| **SessionList** | `trustos/frontend/src/components/layout/Sidebar.tsx` | 6个导航项(Chat/Tasks/Memory/Dashboard/Beta/Admin), CSS切换视图 | 无 Session 卡片列表, 无状态/风险/审批指示 | 新建 SessionList 组件, 复用 Sidebar 位置 |
| **ManagerConversation** | `trustos/frontend/src/components/chat/ChatInterface.tsx` (27.69 KB) + `MessageBubble.tsx` (14.52 KB) | 单列消息流, SSE 逐行解析, MessageBubble 渲染 | 当前所有事件混入 chat stream | 保留核心对话能力, 去掉 Worker 事件混入, 增加 Session 关联 |
| **SessionDetail** | 无独立组件 | Workbench 包含 TaskPanel + 4个Tab面板(Evidence/Trace/Health/Debug) | 无可用的 Session Detail 面板 | 新建 SessionDetail 组件: DelegationContract + WorkerTimeline + ApprovalCard + TrustReport |

### 2.2 Data Models / Database Schema

**主 Schema 文件**: `trustos/src/db/schema.sql` (26.28 KB)

| Capability Needed | Current Table | Current State | Gap | Recommended Change |
|---|---|---|---|---|
| **agent_sessions** | `sessions` (会话) + `tasks` (任务) + `task_archives` (委托档案) | 三张表已有 session 生命周期字段 | 分散在三张表, 字段不完整 (缺 risk_level, worker_id, delegation_contract_id) | 新建或重命名为 `agent_sessions`, 合并关键字段 |
| **manager_messages** | 无独立表 | 消息通过 ChatInterface 本地 state 管理, 未持久化到独立表 | **完全缺失** | 新建表: id, conversation_id, role, content, related_session_id, created_at |
| **session_events** | `task_archive_events` (迁移 011) | 已有事件类型: archive_created, worker_started, worker_completed, manager_synthesized, permission_denied, approval_requested 等 | 表名不同, 缺 visibility 字段 | 重命名为 session_events, 增加 type/summary/severity/visibility/raw_ref |
| **approval_requests** | `permission_requests` (迁移 016) | 字段: id, task_id, worker_id, session_id, field_name, purpose, status, expires_in | 字段结构不同 (缺 risk_level, manager_recommendation, options) | 对齐字段, 增加 session_id 关联 |
| **trust_reports** | 无独立表 | 只在 TrustOS-UX-Blueprint.md 文档中定义 | **完全缺失** | 新建表: id, session_id, summary, allowed_actions_count, denied_actions_count, approval_count, etc. |
| **delegation_contracts** | `task_workspaces` (部分) | 有 objective, constraints, shared_outputs | 缺 allowed/denied/approval-required 结构化字段 | 扩展或新建 delegation_contracts 表 |
| **audit_events** | `decision_logs` + `task_archive_events` | 已有决策日志和事件日志 | 分散, 缺统一 audit event 表 | 可暂用现有表, S101P 再统一 |

**现有其他相关表**: `task_commands`, `task_worker_results`, `delegation_logs`, `scoped_tokens`, `session_summaries`, `human_review`

### 2.3 API Routes

**路由入口**: `trustos/src/index.ts` (Hono 框架)
**路由文件目录**: `trustos/src/api/` (16 个文件)

| Capability Needed | Current Route | Current State | Gap | Recommended Change |
|---|---|---|---|---|
| **Manager Conversation API** | `POST /api/chat` (`chat.ts`) | SSE streaming, Manager 路由逻辑内嵌 | 路由逻辑在单一端点内, 事件混流 | 保持 POST /api/chat, 增加 Manager-only 响应模式 |
| **Session CRUD** | `GET /v1/tasks/*`, `GET /v1/sessions` | tasks 端点较完整 (CRUD + traces + decision) | 命名不一致 (task vs session) | 统一为 `/v1/sessions/*`, 增加 PATCH/POST/DELETE |
| **Session Events** | `GET /v1/tasks/:task_id/traces` | 返回 trace 数据 | 需要 session_events 端点 | 新增 `GET /v1/sessions/:id/events` |
| **Approval Resolution** | `POST /v1/human-review` (`human-review.ts`) | 人工审核解决 | 需要绑 session_id 的 approval 端点 | 新增 `POST /v1/sessions/:id/approvals/:action_id` |
| **Trust Report** | 无 | — | **完全缺失** | 新增 `GET /v1/sessions/:id/trust-report` |
| **Manager Messages** | 无 | — | **完全缺失** | 新增 `GET /v1/conversations/:id/messages` |

**中间件栈**: cors → betaInvite → rateLimit → identity → (chat only: costCap + quota)
所有 `/api/*` 和 `/v1/*` 已通过身份验证。

### 2.4 Worker Execution & Events

| Capability Needed | Current Module | Current State | Gap | Recommended Change |
|---|---|---|---|---|
| **Worker Loop execution** | `trustos/src/services/phase3/slow-worker-loop.ts` (58.47 KB) | Cycle Runtime 完整, 支持 pre-gen initialContent, 委托执行 | 执行结果通过 chat SSE 流回, 未路由到 Session | Worker 事件改为写入 session_events 表, 不再直接 SSE 到 chat |
| **Worker Events production** | `slow-worker-loop.ts` + `sse-poller.ts` | `pollArchiveAndYield()` 轮询 task_archives 并 yield SSE events | 事件直接写入 chat stream | 事件写入 session_events 表 + 通知 Session Detail 订阅 |
| **Manager routing** | `trustos/src/services/llm-native-router.ts` (G0-G4 gates) + `intent-classifier.ts` + `task-planner.ts` | ✅ 路由工作正常 | 无显式 Loop 边界, 嵌入 chat request lifecycle | 抽取 ManagerLoop 为独立模块, 明确 Session 创建/更新/查询 分流 |
| **Action Loop** | `trustos/src/services/local-manager-runtime.ts` + `execution-policy.ts` | ⚠️ 部分实现, 非统一拦截点 | Worker 可能绕过 | S101P 实现统一 Action Loop 拦截 |
| **Event visibility routing** | 无 | 事件直接入 chat 或 archive_events | **完全缺失** | 新增 visibility 映射: silent_audit / session_timeline / approval_required / manager_chat_summary / trust_report_only / critical_alert |

### 2.5 Streaming / SSE

| Capability Needed | Current Module | Current State | Gap | Recommended Change |
|---|---|---|---|---|
| **Chat SSE** | `trustos/src/api/chat.ts` | Hono stream(), SSE headers, 事件: thinking/fast_reply/status/done/error | 所有事件混入一条 SSE 流 | 拆分: Manager chat SSE (仅 Manager Loop 内容) + Session events SSE (订阅特定 session) |
| **Frontend SSE consumer** | `ChatInterface.tsx` | `fetch` + `ReadableStream`, 逐行解析 `data:` JSON | 单一消费者, 无法区分 Manager/Worker 事件 | 分离为 ManagerChatStream + SessionEventStream |
| **Worker polling** | `sse-poller.ts` | `pollArchiveAndYield()` 轮询 task_archives | 轮询模式, 非事件驱动 | 改为事件驱动 (DB notify 或 WebSocket), S100P 可暂保留轮询 |

### 2.6 Frontend Architecture

| Aspect | Current State | S100P Readiness |
|---|---|---|
| **Framework** | Next.js (app router), 全客户端渲染 (`"use client"`) | ✅ 无 SSR 阻塞风险 |
| **State Management** | React Query (dashboard), local useState (chat) | ⚠️ 需要跨组件 Session 状态共享 |
| **localStorage** | API key, LLM config 存储 | ✅ 仅客户端配置, 无 SSR 冲突 |
| **Routing** | 单页面, Sidebar 切换视图 (display:none/block) | ⚠️ 可保留但需加 Session 选择路由 |
| **Styling** | Tailwind CSS | ✅ 可直接用于三栏布局 |

---

## 3. Gap Priority Matrix

### Blockers (Must resolve before S100P coding)

| # | Gap | Impact | Effort |
|---|---|---|---|
| B1 | manager_messages 表不存在 | Manager 对话无法持久化分离 | Medium |
| B2 | session_events 表命名/字段不对齐 | Worker 事件无法按 Session 路由 | Low (rename + add columns) |
| B3 | trust_reports 表不存在 | Session 完成无法生成独立报告 | Medium |
| B4 | SSE 事件混流 | Worker 事件继续刷屏主对话 | High |

### High Priority (Should resolve in S100P)

| # | Gap | Impact | Effort |
|---|---|---|---|
| H1 | 三栏布局语义不对 | 无法承载 Manager Workspace | Medium |
| H2 | agent_sessions 表分散 | Session 数据查询复杂 | Medium |
| H3 | approval_requests 字段不对齐 | 审批无法绑 session_id | Low |
| H4 | 无 Session Detail 组件 | 右侧面板无可用内容 | High |

### Medium Priority (Can defer to S101P+)

| # | Gap | Impact | Effort |
|---|---|---|---|
| M1 | Action Loop 非统一拦截点 | Worker 可绕过策略 | High (S101P) |
| M2 | delegation_contracts 表不完整 | Contract 无法结构化存储 | Medium |
| M3 | Event visibility routing 缺失 | 无法按优先级路由事件 | Medium |

---

## 4. Recommended Migration Strategy

### Phase 1: Schema Foundation (先做, 无破坏性)

1. 新建 `manager_messages` 表 (独立于现有表, 零风险)
2. 新建 `trust_reports` 表
3. 重命名 `task_archive_events` → `session_events`, 增加 visibility 字段
4. 扩展 `permission_requests` 对齐 approval_requests 字段

### Phase 2: Backend Refactoring

5. Worker events 写入 session_events 表, 不再直接 SSE 到 chat
6. 新增 Session Detail SSE 端点 (订阅特定 session_id)
7. Manager chat SSE 仅发送 Manager Loop 内容
8. 新增 `/v1/sessions/*` CRUD 端点

### Phase 3: Frontend Rebuild

9. 重构三栏布局为 SessionList / ManagerConversation / SessionDetail
10. 实现 SessionList 组件 (复用任务查询)
11. 实现 SessionDetail 组件 (DelegationContract + WorkerTimeline + ApprovalCard + TrustReport)
12. ManagerConversation 去掉 Worker 事件, 仅显示 Manager 摘要

---

## 5. Key File Inventory

### Files to Modify (S100P)

| File | Reason |
|---|---|
| `trustos/frontend/src/app/page.tsx` | 三栏布局重构 |
| `trustos/frontend/src/components/chat/ChatInterface.tsx` | 去 Worker 事件, 保留 Manager 对话 |
| `trustos/frontend/src/components/layout/Sidebar.tsx` | 改为 SessionList |
| `trustos/src/api/chat.ts` | 拆分 SSE 流 |
| `trustos/src/api/tasks.ts` | 统一为 sessions 端点 |
| `trustos/src/services/phase3/slow-worker-loop.ts` | Worker 事件写入 session_events |
| `trustos/src/services/phase3/sse-poller.ts` | 改为 Session-scoped 事件轮询 |
| `trustos/src/db/schema.sql` | 新增/重命名表 |

### Files to Create (S100P)

| File | Purpose |
|---|---|
| `trustos/frontend/src/components/workspace/SessionList.tsx` | Session 卡片列表 |
| `trustos/frontend/src/components/workspace/SessionDetail.tsx` | Session 详情面板 |
| `trustos/frontend/src/components/workspace/WorkerTimeline.tsx` | Worker 事件时间线 |
| `trustos/frontend/src/components/workspace/ApprovalCard.tsx` | 审批卡片 |
| `trustos/frontend/src/components/workspace/TrustReportPanel.tsx` | Trust Report 面板 |
| `trustos/frontend/src/components/workspace/DelegationContractPanel.tsx` | 委托合同摘要 |
| `trustos/src/api/sessions.ts` | Session CRUD API |
| `trustos/src/api/session-events.ts` | Session Events API |
| `trustos/src/db/migrations/0XX_s100p_schema.sql` | S100P Schema 迁移 |

### Files NOT to Touch (out of scope)

| File | Reason |
|---|---|
| Agent Engine / Sandbox code | S100P non-goal |
| MCP / Worker Registry | S104P+ |
| Local daemon | S103P+ |
| Workflow engine | S102P+ |

---

## 6. S100P Implementation Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Existing chat stream mixes Manager and Worker events | Loop Separation fails | Split manager_messages and session_events |
| Existing SSE sends all events to chat | UI event mixing persists | Add visibility routing in Phase 2 |
| Existing task tables do not map cleanly to Sessions | Data migration complexity | Introduce compatibility layer via VIEW or query adapter |
| Existing permission_requests lack session ownership | Approval attribution unclear | Require session_id for all approval_requests |
| Three-column UI exists only visually, not semantically | False separation | Bind each panel to distinct data source |
| Trust Report missing source events | Reports not reproducible | Generate from session_events + audit events |
| Schema migration breaks existing data | Data loss or app crash | Use ADD COLUMN non-destructive migration; never drop old tables |
| SSE split causes event loss | Worker progress invisible | Retain old SSE as fallback during transition |
| Frontend three-column refactor exceeds estimate | Schedule slip | Start with functional display:none/block toggle, polish later |
| Manager routing misclassifies intent | Wrong Session targeted or created | Conservative: ask_clarification on ambiguity; never guess |
