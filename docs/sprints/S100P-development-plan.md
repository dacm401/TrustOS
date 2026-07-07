# S100P Development Plan — Manager Workspace v1: Loop Separation in UX

Version: v1.0
Stage: S100P
Date: 2026-07-07
Status: ACCEPTED — PM Final Sign-off 2026-07-07

---

## 0. S100P Exit Criteria

S100P is complete when:

1. Manager Workspace three-column layout is available.
2. User can create a delegated task as an independent Session.
3. Session appears in Session List.
4. Session Detail shows Delegation Contract summary.
5. Worker/session events are stored as session_events.
6. Worker/session events appear in Session Detail, not main chat.
7. Approval Requests are bound to session_id.
8. Trust Report is bound to session_id.
9. Manager Conversation only shows Manager-level summaries.
10. Multiple Sessions can exist without event stream confusion.

---

## 1. Sprint Definition

```text
S100P — Manager Workspace v1: Loop Separation in UX
```

### Goal

把单体聊天体验拆成 Manager Workspace：
- 左侧 Session List
- 中间 Manager Conversation
- 右侧 Session Detail

### Core Value

每个委托任务成为独立 Session。
Worker 事件进入对应 Session。
主对话只显示 Manager 层摘要。
审批和 Trust Report 绑定具体 Session。

### Non-goals

S100P 不做：
- 完整 Agent Engine
- 完整远程 Sandbox
- 自动扩缩容
- 包管理执行环境
- Worker Marketplace
- 复杂 MCP 生态
- 浮动窗口系统
- 多桌面系统
- 完整 local daemon
- 完整 workflow engine

---

## 2. P0 Development Tasks

### Task S100P-001: Manager Workspace Layout

**Goal**: 实现三栏基础布局：Session List / Manager Conversation / Session Detail

**Scope**:
- 重构 `trustos/frontend/src/app/page.tsx` 三栏布局
- 左栏：SessionList（任务卡片列表，含状态/风险/审批指示）
- 中栏：ManagerConversation（仅 Manager Loop 内容）
- 右栏：SessionDetail（选中 Session 时展示详情）

**Files / Modules to inspect**:
- `trustos/frontend/src/app/page.tsx` — 当前三栏布局
- `trustos/frontend/src/components/layout/Sidebar.tsx` — 当前导航栏
- `trustos/frontend/src/components/layout/Header.tsx` — 顶栏

**Implementation Notes**:
- 当前已有三栏 CSS 结构（Sidebar 52px + Main flex-1 + Workbench w-96），需改为语义三栏
- 所有组件保持 `"use client"`（当前无 SSR）
- 使用 Tailwind CSS

**Acceptance Criteria**:
- 用户能同时看到主对话、任务列表、当前任务详情
- 切换 Session 不影响主对话状态
- 三栏可独立滚动

---

### Task S100P-002: Session Data Model

**Goal**: 实现或映射 agent_sessions 表

**Scope**:
- 评估现有 `sessions` + `tasks` + `task_archives` 三表是否可以映射为统一 agent_sessions
- 如不可行，新建 agent_sessions 表
- 字段至少包含：id, title, goal, status, worker_id, delegation_contract_id, risk_level, created_at, updated_at, completed_at

**Files / Modules to inspect**:
- `trustos/src/db/schema.sql` — 当前 schema
- `trustos/src/db/migrations/` — 现有迁移

**Implementation Notes**:
- 优先方案：不新建表，通过 VIEW 或 query 层映射现有三表到 agent_sessions 概念
- 如果映射复杂度高，新建 `agent_sessions` 表并做数据迁移
- `risk_level` 字段需要新增（当前缺失）

**Acceptance Criteria**:
- 每个委托任务都有独立 Session 记录
- Session 状态可更新（created → running → waiting_approval → completed 等）
- 可通过 API 查询 Session 列表

---

### Task S100P-003: Manager Messages Separation

**Goal**: 主对话消息和 Session 事件分离

**Scope**:
- 新建 `manager_messages` 表
- 字段：id, conversation_id, role, content, related_session_id (nullable), created_at
- `related_session_id` 链接 Manager 消息到具体 Session

**Files / Modules to inspect**:
- `trustos/src/db/schema.sql`
- `trustos/src/api/chat.ts` — 消息写入点

**Implementation Notes**:
- 当前消息未持久化到独立表（只在 ChatInterface state 中）
- 这是 S100P 新增功能，非破坏性变更
- Manager 摘要（如 "任务完成"）带 related_session_id

