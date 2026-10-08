# TRST-6 执行计划（WP + AC）

> 前置：TRST-6 Charter v0 DRAFT → **scope 已签核 2026-10-08**（Boss 选 A/A）。
> 签核结论：**最小集（6.1 + 6.4）+ 默认 `cloud`、local 一键 opt-in**。
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

## 验证汇总（开工后回归）
- 前后端 `npx tsc --noEmit` 均 0 报错。
- `LLM_PROVIDER=local` 启动冒烟：探针打本地端点、banner 打印 provider + 生效 model、local 不可达有清晰警告（不静默）。
- `docker compose config` 校验通过；`.env.example` 占位正确。
- README 本地接入段可读、链接可达。

## 预计文件清单（约 4 文件）
`src/config.ts`、`src/index.ts`、`src/models/model-gateway.ts`、`docker-compose.yml`、`README.md`、`.env.example`（doc/配置，无新依赖、无信任内核改动）。
