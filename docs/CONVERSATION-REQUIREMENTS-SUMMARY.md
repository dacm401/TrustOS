# SmartRouter Pro — 对话需求总结

> 日期：2026-04-19 | 覆盖范围：从项目启动至 Sprint 35

---

## 概述

本文档梳理了整个开发过程中，用户（老板）通过对话提出的核心要求、设计决策和约束条件。按主题分类，每条标注对应的 Sprint 阶段。

---

## 一、架构与设计哲学

### 1.1 核心原则（贯穿全程）

| 要求 | 来源 Sprint |
|------|------------|
| **可控制性优于能力**——显式优于隐式，稳定架构优先 | Sprint 01 起始定义 |
| **任务（Task）是核心单元**，不是消息历史 | LAR Spec v1 |
| 轻量默认，按需升级——默认保持对话，仅在必要时进入 Agent 行为 | LAR Spec v1 |
| **先 benchmark，再改规则** | MEMORY.md 执行原则 |
| **先收口主干质量，再扩功能面** | MEMORY.md 执行原则 |
| **统一数据结构，减少隐式兼容** | MEMORY.md 执行原则 |
| **模型选择按能力，不按名字写死** | Sprint 29+ |
| 每 sprint 必须有：交付清单 / 已知问题 / benchmark 结果 / 下一优先级 | MEMORY.md 执行原则 |

### 1.2 LLM-Native 路由重设计（Sprint 29+核心需求）

用户明确要求：**用模型自判断替代硬编码规则**，具体是：

- 删除 `rule-router.ts`（硬编码评分+关键词）
- 删除 `complexity-scorer.ts`（硬编码复杂度公式）
- 删除 `intent-analyzer.ts`（硬编码正则意图）
- 删除 orchestrator 内的 `shouldDelegate()` 硬编码逻辑
- 替换为：Fast 模型通过系统 prompt 自我判断路由路径

**原话精神**："这些规则是人写的，不是模型理解的。加一个 weather-search 只是把猫鼠游戏从代码挪到数据库，五十步笑百步。"

### 1.3 Fast/Slow 共享工作台架构

要求：不靠上下文压缩传递信息，改用 Archive（共享工作台）：

- Fast 模型把"现场"写入 Task Archive（PostgreSQL）
- Slow 模型执行中主动查 Archive
- Slow 完成后把结果写回 Archive
- **Fast → Slow 传递的只有结构化 JSON command，不传 history 上下文**

---

## 二、功能需求

### 2.1 身份与安全（Sprint 15 C3a）

- `user_id` 从 `body.user_id` 迁移到服务端 middleware（`X-User-Id` header）
- 生产模式无 header 直接 401
- 保留 dev fallback（`ALLOW_DEV_FALLBACK=true`）
- 身份优先级：`X-User-Id` → `query.user_id（dev）` → 401
- **不引入 session/token/JWT**（严格遵守 scope 约束）

### 2.2 Evidence System（Sprint 15 E1）

- 新建独立 `evidence` 表（区别于 `memory_entries`）
- 职责划分：`memory_entries` = 用户级/可编辑；`evidence` = 任务级/保留 provenance
- `web_search` 结果自动 fire-and-forget 写入 evidence
- CRUD API：`POST /v1/evidence`、`GET /v1/evidence/:id`、`GET /v1/evidence?task_id=`

### 2.3 Task Resume（Sprint 15 T1）

- 跨 session 续接同一 task
- 触发方式：显式 `task_id` 优先；无则按 `session_id` 找最近 active task；都没有就新建
- **架构约束：TaskPlanner 不查数据库**，通过 chat.ts 中间层注入 context
- resume context 包含：`completed_steps / blocked_by / confirmed_facts / summary_text`

### 2.4 web_search 真实接入（Sprint 15 W1）

- 接入外部搜索 API（provider 可配置）
- 无 endpoint 时优雅降级，不崩溃
- 带 `Authorization: Bearer <apiKey>` header
- 网络错误返回友好错误信息，不抛异常

### 2.5 Phase 1.5 任务卡片与 Clarifying 流程（Sprint 32）