**Acceptance Criteria**:
- Worker 事件不再直接进入主 chat message 流
- Manager 摘要可关联 Session
- 主对话可通过 API 查询历史消息

---

### Task S100P-004: Session Events

**Goal**: 实现 session_events 表，Worker 事件按 Session 隔离

**Scope**:
- 重命名/扩展 `task_archive_events` → `session_events`
- 增加字段：type, summary, severity, visibility, raw_ref (nullable)
- visibility 枚举：silent_audit, session_timeline, approval_required, manager_chat_summary, trust_report_only, critical_alert

**Files / Modules to inspect**:
- `trustos/src/db/migrations/011_task_archive_events.sql` — 现有事件表
- `trustos/src/services/phase3/slow-worker-loop.ts` — Worker 事件生产者
- `trustos/src/services/phase3/sse-poller.ts` — 事件轮询

**Implementation Notes**:
- `task_archive_events` 已有基础事件类型，增加 visibility 字段即可
- Worker 事件写入 session_events 而非直接 SSE 到 chat
- 轮询改为按 session_id 过滤

**Acceptance Criteria**:
- Worker progress/action/approval/artifact 事件都能归属到具体 Session
- 多个任务并行时事件不混流
- Session Detail 可订阅特定 Session 的事件流

---

### Task S100P-005: Delegation Contract Summary Panel

**Goal**: 在 Session Detail 中展示 Delegation Contract 摘要

**Scope**:
- 新建 DelegationContractPanel 组件
- 展示：Goal, Allowed, Denied, Requires Approval, Success Criteria

**Files / Modules to inspect**:
- `trustos/src/db/schema.sql` — task_workspaces 表
- 现有 Workbench 面板组件

**Implementation Notes**:
- 复用 task_workspaces 表的 objective/constraints 字段
- 如果当前数据不够结构化，用 JSON 字段存储 allowed/denied/approvalRequired

**Acceptance Criteria**:
- 用户能一眼看到这个任务的边界
- Contract 摘要随 Session 选择切换

---

### Task S100P-006: Worker Timeline

**Goal**: 在 Session Detail 中展示 session_events timeline

**Scope**:
- 新建 WorkerTimeline 组件
- 按时间倒序展示事件
- 按 visibility 过滤：session_timeline + approval_required 级别显示
- silent_audit 和 trust_report_only 默认隐藏

**Files / Modules to inspect**:
- `trustos/src/api/tasks.ts` — GET /v1/tasks/:task_id/traces
- 现有 TaskPanel 组件

**Implementation Notes**:
- 使用 session_events 表数据
- 事件卡片按类型显示不同样式（允许/拒绝/审批/错误）

**Acceptance Criteria**:
- 低风险事件不刷主对话
- 重要事件显示在对应 Session Timeline
- 事件实时更新（SSE 订阅或轮询）

---

### Task S100P-007: Approval Card

**Goal**: 审批请求绑定 session_id 和 action_id

**Scope**:
- 新建 ApprovalCard 组件
- 扩展现有 permission_requests 表字段对齐
- 审批卡片显示：请求动作、Worker 原因、风险说明、Manager 建议、操作按钮

**Files / Modules to inspect**:
- `trustos/src/db/migrations/016_permission_workspace.sql` — permission_requests 表
- `trustos/src/api/human-review.ts` — 审批 API

**Implementation Notes**:
- 当前 permission_requests 有 session_id 字段 ✅
- 增加 risk_level, manager_recommendation 字段
- 审批结果写回 session_events

**Acceptance Criteria**:
- 用户能看到审批属于哪个任务
- 批准/拒绝后，状态写回对应 Session
- 审批卡片在 Session Detail 和 Manager Conversation 均可显示

---

### Task S100P-008: Trust Report Panel

**Goal**: 任务完成后在 Session Detail 展示 Trust Report

**Scope**:
- 新建 trust_reports 表
- 新建 TrustReportPanel 组件
- 字段：id, session_id, summary, allowed_actions_count, denied_actions_count, approval_count, sensitive_data_summary, artifact_refs, rollback_available, manager_assessment, created_at

**Files / Modules to inspect**:
- 无现有实现，全新开发

**Implementation Notes**:
- Trust Report 由 Manager Loop 在 Session 完成时生成
- 基于 session_events 汇总统计
- 在 Session Detail 显示，不在主对话刷屏

**Acceptance Criteria**:
- 每个 completed Session 有独立 Trust Report
- 主对话只显示完成摘要（如 "任务完成，Trust Report 已生成"）

