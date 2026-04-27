# SmartRouter Pro V2

**轻量 AI Runtime** — 基于 Manager-Worker 架构的智能路由系统。

> 核心设计：Fast 模型（7B）做"守门人"，Slow 模型（72B）做"执行者"。所有委托决策带置信度日志，支持实时流式反馈。

---

## 核心特性

| 特性 | 说明 |
|------|------|
| **LLM-Native Routing** | Gated Delegation 四层（Score → Policy → Rerank → Learn），benchmark 72B 路由准确率 80-83% |
| **Manager-Worker 架构** | Fast/Manager 做分层决策，Slow/Worker 做执行，Fast 配置 `Qwen2.5-72B-Instruct` |
| **Phase 4 安全层** | Data Classification → SmallModelGuard → Redaction Engine，PII/凭证不过 Worker |
| **权限授权流** | Worker 访问敏感数据前，需 Fast 审批（`permission_requests` 表 + 实时面板） |
| **Prompt 模板系统** | 数据库存储 + 版本控制 + 渲染服务，支持作用域（global/user/session） |
| **Cross-Session 上下文** | 跨会话摘要 + 未完成任务 + 关键事实注入 Manager prompt |
| **SSE 实时流** | 状态事件驱动（`pending` → `processing` → `done`），前端轮询 + Worker 后台轮询双路 |
| **Task Archive** | 结构化工作台，支持 Local/S3/PostgreSQL 多存储后端 |
| **Benchmark CI** | L1/L2 离线用例 + 在线 SiliconFlow 路由评测，Gate: L1≥85% L2≥75% |

---

## 技术栈

| 层级 | 技术 |
|------|------|
| Runtime | TypeScript + Node.js + Hono（端口 3000 前端 / 3001 后端） |
| Database | PostgreSQL 16 + pgvector（Docker，端口 5432） |
| 模型 | SiliconFlow — Fast 层 `Qwen2.5-72B-Instruct`，Slow 层 `Qwen2.5-72B-Instruct` |
| 部署 | Docker + Docker Compose |

> ⚠️ DeepSeek-V3/R1 在 SiliconFlow 不支持 function calling（会 hang），统一使用 Qwen 系列。

---

## 快速启动

```bash
# 1. 复制配置
cp .env.example .env
# 填入 SILICONFLOW_API_KEY

# 2. 启动数据库
docker-compose up -d postgres

# 3. 安装依赖
npm install

# 4. 开发启动（前后端各自运行）
npm run dev          # 后端，端口 3001
npm run frontend     # 前端，端口 3000（若分离）

# 生产构建
npm run build && npm start
```

---

## 测试

```bash
npm run test:run     # vitest 全量（570 tests），tsc --noEmit 先跑
npm run test:watch   # watch 模式
npm run benchmark     # routing benchmark（需要 backend 在线）
npm run benchmark:l1  # L1 简单任务（30 cases）
npm run benchmark:l2  # L2 复杂任务（30 cases，需要 SiliconFlow）
```

---

## API 概览

### 认证
| Method | Path | 说明 |
|--------|------|------|
| POST | `/auth/login` | 登录，返回 JWT |

### 聊天（核心）
| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/chat` | 聊天消息，stream=true 返回 SSE |
| POST | `/api/chat/:taskId/execute` | 触发 Worker 执行 |
| POST | `/api/chat/:taskId/feedback` | 提交反馈（accepted/rejected/edited） |
| POST | `/api/chat/:taskId/permission-response` | 权限响应（allow/deny） |

### 任务 & 会话
| Method | Path | 说明 |
|--------|------|------|
| GET | `/v1/tasks/:id` | 获取任务详情 |
| GET | `/v1/tasks/:id/plan` | 获取执行计划 |
| GET | `/v1/tasks/:id/results` | 获取执行结果 |
| GET | `/v1/tasks/:id/trace` | 获取 Trace |
| GET | `/v1/sessions/:id/summary` | 获取会话摘要 |
| POST | `/v1/sessions/:id/summary` | 更新会话摘要 |
| GET | `/v1/sessions/recent` | 最近会话列表 |

### Prompt 模板
| Method | Path | 说明 |
|--------|------|------|
| GET | `/v1/prompt-templates` | 列表 |
| POST | `/v1/prompt-templates` | 创建 |
| PUT | `/v1/prompt-templates/:id` | 更新 |
| DELETE | `/v1/prompt-templates/:id` | 删除 |
| POST | `/v1/prompt-templates/:id/activate` | 激活版本 |
| GET | `/v1/prompt-templates/active` | 获取当前生效模板 |

### 权限
| Method | Path | 说明 |
|--------|------|------|
| GET | `/v1/permissions/pending` | 待审批权限 |
| POST | `/v1/permissions/:id/allow` | 允许 |
| POST | `/v1/permissions/:id/deny` | 拒绝 |
| GET | `/v1/workspaces` | 活跃工作区 |
| GET | `/v1/workspaces/:taskId` | 按任务查工作区 |

### 其他
| Method | Path | 说明 |
|--------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/api/dashboard/stats` | 仪表盘统计 |
| GET | `/v1/memory/...` | Memory API |
| GET | `/v1/archive/...` | Archive API |

