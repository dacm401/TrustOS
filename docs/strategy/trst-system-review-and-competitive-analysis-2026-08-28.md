# TrustOS / SmartRouter Pro — 系统全景回顾与主流 Agent 对比分析

> **文档类型**：系统回顾 / 竞争力评估（归档查询用）
> **撰写日期**：2026-08-28
> **代码基线**：`feature/trst-3-private-beta-readiness` @ commit `a7929b7`
> **撰写方式**：全量代码勘察（4 路并行子代理 + 定向验证），非文档转述
> **阅读对象**：后续开发者 / PM / 需要快速了解系统真实能力的任何人

---

## 0. 如何使用本文档

本文档的**核心价值在 §4（实现度诚实评估）与 §6（架构断链）**——它们区分了"系统宣称的能力"与"代码里真实跑起来的能力"。

- 想快速了解系统有什么 → 读 §2
- 想了解与主流框架的差异 → 读 §3
- **想判断哪些能力可用、哪些是空壳 → 读 §4（最重要）**
- 想知道下一步该修什么 → 读 §6

所有结论均附代码路径（`文件:行号`），可自行复核。凡标注「未实现 / 占位 / fixture」者，均有代码证据，非主观判断。

---

## 1. 开发历程回顾

项目自 2026-06 至 2026-08，历时约三个月，遵循「先验证产品闭环，再谈生产化」的路径。

| 阶段 | 时间 | 关键交付 |
|---|---|---|
| **TRST-0 / 0.3** | 07-14 | 战略架构基线。冻结：五大 AI-native 资源 + Trust Control Plane；无 DLP 检测；Shadow Mode 默认；tamper-evident 而非 tamper-proof；Enforcement → Observation → Governance |
| **TRST-1A/1B** | 07-15 | Execution Trace MVP。真实模型调用跑通，gateway 开销 2ms/请求；output_hash 验证、Tool Trace CLI、Shadow Report |
| **TRST-2 / 2B / 2C** | 07-31 | **产品闭环验证**（Observe→Assess→Control→Prove→Evidence Export）。output_hash 覆盖率从 20% 修复至 100%；Fresh-Event E2E 5/5 |
| **TRST-3** | 08-05 | Private Beta MVP。52/52 AC、6/6 Work Package、Smoke 20/0 |
| **MWT-0 ~ MWT-7** | 08 月 | 七个工作线程全部 SEALED。含 Memory 治理(MWT-6)、审计复核(MWT-5R)、上下文边界(MWT-5)、真实 Worker 接线(MWT-21)、评估迁后端(MWT-22/TRST-4D) |
| **TRST-4D** | 08-22 | 前端评估迁至后端 `/v1/assess`，风险模型统一为后端 4 级（移除前端臆造的 critical） |
| **TRST-5** | 08-24 ~ 08-28 | 极客友好部署、安全闭环(5B)、构建修复(5F1)、前端流畅度(5F2: React.lazy + content-visibility) |
| **基线修复** | 08-26 ~ 08-28 | 修复首页 client-side exception（QueryClientProvider 缺失）、聊天 401（Authorization 头缺失）、API fallback 端口（3002→3001） |

### 关键决策纪律

PM（后期由 agent 兼任）三次明确拒绝「过早生产化」：

1. gateway 不先做成产品级基础设施
2. 多租户被剔除（本机单用户）
3. 先让极客有真正体验，而非先补已有 WIP

Boss 于 2026-08-24 明确定位：**TrustOS = 个人 PC 操作系统（本地 OS）**；先服务愿自己跑容器的极客；**Memory 是用户粘性钩子**；竞争力差异点为「本地优先数据不出本机 + 可验证审计/证据链 + Worker 不碰原始数据的架构隔离」。

---

## 2. 系统功能全景

### 2.1 后端总览