---

### Task S100P-009: Manager Routing Logic

**Goal**: Manager 判断用户输入是新建任务、更新已有 Session、普通对话还是需要澄清

**Scope**:
- 扩展 Manager Loop 路由逻辑
- 4 种路由：new_task, update_session, direct_reply, ask_clarification

**Files / Modules to inspect**:
- `trustos/src/services/llm-native-router.ts` — G0-G4 gates
- `trustos/src/services/intent-classifier.ts` — 意图分类
- `trustos/src/services/task-planner.ts` — 任务规划

**Implementation Notes**:
- 现有路由逻辑已工作，增加 Session 更新/澄清路由
- 指代消解：当用户说 "登录页那个任务" 时，匹配已有 Session
- 多个 Session 指代不清时，只问一个澄清问题

**Acceptance Criteria**:
- 用户说 "登录页那个任务，不要改按钮文案" 时，系统能更新对应 Session
- 如果多个 Session 指代不清，只问一个澄清问题
- 新建任务时自动创建 Session 并显示在 Session List

---

### Task S100P-010: Visibility Rules

**Goal**: 实现事件 visibility 映射，控制事件展示位置

**Scope**:
- 实现 6 级 visibility 路由：
  - silent_audit → 仅审计日志
  - session_timeline → Session Detail 时间线
  - approval_required → Approval Card（Manager Chat + Session Detail）
  - manager_chat_summary → Manager Conversation 摘要
  - trust_report_only → 最终 Trust Report
  - critical_alert → Manager Chat 即时通知

**Files / Modules to inspect**:
- `trustos/src/services/phase3/slow-worker-loop.ts` — 事件生产者
- `trustos/src/api/chat.ts` — 事件 SSE 发送

**Implementation Notes**:
- 在 Worker 事件写入 session_events 时标记 visibility
- 前端按 visibility 分流到不同组件
- 默认规则：
  - 低风险文件读取 → silent_audit
  - 首次文件写入 → session_timeline
  - 秘密访问被拒 → session_timeline
  - 依赖安装请求 → approval_required
  - 重复安全操作 → trust_report_only

**Acceptance Criteria**:
- 低风险事件不打扰用户
- 审批事件进入 Session Detail
- critical_alert 可在主对话或全局提醒显示

---

## 3. P1 Development Tasks

P1 任务在 P0 完成后按需启动，不混入 P0 scope：

1. **Artifact / Diff Panel** — Session Detail 中的产物和差异展示
2. **View Audit** — 独立审计日志查看面板
3. **Session pin/search/filter** — Session List 的固定/搜索/过滤
4. **Session-specific input** — 在 Session Detail 中直接输入补充指令
5. **Session pause/resume basic controls** — Session 暂停/恢复基础控制
6. **Cross-session summary** — 跨 Session 汇总视图
7. **Rollback entry point** — 回滚入口（UI 层面，实际回滚逻辑在 S102P）

---

## 4. Implementation Order

```
Phase 1: Schema Foundation (Day 1-2)
  S100P-002: Session Data Model
  S100P-003: Manager Messages Separation
  S100P-004: Session Events

Phase 2: Backend Routing (Day 2-4)
  S100P-009: Manager Routing Logic
  S100P-010: Visibility Rules

Phase 3: Frontend Layout (Day 3-5)
  S100P-001: Manager Workspace Layout
  S100P-005: Delegation Contract Summary Panel

Phase 4: Session Detail (Day 5-7)
  S100P-006: Worker Timeline
  S100P-007: Approval Card
  S100P-008: Trust Report Panel

Phase 5: Integration & Polish (Day 7-8)
  端到端测试，事件流验证，UX 打磨
```

任务依赖关系：
- S100P-002/003/004 是基础设施，必须先做
- S100P-001 依赖 002 的 Session 数据模型
- S100P-005/006/007/008 依赖 001 的布局和 004 的事件表

---

## 5. Acceptance Criteria — S100P Complete

S100P 完成标准：

1. **三栏布局可用**：用户能看到 Session List / Manager Conversation / Session Detail
2. **Session 独立**：每个委托任务创建独立 Session，Worker 事件进入对应 Session
3. **主对话干净**：Manager Conversation 只显示 Manager 层内容，不包含 Worker 执行细节
4. **审批绑 Session**：审批请求显示所属任务，批准/拒绝写回对应 Session
5. **Trust Report 独立**：每个完成的 Session 有独立 Trust Report
6. **事件不混流**：多任务并行时，事件按 Session 隔离，不互相干扰
7. **Manager 路由正确**：新建任务、更新 Session、普通对话、澄清指代 四种路由工作正常

