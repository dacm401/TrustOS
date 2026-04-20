# SmartRouter Pro — 现状全面评估报告

> 版本：v1.1.0（Phase 2.0）| 日期：2026-04-19 | 测试状态：207 tests ✅

---

## 一、系统架构总览

SmartRouter Pro 是一个 **Lean Agent Runtime（LAR）**，以 Task 为核心单元，默认保持轻量对话，按需升级为 Agent 行为。

```
用户请求
    │
    ▼
┌─────────────────────────────────────────────┐
│        Fast 模型（Qwen2.5-7B）               │
│  ┌──────────────────────────────────────┐   │
│  │   L0: 直接回复（闲聊/简单问答）        │   │
│  │   L1: Fast + web_search（实时数据）    │   │
│  │   L2: 委托 Slow（复杂分析/深度推理）   │   │
│  │   L3: Execute 模式（工具执行循环）     │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
    │                    │
    ▼                    ▼
SSE 流推用户       Task Archive (PostgreSQL)
                       │
                       ▼
              ┌──────────────────┐
              │ Slow 模型         │
              │ (Qwen2.5-72B)    │
              │ 主动查 Archive    │
              └──────────────────┘
```

---

## 二、功能完成度（LAR 10层）

| LAR 层 | 模块 | 状态 | 说明 |
|--------|------|------|------|
| Layer 1 | Task Runtime | ✅ COMPLETE | 任务创建/续接/追踪，PATCH resume/pause/cancel |
| Layer 2 | Intent & Complexity Classifier | ✅ COMPLETE | 9种意图 / 5因子复杂度（硬编码层，计划替换） |
| Layer 3 | Capability Router | ✅ COMPLETE | 14条加权规则/BH-driven/fallback（计划替换） |
| Layer 4 | Prompt Assembler | ✅ COMPLETE | core_rules + mode_policy + task_summary |
| Layer 5 | Memory System v2 | ✅ COMPLETE | MR-001~003 / category-aware / intent-aware boost |
| Layer 6 | Execution Layer | ✅ COMPLETE | EL-001~004状态机 / tool_call / reasoning / synthesis |
| Layer 7 | Model Router | ✅ COMPLETE | SiliconFlow Fast(7B) + Slow(72B) / Guardrail |
| Layer 8 | Observability & Budget Control | ✅ COMPLETE | 全链路 trace / Growth / metrics dashboard |
| Layer 9 | API 规范 | ✅ COMPLETE | 13个端点（chat/tasks/memory/evidence/feedback/health） |
| Layer 10 | Task Summary Engine | ✅ COMPLETE | 结构化摘要 / 跨会话续接 |

---

## 三、功能模块详细清单

### 3.1 后端核心功能

#### 路由与分层（Phase 2.0）
| 功能 | 状态 | 说明 |
|------|------|------|
| L0 快速直通 | ✅ | 闲聊/问候/简单问答，< 500ms |
| L1 Fast + web_search | ✅ | 需要实时数据时调用搜索工具 |
| L2 Slow 委托 | ✅ | 复杂分析/深度推理，自适应安抚消息 |
| L3 Execute 模式 | ✅ 预留 | `body.execute=true` 触发，ExecutionLoop |
| routing_layer SSE 字段 | ✅ | 所有 SSE 事件携带 L0/L1/L2/L3 标记 |
| `/api/chat/eval/routing` | ✅ | Benchmark 专用路由评估端点 |
| inferRoutingLayer() | ✅ | 覆盖 L0/L1/L2/L3 全路径 |

#### Phase 1.5 任务卡片
| 功能 | 状态 | 说明 |
|------|------|------|
| Task Schema 扩展 | ✅ | task_type / task_brief / state 字段 |
| CLARIFYING_STATE | ✅ | Fast 请求澄清，SSE 推 clarifying 事件 |
| ClarifyQuestion | ✅ | question_id / question_text / options |
| Slow 只读优化 | ✅ | Task Brief JSON 格式，不读历史对话 |

#### Memory & Evidence
| 功能 | 状态 | 说明 |
|------|------|------|
| Memory CRUD | ✅ | memory_entries 表，可编辑 |
| Memory v2 Retrieval | ✅ | MR-001~003，category-aware |
| intent-aware boost | ✅ | 按意图类型调整检索权重 |
| Evidence 表 | ✅ | 独立 evidence 表，任务级/保留 provenance |
| Evidence CRUD API | ✅ | POST/GET，C3a middleware 保护 |
| web_search → Evidence | ✅ | fire-and-forget 自动写入 |
| retrieveEvidenceForContext | ✅ | 任务相关 evidence 注入上下文 |