- **技术栈**：Hono + `@hono/node-server` + node-postgres + drizzle
- **API 端点总数**：**125 个**
- **路由挂载总入口**：`src/app.ts:59-114`
- **运行入口**：`src/index.ts`（`src/app.ts` 导出 `app` 供测试用 `app.request()`）

**全局中间件链**（`src/app.ts:61-89`）：

| 顺序 | 中间件 | 文件 | 作用 |
|---|---|---|---|
| 1 | `cors()` | src/app.ts:61 | 全量 CORS |
| 2 | `betaInviteMiddleware` | src/middleware/beta-invite.ts:38 | Beta 邀请码门禁（`/health`、`/auth`、`/admin`、`/metrics` 跳过） |
| 3 | `rateLimitMiddleware` | src/middleware/rate-limit.ts:116 | 滑动窗口限流，60/min 通用、**SSE 单独 10/min**（:124-127） |
| 4 | `identityMiddleware` | src/middleware/identity.ts:43 | JWT Bearer → `X-User-Id` → `query.user_id`（dev fallback） |
| 5 | `costCapMiddleware` | src/middleware/cost-cap.ts:26 | **仅 `/api/chat`**，日成本上限 |
| 6 | `quotaMiddleware` | src/middleware/quota.ts:26 | **仅 `/api/chat`**，日 session/task 配额 |

### 2.2 智能路由与委托（最核心、最成熟）

**G0–G4 五阶段 Gated Delegation Pipeline**（`src/services/llm-native-router.ts:120-179`）

| 阶段 | 代码位置 | 职责 |
|---|---|---|
| **G0** | `parseGatedDecision()` `llm-native-router.ts:1515` | LLM 产出 `ManagerDecision` JSON（4 动作打分） |
| **G1** | `calculateSystemConfidence()` 调用点 `:128` | 系统置信度计算 |
| **G2** | `calibrateWithPolicy()` 调用点 `:137` | Policy 校准（penalize / boost / block） |
| **G3** | `shouldRerank()` `:146` → `ruleBasedRerank()` `:156` | 低置信度时规则重排 |
| **G4** | 异步学习 | 离线学习闭环 |

**4 个路由动作**（`CLAUDE.md:43`）：
`direct_answer`(L0) / `ask_clarification`(L0) / `delegate_to_slow`(L2) / `execute_task`(L3)

**实际执行顺序**（`routeWithManagerDecision()` `llm-native-router.ts:248-560`）：
1. 快路径启发式 `:267-279`（纯字符串匹配，仅用于分析标记，**不影响路由**）
2. **Execution Policy（规则优先）** `:282`
3. Quality Routing `:309`（读上次验证分数）
4. **Local Manager** `:313`
5. Memory 并行检索 `:330`（与 Manager 并行，省 200-500ms）
6. **Policy-first Bypass** `:354-391`（规则命中则**完全绕过 Manager LLM**）

**5 种 Policy 路由**（`local-manager-runtime.ts:193-209`）：
- `local_answer_from_meta` → 不调任何模型（`:359`）
- `direct_artifact_revision` / `direct_create_artifact` → 绕过 Manager LLM（`:391`）
- `manager_llm_required` → 才调用远端 Manager LLM
- `ask_clarification`

**Local Manager**（`src/services/manager/local-manager-runtime.ts:96`）—— 最具特色的设计：

```ts
// local-manager-runtime.ts:116-129
const security: LocalManagerSecurity = {
  allowArtifactToManager: false,   // 红线：artifact 原文绝不发给 Manager
  allowRawHistoryToWorker: false,  // Context Boundary 不变量
  allowRawMemoryToWorker: false,
};
```

设计哲学（注释 `local-manager-runtime.ts:88`）：**「安全靠代码，不靠模型自觉」**。安全决策本地化，且在 Policy 之后、LLM **之前**运行。

### 2.3 任务执行引擎

