# TrustOS 主文档（单一事实来源）

> 本文件是策略与现状的唯一收口文档。详细的发散讨论见 `TRUSTOS-brainstorm.md`（原始点池，A1–A15）。
> 定位文档 `TRUSTOS-positioning.md`、用户视角 `TRUSTOS-user-facing.md` 为其背景。

---

## 0. 一句话定位（thesis）
**TrustOS 是一个让 agent「记得住、接得上」的连续性工作台：决策图是主轴，聊天只是节点的一条边；任何引擎（Hermes / Claude / GPT / 本地）都能接入当大脑，但记忆与连续性是 TrustOS 的、跟着人走，不绑定任何模型。**

---

## 1. 我们怎么走到这（决策时间线，已锁定）
| # | 决策 | 结论 |
|---|------|------|
| 1 | 可验证审计/对第三方问责 | **伪需求，冻结**。单用户本机威胁模型不成立，没人会校验哈希。 |
| 2 | 那套信任基建怎么办 | 保留 Event Backbone，改叙事为**连续性**。审计层（evidence/provenance/signed-approval/trust-ref）认栽、停投、deprecated。 |
| 3 | 从头重写还是捡起来 | **捡起来**。事件主干写路径干净、未被密码学污染，复用成本极低。 |
| 4 | 差异化在哪 | **架构原生连续性 + 引擎无关可携带（反锁定）**。表层 UX 打磨不是差异化。 |
| 5 | 接 Hermes 浅不浅 | **深接（Path A）**：Hermes 当 worker 进主干，动作也流经网关被记录；不是 UI 后黑盒。借脑不借壳。 |
| 6 | 记忆回放长什么样 | 用户构想：**决策树 / 流动分叉河流**，按需非实时，节点=关键词+时间，点开有 prompt/回复/「问题在哪被回答」跨链定位。优于线性时间线。 |
| 7 | 只做这一层能独立成产品吗 | **不能 standalone**。缺进入理由，单层=feature 非 product。必须二选一。 |
| 8 | 路1（embed）还是路2（图主轴） | **选路2**：决策图为主轴的工作台 + 钉长程编码垂直。 |
| 9 | 路2 胜机 | 白空格（incumbents 皆 action-first，无 decision-first）+ 顺风（agent 越自主人越失忆）+ 反锁定（图可携带，incumbents 结构性难抄）。 |
| 10 | 证伪方式 | **dogfooding**：用本场真实对话做种子数据，构建决策图 demo。 |
| 11 | 「太简单了」自评 | 认同。建了简单的 20%（树查看器+薄抽取器），延后了差异化的 80%（图为主轴 UX、跨 session 续接、增量抽取、可携带演示）。当前产物≈聊天+侧栏，恰踩致死条件。 |
| 12 | 自建 UI 还是嵌入 | **自建 UI（路2 真身）**，后面接不同 agent；切脑无缝（参考 WorkBuddy 无感知切换）。 |

---

## 2. 当前战略结论（不用再选）
1. **审计/证明层 = 伪需求，已冻结**，不再投资。
2. **真需求 = 连续性**（多轮后人的记忆兜底 / 思路断线），这是普遍痛点，非自嗨。
3. **差异化 = 架构原生连续性 + 引擎无关可携带（反锁定楔子）**。
4. **产品形态 = 决策图为主轴的工作台，聊天降为节点的边**（不是侧栏、不是弹窗）。
5. **UX 原则 = 结构性差异（交互模型不同），非 cosmetic 打磨；按需非实时**。
6. **接入 = 自有核心（Event Backbone + 抽取）+ 任意模型当 worker（借脑不借壳）**。

---

## 3. 已建的东西（现状）
### 后端（真实代码，已落 `src/services/trst1/`）
- `event-envelope.ts`：事件类型联合新增 `"decision"`。
- `decision-extractor.ts`（新）：`extractDecisions()` 复用 `forwardChatCompletion` + `modelRegistry`，把原始对话抽成决策节点；`toDecisionEvent()` 转成 `decision` 事件。**永不抛错**。
- `llm-gateway-server.ts`：挂 `POST /trst1/extract-decisions`（抽+落盘）与 `GET /trst1/decisions`（供图查询）。落盘走与 `model_call` 完全相同的 `persistEvent` 哈希链。