#### Identity & Security
| 功能 | 状态 | 说明 |
|------|------|------|
| identityMiddleware | ✅ | X-User-Id header 解析 |
| getContextUserId() | ✅ | 从 middleware context 读 userId |
| dev fallback | ✅ | ALLOW_DEV_FALLBACK=true |
| 生产模式 401 | ✅ | 无 X-User-Id 直接拒绝 |

#### Feedback & Learning
| 功能 | 状态 | 说明 |
|------|------|------|
| Feedback Signal 分层 | ✅ | L1/L2/L3 signal_level |
| Feedback dual-write | ✅ | feedback_events 先写，失败时 decision_logs 不更新 |
| analyzeAndLearn | ✅ | Behavioral Memory + Growth Profile |
| satisfaction_rate | ✅ | 仅 L1 signal 计算，与 learning truth 对齐 |

#### Execution Loop
| 功能 | 状态 | 说明 |
|------|------|------|
| EL-001 状态机 | ✅ | 顺序 step 执行 |
| EL-002 tool_call | ✅ | 工具调用 step |
| EL-003 reasoning | ✅ | 推理 step |
| EL-004 synthesis | ✅ | 合成 step |
| ToolGuardrail | ✅ | HTTP 白名单/HTTPS-only/timeout/响应大小 |
| GuardrailRejection | ✅ | 触发时 loop abort |

#### API 端点（13个）
| 端点 | 功能 |
|------|------|
| POST `/api/chat` | 主对话，SSE 流 |
| GET `/api/chat/eval/routing` | 路由评估 |
| GET/POST `/v1/tasks` | 任务 CRUD |
| PATCH `/v1/tasks/:id` | resume/pause/cancel |
| GET `/v1/tasks/:id/traces` | 链路 trace |
| GET `/v1/tasks/all` | 所有任务列表 |
| GET/POST/DELETE `/v1/memory` | Memory CRUD |
| POST `/v1/evidence` | 写入 evidence |
| GET `/v1/evidence/:id` | 按 ID 查 evidence |
| GET `/v1/evidence?task_id=` | 按任务查 evidence |
| POST `/v1/feedback` | 写入反馈 |
| GET `/v1/dashboard` | 统计仪表板 |
| GET `/health` | 服务健康状态 |

### 3.2 前端功能

| 组件 | 功能 | 状态 |
|------|------|------|
| ChatInterface | 对话界面，支持 execute 模式 | ✅ |
| TaskPanel | 任务列表 + 状态 | ✅ |
| EvidencePanel | source icon + 截断内容 + URL | ✅ |
| TracePanel | 分类图标 + detail 摘要 | ✅ |
| HealthPanel | 服务状态 30s auto-refresh | ✅ |
| routing_layer badge | L0/L1/L2/L3 颜色可视化 | ✅ |

---

## 四、测试体系现状

### 4.1 测试套件（截至 2026-04-19）

| Suite | 命令 | 结果 | 类型 |
|-------|------|------|------|
| 单元测试（vitest.config.ts） | `npm test` | **172 tests ✅** | 无 DB |
| R1 API 测试（vitest.r1.config.ts） | `npm run test:r1` | **35 tests ✅** | Mock-based |
| Repo 集成测试 | `npm run test:repos` | 就绪，需 PG | DB 必需 |
| Benchmark | `npm run benchmark` | 13 tasks（需 backend 运行） | E2E |

**总计：207 tests 全绿 ✅**

### 4.2 测试覆盖分布

| 测试文件 | 测试数 | 覆盖范围 |
|---------|-------|---------|
| memory-store.test.ts | 33 | analyzeAndLearn 核心学习逻辑 |
| feedback-collector.test.ts | 48 | implicit signal + dual-write |
| feedback-event-repo.test.ts | 21 | FeedbackEvent CRUD |
| decision-repo.test.ts | 48 | satisfaction_rate 分层 SQL |
| chat.test.ts（R1） | 4 | chat endpoint 4 场景 |
| evidence.test.ts（R1） | 8 | evidence CRUD API |
| tasks.test.ts（R1） | 9 | tasks API + 权限 |
| chat-execute.test.ts（R1） | 14 | execute 模式 Phase 2.0 |

### 4.3 Benchmark 基准

