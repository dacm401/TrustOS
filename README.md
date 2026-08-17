# TrustOS — 信息分发架构

> **领导不是因为聪明，是因为信息多。**
> TrustOS 是一个解决"怎么让 AI 的权限和可见信息匹配"的系统。

---

## 核心洞察

**行业在做什么：** 造更强的 AI → 更大模型、更多 context、更强推理

**TrustOS 在做什么：** 造更精准的信息分发层 → 瓶颈从模型能力变成"谁决定给谁看什么"

这不是能力分层，是**信任架构**。

---

## 架构哲学

**少规则 + 强学习 + 必要时请示用户**

```
┌──────────────────────────────────────────────────────────┐
│  Hard Policy（极简红线）                                  │
│  密码/账号/密钥/私人数据 → 直接拒绝                        │
└──────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────┐
│  Learning Layer（学习层）                                  │
│  用户反馈 → 记住 → 下次复用                                │
└──────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────┐
│  Human-in-the-Loop（用户兜底）                             │
│  模糊地带 → 请示用户 → 记入学习层                          │
└──────────────────────────────────────────────────────────┘
```

---

## 当前架构：Manager Workspace

S100P 引入 **Loop Separation in UX**，将单体聊天拆分为三栏工作区：

```
┌──────────────┬────────────────────────┬─────────────────────┐
│              │                        │                     │
│  Session     │  Manager Conversation  │  Session Detail     │
│  List        │  (Manager 层摘要)       │  (Delegation        │
│              │                        │   Contract /        │
│  ┌────────┐  │  ┌──────────────────┐  │   Timeline /        │
│  │ Task 1 │  │  │ Manager: 任务完成 │  │   Approval /        │
│  │ ●active│  │  │ Trust Report 已生成│  │   Trust Report)    │
│  └────────┘  │  └──────────────────┘  │                     │
│  ┌────────┐  │                        │  ┌───────────────┐  │
│  │ Task 2 │  │                        │  │ Worker Events │  │
│  │ ✓ done │  │                        │  │ • progress    │  │
│  └────────┘  │                        │  │ • action      │  │
│              │                        │  │ • approval    │  │
│              │                        │  │ • artifact    │  │
│              │                        │  └───────────────┘  │
└──────────────┴────────────────────────┴─────────────────────┘
```

**核心原则：**
- 每个委托任务 = 独立 Session
- Worker 事件归属对应 Session，不进主对话
- Manager Conversation 只显示 Manager 层摘要
- 审批和 Trust Report 绑定具体 Session

---

## 核心特性

| 特性 | 说明 |
|:---|:---|
| **LLM-Native Routing** | Gated Delegation 四层（Score → Policy → Rerank → Learn），benchmark 72B 路由准确率 80-83% |
| **Manager-Worker 架构** | Fast/Manager 做分层决策，Slow/Worker 做执行，Fast 模型用户可选（默认 `Qwen2.5-72B-Instruct`） |
| **Manager Routing** | 5 级优先路由（explicit target → delegation → reference match → ambiguous → normal），中文 n-gram 语义匹配 |
| **Visibility Routing** | 6 级事件可见性（silent_audit / session_timeline / approval_required / manager_chat_summary / trust_report_only / critical_alert），控制事件展示位置 |
| **Session 隔离** | 每任务独立 Session，Worker 事件不混流，多任务并行互不干扰 |
| **TrustPolicy Engine** | 7条默认规则（fail-closed），支持 allow/deny/transform/ask_user 决策 |
| **Sanitizer Engine** | email/phone/name/bank-card 等内置脱敏器，支持自定义 transform |
| **权限授权流** | Worker 访问敏感数据前，需 Fast 审批（`permission_requests` 表 + 实时面板） |
| **Prompt 模板系统** | 数据库存储 + 版本控制 + 渲染服务，支持作用域（global/user/session） |
| **Cross-Session 上下文** | 跨会话摘要 + 未完成任务 + 关键事实注入 Manager prompt |
| **SSE 实时流** | 状态事件驱动（`pending` → `processing` → `done`），前端轮询 + Worker 后台轮询双路 |
| **Task Archive** | 结构化工作台，支持 Local/S3/PostgreSQL 多存储后端 |

---

## 技术架构：Manager-Worker Runtime

