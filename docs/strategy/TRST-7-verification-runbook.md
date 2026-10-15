# TRST-7 真机验证 Runbook（Docker + Ollama / Cloud）

> 目的：本环境 `ENV_BLOCKED`（无 Postgres/Ollama），TRST-7 的「真 LLM 决策抽取 + 完整启动冒烟」需在有运行时真机执行。
> 本 Runbook 由 Boss 在真机执行，结果回填文末回报表，反馈给 agent-PM 以修抽取质量 / 推进 S2–S5。
> 关联：`TRST-7-continuity-charter.md`、`CURRENT-STATUS.md §3.20`。

## 0. 前置

- 一台可运行 `docker compose` 的机器（Docker Desktop 或引擎），能联网拉镜像/模型，或本机已装 Ollama。
- 代码已切到分支 `feature/trst-7-continuity`（含 `89cdd52` 提交）。
- `cp .env.example .env`（按 `.env.example` 注释填写；默认模型 `deepseek-ai/DeepSeek-V4-Flash`）。

## 1. 起全栈（含可选本地 LLM）

**方案 A — 本地 Ollama（数据不出本机，推荐验证「本地优先」价值）**
```bash
cd trustos
# 编辑 .env：LLM_PROVIDER=local，LOCAL_LLM_BASE_URL=http://localhost:11434/v1（本机原生 Ollama）
docker compose --profile local-llm up -d          # 起 postgres / ollama / backend / frontend / gateway
docker compose exec ollama ollama pull qwen2.5:7b  # 或 deepseek-r1:8b 等；拉取需要点时间
```

**方案 B — Cloud（SiliconFlow deepseek，最省事）**
```bash
cd trustos
# 编辑 .env：保留默认 cloud 配置（LLM_PROVIDER=cloud + SILICONFLOW_API_KEY=...）
docker compose up -d                              # 不起 ollama
```

## 2. 确认服务起来

```bash
curl http://localhost:8787/health      # 网关健康（含 execution_mode）
curl http://localhost:3000             # 前端可访问（admin / changeme 登录）
curl http://localhost:5432            # postgres 起（或直接看 docker compose ps）
```

## 3. 模型名映射（重要，先读）

前端 `ContinuityWorkspace` 的「大脑」下拉目前把 **展示名** `hermes / claude / gpt / local` 当作 `model` 字符串发给网关。
真机必须让网关 `modelRegistry` 能 `resolveProvider(该名字)`，否则抽取会 400。

**临时做法（最省事）**：把 `frontend/src/components/continuity/ContinuityWorkspace.tsx` 的 `MODELS` 数组里每项的 `value` 改成你真机上配置的**真实模型 id**（如 `deepseek-ai/DeepSeek-V4-Flash` 或 `qwen2.5:7b`），再 `docker compose up -d frontend` 重建前端。
（后续我会把展示名→真实模型 id 做成配置，不硬编码。）

## 4. 直接验证网关抽取端点（不依赖前端）

```bash
curl -s -X POST http://localhost:8787/trst1/extract-decisions \
  -H "Content-Type: application/json" \
  -d '{"model":"<真实模型id>","messages":[
        {"role":"user","content":"我们决定用本地模型，冻结对云端的依赖"},
        {"role":"assistant","content":"好，Hermes 作为 worker 进主干，借脑不借壳"}
      ]}' | head -c 800
# 期望：{"status":"ok","extracted":N,"decisions":[ {keyword, prompt, reply, parent_keyword, links, seq} ... ]}

curl -s http://localhost:8787/trst1/decisions | head -c 800
# 期望：{"status":"ok","count":N,"nodes":[ ... ]}  —— 上一步落库的 decision 事件
```

## 5. 前端「连续」视图端到端

1. 打开 `http://localhost:3000` → 登录 → 左侧导航点 **🌊 连续**。
2. 选「新建会话」或选中一个节点 → 右侧聊天边发几条带「决策/分支」语义的消息。
3. 观察左侧决策图是否**自动长出新节点**（抽取+落库+读回）。
4. 切「大脑」下拉（Hermes↔Claude 等）→ 确认图与连续性**不变**（反锁定演示）。

## 6. 预期结果

- `/health` healthy；前端可登录；全栈无崩溃日志。
- `extract-decisions` 返回 ≥1 节点；`/trst1/decisions` 能看到落库的 `decision` 事件（哈希链完整）。
- 前端连续视图图随聊天长出节点；切脑不改变图。

## 7. 回报表（填完反馈给 agent-PM）

| 项 | 结果 |
|---|---|
| 环境 | Docker+Ollama / Cloud |
| `/health` 输出 | … |
| 方案 | A 本地 / B 云 |
| 模型 id（实际用的） | … |
| `extract-decisions` 返回节点数 | … |
| `/trst1/decisions` count | … |
| 前端图是否随聊天更新 | 是 / 否 |
| 切脑后图是否不变 | 是 / 否 |
| 抽取质量观察（节点是否准确/有用，举例） | … |
| 问题 / 报错（贴关键日志） | … |

## 8. 已知限制 / 诚实边界

- 本环境未实跑，以上步骤未经验证，待 Boss 真机执行。
- 抽取质量依赖 LLM；首跑若节点不准，调 `src/services/trst1/decision-extractor.ts` 的 `SYSTEM_PROMPT`（已是 v0 启发式兜底）。
- 「增量抽取 / 跨 session 真续接 / 河流动态视觉」尚未做（charter S3–S5），本验证只覆盖 S1 代码 + S2 真机冒烟。
- `package.json` 中 RFC-002 的 `verify:fidelity` 仍悬空引用（脚本文件缺失），与 TRST-7 无关，留待另处理。