- **3 种执行模式**：`direct` / `research` / `execute`
- **Cycle Runtime**（`src/services/cycle/cycle-runtime.ts`）：验证-修订循环
  - `maxCycles` 从 `budgetPolicy` 读取，防止无限重试（`:216`）
  - `finalStatus`：`accepted` / `revised` / `rewritten` / `blocked` / `human_review` / `max_cycles_exceeded`（`:66`）
- **双层验证**：
  - `ContractVerifier`（`src/services/verifier/contract-verifier.ts`）按契约标准逐条验证
  - `ArtifactVerifier`（`src/services/verifier/artifact-verifier.ts`）产出物质量评分
- **任务契约**：`src/services/task-contract/task-contract-builder.ts`
- **完整生命周期**：`resume` / `pause` / `cancel` / `retry`（终态任务可重入队）

**核心 API（挂载 `/v1/tasks`，`src/api/tasks.ts`）**：

| 方法 | 路径 | 行号 | 功能 |
|---|---|---|---|
| GET | `/v1/tasks/recent` | :10 | 分页任务列表 + 状态过滤 |
| GET | `/v1/tasks/all` | :87 | 全部任务（archive 最近 100 条） |
| GET | `/v1/tasks/:id/result` | :64 | 任务完整结果 + errors |
| GET | `/v1/tasks/:id/summary` | :112 | 摘要（goal/facts/steps/blockers/next_step） |
| GET | `/v1/tasks/:id/traces` | :129 | 执行轨迹（limit≤500），附人类可读摘要 |
| GET | `/v1/tasks/:id/decision` | :152 | 最新路由决策日志 |
| GET | `/v1/tasks/:id` | :167 | 任务详情 |
| PATCH | `/v1/tasks/:id` | :180 | `resume` / `pause` / `cancel` |
| POST | `/v1/tasks/:id/retry` | :257 | 重试终态任务 |

### 2.4 上下文边界管控（真正差异化）

**边界契约 `WORKER_CONTEXT_BOUNDARY`**（`src/services/context/context-package.ts:38-62`）：

```
mustInclude: command, message, language
mayInclude:  archivedArtifactContent, confirmedFacts, ...
deniedContext: true   ← 字面量，类型系统级强制
```

**两套 Context Package（易混淆，注意区分）**：
- `ContextPackage`（Sprint 61P V0，Worker prompt 组装契约）`context-package.ts:89-141`，`buildWorkerContextPackage()` `:181`
- `ContextPackageV1`（运行时审计合同）`context-package.ts:360-409`，`buildContextPackage()` `context-package-builder.ts:70`

**Context Curation（上下文加工）**：22 个单测全绿（`context-package-builder.test.ts` 13 + `context-compressor.test.ts` 9）。核心不变量：artifact 绝不发 Manager、raw history/memory 绝不发 Worker、Worker 只收 brief + 可选 artifact summary。

### 2.5 工具能力（6 个）

**注册表**：`src/tools/registry.ts`（`ToolRegistry` 类，导出 OpenAI Function Calling schema `:73`）
**定义**：`src/tools/definitions.ts`（`BUILTIN_TOOLS`）

| 工具 | Scope | 功能 |
|---|---|---|
| `memory_search` | internal | 记忆检索（query + max_results） |
| `task_read` | internal | 读取任务 |
| `task_update` | internal | 更新状态 / next_step / completed_step |
| `task_create` | internal | 建任务（direct/research/execute） |
| `http_request` | **external** | HTTP 请求（url + headers） |
| `web_search` | **external** | 网络搜索（query + max_results） |

另有 MCP Passthrough Forwarder（`src/services/trst1/mcp-passthrough-forwarder.ts`）已实现，**未接入主链路**。

### 2.6 Memory（真实可用）

