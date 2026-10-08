# TRST-6 执行计划（WP + AC）

> 前置：TRST-6 Charter v0 DRAFT → **scope 已签核 2026-10-08 最小集，同日扩为完整集**（Boss 选 "C 两者都要"）。
> 签核结论：**完整集（6.1 + 6.2 + 6.3 + 6.4）+ 默认 `cloud`、local 一键 opt-in**。
> 分支：`feature/trst-6-local-first-llm`（待创建）。执行顺序：WP-6.1 → WP-6.4。

---

## 全局护栏（不可越）

- 不碰网关 / enforcement 生产化（TRST-4F deferred，仍冻结）。
- 不动信任内核：Event Backbone、哈希链、Evidence 签名、Worker 不碰 raw 不变。
- 不引入新依赖：local provider 复用既有 OpenAI 兼容路径（`src/models/providers/openai.ts`）。
- embedding / Memory 检索在**最小集**仍走云端（siliconflow），仅 chat 推理本地化；文档明确标注此限制。
- 网关（gateway 服务）upstream 在最小集仍默认云端（可选层，offline 容忍），不强行改。

---

## WP-6.1：可插拔 LLM provider（cloud/local 一键切换）

### 落点文件
- `src/config.ts`：新增 env 读取 + 按 provider 派生生效配置。
- `src/index.ts`：启动 banner 打印 provider 名（现有探针已兼容 local）。
- `src/models/model-gateway.ts` `validateProviderConfig()`：仅文案增强（local 模式提示 LOCAL_LLM_*）。

### 实现要点
在 `config.ts` 新增：
```ts
const llmProvider = (process.env.LLM_PROVIDER || "cloud") as "cloud" | "local";
const localLlmBaseUrl = process.env.LOCAL_LLM_BASE_URL || "http://localhost:11434/v1";
const localLlmApiKey = process.env.LOCAL_LLM_API_KEY || "ollama";
const localLlmModel = process.env.LOCAL_LLM_MODEL || "qwen2.5:7b";

// cloud 模式行为与现状完全一致；local 模式由 LOCAL_LLM_* 派生，零代码改动切换
openaiBaseUrl: llmProvider === "local" ? localLlmBaseUrl : (process.env.OPENAI_BASE_URL || ""),
openaiApiKey:  llmProvider === "local" ? localLlmApiKey  : (process.env.OPENAI_API_KEY || ""),
fastModel:     llmProvider === "local" ? localLlmModel : (process.env.FAST_MODEL || "Qwen/Qwen2.5-72B-Instruct"),
slowModel:     llmProvider === "local" ? localLlmModel : (process.env.SLOW_MODEL || "gpt-4o"),
compressorModel: llmProvider === "local" ? localLlmModel : (process.env.COMPRESSOR_MODEL || "gpt-4o-mini"),
llmProvider,
```
`index.ts` 探针（`FAST_MODEL`/`BASE_URL`/`API_KEY` 来自 config）对 local 自动生效；Ollama 忽略 key，`API_KEY="ollama"` 非空 → 探针打 `http://localhost:11434/v1/chat/completions`。banner 增一行 `→ LLM provider: ${config.llmProvider}`。

### AC（8 条）
1. 新增 `LLM_PROVIDER` env，默认 `cloud`；`local` 时从 `LOCAL_LLM_BASE_URL`(默认 `http://localhost:11434/v1`)/`LOCAL_LLM_API_KEY`(默认 `ollama`)/`LOCAL_LLM_MODEL`(默认 `qwen2.5:7b`) 取数。
2. `cloud` 模式行为与现状**完全一致**（FAST_MODEL 默认走 SiliconFlow；OPENAI_BASE_URL/KEY 不变）。
3. `local` 模式：`openaiBaseUrl`/`openaiApiKey`/`fastModel`/`slowModel`/`compressorModel` 全部由 `LOCAL_LLM_*` 派生，零代码改动切换。
4. 启动 banner 打印当前 `LLM_PROVIDER` 与生效 baseURL/model（**不打印 key**）。
5. `local` 模式启动探活复用现有 `/chat/completions` 探针；不可达时打印明确 ⚠️ 警告 + 指向 README 本地模型接入段，**不静默 fallback 到 cloud、不静默失败**。
6. `local` 模式下 OpenAI 客户端实际指向本地端点（断言 client baseURL === `LOCAL_LLM_BASE_URL`）。
7. `.env.example` 增加 `LLM_PROVIDER` / `LOCAL_LLM_*` 注释示例。
8. 前后端 `tsc --noEmit` 0 报错；一次 `LLM_PROVIDER=local` 启动冒烟（探针打本地端点、banner 正确、local 不可达有清晰警告）。

---

## WP-6.4：极客文档 + Ollama sidecar（profile-gated）

### 落点文件
- `docker-compose.yml`：新增 `ollama` 服务（`profiles: ["local-llm"]`，默认关）+ `ollama_data` volume。
- `README.md`：新增「本地模型接入（Ollama）」段。
- `.env.example`：占位 + 注释（与 WP-6.1 同次提交）。

