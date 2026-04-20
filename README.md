# SmartRouter Pro V2

**轻量 AI Runtime** — 基于 Manager-Worker 架构的智能路由系统。

## 核心特性

- **LLM-Native Routing**：Fast 模型做 Manager，Slow 模型做 Worker，自动分层
- **Phase 4 安全层**：Data Classification → SmallModelGuard → Redaction Engine
- **Task Archive**：结构化工作台，支持多种存储后端
- **SSE 实时流**：状态事件驱动的前端集成

## 技术栈

| 层级 | 技术 |
|------|------|
| Runtime | TypeScript + Node.js + Hono |
| Database | PostgreSQL + pgvector |
| 模型 | SiliconFlow (Qwen2.5-7B/72B) / Ollama |
| 部署 | Docker + Docker Compose |

## 快速启动

```bash
# 1. 复制配置
cp .env.example .env
# 填入 SILICONFLOW_API_KEY

# 2. 启动数据库
docker-compose up -d postgres

# 3. 安装依赖
npm install

# 4. 启动
npm run dev
```

## 测试

```bash
# 单元测试
npm test

# Phase 4 Benchmark
npm run benchmark:phase4

# Routing Benchmark (需要 backend 运行)
npx tsx evaluation/runner.ts --suite routing --json-out
```

## 文档

| 文档 | 说明 |
|------|------|
| `docs/ARCHITECTURE-VISION.md` | 架构愿景 |
| `docs/LLM-NATIVE-ROUTING-SPEC.md` | LLM 路由规格 |
| `docs/MANAGER-DECISION-TYPES.md` | Manager 决策类型 |
| `docs/PHASE-4-IMPLEMENTATION-PLAN.md` | Phase 4 实现计划 |
| `docs/TASK-ARCHIVE-IMPLEMENTATION-GUIDE.md` | Task Archive 指南 |
| `docs/ROADMAP-2026Q2.md` | Q2 路线图 |
| `docs/SPRINT-44-REPORT.md` | Sprint 44 结果报告 |
| `docs/SPRINT-45-PROPOSAL.md` | Sprint 45 提案 |
| `docs/SYSTEM-STATUS-REPORT.md` | 系统状态报告 |

## 已完成 Sprints

| Sprint | 内容 |
|--------|------|
| Sprint 05 | ExecutionLoop + ToolGuardrail |
| Sprint 18 | Docker 收口 + CI |
| Sprint 36-37 | Phase 0-2 Manager-Worker Runtime |
| Sprint 39 | Runtime Validation |
| Sprint 40-43 | Phase 4 (Classification/Redaction/Guard) + Phase 5 |
| Sprint 44 | Routing Benchmark Baseline + Ollama 集成 |

## 分支说明

- `master` (V2)：当前开发分支，独立于旧仓库
- V2 仓库：`https://github.com/dacm401/smartrouter-pro-v2`