- **持久化**：PostgreSQL（`src/db/repositories/memory-growth.ts`），非 fixture
- **分类**：`preference` / `fact` / `context` / `instruction`
- **字段**：`importance` 1-5 分级、`tags`（≤10）、`content`（≤2000 字）
- **API（挂载 `/v1/memory`，`src/api/memory.ts`）**：`POST /v1/memory`（:16 创建）、`GET /v1/memory`（:75 列表）等
- **检索与 Manager 调用并行**（`llm-native-router.ts:330`）
- **MWT-6 Memory Governance**：scope / source / retention / sensitivity / status / warnings + Trust Spine 引用

### 2.7 前端

**技术栈**：Next.js 14 App Router + React 18 + TypeScript + Tailwind 3 + `@tanstack/react-query` v5 + recharts + lucide-react。**无 Zustand / Redux / i18n**。

**页面（仅 3 个 `page.tsx`）**：

| 路由 | 文件 | 用途 |
|---|---|---|
| `/` | `src/app/page.tsx` | 主工作台（Auth guard `:75-79`；三栏布局） |
| `/login` | `src/app/login/page.tsx` | 登录，调 `POST /auth/token`（`src/lib/auth.ts:61`） |
| `/privacy` | `src/app/privacy/page.tsx` | 静态隐私声明 |

⚠️ `src/app/dashboard/layout.tsx` 存在但同目录无 `page.tsx` → `/dashboard` 路由**不可访问**（孤立 layout）。

**主导航 8 视图**（`page.tsx:51` 定义，渲染分支 `:156-192`）：

| # | ID | 组件 | 用途 |
|---|---|---|---|
| 1 | `chat` 💬 | `ChatInterface`（非懒加载 `:157`） | 主对话，SSE 流式 |
| 2 | `tasks` 📋 | `views/TasksView.tsx`（`:167`） | 任务列表 + 内联轨迹/证据 + 暂停/恢复/取消 |
| 3 | `memory` 🧠 | `memory/MemoryGovernanceSurface`（`:171`） | MWT-6 记忆治理 |
| 4 | `dashboard` 📊 | `views/DashboardView.tsx`（`:175`） | KPI、ROI 成本节省、意图/模型分布 |
| 5 | `archive` 📦 | `views/ArchiveView.tsx`（`:179`） | 任务档案 |
| 6 | `permissions` 🔐 | `views/PermissionsView.tsx`（`:183`） | Worker 信息访问审批 |
| 7 | `manager` 🤖 | `views/ManagerView.tsx`（`:187`） | 受控委托闭环 |
| 8 | `audit` 🛡️ | `audit/AuditReviewSurface`（`:191`） | 审批复核回放 + Live Event Chain |

> 除 Chat 外全部 `React.lazy` 代码分割（`page.tsx:16-38`），由 `LazyView`（ErrorBoundary + Suspense `:41-49`）包裹。

**右侧工作台 4 标签**（`page.tsx:106-111`）：🔍 证据 / ⚡ 轨迹 / 💚 健康 / 🔧 调试

**未接入路由的组件**：`views/MemoryView.tsx`（记忆库 CRUD）、`views/OverviewView.tsx`（TrustOS Console）。

---

## 3. 与主流 Agent 对比

### 3.1 对比矩阵

| 维度 | **TrustOS** | **LangGraph** | **AutoGPT** | **Dify / Coze** | **Claude Code** |
|---|---|---|---|---|---|
| **核心抽象** | 角色 + **信息流边界** | 图/节点/边状态机 | 自主循环 | 可视化工作流 | 单 agent + 工具 |
| **编排方式** | 规则优先 + 可选 LLM | 开发者显式定义图 | 模型自主决定 | 拖拽编排 | 模型自主 |
| **安全落地** | **类型系统级不变量** | 无内建 | 无 | 平台级 | 权限提示 |
| **工具生态** | **6 个** | 数百（社区） | 数十插件 | 数十内置 | 十几个 |
| **状态持久化** | Postgres + JSONL | Checkpointer | 文件/向量库 | 平台托管 | 无（会话内） |
| **自修正** | Cycle Runtime + 双层 Verifier | 条件边/人工介入 | 自我批评循环 | 有限 | 有限 |
| **记忆** | 真实 PG + 治理 | 需自建 | 向量库 | 平台级 | 无跨会话 |
| **可观测性** | 逐事件哈希 + 轨迹 | LangSmith（外挂） | 日志 | 平台级 | 有限 |
| **部署形态** | **本地 Docker（数据不出机）** | 自托管 | 自托管 | SaaS 为主 | 本地 CLI |
| **目标用户** | **极客 / 自建** | 开发者 | 实验者 | 业务人员 | 开发者 |