---

## 6. Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Schema migration 破坏现有数据 | High | 用 ADD COLUMN 非破坏性迁移，新建表不删旧表 |
| SSE 拆分导致事件丢失 | Medium | 保留旧 SSE 作为 fallback，逐步切换 |
| 前端三栏重构复杂度超预期 | Medium | 先做功能三栏（display:none/block 切换），再优化动画 |
| Manager 路由误判（新建 vs 更新） | Medium | 保守策略：指代不清时 ask_clarification，不猜测 |
| Migration SQL BOM 导致 Node.js pg 库报错 | Low | Migration runner should strip BOM from SQL files or enforce UTF-8 without BOM. Use `psql -f` as workaround. Affects automated migration pipeline. |

---

## 7. Branch and PR Rules

### Branch Name

```text
s100p-manager-workspace-v1
```

### PR Split by Phase

```text
PR-1: Schema Foundation (S100P-002, 003, 004)
PR-2: Backend Session/Event Routing (S100P-009, 010)
PR-3: Manager Workspace Layout (S100P-001, 005)
PR-4: Session Detail / Timeline / Approval (S100P-006, 007)
PR-5: Trust Report Integration (S100P-008)
PR-6: E2E Cleanup and Acceptance
```

### Scope Enforcement Rules

- No Agent Engine implementation in S100P PRs.
- No full Sandbox implementation in S100P PRs.
- No Worker Marketplace implementation in S100P PRs.
- No floating desktop window system in S100P PRs.
- Any scope expansion requires PM approval.

### PR Checklist

Each PR must include:
- [ ] Schema diff (if schema changes)
- [ ] API diff (if API changes)
- [ ] Key files list
- [ ] Test results
- [ ] No scope creep beyond assigned tasks

---

## 8. S100P Current Status

**Status: ACCEPTED**

### Completed Phases

| Phase | Title | Status | Smoke/Unit |
|---|---|---|---|
| Phase 1 | Schema Foundation | ✅ PASS | 35/35 PASS |
| Phase 1.5 | Schema/API Smoke | ✅ PASS | 35/35 PASS |
| Phase 2 | Backend Routing | ✅ PASS | 56 unit + 13 API PASS |
| Phase 3 | Frontend Layout | ✅ PASS | 21/21 PASS |
| Acceptance Freeze | Docs + Demo + Freeze | ✅ PASS | 4e64752 |

**Cumulative: 125/125 smoke + unit tests pass.**
**Acceptance Snapshot: `4e64752`**
**PM Final Sign-off: 2026-07-07**

### Exit Criteria

8/10 criteria met. 2 deferred (Approval Card, Trust Report) have schema foundation, UI pending Phase 4.

### Not Started

- Phase 4: Session Detail deep components (Worker Timeline, Approval Card, Trust Report)
- Phase 5: Trust Report / Approval UI / Integration hardening
- P1 Tasks: Artifact Panel, View Audit, Session search/filter, Cross-session summary, Rollback entry

### Commit Chain

```
74aa64f s100p phase3 manager workspace layout
aa9040f docs: update README for S100P Manager Workspace architecture
99fbb11 s100p phase2: update report with confirmed smoke results + dev plan
02adcfb s100p phase2 backend manager routing
565fa89 s100p phase1.5 smoke verification assets
216eb74 s100p phase1 schema foundation
```

### Sync Status

| Endpoint | Status |
|---|---|
| WorkBuddy | ✅ |
| Desktop | ✅ |
| origin/GitHub | ❌ Network blocked |

---

## 9. Acceptance Freeze Rules

S100P is in **acceptance freeze**. The following rules apply:

### Allowed
- Documentation updates (reports, plans, demo scripts)
- Smoke test additions or fixes
- Minor comment/code-doc corrections
- README or plan status updates

### Prohibited
- New product features
- New UI panels or components
- Worker Timeline expansion
- Approval Card implementation
- Trust Report Panel implementation
- Schema changes or migrations
- Routing rule modifications
- Session field extensions
- Agent Engine / Sandbox / MCP scope additions
- Floating window or desktop system work

### Lift Condition
S100P acceptance freeze lifted 2026-07-07 — PM declared S100P ACCEPTED.
Phase 4 requires separate authorization. See `docs/sprints/Post-S100P-planning-brief.md` for next sprint candidates.
