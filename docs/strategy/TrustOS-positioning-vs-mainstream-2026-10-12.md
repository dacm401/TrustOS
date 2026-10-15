# TrustOS 产品定位与主流 Agent 对比

> 日期：2026-10-12
> 背景：TRST-5 已 PROD_READY（Boss 确认 2026-09-23）；TRST-6 完整集（6.1–6.4，本地优先 LLM + 影子模式）代码完成。
> 目的：用一段话讲清 TrustOS 是什么，并与现有主流 agent 做维度对比，作为跨会话可追述的定位基线。

---

## 1. 一句话定位

TrustOS **不是**一个"帮你写代码 / 查资料的 agent"，而是一个**跑在用户自己电脑上的、把每一次 AI 行为都记成可验证证据链的"信任运行时"**。

用户用它指挥 AI 干活，但它有三个硬约束：
1. **默认先观察、不执行**（Shadow Mode 首跑，real 需显式 opt-in）；
2. **AI 干活时看不到用户的原始记忆和历史**（Worker 只收 brief + 可选 artifact 摘要）；
3. **每个动作留下哈希链证据**，用户可独立 SHA256 校验 `output_hash`。

它卖的是"可信"，不是"更聪明的模型"。

---

## 2. 与主流 Agent 的核心维度对比

| 维度 | 主流 Agent（典型） | TrustOS | 差异本质 |
|---|---|---|---|
| **数据驻留 / 主权** | 多数云端，对话 / 文件送 LLM 厂商 | 本地优先，可本机模型（Ollama），数据不出本机 | 主权归属不同 |
| **行为可审计** | 依赖厂商日志、基本不透明 | 哈希链事件主干 + 签名证据 + `output_hash` 可 SHA256 校验 | 可验证 vs 黑盒 |
| **执行前姿态** | 默认直接执行（或简单确认） | 默认 **Shadow 观察态**，`real` 需 opt-in，shadow 下 `real` 被**硬 hold** | 安全默认不同 |
| **隐私架构隔离** | 整段 history 通常全量进 prompt | Worker **只收 brief**，不碰 raw memory / history（已单测覆盖） | 架构级隔离 vs prompt 级 |
| **风险门禁** | 少有内置风险评估 | `/v1/assess` 四级风险 + policy control + human-review | 原生信任控制面 |
| **模型 / 工具生态** | 丰富（原生工具、MCP、插件） | 较窄（OpenAI 兼容 + Ollama，工具生态早期） | 生态成熟度劣势 |
| **多智能体编排** | LangGraph / AutoGen / CrewAI 成熟 | 单 Manager + Worker 隔离，编排简单 | 编排能力劣势 |
| **目标用户** | 大众 / 开发者 | 先服务愿跑容器的极客 | 切入点不同 |

---

## 3. 主流 Agent 分类（对照 TrustOS 的位置）

- **编码类**：Cursor、Claude Code、Copilot、Devin、Windsurf、CodeBuddy。强在模型与工程 UX，但代码 / 上下文仍发往云端模型，行为审计依赖厂商。
- **框架类**：LangChain / LangGraph、AutoGen、CrewAI、OpenAI Agents SDK、Claude Agent SDK。强在多智能体编排与生态，但信任 / 审计 / 本地主权不是设计重心（LangSmith 等可观测为云端附加项）。
- **自主任务类**：Manus、OpenAI Operator、Claude Computer Use。强在端到端自动执行，但更"黑盒"、数据更外溢。
- **低代码类**：Dify、Coze（扣子）、n8n。强在可视化编排与私有化部署，审计 / 证据链粒度有限。

---

## 4. 强项 / 弱项（诚实记录）

### 强项（真实技术深度，主流普遍不做或只做表面）
1. **本地主权**：推理可本机跑（Ollama sidecar，`docker compose --profile local-llm`），数据不出本机。
2. **可验证信任**：哈希链事件主干 + 证据签名 + `output_hash` 校验，reviewer 可独立验证。
3. **架构隔离**：Worker 不接触原始数据 / 记忆，信任内核（Event Backbone / 签名）独立不被触碰。
4. **默认安全**：Shadow 默认首跑，real 需 opt-in 且 shadow 下被硬 hold。

### 弱项（已知边界）
1. 模型 / 工具生态窄。
2. 多智能体编排简单（单 Manager + Worker）。
3. **streaming、enforcement 仍 deferred**（TRST-4B / TRST-4F 冻结）。
4. 最小集下 **embedding / Memory 检索仍走云端**（SiliconFlow），仅 chat 推理可本地化；gateway upstream 仍默认云端。
5. 刻意**单用户、不做多租户**（本机 OS 定位）。
6. 本环境（低配测试机）local 模型实跑冒烟 ENV_BLOCKED，cloud 维度已实测；高配机可补本地验证。

---

## 5. 适合谁 / 不适合谁

- **适合**：在意数据不出本机、需要可审计 AI 行为、愿意自己跑容器的极客 / 安全敏感用户。Memory 是用户粘性钩子（随使用积累、迁移成本高）。
- **不适合**：想要开箱即用、丰富插件、最强模型、团队协作（多租户）的大众用户——这类需求主流云 agent 更合适。

---

## 6. 依据与来源

- TRST-0.3 战略基线（架构论文 / 威胁模型 / 执行追踪 charter，ACCEPTED）确立"本地优先 + 信任控制面 + Shadow 默认首跑"冻结共识。
- TRST-5 生产化收口（PROD_READY，2026-09-23）：登录修复、前端同源反代、WP-5A/5B/5E。
- TRST-6 完整集（2026-10-08 签核）：可插拔 LLM provider（cloud/local）、影子模式默认首跑、影子对照脚本、Ollama sidecar 极客文档。
- 代码落点：`src/config.ts`（provider 派生）、`src/services/shadow/first-run-mode.ts`（shadow 状态机 + 真实降级保证）、`src/services/manager/execution-attempt-service.ts`（real hold）、`src/api/health.ts`（execution_mode 暴露）、`scripts/trst6/run-shadow-compare.mts`（cloud vs local 对照）。