- Task Schema 扩展：`task_type / task_brief / state` 字段
- CLARIFYING_STATE 状态：Fast 模型可请求澄清，SSE 推 `clarifying` 事件
- Slow 只读优化：Task Brief 用 JSON 格式传递，Slow 不读历史对话
- ClarifyQuestion 数据结构：`question_id / question_text / options`

### 2.6 Memory/Evidence 效果增强（Sprint 32）

- intent-aware boost：按意图类型调整 memory retrieval 权重
- `retrieveEvidenceForContext`：任务相关 evidence 注入上下文
- 记忆检索与证据检索分离但联动

### 2.7 Phase 2.0 流量分级（Sprint 33）

- 三层路由可观测、可评测：`routing_layer` 字段暴露给 SSE 和 eval API
- 所有 SSE 事件携带 `routing_layer`（L0/L1/L2/L3）
- `/api/chat/eval/routing` 评估端点
- 前端路由层 badge 可视化（L0 灰/L1 蓝/L2 紫/L3 橙）

---

## 三、测试与质量需求

### 3.1 测试体系要求

| 测试类型 | 要求 |
|---------|------|
| R1 Mock 测试 | 无需 DB，完全 mock，CI 可运行 |
| Repo 集成测试 | 带 PostgreSQL service |
| Benchmark | CLI args / timeout / 结果持久化 |
| CI | GitHub Actions 三 job（R1 + repos + frontend tsc） |

### 3.2 质量门控

- `tsc --noEmit` 零错误（backend + frontend + evaluation）
- 每次 sprint 推前必须通过全部测试
- Benchmark routing accuracy ≥ 50%，intent accuracy ≥ 70%

### 3.3 Sprint 35 测试稳定化需求

- vitest NTFS hardlink 问题修复（移除 setupFiles，添加 NODE_PATH）
- 单元测试 8 files / 172 tests 全绿
- R1 API 测试 4 files / 35 tests 全绿
- CI postgres 镜像升级为 `pgvector/pgvector:pg15`

---

## 四、基础设施需求

### 4.1 Docker 部署

- 多阶段构建（backend + frontend Dockerfile）
- postgres healthcheck
- `DATABASE_URL` 和 `NODE_ENV` 正确注入
- 移除破坏性 volume

### 4.2 模型提供商

- SiliconFlow：Fast 层 Qwen2.5-7B，Slow 层 Qwen2.5-72B-Instruct
- **明确禁止**：DeepSeek-V3/R1 在 SiliconFlow 不支持 function calling（会 hang）
- Docker 镜像加速：ustc.edu.cn（中国环境适配）

### 4.3 自适应轮询

- Slow 任务状态轮询：`<10s → 2s`，`10s~60s → 3s`，`>60s → 5s`
- 目的：减少数据库压力，同时保持感知延迟可接受

---

## 五、用户体验需求

### 5.1 慢任务等待体验

- 慢任务启动 < 1s 内必须给用户反馈（安抚消息）
- 30s 后推安抚状态：`🔄 任务比较复杂，正在分析...`
- 60s 后：`⏳ 资料已找到，正在整理对比...`
- 120s 后每 60s 一次：`🔄 仍在执行，请继续等待...`
- **原则：用户不怕等，怕"不知道在干嘛"**

### 5.2 前端工作台

- TaskPanel：任务列表 + 状态
- EvidencePanel：source icon + 内容截断 + URL
- TracePanel：分类图标 + detail 摘要
- HealthPanel：服务状态 30s auto-refresh
- 路由层 badge：L0/L1/L2/L3 颜色区分

---

## 六、工作方式偏好

| 偏好 | 说明 |
|------|------|
| 先审计/计划，再改代码 | 复杂改动必须先评审方案 |
| 结论先行 | 回复优先给结论，再展开细节 |
| 证据闭环 | 叙述版本收成一版，不允许矛盾 |
| 弱信号不升级为 truth | Feedback 的 signal_level 严格分层 |
| 中文沟通 | 全程中文，称 AI 为助手/蟹小钳 |
| 工作流 | code → tsc → test → push → handoff |
| Sprint 节奏 | 每 sprint 有明确交付清单 + 下一优先级 |

---

_生成日期：2026-04-19 | by 蟹小钳 🦀_