### 3.2 真正的差异点

**TrustOS 做对了（主流框架没做的）**：

1. **把「谁能看到什么」从约定升级为类型不变量**
   LangGraph 中可随意把整个 state 塞给任意节点；TrustOS 的 `deniedContext: true` 是编译期强制。安全不变量写在类型系统里，不是文档约定。

2. **安全决策本地化**
   Local Manager 在 Policy 之后、LLM **之前**运行，artifact 永不发给 Manager —— 不依赖远端模型「自觉」不泄露。

3. **规则优先可绕过模型**
   命中 Policy 时完全不调 LLM，兼具确定性与成本/延迟优势。

4. **本地优先 + 数据不出本机**
   整栈 Docker 跑在本机，是架构级承诺而非配置选项。

**TrustOS 明显落后的**：

1. **工具生态 6 vs 数百** —— 无代码执行、无文件读写、无浏览器，做不了真正的软件工程任务。
2. **通用编排能力弱** —— 无 DAG、无并行分支、无子 agent 协作，对比 LangGraph 表达力差距明显。
3. **生态与社区为零** —— 无插件市场、无模板库、无第三方集成。

---

## 4. 实现度诚实评估（**本文档最重要章节**）

> 口径定义：
> **真实实现** = 有代码路径、运行时可被触发
> **占位/仅前端/dry-run** = 代码存在但只在测试/脚本/浏览器内，或不影响运行时行为

### 4.1 总览

| 能力 | 真实度 | 关键限定 |
|---|---|---|
| 路由决策 / 委托 | ✅ **真实且成熟** | G0-G4 全链路运转，规则+模型混合 |
| 任务执行 / 自修正 | ✅ **真实** | Cycle Runtime + 双层 Verifier |
| Context Boundary | ✅ **真实（类型级）** | 22 单测覆盖 |
| Memory | ✅ **真实持久化** | PG 表 + 并行检索 |
| JWT / 限流 / 成本上限 | ✅ **真实** | 中间件链 `app.ts:61-89` |
| 事件哈希 | ⚠️ **逐条真实，无链式** | 有 SHA-256，但**全库无 `prev_hash` 实现** |
| Event Backbone | 🚨 **主后端写不进** | 见 §6.1 |
| Assessment | ⚠️ **真实但极浅** | 12 信号全基于元数据（哈希字段是否存在） |
| Control 拦截 | 🚨 **实际永不拦截** | 见 §6.2 |
| Evidence Bundle | ⚠️ **仅前端** | 剪贴板/Blob 下载，`signed:false` |
| Audit 审阅 | ⚠️ **UI 为 fixture** | 渲染 4 个静态样例 |
| RBAC / 多租户 | ❌ **无** | 单用户，Gateway 零鉴权 |
| Gateway | ❌ **未部署** | `docker-compose.yml` 无此服务 |

### 4.2 逐项证据

#### Event Backbone —— 🚨 主后端写不进

