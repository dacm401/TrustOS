# TRST-7 Continuity Engine — Charter v0.1 (DRAFT)

> 状态：DRAFT（agent-PM 起草，待 Boss scope 签核）
> 授权来源：Boss 2026-10-15 拍板「Continuity Engine 正式立项下一阶段」
> 关联策略文档：`docs/strategy/TRUSTOS-master.md`、`TRUSTOS-brainstorm.md`

## 1. 背景与定位

策略脑暴（详见 `TRUSTOS-master.md`）结论：
- **可验证审计/对第三方问责 = 伪需求**，已冻结（evidence/provenance/signed-approval/trust-ref 不再投资）。
- **真需求 = 连续性**：长程多轮对话里人（和 agent）会失忆、思路断线、错误指挥。痛点普遍，非自嗨。
- **差异化 = 架构原生连续性 + 引擎无关可携带（反锁定楔子）**：记忆是 TrustOS 的，不绑定任何模型；换脑（Hermes/Claude/GPT/本地）图与连续性不变。

TRST-7 把"决策图连续性"从原型/WIP 落成**真实可用的工作台**，作为 TrustOS 的产品主轴 UI。

## 2. Scope（做）

1. **决策抽取服务**（gateway-side LLM decision extraction）
   - `src/services/trst1/decision-extractor.ts`：复用 `forwardChatCompletion` + `modelRegistry`，原始对话 → 决策节点（keyword/prompt/reply/parent/links/seq），永不抛错。
   - 网关端点 `POST /trst1/extract-decisions`（抽+落盘）、`GET /trst1/decisions`（供图读取）。
   - 落 `decision` 事件到 Event Backbone（哈希链 + 索引），与 `model_call` 同路径。
   - **状态：WIP 已完成，待真机验证。**
2. **决策图工作台 UI**（`frontend/src/components/continuity/ContinuityWorkspace.tsx`）
   - 图为主轴（常驻），聊天为节点的一条边；顶部大脑切换器（无缝、连续性不变）；跨会话续接。
   - 真实接线网关（`GATEWAY_URL` 默认 8787），网关不可达时回退种子图 + 本地启发式。
   - **状态：WIP 已完成，待打磨/真机验证。**
3. **真机端到端验证**（Docker+Ollama 完整启动冒烟 + 决策抽取真跑）。**PENDING（需 Boss 提供真机）。**
4. **增量抽取 + 跨 session 真续接**。**PENDING。**
5. **河流动态视觉（可选）**：静态树 → 带时间流的河流分叉呈现。**PENDING。**

## 3. Non-Scope（不做）

- 不重启审计/证据证明层（已冻结）。
- 不做多租户/企业级/生产化基建（遵循 PM 备忘：先验证完整闭环，不 premature productionization）。
- 不替换核心 Manager/Worker 循环；Continuity 是叠加在 Event Backbone 之上的用户向层。

## 4. Acceptance Criteria（初版）

- **AC1**：网关 `POST /trst1/extract-decisions` 在真实 LLM 下能抽取决策节点，并落 `decision` 事件（哈希链完整）。
- **AC2**：`GET /trst1/decisions` 返回正确节点（含跨链/父节点）。
- **AC3**：前端「🌊 连续」视图显示决策图；点节点可展开聊天边并发送。
- **AC4**：跨 session 续接——关掉重开图仍在（本地/服务端持久化）。
- **AC5**：切脑（Hermes↔Claude 等）不改变图与连续性。
- **AC6**：前后端 `tsc --noEmit` 0 错误；真机冒烟 PASS（参考 `verify:trust`）。

## 5. 风险

- **R1 抽取质量**：依赖 LLM 在网关时刻抽取，需真机验证（已修复 tsc，待真跑）。
- **R2 用户只瞥不遍历**：图是否真被使用，需在长程编码垂直验证；有一票否决权。
- **R3 incumbent 项目记忆**：若 Claude/WorkBuddy 项目记忆够好，图的边际价值塌缩 → 胜负手在跨链/分支/why 质量，非"它记得"。

## 6. 边界 / Hold

- 真机验证在本环境 `ENV_BLOCKED`（无 Postgres/Ollama），需 Boss 提供 Docker+Ollama 机（已确认可提供）。
- 不 premature productionization；保持证据/影子模式既有架构。

## 7. 依赖

- TRST-5（PROD_READY 09-23）、TRST-6（本地优先 LLM + 影子模式 10-08 收口）。
- Event Backbone（决策事件类型已加 `decision`）。
- Provider 抽象（TRST-6）使"无缝切脑"可落地。

## 8. 执行序列（提案）

- **S1**（已完成代码）：抽取服务 + 图 UI + 网关端点 WIP 落地，tsc 0 错误。
- **S2**：真机端到端验证（Docker+Ollama + 真实 LLM 抽决策）。
- **S3**：增量抽取 + 跨 session 真续接。
- **S4**（可选）：河流动态视觉。
- **S5**：钉长程编码垂直，验证 R2（用户是否真遍历图）。

## 9. 文件清单（本草案涉及）

- 新增：`src/services/trst1/decision-extractor.ts`、`frontend/src/components/continuity/ContinuityWorkspace.tsx`、`demo/decision-graph*.html`（原型）
- 改：`src/services/trst1/event-envelope.ts`（加 `decision` 类型 + `decision_*` 字段）、`src/services/trst1/llm-gateway-server.ts`（端点）、`frontend/src/lib/api.ts`（网关助手）、`frontend/src/app/page.tsx`、`frontend/src/components/layout/Sidebar.tsx`
- 文档：`docs/strategy/TRUSTOS-*.md`（定位/脑暴，收口为基线参考）
