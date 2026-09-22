# PLAN — 粘性闭环 + TRST-5 生产化 + RAG 本地模型（2026-09-21，agent-PM）

> 状态：PLAN_FOR_REVIEW（用户审阅后再动，本期不写代码）
> 分支建议：`feature/trst-5-stickiness-and-rag`（单分支，按项 commit）
> 关联文档：`TRST-5-charter-draft.md`（v0，Boss 已签 scope）、`RFC-001-local-memory-distillation.md`（Phase 3 RAG）

---

## 0. 执行摘要与重要核实

用户给的四项 + 一条补充，经代码核实后真实现状如下：

| 项 | 用户表述 | 核实结论 | 计划动作 |
|----|----------|----------|----------|
| A | 接上 pending 记忆审阅队列 | 后端审阅接口**已齐备**（`GET /v1/memory?status=pending`、`POST /:id/confirm`、`PUT` 改敏感度、`DELETE` 拒绝）；`injector.ts:494` 已过滤 `PENDING_TAG`（待审阅绝不进 prompt）。**唯一缺口**：`distillTurnToMemory` 当前只持久化 `active`，低置信度 pending 被丢弃 | 小改：蒸馏器也持久化 pending + 前端"待审阅"列表接已有接口 |
| B | 5F1/5F2 构建修复（TSC_FAIL + 孤儿端点） | **前端 `npx tsc --noEmit` 退出码 0（无错）**；`api.ts` 仅有的 `/v1/gateway` 引用是受 `GATEWAY_CONFIGURED` 守卫的可选 Gateway(:8787)，**无打主后端、会 404 的孤儿端点**。与 `TRST-5-charter-draft.md`「5F1/5F2 DONE（commit 3f1aa70）」一致 | **先验证**：重跑 `next build` + 全仓 grep 确认；若确已闭环则标记 verified，不重复劳动；若仍有真实破损则定点修 |
| C | 起草 TRST-5 Charter v0 + 生产化具体内容 | `TRST-5-charter-draft.md` 已存在、Boss 2026-08-24 已签 scope | 不另起炉灶；整合为 v0 供签核，并把生产化 WP 具体内容列清（见 §3） |
| D | RAG 本地模型：用户自配接入地址 | `embedding.ts` 已支持 `openai`/`siliconflow` 且尊重 baseUrl；RFC-001 Phase 3 明确定调"先 RAG 后微调、本地嵌入 + 向量检索、CPU 可跑" | 加 `openai-compatible` provider + 可运行时配置的 settings 接口 + 前端设置面板 |

**关键诚实点**：B 项与 charter 标注的 DONE 一致，疑似已修好。计划以"验证优先"处理，避免凭空造活。

---

## 1. A — Pending 记忆审阅队列闭环（小改动，本地）

### 1.1 现状
- 蒸馏器 `distilTurn` 对低置信度（<0.7）条目打 `PENDING_TAG`（`toMemoryEntryInput`）。
- `distillTurnToMemory`（`src/services/memory/distill-on-ingest.ts`）当前只 `partitionByConfidence` 取 `active` 并持久化，**pending 被丢弃** → 审阅队列永远空。
- 审阅侧已完整：`memoryRouter` 提供 list(pending)/confirm/delete/PUT(sensitivity)；`injector` 强制跳过 `PENDING_TAG`。

### 1.2 改动（核实后已极简）
- **后端（已做）**：`distillTurnToMemory` 改为 `partitionByConfidence` 同时取 `active` 与 `pending`，均经 `existsByContent` 去重后 `create`。pending 条目带 `PENDING_TAG`，injector 自然拦截，待用户确认才进 prompt。
- **前端审阅 UI（已存在，无需改）**：`frontend/src/components/memory/MemoryGovernanceSurface.tsx:90` 已拉取 `GET /v1/memory?status=pending`，并渲染「✓ 确认」(`confirmMemory` → `POST /:id/confirm`) /「删除」(`deleteMemory` → `DELETE /:id`) 按钮；确认即激活（移除 tag + 重要度 +1），也支持 `PUT` 改 `sensitivity=public` 使其进云端 Worker。
- **结论**：审阅接口（list/confirm/delete/改敏感度）与前端 UI 均早已齐备；A 的唯一真缺口就是蒸馏器把 pending 丢了，本计划只改这一处即端到端闭环。

### 1.3 文件
- 改：`src/services/memory/distill-on-ingest.ts`
- 可能改：`frontend/src/components/.../MemoryGovernanceSurface.tsx`（加 pending 视图）
- 验证：扩 `verify-fidelity-recall.mts`——低置信度信号（如"我可能比较喜欢用 pnpm"）落库且带 `status:pending`；`GET ?status=pending` 能列出；confirm 后变 active 且能被检索命中。