- **结构真实**：`event-envelope.ts:15-24` 定义 9 种事件类型；`computeEventHash()` `:126-135` 对排序键 canonical JSON 做 SHA-256；`sealEvent()` 写入 `event_hash`。顺序无关性由 `scripts/mwt3b1/run-regression.mts:100-101` 验证。
- **存储**：JSONL 为主（`jsonl-event-store.ts:81-89`，默认 `.trustos/events.jsonl`），SQLite 为可重建索引（`event-index.ts:53-111`）。⚠️ **SQLite 索引不存 `event_hash`**（`:73-87` 字段列表无此列）→ 从 `/events` 响应中 `event_hash` 恒缺失 → 反被 Assessment 判为 `MISSING_EVENT_HASH`(high)。
- **类型外事件**：`src/trust/policy-enforcement.ts:110-130` 用 `appendEvent({ event_type: "policy_enforcement", ... } as any)` 写入不在联合类型内的事件，且缺 `resource_type`/`latency_ms`/`privacy_flags` 等必填字段（靠 `as any` 绕过）。
- 🚨 **关键断链**：`initEventStore()` 调用点仅有 `scripts/trst1/start-gateway.ts:48`、`scripts/trst1/simulate-tool-call.ts:76`、若干 `scripts/trst2/*`、`tests/trust/policy-enforcement.test.ts:29`。**`src/index.ts` 与 `src/app.ts` 全文无调用**（全库 grep 确认，13 处命中无一在 runtime 入口）。
  → docker-compose 起的 backend 进程里 `storePath === undefined` → `appendFileSync(undefined, …)` 抛错 → 被 `:35 catch` 吞掉 → 只剩 stderr 一行。**主后端产生的 enforcement 事件 100% 落不了盘。**
- **实证**：`.trustos/events.jsonl`（327 KB，260+ 行，2026-07-15 → 2026-08-06）全为 Gateway 写的 `model_call`/`tool_call`；抽样第 1/2/3/200-203/255-258 行 **零条含 `task_id`、零条 `policy_enforcement`**；尾部大量 `status:"failure", error_code:"UPSTREAM_ERROR"`。

#### Evidence —— ⚠️ 逐条自哈希，非链

- **真实**：`llm-gateway-server.ts` 每条事件写 `input_hash`/`output_hash`/`args_hash`/`result_hash`（如 `:482-483, 648`、`:815-816`）。
- **不存在 `prev_hash`**：全库搜 `prev_hash|hash_chain` 唯一实现在**单测**里，生产路径无。Merkle 锚定同样只在测试跑。
- **Bundle 导出**：剪贴板复制 / 浏览器 Blob 下载；后端不产出、不持久化、`signed:false`。

#### Assessment —— ⚠️ 真实但极浅

- `src/services/assessment/assess-engine.ts`，4 级风险（none/low/medium/high），响应 `{assessments, distribution, control?, meta}`，`includeControl` 才返回 control。
- 12 个信号**全部**基于「哈希字段是否存在」等元数据，无语义分析（符合 TRST-0.3 冻结的「无 DLP 检测」决策）。
- **Control**：`mode:"dry_run"`, `runtimeEffect:"none"`。

#### Audit Review —— ⚠️ UI 为 fixture

- 审阅面板渲染 4 个静态样例。
- 后端 human-review 存在但**事后记录，不阻断交付**。

#### 安全

- JWT 真实可用（HS256/24h，50ms 恒定延迟防时序攻击，`src/api/auth.ts:91`）。
- **无 RBAC、单用户**；Gateway 零鉴权；前端硬编码 `dev-user` fallback。

---

## 5. 定位结论

**TrustOS 不是（也不该做成）通用 Agent 框架。** 其真正产品命题是：

> **一个把「信息流边界」当作头等公民、可本地部署的 LLM 路由与审计工作台。**

在此定位下，安全架构深度确实超过主流框架 —— 但**信任闭环目前只完成约 40%**：

| 环节 | 状态 |
|---|---|
| Observe | ✅（但仅 Gateway 覆盖，主后端断链） |
| Assess | ⚠️ 浅（仅元数据信号） |
| Control | ❌ 空环节（dry_run，无可达 deny 规则） |
| Prove | ⚠️ 半（逐条哈希，无链） |

---

## 6. 架构断链与修复优先级

### 6.1 🚨 P0 — Event Backbone 断链

