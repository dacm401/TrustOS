# TrustOS 极客一键部署（Quickstart）

> 面向**愿意自己跑容器的极客**。5 分钟从零到可登录的本地 AI 工作台。
> 数据全部留在你本机（本地优先 + 可验证审计 / 证据链），不依赖任何云端账户。

---

## 它是什么

TrustOS = 跑在你本机的 **AI 工作操作系统**。每次对话、记忆、证据链都存在本地，不外发。
真正的差异化在底层，不在 UI 壳：

- **外发内容强制加工**：发给 Worker / 第三方模型的内容先过护栏，敏感字段不裸奔
- **Worker 不碰原始数据**：Worker 只收 brief + 可选的 artifact 摘要，raw history / memory 不落地到执行端
- **事件哈希链可验证**：model_call / tool_call 事件哈希成链，可检测篡改与删除
- **记忆是粘性核心**：跨会话记住你的偏好与决策（路线图里的真实化专项进行中）

---

## 前置条件

- Docker + Docker Compose v2
- 一个 LLM API key（默认走 [SiliconFlow](https://siliconflow.cn)，OpenAI 兼容；换 `OPENAI_BASE_URL` 即可接别的网关）

---

## 三步跑起来

```bash
git clone <repo> && cd trustos
cp .env.example .env
# 编辑 .env：至少填 OPENAI_API_KEY 与 TRUSTOS_UPSTREAM_API_KEY，并改掉 AUTH_USERS 与 JWT_SECRET
docker compose up -d --build
# 等 ~30s 服务就绪（postgres/redis/minio 健康检查通过）
# 浏览器打开 http://localhost:3000
# 用你在 AUTH_USERS 里设的 用户名:密码 登录
```

---

## 必改的 `.env` 项

| 项 | 默认值 | 说明 |
|---|---|---|
| `OPENAI_API_KEY` | `<your-key>` | 后端 LLM key |
| `TRUSTOS_UPSTREAM_API_KEY` | `<your-key>` | Gateway 用的同一份 key（两处都要填） |
| `AUTH_USERS` | `admin:changeme` | **务必改成 `用户名:强密码`** |
| `JWT_SECRET` | `<your-strong-secret-min-32-chars>` | ≥32 字符随机串，否则启动告警 |
| `FAST_MODEL` / `SLOW_MODEL` / `COMPRESSOR_MODEL` | `deepseek-ai/DeepSeek-V4-Flash` | 默认 SiliconFlow；换模型记得同步 `OPENAI_BASE_URL` |

> 启动后若仍用默认 `admin:changeme`，后端会打印 `[AUTH-SEC]` 告警提醒你改密码。
> 暴露到公网前**必须**改密码 + 设强 `JWT_SECRET`。

---

## 服务与端口

| 端口 | 服务 | 说明 |
|---|---|---|
| `3000` | frontend | 你访问的 UI |
| `3001` | backend | API（`/v1/*`、`/api/*`） |
| `8787` | gateway | 观测层（**可选**；缺了 UI 显示 “Gateway: Offline”，不影响主功能） |
| `5432` | postgres | 主库（pgvector） |
| `6379` | redis | 缓存 |
| `9000` / `9001` | minio | 归档对象存储 / 控制台 |
| `9090` | prometheus | 指标 |

---

## 改完代码怎么生效

- **后端**：`docker compose up -d --build backend`
- **前端**（Next 生产构建）：`docker compose up -d --build frontend`
- **只想本地热改前端**：`cd frontend && npm run dev`（独立 dev server，不依赖容器）

---

## 常用运维

```bash
docker compose logs -f backend        # 看后端日志
curl localhost:3001/health           # 健康检查
curl localhost:3001/readiness        # 就绪检查（含 DB/Redis 连通）
# 指标：浏览器打开 http://localhost:9090  (Prometheus)
```

事件证据链落在 Docker volume `trustos_events`，**容器重启不丢**。

---

## 已知注意 / 局限

- 默认 `admin:changeme` 仅用于本地试用；公网暴露前必须改。
- 当前为 **Private Beta** 阶段：单用户、本地 OS 定位，多租户已剔除。
- Memory 正在从 fixture 占位走向真实可用（路线图 RFC-001 待签核），跨会话记忆的真实积累仍在收尾。

详见 `README.md`（产品愿景）与 `docs/strategy/CURRENT-STATUS.md`（工程状态）。