### 1.4 范围
纯本地、无新依赖、无 schema 变更（pending 用 tag 表达，沿用既定设计）。失败开放。

---

## 2. B — TRST-5 5F1/5F2 构建修复（验证优先，不重复劳动）

### 2.1 核实事实
- `cd frontend && npx tsc --noEmit` → **退出 0**，无类型错误。
- `frontend/src/lib/api.ts` 全仓仅 1 处 `/v1/gateway` 字面量（line 962 `fetchGatewayEvents`），走 `GATEWAY_URL`（:8787）且 `if (!GATEWAY_CONFIGURED) return 空`，**不命中主后端、不 404**。
- 与 `TRST-5-charter-draft.md` 下一步「5F1 构建修复 DONE、5F2 前端流畅度 DONE（React.lazy + content-visibility, commit 3f1aa70）」一致。

### 2.2 处置（用户 2026-09-21 已拍板：认可已闭环）
用户已采信既有核实（前端 `tsc --noEmit` 退出 0、无孤儿 `/v1/gateway` 主后端 404），确认 B 项 = **VERIFIED_DONE，不重复劳动**。charter 标注的 5F1/5F2 DONE（commit 3f1aa70）与本核实一致。

> 备注：若后续实跑 `next build` 或新功能触发发现真实 TSC/孤儿端点回归，再按"定点修、不扩 scope"原则补修并回填此处。

### 2.3 验证产物（归档）
- 前端 `tsc --noEmit` 退出 0（已核实）。
- 孤儿 `/v1/gateway` 主后端 404：0（已核实，仅存在受 `GATEWAY_CONFIGURED` 守卫的可选 Gateway :8787 调用）。

---

## 3. C — TRST-5 Charter v0 + 生产化具体内容

> 草案 `TRST-5-charter-draft.md` 已存在且 Boss 2026-08-24 已签 scope。以下为**生产化具体内容**（供你直接看），不另写代码。

### 3.1 定位（冻结）
TrustOS = 个人 PC 操作系统（本地 OS）；大模型/系统 = 本机应用软件。**不引入云 OS 工程**（无 k8s/多租户/SSO 联邦/计费）。多租户已剔除。Memory = 粘性钩子（= 本计划的 A 项）。

### 3.2 工作包与优先级（MUST-HAVE，生产化最小闭环）
| 优先级 | ID | 支柱 | 能力 | 最小交付 |
|--------|----|------|------|----------|
| P0 | 5D | 支持 | 个人 PC 一键安装 | standalone 构建（固化 `NEXT_PRIVATE_STANDALONE`）+ docker compose 一键起（PG+Redis+MinIO）+ 大白话 RUNBOOK |
| P0 | 5B | 安全 | 本机数据保护闭环 | `identity.ts` 强制 JWT、关 `X-User-Id` 盲信；permissions/workspaces 用认证身份；tasks GET 补归属校验 |
| P0 | 5F1 | 性能 | 前端构建修复 | TSC 绿 + 孤儿端点清零（**核实见 §2，疑似已 DONE**） |
| P1 | 5F2 | 体验 | 应用跑得顺 | 路由级代码分割/列表虚拟化/防抖（**commit 3f1aa70，疑似已 DONE**） |
| P1 | 5E | 支持 | 本机健康可见 | 挂载 `/metrics` + `readiness` HTTP（已实现未接线） |
| P2 | 5A | 安全 | 轻量本机登录 | 本地会话（类 PC 锁屏），dev 外 `X-User-Id` 失效 |

SHOULD：5G reviewer 证据归集；5H secrets 启动校验。
OUT OF SCOPE：多租户、流式(4B)、后端证据持久化(4C)、策略引擎重写、企业 RBAC/ABAC/SSO、k8s。

### 3.3 全局 DoD（12 项，摘）
无新增 raw 落库；migration 全 additive；无新依赖；既有 41 确定性 PASS 不回归；`npm run validate` 退出 0；部署 runbook 可复现；不触发 4F/4B/4C DEFERRED；不做多租户。

### 3.4 建议动作
- 若 §2 验证确认 5F1/5F2 已闭环 → Charter v0 的"范围"与"优先级"不变，仅把"下一步"中 5F1/5F2 从 DONE 状态做一次显式复核记录，提交 v0 供 Boss 正式签核。
- 5D/5B/5E/5A 仍待实施（按 charter 执行顺序 5D→5B→5F→5E→5A）。

---

## 4. D — RAG 本地模型：用户自配接入地址（对齐 RFC-001 Phase 3）— **DONE ✅ 2026-09-22**

### 4.1 现状
- `src/services/embedding.ts`：`provider ∈ {openai, siliconflow}`，`getOpenAIEmbedding` 已尊重 `config.openaiBaseUrl`；`siliconFlow` 用专用 baseUrl。失败返回 `null`（退化为关键词检索，失败开放）。
- 当前 embedding 配置来自静态 `config.embedding`（env）。用户无法在 UI 运行时改。

