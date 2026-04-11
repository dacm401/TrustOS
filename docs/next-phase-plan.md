# Sprint 15+ 规划：从 Demo 到可用版

**基准：** `docs/project-completion-report.md`（2026-04-11）
**当前完成度：** ~85%
**目标：** 单用户可稳定使用的 v1 可用版

---

## 背景说明

当前项目已具备 Runtime 主干能力（Task/路由/Prompt/Memory/Execution/Model/Dashboard），真实剩余缺口集中在：
**身份可信、Evidence、Task Resume、UI 工作台、评测体系。**

---

## 1. 下一阶段卡片

| 优先级 | 卡片 | 类型 | 目标 | 影响模块 | 风险 | 验收标准 |
|---|---|---|---|---|---|---|
| **P0** | **C3：服务端身份上下文** | 阻塞 | `user_id` 从客户端传参迁移到服务端 session/auth middleware，消除归属污染 | chat.ts、feedback API、dashboard API、learning-engine、feedback-event-repo | 需要设计 session 机制；现有 537 个测试需确认回归；`body.user_id` 在多处使用 | feedback_events/dashboard/growth 数据归属可信；旧数据不破坏；测试全绿 |
| **P0** | **E1：Evidence System v1** | 阻塞 | 新建 `evidence` 表 + `EvidenceRepo`（create/getById/listByTask/associate）+ `/v1/evidence` CRUD API；task 可关联 evidence；外部检索预留接口 | `db/repositories.ts`（新增 EvidenceRepo）、`api/`（新增路由）、`types/index.ts` | evidence 表与 memory_entries 的职责边界需明确定义；防止两张表职责重叠 | evidence 可存储、可按 task 检索；API 可用；单元测试通过 |
| **P0** | **R1：Task Resume v1** | 阻塞 | 用户说"继续 X 任务"，系统能恢复 task summary + blocked_by + next_step + traces 到 planner 上下文；架构约束：TaskPlanner 不直接查 DB → 通过 chat.ts 中间层注入 | `api/chat.ts`（新增 resume 分支）、`services/task-planner.ts`（接受 resume context）、`services/prompt-assembler.ts`（接受 summary 注入） | task-planner 不查 DB 是架构约束不能硬破；需在不违背约束的前提下传 context；summary 格式需稳定 | resume 请求 → planner 收到 task context → 执行路径与新建任务可区分；E2E 测试通过 |
| **P1** | **T1：web_search Tool 实现** | 增强 | `tool-registry.ts` 中注册 web_search handler；调用外部搜索 API（provider 可配置）；结果写入 evidence 表；guardrail 参数限制已存在 | `tools/definitions.ts`、`tools/executor.ts`、`services/tool-guardrail.ts`（已有参数限制） | 依赖外部搜索 API 稳定性；需防止无 API key 时系统崩溃（目前 stub） | web_search 调用成功 → evidence 记录生成 → trace 记录；fallback 当无 API 时给出友好提示 |
| **P1** | **UI1：Task Workspace v1** | 增强 | 前端最小工作台：Task List 面板、Task Summary 视图、Trace Panel、Memory Panel；不求炫酷，只求可见可控 | `frontend/`（Next.js）、`api/tasks.ts`、`api/memory.ts` | 前端 Next.js 组件需调研当前代码深度；可能需要重建而非增量 | 用户可在 UI 看到当前任务状态、历史任务、traces、memory entries；基本可操作 |
| **P1** | **EV1：Benchmark Runner v1** | 增强 | 三类任务集（direct/research/execute）× 每类 10 条case；自动跑并记录 token/task、fallback rate、task completion rate | `evaluation/`（新建目录）、测试套件扩展 | case 设计质量决定 benchmark 价值；第一批 case 应由项目方提供 | benchmark 可重复运行；结果持久化；至少 direct/research 各 5 条可跑通 |

---

## 2. 首批建议开工

### ① C3：服务端身份上下文

**理由：**
这是唯一真正"不修就无法进入真实使用"的问题。当前 `user_id` 来自 `body.user_id || "default-user"`（chat.ts:47），意味着任何人都可以伪造 feedback、污染 learning 数据、让 dashboard 归属失真。一旦开始有第二个真实用户，这个风险就会暴露。而且 Sprint 14 MEMORY.md 里已经明确标注这是"临时过渡"，升级为阻塞项是顺理成章。

### ② E1：Evidence System v1

**理由：**
这是 LAR "默认工具优先于语言脑补"核心主张的唯一缺失环节。没有 evidence 表和检索，memory entries 独挑大梁但语义不对——memory 是"我知道的信息"，evidence 是"我查到过的来源"，两者不该混用。E1 建完以后，T1（web_search）和 R1（resume with evidence context）才有依附的基础。

### ③ R1：Task Resume v1

**理由：**
"跨会话持续推进任务"是 LAR 区别于普通 chat 的核心卖点。当前 task summaries/traces 表都在，但 task-planner 不查 DB（架构约束），所以用户说"继续"时系统实际上是新建任务，不是续接。R1 解决这个问题，让"继续"真正有效。E1 之后 R1 更干净（resume context 里可以带 evidence），但 R1 本身可以先做 chat.ts → task-planner 的 context injection。

---

## 3. 总体建议

**建议进入下一阶段开发。**

但有一个前置条件：C3 的 session 机制设计需要在第一条卡开工前先评审，不要直接开代码。

理由：身份上下文是横切关切，改动点遍布所有 API。方案没想清楚就动代码，会导致返工。其他的 E1/R1/T1/UI1/EV1 都可以按正常 sprint 节奏推进。

---

## 附：各卡先审计后改代码的检查清单

| 卡片 | 先读文件 | 关键问题 |
|---|---|---|
| C3 | chat.ts、feedback API、所有 repo 的 user_id 来源 | session 如何持久化（cookie/token/JWT）？旧数据如何迁移？ |
| E1 | memory-store.ts、memory-retrieval.ts、types/index.ts | evidence 与 memory_entries 的边界怎么划？检索粒度是什么？ |
| R1 | task-planner.ts、chat.ts、prompt-assembler.ts | context injection 路径怎么走最干净？summary 格式稳定性？ |
| T1 | tool-registry.ts、tool-executor.ts、tool-guardrail.ts | 搜索 API 用哪个（Bing/Serp/Google）？无 key 时行为？ |
| UI1 | frontend/src/ 目录结构 | 现有 Next.js 代码深度如何？是基础框架还是已有面板？ |
| EV1 | tests/ 目录结构 | 测试框架用哪个？case 格式怎么定？ |