| 组件 | 角色 | 职责 |
|:---|:---|:---|
| **Fast Manager（本地层）** | 判断与分发 | 做判断、分发指令、控制信息流、Manager 路由 |
| **Slow Worker（云端层）** | 任务执行 | 执行任务、产出事件、上报进度 |
| **Session Layer** | 任务隔离 | 每委托任务为独立 Session，Worker 事件按 Session 隔离 |
| **Task Archive** | 共享工作台 | 跨层传递结构化信息、Persist Artifacts |

### 四种标准动作

| 动作 | 说明 |
|:---|:---|
| `direct_answer` | Fast 模型直接回复 |
| `ask_clarification` | 请求澄清后再执行 |
| `delegate_to_slow` | 委托 Slow Worker 执行，创建独立 Session |
| `execute_task` | 触发执行模式（多步骤） |

### Manager 路由决策

| 路由 | 触发条件 | 行为 |
|:---|:---|:---|
| `new_task` | 用户请求新任务 | 创建 Session + Delegation Contract |
| `update_session` | 指代已有 Session | 更新对应 Session 指令/约束 |
| `direct_reply` | 普通对话 | Manager 直接回复 |
| `ask_clarification` | 指代不清 | 只问一个澄清问题 |

### 数据分级

| 分级 | 说明 |
|:---|:---|
| `strictly_private` | 永不离开本地 |
| `confidential` | 需确认后可上云 |
| `internal` | 仅内部系统间流转 |
| `public` | 可对外公开 |

---

## 项目状态

| Phase | 内容 | 状态 |
|:---|:---|:---|
| Phase 0 | ManagerDecision 类型 + Schema 校验 | ✅ 完成 |
| Phase 1 | ManagerDecision MVP + chat.ts 路由 | ✅ 完成 |
| Phase 2 | Worker Prompt 分离 + Task Archive | ✅ 完成 |
| Phase 3 | Local Trust Gateway + 数据分级 | ✅ 完成 |
| Phase 4 | Permission Layer + Hard Policy | ✅ 完成 |
| Phase 5 | 审计归档 + Learning Layer | ✅ 完成 |
| S100P P1 | Schema Foundation (agent_sessions, manager_messages, session_events) | ✅ 完成 |
| S100P P2 | Backend Routing (Manager Router + Visibility Router) | ✅ 完成 |
| S100P P3 | Manager Workspace Layout (三栏前端) | ✅ 完成 |
| S100P P4 | Session Detail (Timeline / Approval / Trust Report) | ✅ 完成 |
| S101P/S102P | Executive Visibility (ExecutionMetadata / usage / progress) | ✅ 完成 |
| Manager Loop v0 (MWT-12~20) | Conversation→Contract→Approved→Attempt→Review 全链路 | ✅ 完成 (live PASS 2026-08-17) |
| TRST-2 / TRST-3 | 产品闭环 + Private Beta Release Pack (52/52 AC) | ✅ CLOSED |
| 当前门禁 | 详见 `docs/strategy/TRST-execution-log.md` | — |

---

## 快速开始

```bash
git clone https://github.com/dacm401/TrustOS.git
cd TrustOS
cp .env.example .env   # 配置 API keys
docker-compose up -d   # 启动 PostgreSQL
npm install
npm run dev            # 端口 3001
npm run test           # Vitest
```

> ⚠️ DeepSeek-V3/R1 在 SiliconFlow 不支持 function calling（会 hang）；当前默认使用 **DeepSeek-V4-Flash**（已验证 function calling / 路由正常）。Qwen 系列仍可用。

---

## Private Beta（受控私有测试）

当前分支 `feature/trst-3-private-beta-readiness` 已具备 Private Beta Release Pack。
operator 从零开始的上手与发布门禁文档：

| 文档 | 用途 |
|:---|:---|
| `docs/private-beta/QUICKSTART.md` | 复制粘贴命令 + 预期结果 |
| `docs/private-beta/OPERATOR_ONBOARDING.md` | 完整 onboarding 流程（install → configure → validate → demo → report） |
| `docs/private-beta/BETA_ACCEPTANCE_CRITERIA.md` | Candidate / Full READY / Rejected 判定 |
| `docs/private-beta/RUNBOOK.md` | 安装、启动、验证、排障 |
| `docs/private-beta/ENVIRONMENT.md` | 环境要求（DB/gateway/chrome） |
| `docs/private-beta/KNOWN_BLOCKERS.md` | 已知 blocker（历史 blocker 已消解，详见执行日志） |

环境模板（仅空 key，无真实 secret）：

```bash
cp .env.private-beta.example .env   # 仅在需要 TRST-4H-III live 时填写
```

一键检查 / 报告：