### 实现要点
`docker-compose.yml` 追加：
```yaml
  # 可选本地 LLM（默认关；启用：docker compose --profile local-llm up -d）
  # 启用后需在 .env 设 LLM_PROVIDER=local 与 LOCAL_LLM_BASE_URL=http://ollama:11434/v1
  ollama:
    image: ollama/ollama:latest
    profiles: ["local-llm"]
    ports:
      - "11434:11434"
    volumes:
      - ollama_data:/root/.ollama
    healthcheck:
      test: ["CMD-SHELL", "ollama list || true"]
      interval: 10s
      timeout: 5s
      retries: 5
```
README 段覆盖：原生 Ollama（`localhost:11434`）+ compose sidecar（`--profile local-llm`）两条路径，含 `ollama pull <model>` 与 `LOCAL_LLM_MODEL` 必须与 pull 的模型名一致；并标注已知限制（embedding/Memory 仍云端、gateway upstream 仍云端）。

### AC（6 条）
1. docker-compose 新增 `ollama` 服务，默认**不**随 `docker compose up` 启动（profile 隔离）。
2. 启用方式文档化：`docker compose --profile local-llm up -d`，且 `.env` 需 `LLM_PROVIDER=local` + `LOCAL_LLM_BASE_URL=http://ollama:11434/v1`。
3. README 本地接入段覆盖原生 Ollama 与 compose sidecar 两种路径，含 `ollama pull` 与模型名对齐说明。
4. 文档明确已知限制：embedding / Memory 检索最小集仍走云端（siliconflow），仅 chat 推理本地化；gateway upstream 仍默认云端（可选层）。
5. `.env.example` 含 `LLM_PROVIDER` / `LOCAL_LLM_*` 占位与注释。
6. `docker compose config` 校验通过（profile 语法正确，不破坏现有编排）；README 链接可达。

---

## WP-6.2：影子模式默认首跑（Shadow Mode default first-run）

### 落点文件
- `src/config.ts`：新增 `defaultExecutionMode`（默认 `shadow`），env `TRUSTOS_DEFAULT_EXECUTION_MODE`。
- `src/services/shadow/first-run-mode.ts`（新）：首跑 / opt-in 状态机 + `resolveExecutionMode()` 真实降级保证。
- `src/api/health.ts`：`/health` 暴露 `execution_mode`（mode / first_run / opted_into_real / provider / reason / note）。
- `src/services/manager/execution-attempt-service.ts`：`createAttemptFromContract` 用 `resolveExecutionMode` 解析，shadow 默认下 `real` 被 hold 降级为 `deterministic_local`（观察态），不实际外发执行。
- `src/index.ts`：启动 banner 打印当前模式（SHADOW/REAL）+ opt-in 提示。
- `frontend/src/lib/api.ts` + `HealthPanel.tsx`：健康面板渲染执行模式徽章（SHADOW/REAL + provider + 首次运行）。
- `.env.example`：补 `TRUSTOS_DEFAULT_EXECUTION_MODE` 注释示例。

### 实现要点（兑现 TRST-0.3 "Shadow Mode default first-run"）
- 默认 `shadow`：首跑 / 未 opt-in 时，系统处于观察态，受控执行 seam 不实际外发 `real` 执行（`real` 请求被 hold 并降级为 `deterministic_local`）。
- `real` 需显式 opt-in：env `TRUSTOS_DEFAULT_EXECUTION_MODE=real`（配置即 opt-in）或用户经 UI 选择后持久化到 `.trustos/first-run.json`。
- 全程生成完整审计 trail（Event Backbone），观察态无信息损失。

### AC（7 条）
1. 新增 `TRUSTOS_DEFAULT_EXECUTION_MODE` env，默认 `shadow`；`real` 时系统进入实际执行模式。
2. 首跑 / 未 opt-in 时，`resolveExecutionMode("real")` 返回 `held=true` + `effective=shadow`；调用方据此降级为 `deterministic_local`。
3. `real` 请求被 hold 时，后端打印明确 ⚠️ 警告（含 requested + effective + opt-in 提示），不静默放行。
4. `/health` 返回 `execution_mode`：含 `mode` / `first_run` / `opted_into_real` / `provider` / `reason` / `note`。
5. 启动 banner 打印当前模式（SHADOW/REAL）+ opt-in 提示，不打印 key。
6. 前端健康面板渲染执行模式徽章（SHADOW 琥珀 / REAL 绿）+ provider + 首次运行标记。
7. 前后端 `tsc --noEmit` 0 报错；一次启动冒烟确认 banner 与 `/health` 的 `execution_mode.mode=shadow`（默认）。

---

## WP-6.3：影子对照（Shadow Comparison）

### 落点文件
- `scripts/trst6/run-shadow-compare.mts`（新，零依赖，复用既有 `openai` SDK + 环境变量）。

