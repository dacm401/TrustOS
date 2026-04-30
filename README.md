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
┌─────────────────────────────────────────────┐
│  Hard Policy（极简红线）                     │
│  密码/账号/密钥/私人数据 → 直接拒绝          │
└─────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────┐
│  Learning Layer（学习层）                    │
│  用户反馈 → 记住 → 下次复用                  │
└─────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────┐
│  Human-in-the-Loop（用户兜底）              │
│  模糊地带 → 请示用户 → 记入学习层            │
└─────────────────────────────────────────────┘
```

---

## 核心特性

| 特性 | 说明 |
|:---|:---|
| **LLM-Native Routing** | Gated Delegation 四层（Score → Policy → Rerank → Learn），benchmark 72B 路由准确率 80-83% |
| **Manager-Worker 架构** | Fast/Manager 做分层决策，Slow/Worker 做执行，Fast 模型用户可选（默认 `Qwen2.5-72B-Instruct`） |
| **Phase 4 安全层** | Data Classification → SmallModelGuard → Redaction Engine，PII/凭证不过 Worker |
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
| **Fast Manager（本地层）** | 判断与分发 | 做判断、分发指令、控制信息流 |
| **Slow Worker（云端层）** | 任务执行 | 执行任务、返回结果 |
| **Task Archive** | 共享工作台 | 跨层传递结构化信息 |

### 四种标准动作

| 动作 | 说明 |
|:---|:---|
| `direct_answer` | Fast 模型直接回复 |
| `ask_clarification` | 请求澄清后再执行 |
| `delegate_to_slow` | 委托 Slow Worker 执行 |
| `execute_task` | 触发执行模式（多步骤） |

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

---

## 快速开始

```bash
git clone https://github.com/dacm401/TrustOS.git
cd TrustOS
cp .env.example .env   # 配置 OPENAI_API_KEY
docker-compose up -d   # 启动 PostgreSQL
npm install
npm run dev            # 端口 3001
npm run test:run       # 94 tests
```

> ⚠️ DeepSeek-V3/R1 在 SiliconFlow 不支持 function calling（会 hang），统一使用 Qwen 系列。

---

## 目录结构

```
src/
├── api/                    # HTTP 接口（chat/auth/dashboard/tasks/memory/permissions...）
├── services/               # 业务逻辑
│   ├── llm-native-router.ts     # Phase D Gated Delegation 核心
│   ├── execution-loop.ts         # Fast 同步执行循环
│   ├── permission-manager.ts     # Worker 权限审批流
│   ├── prompt-template-service.ts# Prompt 模板渲染
│   ├── cross-session-context.ts  # 跨会话上下文
│   ├── task-workspace.ts         # 共享工作区
│   ├── gating/                   # G1-G3 门控子模块
│   ├── phase3/                   # Worker 后台轮询
│   ├── phase4/                   # Data Classification / Redaction
│   ├── phase5/                   # Archive 存储后端
│   └── trust/                    # TrustPolicy Engine（T3-1~T3-3）
├── models/                 # 模型网关（OpenAI/Anthropic）
├── tools/                  # 工具注册 + 执行器
├── context/                # Token Budget / Context Compressor
├── db/                     # Repositories + ArchiveRepo + Connection
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

---

## 技术栈

| 类别 | 技术 |
|:---|:---|
| Runtime | TypeScript / Node.js / Hono（端口 3000 前端 / 3001 后端） |
| Database | PostgreSQL 16 + pgvector（Docker，端口 5432） |
| Models | SiliconFlow / OpenRouter — Fast 层默认 `Qwen2.5-72B-Instruct`，Slow 层用户可选 |
| Frontend | React + TypeScript（Next.js） |
| Testing | Vitest（94 tests） |

---

## 为什么不是别的方案

| 方案 | 问题 | TrustOS 的回答 |
|:---|:---|:---|
| 全上云 | 用户数据暴露，无法控制 | 本地守门，信息按分级流动 |
| 全本地 | 模型能力受限 | 云端只做执行，不持有上下文 |
| Prompt 写死规则 | 脆弱，无法学习 | Learning Layer 从用户反馈中进化 |
| 靠模型自觉 | 不可靠 | Hard Policy + TrustPolicy Engine 守住红线 |

