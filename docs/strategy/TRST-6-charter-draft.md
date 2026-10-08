# TRST-6 Charter (Draft v0) — 本地优先 LLM 与影子模式

> 状态：DRAFT v0，**scope 已签核 2026-10-08 为最小集（6.1+6.4），同日扩为完整集（6.1+6.2+6.3+6.4）**（Boss 选 "C 两者都要"）。
> 起草时间：2026-10-08。前置：TRST-5（Private Beta Readiness，verdict=PROD_READY，已 push origin，合 master 待 Boss 指令）。
> 建议分支：`feature/trst-6-local-first-llm`。

---

## 1. 问题 / 为什么是现在

- TRST-5 把产品做成 PROD_READY：可部署（5D 极客友好部署）、安全闭环（WP-5A/5B JWT 强制）、可观测（5E metrics 挂载）、前端流畅（5F1/5F2）。登录拦路虎（裸 fetch 漏 Authorization）也于 2026-09-24 修复并验证。
- **价值主张矛盾**：产品定位是"本地 OS / 数据不出本机 + 可验证审计 + Worker 不碰原始数据的架构隔离"，但**推理仍强依赖 SiliconFlow 云端 LLM**（`OPENAI_BASE_URL=https://api.siliconflow.cn/v1` + 云端 key）。对"愿自己跑容器的极客"而言，真正的本地主权 = 推理也能本地化。
- **冻结架构未兑现**：TRST-0.3 战略基线明确 "Shadow Mode as default first-run experience"（首次运行默认观察态、不强制外部动作、生成 shadow report）。但当前实现默认 `execution_mode=real`，首次即实际外发执行。
- **成熟度评估探索 A**：TRST-5 charter 的成熟度评估给出 "探索 A：本地模型影子模式"——可插拔本地模型，并在影子态与云端模型对照，建立信任、降低切本地的决策风险。

一句话：TRST-5 让产品"能跑、安全、可观测"；TRST-6 让产品对极客"真正主权、首次即安全"。

---

## 2. Scope（v0 最小集提案，待签核取舍）

| # | 项 | 说明 | 是否纳入 v0 |
|---|---|---|---|
| 6.1 | **可插拔 LLM provider** | 在既有 OpenAI 兼容接口上，增加 `local` provider（Ollama / llama.cpp / vLLM 的本地 OpenAI 兼容端点），通过 env 切换，**零代码改动切换**（仅 config 读取不同 baseURL/apiKey）。 | 必做 |
| 6.2 | **影子模式默认首跑** | 首次运行 / 可配置默认 `execution_mode=shadow`（观察、不强制 external 动作、生成 shadow report）；`real` 需显式 opt-in。复用既有 shadow report 机制。 | **纳入（完整集）** |
| 6.3 | **影子对照** | 让本地模型与云端模型对同一 brief 并行跑，输出差异对照（延迟 / 质量 / 成本），帮助极客判断是否切本地。 | **纳入（完整集）** |
| 6.4 | **极客友好文档** | 部署文档补"本地模型接入"一节；`docker-compose` 提供可选的 Ollama sidecar（默认关，资源可控）。 | 随 6.1 必做 |

**v0 最终范围（完整集）**：6.1 + 6.2 + 6.3 + 6.4 全做（Boss 2026-10-08 选 "C 两者都要"，由最小集扩为完整集）。6.2 兑现冻结架构、首次即安全；6.3 建立本地 vs 云端信任对照。

---

## 3. Out-of-Scope（护栏，不可越）

- 不做新的 enforcement / 不碰网关生产化（TRST-4F deferred，仍冻结）。
- 不改信任 / 审计 / 隔离架构核心（Event Backbone、哈希链、Evidence 签名、Worker 不碰 raw 不变）。
- 不引入重依赖污染：`local` provider 走已有 OpenAI 兼容路径，最多加一个轻量 health check；不引入新的推理框架耦合。
- 不削弱"数据不出本机"主张——本地 provider 模式下所有推理留本机。

---

## 4. DoD（提案）

- [ ] env 切换 `local` / `cloud` provider，后端启动日志打印当前 provider + `reachable` 状态（对齐现有 `[model-gateway]` 启动 banner）。
- [ ] 本地 provider 不可达时**优雅降级**：明确报错 + 回退提示（指向文档），不静默 fallback 到云端、不静默失败。
- [ ] 影子模式默认开启；`real` 需显式 opt-in，并在 UI / 启动处明确标注当前模式。
- [ ] （若纳入 6.3）影子对照能产出一份可读的差异报告（延迟 / 质量 / 成本三维度）。
- [ ] 文档：本地模型接入指南 + `docker-compose` Ollama sidecar 示例（默认关）。
- [ ] 前后端 `tsc --noEmit` 均 0 报错。
- [ ] 一次 E2E 冒烟：local provider 健康探活 + shadow 模式跑通（无 external 实际执行）。

---

## 5. Risks / 坏处（诚实记录）

- **本地模型能力 / 延迟参差**：小模型可能答得差或慢，反而伤害"极客体验"。缓解：6.3 影子对照让用户自己判断；cloud 仍是一键默认易用路径。
- **Ollama sidecar 资源占用**：可选、默认关，避免强迫低配机器。
- **与 TRST-5 安全闭环无冲突**：provider 是后端内部配置，不影响 JWT / `X-User-Id` / 审计事件类型（WP-5A 已加性扩展）。
- **首次默认 shadow 可能让"想直接干活"的极客觉得多一步**：缓解——shadow 与 real 切换成本极低（env / UI 开关），且 shadow 同样产出完整审计 trail，无信息损失。

---

## 6. 与既有资产的关系

- 复用：`[model-gateway]` 启动探活（`reachable` banner）、既有 shadow report 机制、TRST-5 的 JWT / metrics / 部署底座。
- 不冲突：TRST-0.3 冻结的 "Shadow Mode default" 本次**兑现**而非新增；本地 provider 是 config 层扩展，不动信任内核。
- 上游：TRST-5 的 LLM 可达性已确认（SiliconFlow `deepseek-ai/DeepSeek-V4-Flash` 真实可达，非 mock），cloud 路径保留为默认易用选项。

---

## 7. Next Decision（需 Boss 拍板）

> **✅ SIGNED-OFF 2026-10-08（Boss 先选 A/A = 最小集 6.1+6.4；同日选 "C 两者都要" 扩为完整集 6.1+6.2+6.3+6.4）**：默认 `cloud`，`local` 一键 opt-in。执行计划见 `TRST-6-execution-plan.md`。

1. ~~**scope 取舍**~~ → 已定：**完整集**（6.1 可插拔 provider + 6.2 影子默认首跑 + 6.3 影子对照 + 6.4 极客文档/Ollama sidecar）。
2. ~~**默认 provider**~~ → 已定：**默认 `cloud`**（SiliconFlow 一键易用，延续现状）；`local` 经 `LLM_PROVIDER=local` 一键 opt-in。
3. **签核后**：agent-PM 已出 TRST-6 执行计划（WP-6.1 ~ WP-6.4），下一步创建分支 `feature/trst-6-local-first-llm` 开工。

---

## 8. 不做清单（防范围蔓延）

- 不做本地模型的微调 / 蒸馏 / 量化（用现成 gguf / Ollama 拉取）。
- 不做多模型路由自动择优（6.3 仅对照展示，不自动切换）。
- 不做网关 / enforcement 生产化（仍属 TRST-4F deferred）。