```bash
npm run beta:check     # 文档包一致性门禁（offline）
npm run beta:report    # 生成 operator-facing readiness report
npm run validate       # 完整验证（deterministic + live）
```

> 当前总体状态：**`PRIVATE_BETA_READY` ✅**（产品/前端/浏览器/文档已就绪；
> 2026-08-17 已实测 live run：Postgres + Gateway 全链路跑通，MWT-12 LIVE_PASS，真实 `[LIV]` 证据落库。
> 外部 reviewer 会话按 operator 决策取消，局限声明见 `docs/private-beta/BETA_CANDIDATE_STATUS.md`）。

---

## 目录结构

```
src/
├── api/                    # HTTP 接口
│   ├── chat.ts / auth.ts / dashboard.ts / tasks.ts ...
│   ├── agent-sessions.ts        # S100P: Session CRUD API
│   ├── manager-messages.ts      # S100P: Manager 消息 API
│   ├── manager-route.ts         # S100P: Manager 路由 API
│   └── session-events.ts        # S100P: Session 事件 API
├── services/               # 业务逻辑
│   ├── llm-native-router.ts     # Phase D Gated Delegation 核心
│   ├── execution-loop.ts         # Fast 同步执行循环
│   ├── permission-manager.ts     # Worker 权限审批流
│   ├── prompt-template-service.ts# Prompt 模板渲染
│   ├── cross-session-context.ts  # 跨会话上下文
│   ├── task-workspace.ts         # 共享工作区
│   ├── manager-routing/          # S100P: Manager 路由逻辑
│   │   ├── manager-router.ts     #   5 级优先路由引擎
│   │   └── manager-routing-types.ts
│   ├── visibility-routing/       # S100P: 事件可见性路由
│   │   ├── visibility-router.ts  #   6 级 visibility 映射
│   │   └── visibility-types.ts
│   ├── gating/                   # G1-G3 门控子模块
│   ├── phase3/                   # Worker 后台轮询
│   ├── phase4/                   # Data Classification / Redaction
│   ├── phase5/                   # Archive 存储后端
│   └── trust/                    # TrustPolicy Engine（T3-1~T3-3）
├── models/                 # 模型网关（OpenAI/Anthropic）
├── tools/                  # 工具注册 + 执行器
├── context/                # Token Budget / Context Compressor
├── db/                     # Repositories + Migrations
│   ├── repositories/            # agent-session / manager-message / session-event ...
│   ├── migrations/              # 024_s100p_schema_foundation.sql ...
│   └── schema.sql               # Full DDL
├── logging/                # Decision Logger / Metrics Calculator
├── middleware/             # Identity / JWT / Rate Limit
├── config/                 # Config + Model Capability Matrix
└── types/                  # TypeScript 类型定义
```

---

## 相关文档

- `docs/ARCHITECTURE-DESIGN-PRINCIPLES.md` — 架构设计原则
- `docs/GATED-DELEGATION-v2.md` — Phase D 架构详细设计
- `docs/lean-agent-runtime-spec.md` — 完整规范
- `docs/MANAGER-DECISION-SCHEMA.md` — 决策 Schema
- `docs/dev-rules.md` — 开发规范
- `docs/sprints/S100P-development-plan.md` — S100P 开发计划
- `docs/sprints/S100P-phase2-report.md` — S100P Phase 2 报告

---

## 技术栈

| 类别 | 技术 |
|:---|:---|
| Runtime | TypeScript / Node.js / Hono（端口 3000 前端 / 3002 后端 / Gateway 8787） |
| Database | PostgreSQL 16 + pgvector（Docker，端口 5432） |
| Models | SiliconFlow / OpenRouter — Fast 层默认 `Qwen2.5-72B-Instruct`，Slow 层用户可选 |
| Frontend | React + TypeScript（Next.js） |
| Testing | Vitest（200+ tests，含 S100P 56 路由测试） |

---

## 为什么不是别的方案

| 方案 | 问题 | TrustOS 的回答 |
|:---|:---|:---|
| 全上云 | 用户数据暴露，无法控制 | 本地守门，信息按分级流动 |
| 全本地 | 模型能力受限 | 云端只做执行，不持有上下文 |
| Prompt 写死规则 | 脆弱，无法学习 | Learning Layer 从用户反馈中进化 |
| 靠模型自觉 | 不可靠 | Hard Policy + TrustPolicy Engine 守住红线 |
| 单体聊天 | Worker 事件泛滥，多任务混流 | Session 隔离 + Visibility 路由，每个任务独立 |