### 前端原型（`demo/`）
- `decision-graph.html`（v1）：手工决策树，对照基线。
- `decision-graph-v2.html`（v2）：原始对话→启发式抽取→对照，验证抽取质量。
- `workspace-v3.html`（v3，**当前主原型**）：**决策图为主轴 + 聊天为边 + 顶部无缝切脑 + 跨 session 续接**；真实接线网关端点，网关不可达时优雅回退（本地启发式+种子数据），保证可预览。

---

## 4. 还没做的（诚实边界）
- 未并入真实 Next.js 壳；v3 是独立原型。
- 增量抽取目前是「整段 thread 重抽 + 去重」，非严格流式增量。
- 跨 session 是 mock，未真打 `/sessions` 做持久续接。
- 「河流/分叉」动态视觉未做，目前是静态树。
- 切脑无缝是 UI 演示；真实多模型需把 `hermes/claude/gpt` 映射到 provider 配置（TRST-6 已就位）。
- 真实 LLM 抽取质量（风险1）仅在回退启发式下看过，未用真模型跑过本场对话。

---

## 5. 执行序列（单一推荐路线，不再分叉）
> 按此顺序推进；只有标 ⚠️ 处需你拍板，届时单独问，不每次给选项。

- **S1 · 真连网关跑一轮**（最高优先）：把 v3 并入真实 Next 前端，配好网关端口与 provider，`GATEWAY_BASE` 指向真实服务；用**本场对话**真抽一次，看真实 LLM 抽取质量 → 一次检验风险1。
  - **已落地（代码层）**：① `frontend/src/lib/api.ts` 新增 `fetchDecisions / gatewayChat / gatewayExtract` + `DecisionNode` 类型；② 新增 `frontend/src/components/continuity/ContinuityWorkspace.tsx`（图为主轴 React 组件，接真实网关 + 种子/启发式回退）；③ `Sidebar` 加「🌊 连续」导航、`page.tsx` 接入视图。`tsc --noEmit` 0 错误。
  - **待本地跑**：本沙箱起网关有 shell 摩擦未跑通；在你本地执行 `npm run trst1:gateway` 后，`npm run dev` 起前端 → 点「连续」→ 聊天即见节点抽取。真 LLM 抽取需 `.env` 配 provider key；无 key 时 UI 自动回退本地启发式（仍可看流程）。
- **S2 · 增量抽取 + 跨 session 真续接**：thread 级别增量（不整段重抽）；会话列表真打 `/sessions` + `/trst1/decisions` 持久续接。
- **S3 · 河流/分叉动态视觉**：把静态树升级为带时间流的河流分叉呈现，承载「过程感」。
- **S4 · 切脑真映射**：`hermes/claude/gpt` → 真实 provider（TRST-6 填配置），让「无缝切脑、连续性不变」从演示变事实。
- **S5 · 钉垂直验证**：在长程编码场景跑通「图主轴 + 续接」，验证用户是否真遍历图（风险2）。

---

## 6. 开放风险（记录，不阻塞）
- **R1 抽取质量**：依赖 LLM 在网关时刻抽取，需 S1 真实验证。
- **R2 用户只瞥不遍历**：图是否真被使用，需 S5 垂直验证；有一票否决权。
- **R3 incumbent 项目记忆**：若 Claude/WorkBuddy 项目记忆够好，图的边际价值塌缩 → 胜负手在「跨链/分支/why」质量，非「它记得」。

---

## 7. 待你拍板的点（⚠️ 仅这些）
- 真实网关端口与 provider 配置（S1 需要）→ 你提供后我接。
- S5 选哪个垂直先打（长程编码 / 研究写作）→ 我倾向长程编码。
- 其余按 S1–S5 推进即可，不必每轮选。