**问题**：主后端从不初始化事件存储，enforcement 事件 100% 落不了盘。
**为什么致命**：没有事件，审计、证据、评估全是无源之水 —— 整个「可验证」承诺的地基缺失。
**修复方向**：在 `src/index.ts` / `src/app.ts` 调用 `initEventStore()`；修复 SQLite 索引缺失 `event_hash` 字段问题。

### 6.2 🚨 P0 — Evidence 无哈希链

**问题**：只能证明「单条未被篡改」，无法证明「序列完整未被删除」。
**为什么致命**：后者才是审计的真正价值（防删除比防篡改更关键）。
**修复方向**：引入 `prev_hash` 链 + 验证器；将单测里的 Merkle 锚定生产化。

### 6.3 P1 — Gateway 未部署

**问题**：`docker-compose.yml` 无 gateway 服务，需手工 `npm run trst1:gateway`。
**影响**：Observe 层无法覆盖业务调用；前端顶部状态恒为 `Gateway: Offline`。
**修复方向**：加入 compose；确认 `src/services/trst1/llm-gateway-server.ts` 启动契约。

### 6.4 P1 — Control 形同虚设

**问题**：默认 `dry_run`；即便切 live，可达 deny 规则为 0（分类器断链）。
**影响**：产品闭环「Control」实际不存在。
**修复方向**：至少落地 1 条真实拦截规则并验证。

### 6.5 P2 — Audit UI 接真实后端

**问题**：审阅面板渲染 4 个静态样例。
**修复方向**：接 `/v1/audit` 真实数据，完成人工审阅闭环。

### 6.6 不建议做

- ❌ 追赶工具生态（6 → 数百）
- ❌ 做通用 DAG 编排 / 子 agent 协作
- ❌ 补多租户

**理由**：均会稀释「极客 + 本地 + 可验证」的差异化定位，且投入产出比远低于把信任闭环做实。

---

## 7. 一句话总结

> **架构品味高于平均，工程完成度低于宣称；把 §6 的三个架构断链接上，它才真正成为它所宣称的东西。**

---

## 附录 A：关键文件索引

| 主题 | 路径 |
|---|---|
| 路由挂载总入口 | `src/app.ts:59-114` |
| Gated Delegation Pipeline | `src/services/llm-native-router.ts:120-179` |
| Local Manager | `src/services/manager/local-manager-runtime.ts:96` |
| Context 边界契约 | `src/services/context/context-package.ts:38-62` |
| Cycle Runtime | `src/services/cycle/cycle-runtime.ts` |
| Contract Verifier | `src/services/verifier/contract-verifier.ts` |
| 工具注册表 | `src/tools/registry.ts` |
| 工具定义 | `src/tools/definitions.ts` |
| Event Envelope | `src/services/trst1/event-envelope.ts` |
| JSONL Event Store | `src/services/trst1/jsonl-event-store.ts` |
| Event Index (SQLite) | `src/services/trst1/event-index.ts` |
| Assessment Engine | `src/services/assessment/assess-engine.ts` |
| Policy Enforcement | `src/trust/policy-enforcement.ts:110-130` |
| LLM Gateway Server | `src/services/trst1/llm-gateway-server.ts` |
| 主看板 | `frontend/src/app/page.tsx` |
| 前端 API 客户端 | `frontend/src/lib/api.ts` |

## 附录 B：相关文档

- 战略架构基线：`docs/strategy/TRST-0-trustos-architecture-thesis.md`
- 执行日志（项目状态锚点）：`docs/strategy/TRST-execution-log.md`
- TRST-5 Charter：`docs/strategy/TRST-5-charter-draft.md`
- 路线图 rebaseline：`docs/strategy/trustos-roadmap-rebaseline-2026-08.md`
- Manager-Worker 信任架构：`docs/strategy/trustos-manager-worker-trust-architecture.md`
- Private Beta 限制声明：`docs/private-beta-limitations.md`