| 指标 | 目标 | 当前（需 backend 运行验证） |
|------|------|--------------------------|
| routing accuracy | ≥ 50% | 未实时验证 |
| intent accuracy | ≥ 70% | 未实时验证 |
| L0 测试用例 | 20条 | ✅ 已扩充 |
| L1 测试用例 | 10条 | ✅ 已扩充 |
| L2 测试用例 | 36条 | ✅ 已扩充 |

---

## 五、性能特征

### 5.1 延迟分层

| 层 | 预期延迟 | 触发场景 |
|----|---------|---------|
| L0 | < 500ms | 闲聊/问候/简单问答 |
| L1 | 500ms ~ 2s | 需要实时数据（web_search） |
| L2 | 3s ~ 5min | 复杂分析/深度推理（Slow 模型） |
| L3 | 不定 | Execute 工具执行循环 |

### 5.2 Slow 任务轮询策略

| 经过时间 | 轮询间隔 | 设计意图 |
|---------|---------|---------|
| < 10s | 2s | 快速感知结果 |
| 10s ~ 60s | 3s | 平衡感知与 DB 压力 |
| > 60s | 5s | 减少 DB 压力 |

### 5.3 用户体验反馈节奏

| 触发时机 | 内容 |
|---------|------|
| 启动后 < 1s | 自然语言安抚（"让我想想"） |
| > 30s | 🔄 任务比较复杂，正在分析... |
| > 60s | ⏳ 资料已找到，正在整理对比... |
| > 120s（每60s） | 🔄 仍在执行，请继续等待... |

---

## 六、已知问题与限制

### 6.1 架构层面

| 问题 | 严重程度 | 说明 |
|------|---------|------|
| 硬编码路由规则 | ⚠️ 高 | rule-router / complexity-scorer / intent-analyzer 仍为硬编码，是计划删除的技术债 |
| Fast/Slow 通信未完全实现 Archive 方案 | ⚠️ 高 | LLM-Native Routing Spec 已规划，Phase 0~5 尚未实施 |
| Task Archive 表未建 | ⚠️ 高 | task_archives 表及 CRUD 是 LLM-Native 架构的核心基础设施，待建 |

### 6.2 功能层面

| 问题 | 严重程度 | 说明 |
|------|---------|------|
| 无生产认证系统 | 🔴 中 | 依赖 X-User-Id header，无 JWT/session |
| Evidence 来源单一 | 🟡 低 | 仅 web_search 自动写入；http_request/manual 待补 |
| Task Resume 仅单用户 | 🟡 低 | 不支持多人协作 |
| Phase 1.5 Clarifying UX | 🟡 低 | 前端弹窗未完全集成 |
| Layer 3 Execute 前端入口 | 🟡 低 | execute 模式前端触发未完整实现 |

### 6.3 基础设施层面

| 问题 | 严重程度 | 说明 |
|------|---------|------|
| Benchmark CI Job 缺失 | 🟡 低 | GitHub Actions 无 benchmark job |
| Docker 未 live 验证 | 🟡 低 | 配置已就绪，需实际 Docker 环境验证 |
| Feedback dual-write 时序边缘 | 🟡 低 | feedback_events 成功 + decision_logs 失败时短暂不一致 |

---

## 七、CI/CD 状态

| Job | 命令 | 状态 |
|-----|------|------|
| test-r1 | R1 mock 测试 + tsc | ✅ 配置完毕 |
| test-repos | PG service + schema init + 集成测试 | ✅ 配置完毕 |
| test-frontend | tsc --noEmit | ✅ 配置完毕 |
| benchmark | 路由准确率测试 | ⏳ 待加入 CI |

---

## 八、技术债务清单

| 债务 | 优先级 | 影响 |
|------|-------|------|
| 删除硬编码路由三文件（rule-router / complexity-scorer / intent-analyzer） | P0 | 整个 LLM-Native 架构依赖此清理 |
| 建 Task Archive 表 + CRUD | P0 | Fast/Slow 共享工作台的基础 |
| Fast 模型工具化（function calling） | P0 | LLM-Native 架构 Phase 0 |
| 完整 Auth 系统（JWT/session） | P1 | 生产可用的前提 |
| http_request/manual Evidence 来源 | P2 | Evidence Layer 6 完整性 |
| Benchmark CI Job | P3 | 自动化质量门 |
| Memory UI 面板 | P4 | 前端 Memory 管理界面 |

---

_生成日期：2026-04-19 | by 蟹小钳 🦀_