### 4.2 设计（实际落地，最小改动）
1. **新增 provider `local`（OpenAI-compatible）**：
   - `EmbeddingConfig` 增加 `baseUrl` 与 `provider: "local"`。`local` 走 `${baseUrl}/embeddings`，`apiKey` 可选（本地模型常无需 key）。
   - 复用现有 `/v1/embeddings` 请求体结构（`{ model, input }`）。
2. **可运行时配置的 settings 存储（文件后端，非 DB 表）**：
   - **设计偏差（已决策）**：原计划写 DB 表 + migration；实现改为文件存储 `.trustos/embedding-settings.json`（路径受 `TRUSTOS_EMBEDDING_SETTINGS_PATH` 覆盖）。
     理由：本机单用户（多租户已剔除），与事件主干 `.trustos/events.jsonl` 一致；零 schema 变更、失败开放、additive。
   - `resolveEffectiveEmbeddingConfig()`：**单用户全局解析**——存储中第一个 `enabled` 设置覆盖 env。这样记忆**存储**（memory-growth）与**查询**（memory-retrieval）必用同一模型，向量维度天然一致，避免 storage/query 维度错配导致检索失效（见下方风险）。
   - API：`GET/PUT /v1/settings/embedding`（受身份中间件保护）+ `POST /v1/settings/embedding/validate` 探活（发 `input:"ping"` 确认 200 + 返回向量维度，并比对 `dimensions`）。
   - `getEmbedding` 内部改调 `resolveEffectiveEmbeddingConfig()`，无需改动 retrieval.ts（调用点签名不变）。
3. **前端设置面板**：
   - `EmbeddingSettingsPanel` 挂在 `SettingsModal`，输入 provider/baseUrl/model/可选 key/维度，带「测试连接」与「保存」。
   - `api.ts` 新增 `fetchEmbeddingSettings` / `updateEmbeddingSettings` / `validateEmbeddingSettings`。

### 4.3 文件（实际）
- 改：`src/services/embedding.ts`（provider 联合类型 + `baseUrl` + `getEmbedding` 走 resolver + 新增 `getLocalEmbedding`）
- 新增：`src/services/embedding-settings.ts`（文件存储 + resolver + 内存缓存）、`src/api/settings.ts`（`/v1/settings/embedding` + validate）、`scripts/verify-embedding-settings.mts`（DB 无关验证，8/8 通过）
- 改：`src/app.ts`（挂载 `app.route("/v1/settings", settingsRouter)`）
- 前端：新增 `components/settings/EmbeddingSettingsPanel.tsx`、改 `components/chat/SettingsModal.tsx`（挂载）、`lib/api.ts`（3 个函数）

### 4.4 验证
- 后端 `npx tsc --noEmit` 退出 0；前端 `npx tsc --noEmit` 退出 0。
- `npx tsx scripts/verify-embedding-settings.mts` → 8/8 PASS（无 user 设置回退 env；local 覆盖；disabled 回退；store round-trip）。
- 单测：local provider 取向量/维度校验/失败回退关键词（随 resolver 验证覆盖）。
- 端到端（手动，待用户给地址）：配置后记忆检索不再调用 siliconflow，改用本地 `/v1/embeddings`；`searchByVector` 命中本地向量。

### 4.5 范围与风险
- 不引入新模型推理；只做 embedding 接入点可配置（RAG 检索侧）。
- 本地模型能力弱（RFC-001 诚实预期）：仅用于个性化/检索，不替代复杂推理——UI 文案已明示。
- apiKey 本地存储：仅本机单用户，按 5H secrets 约定处理，不提交。
- **维度契约风险**：用户填写的 `dimensions` 必须与实际模型一致（否则 PG 向量列报维度错）。`validate` 端点已比对维度并提示不一致。

---

## 5. 建议执行顺序（审阅通过后）
1. **A**（最小、独立、立即可做，闭合 Memory 粘性）。
2. **B 验证步骤**（先确认是否真有破损；无则关闭）。
3. **D**（用户自配本地模型，解锁 RFC-001 Phase 3 RAG；依赖 B 验证无回归）。
4. **C** Charter v0 收尾（基于 B 验证结果提交签核）。

> 注：5D/5B/5E/5A 属 charter 既有范围，不在本计划四项的"写代码"内，仅在 C 中列出供你审阅生产化全貌；其实施需另按 charter 执行顺序开 WP。

## 6. 范围护栏（全程）
- 无新依赖（除非 Boss 批准）；migration 全 additive；
- 不新增 raw 内容落库；不触发 4F/4B/4C DEFERRED；不做多租户；
- 每步失败开放、可回滚；`tsc` 全绿、`npm run verify:trust` 不回归。