---

## 架构：请求处理流

```
用户消息
    ↓
POST /api/chat
    ↓
┌─────────────────────────────────────────────────────┐
│ 1. 身份认证 & Rate Limit                           │
│ 2. Task Resume（显式 task_id / 隐式 active task） │
│ 3. Permission 响应拦截（allow/deny）              │
└─────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────┐
│ 4. Cross-Session Context 构建                      │
│    (active_task + key_facts + incomplete_tasks)   │
└─────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────┐
│ 5. Route Dispatch（Phase D Gated Delegation）      │
│    L1: Complexity Scorer → 快速分类                │
│    L2: Gated Delegation                            │
│       G1: Action Score Head（LLM 多动作打分）      │
│       G2: Policy-Calibrated Gate（硬策略 + 配置）  │
│       G3: Rerank-on-Uncertainty（top1-top2 差值）  │
│       G4: Delegation Learning Loop（日志写入）     │
│    Layer Rollout（config.layer2.rollout 灰度）     │
└─────────────────────────────────────────────────────┘
    ↓
┌──────────────────┐    ┌──────────────────────────────┐
│ delegate_to_slow │ →  │ Worker Loop（后台轮询）      │
│  (Fast 直接回答) │ →  │ Slow 模型执行 → SSE 流推送   │
└──────────────────┘    └──────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────┐
│ 6. Permission Layer（Worker 访问敏感数据时）       │
│    Data Classification → 审批请求 → 用户确认        │
└─────────────────────────────────────────────────────┘
    ↓
SSE 流 / JSON 响应 → 前端
```

---

## 文档

| 文档 | 说明 |
|------|------|
| `ROADMAP.md` | 完整版本规划 + Sprint 里程碑 |
| `docs/GATED-DELEGATION-v2.md` | Phase D 架构详细设计 |
| `docs/benchmark/L2-BENCHMARK-REPORT.md` | L2 路由 benchmark 结果 |
| `docs/ARCHITECTURE-VISION.md` | 架构愿景（早期） |

---

## Sprint 里程碑

| Sprint | Commit | 内容 |
|--------|--------|------|
| Sprint 52 | `2f46f1f` | 9 个 Production Gap 全部收口，P0/P1/P2 清零 |
| Sprint 53 | `0e3d39a` | Phase 5 存储测试 79/79 + SSE done 双路推送 |
| Sprint 54 | `29a83be` | Intent-aware evidence boost + benchmark 40→78 cases |
| Sprint 55 | `ff4d646` | G4-C DelegationLogs 面板 + L2 上线规划 |
| Sprint 56 | `d736e91` | L2 Benchmark 套件 + CI job，规则路由实测 26.7% |
| Sprint 57 | `18d1558` | L2 在线 benchmark：72B 40% vs 规则 63.3% |
| Sprint 58 | `3d1ce89` | L2 在线 benchmark 最终：72B **80.0%** vs 规则 **63.3%** |
| Sprint 59 | `6912da6` | 72B 升级为 Fast 层默认，cross-session 逻辑整合 |
| Sprint 60 | `97f6b2b` | 72B 第二次运行 83.3%，确认 LLM 推理非确定性 |
| Sprint 61 | `bc0d5b2` | L1 Benchmark：72B 86.7% vs 规则 76.7%，规则在 tool-live 全错 |
| Sprint 62 | `49ad863` | Prompt Template System + CRUD API + 渲染服务 |
| Sprint 63 | `3c05c2d` | Cross-Session Context + SessionContextRepo + API |
| Sprint 64 | `d693c2b` | Permission-Gated Worker Architecture，18 单元测试 |
| Sprint 65 | `160c6d1` | Operation Auth Matrix + Authorization E2E，21 新测试 |
| Sprint 67 | `0dabf31` | Phase 2.0 L2 Feature Flag + Gated Delegation v2 回填脚本 |
| Sprint 68 | `7f75ee6` | 死代码清理：删 orchestrator.ts/router.ts/quality-gate.ts + 13 个临时脚本 |

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
│   └── phase5/                   # Archive 存储后端
├── models/                 # 模型网关（OpenAI/Anthropic）
├── tools/                  # 工具注册 + 执行器
├── context/                # Token Budget / Context Compressor
├── db/                     # Repositories + ArchiveRepo + Connection
├── logging/                # Decision Logger / Metrics Calculator
├── middleware/             # Identity / JWT / Rate Limit
├── config/                # Config + Model Capability Matrix
└── types/                  # TypeScript 类型定义
```

---

## 分支说明

- `master` (V2)：当前开发分支
- V2 仓库：`https://github.com/dacm401/smartrouter-pro-v2`