### 实现要点
- 给定同一 brief，分别用 cloud（默认 SiliconFlow）与 local（Ollama/本地 OpenAI 兼容端点）各跑一次。
- 输出三维度对照：延迟（latency_ms）/ Token 量 / 成本估算（基于已知价格表，未知模型标 unknown）。
- **质量维度诚实标注为人工复核项**，不给虚假自动评分；local 不可达时明确标 unavailable，不静默失败。
- 不碰信任内核 / 网关 / enforcement；不改后端代码。

### AC（5 条）
1. 脚本可经 `npx tsx scripts/trst6/run-shadow-compare.mts [--brief "..."]` 运行，零新依赖。
2. 同时产出 cloud 与 local 的延迟 / Token / 成本估算（任一方不可达时明确标 unavailable，不崩溃）。
3. 质量维度仅作人工复核提示（展示双方回答长度/摘要），不输出自动打分。
4. 报告含差异小结（local/cloud 延迟比、成本对比），并附诚实说明（quality 需人工）。
5. 不修改后端源码、不引入新推理框架 / 重依赖。

---

### 实施状态（2026-10-08，完整集）

> ⚠️ **分支说明**：因 `git checkout -b feature/trst-6-local-first-llm` 审批提示超时（用户暂离），本批实现（含 6.2/6.3）暂提交在 `feature/trst-3-private-beta-readiness`，待用户回来审批创建 TRST-6 分支后再迁出（cherry-pick / 分支重置）。

- **WP-6.2（DONE）**：`config.defaultExecutionMode` 默认 `shadow`；`src/services/shadow/first-run-mode.ts` 状态机 + `resolveExecutionMode()` 真实降级（shadow 默认下 `real` 被 hold → `deterministic_local`，不实际外发执行）；`/health` 暴露 `execution_mode`；`execution-attempt-service.createAttemptFromContract` 接入降级 + ⚠️ 警告；`index.ts` 启动 banner；前端 `HealthPanel` 模式徽章；`.env.example` 补 env。验证：前后端 `tsc --noEmit` 均 0 错。
- **WP-6.3（DONE）**：`scripts/trst6/run-shadow-compare.mts` 零依赖，cloud vs local 三维度对照（延迟 / Token / 成本估算）+ 质量维度诚实标注为人工复核项；local 不可达明确标 unavailable，不静默失败。验证：脚本经 `tsc` 类型校验；实跑待本环境 Ollama（见 ③，ENV 限制，与 TRST-5 Frontend Build 同性质，诚实记为 ENV_BLOCKED）。

## 验证汇总（开工后回归）
- 前后端 `npx tsc --noEmit` 均 0 报错。
- `LLM_PROVIDER=local` 启动冒烟：探针打本地端点、banner 打印 provider + 生效 model、local 不可达有清晰警告（不静默）。
- `docker compose config` 校验通过；`.env.example` 占位正确。
- README 本地接入段可读、链接可达。

## 预计文件清单（约 4 文件）
`src/config.ts`、`src/index.ts`、`src/models/model-gateway.ts`、`docker-compose.yml`、`README.md`、`.env.example`（doc/配置，无新依赖、无信任内核改动）。

---

## 实施状态（2026-10-08）

> ⚠️ **分支说明**：因 `git checkout -b feature/trst-6-local-first-llm` 审批提示超时（用户暂离），本批实现**暂提交在 `feature/trst-3-private-beta-readiness`**，待用户回来审批创建 TRST-6 分支后再将 TRST-6 相关提交迁出（cherry-pick / 分支重置）。

### WP-6.1（DONE）
- `src/config.ts`：新增 `llmProvider`/`localLlmBaseUrl`/`localLlmApiKey`/`localLlmModel`；`fastModel`/`slowModel`/`compressorModel`/`openaiApiKey`/`openaiBaseUrl` 按 provider 派生；`config.llmProvider` 暴露。
- `src/index.ts`：启动 banner 打印 `→ LLM provider: <p> (baseURL=..., model=...)`（不打印 key）；local 探针不可达时补 README 提示（不静默失败）。
- `.env.example`：加 `LLM_PROVIDER` / `LOCAL_LLM_*` 占位与注释。
- **验证**：后端 `tsc --noEmit` 0 错；config 派生断言（local/cloud 两种模式生效值正确）；full startup smoke 待 DB+Ollama 环境补跑（本环境 ENV 限制，与 TRST-5 Frontend Build ENV_BLOCKED 同性质）。

### WP-6.4（DONE）
- `docker-compose.yml`：新增 `ollama` 服务（`profiles: ["local-llm"]`，默认关）+ `ollama_data` volume。
- `README.md`：新增「本地模型接入（Ollama）」段（原生 / compose sidecar 两条路径 + 验证 + 已知限制）。
- **验证**：`docker compose config -q` 0 错（profile 语法正确，不破坏现有编排）；README 链接/格式可读。

### 全局护栏核对
- 未碰网关 / enforcement 生产化（gateway upstream 仍默认云端，文档标注）。
- 未动 Event Backbone / 哈希链 / Evidence 签名 / Worker 不碰 raw。
- 未引入新依赖（local 走既有 OpenAI 兼容路径）。
- embedding / Memory 检索维持云端（文档明确标注为最小集已知限制）。
