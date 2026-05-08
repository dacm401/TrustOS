# TrustOS 新窗口启动 Prompt

> 这是给新 WorkBuddy 窗口的启动说明，读完之后再开始干活。

---

## 必读文件（按顺序）

1. **先读 `HANDOVER.md`**（本文件）—— 整体状态
2. **`docs/dev-rules.md`** —— 开发规范，干活前必看
3. **`docs/ARCHITECTURE-OVERVIEW.md`** —— 系统架构全景
4. **`docs/GATED-DELEGATION-v2.md`** —— 核心门控逻辑
5. **`MEMORY.md`**（`~/.workbuddy/` 下）—— 长期记忆

---

## 一句话状态

**Phase 1~5 全部完成 ✅，types 拆分完成 ✅，GitHub 三端同步 ✅。**
**剩余大任务：阈值实验框架（唯一有实际价值的待办）。目录重命名已放弃（风险高、收益低）。**

---

## 仓库现状

| 位置 | commit | 说明 |
|------|--------|------|
| `WorkBuddy/trustos` | `a97cece` | 当前工作目录 |
| `Desktop/.../TrustOS` | `a97cece` | 与 origin 同步 |
| `origin/master` | `a97cece` | 最新基准 |

**改代码在**：`C:\Users\ligua\WorkBuddy\trustos`
**测试验证在**：`C:\Users\ligua\Desktop\AI项目\trustos\TrustOS`（跑 `npm run dev`）

---

## 最近完成的功能

| 日期 | 功能 | commit |
|------|------|--------|
| 2026-05-08 | types 拆分（2141行→6文件） | `c599c65` |
| 2026-05-08 | Prompt 版本热切换（`.env` `PROMPT_VERSION`） | `a15e39c` |
| 2026-05-08 | DB 连接池配置项 | `1100f48` |
| 2026-05-08 | 根目录临时文件清理 | `2cf1d99` |
| 2026-05-08 | HANDOVER.md | `a97cece` |
| 2026-05-07 | repositories.ts 拆分（2079行→7文件） | `0947a5f` |
| 2026-05-06 | Phase 5.4 B 灰区短路（triggerRate 92%→66%） | `2399ffc` |

---

## 架构速查

- **后端**：Hono + TypeScript，`src/index.ts`（端口 3001）
- **LLM**：SiliconFlow（`api.siliconflow.cn`），Prompt v4
- **DB**：PostgreSQL（Docker `trustos-postgres-1`），`smartrouter` 库
- **门控**：G1~G4 四层，G2=0.65 / G3=0.60 / high_cost_floor=0.70
- **委托**：Manager 双重输出（自然语言 + JSON），`splitManagerOutput()` 解析
- **SSE**：仅 `worker_started → chunk → done`
- **types**：`src/types/task.ts` / `delegation.ts` / `memory.ts` / `execution.ts` / `gating.ts` / `redaction.ts` + 纯 re-export 的 `index.ts`

---

## 待办任务（按优先级）

### 唯一有价值的任务：阈值实验框架

**目标**：`scripts/rerank-analysis.js` formalize，支持 baseline 对比。

方案（CSV 方案，不建新 DB 表）：
```
scripts/
├── rerank-analysis.js   # 扩展：--experiment-id
├── baseline.js          # 新建：快照当前指标到 CSV
└── compare.js           # 新建：对比两个 experiment
```

### 已放弃的任务

- ❌ 目录重命名 `src/` → `backend/`（风险高、收益低，不值得做）

---

## 启动命令

```bash
# Desktop 机器，跑测试
cd C:\Users\ligua\Desktop\AI项目\trustos\TrustOS
npm run dev

# Docker（需要先 restart）
docker restart trustos-postgres-1 trustos-frontend-1 trustos-backend-1
```

---

## 重要注意事项

1. **GFW 网络**：GitHub push 有时会超时，多试几次
2. **双机协作**：改代码在 WorkBuddy，测试在 Desktop，GitHub 是同步基准
3. **vitest 测试**：用 `vitest.repo.config.ts`，不要用默认配置（会 deadlock）
4. **git commit 前**：确认 `git status` 干净，先 tsc 再 push
5. **临时文件**：根目录定期清理，不留 `.cjs` / `.txt` 调试脚本

---

## 一句话状态

**Phase 1~5 全部完成 ✅，types 拆分完成 ✅，GitHub 三端同步 ✅。**
**剩余大任务：目录重命名（src/ → backend/）+ 阈值实验框架。**

---

## 仓库现状

| 位置 | commit | 说明 |
|------|--------|------|
| `WorkBuddy/trustos` | `c599c65` | 干净，ahead of origin 0 |
| `Desktop/.../TrustOS` | `c599c65` | 与 origin 同步 |
| `origin/master` | `c599c65` | 最新基准 |

**工作目录**：`C:\Users\ligua\WorkBuddy\trustos`（改代码），`C:\Users\ligua\Desktop\AI项目\trustos\TrustOS`（测试跑 `npm run dev`）

---

## 已完成的功能（近3天）

### types 拆分 ✅（今日）
- `src/types/index.ts`（2141行）→ 6个按领域拆分的子文件
- `task.ts` / `delegation.ts` / `memory.ts` / `execution.ts` / `gating.ts` / `redaction.ts`
- `index.ts` 变成纯 re-export（9行）
- tsc 零错误，321/321 测试全绿
- 特殊处理：`ExecutionResult` → `ExecutionResponse` 避免命名冲突；`ClarifyQuestion`/`TaskState` 用 `import type` 解决循环

### Prompt 版本热切换 ✅（今日）
- `.env` → `PROMPT_VERSION=v4`
- `src/prompts/manager/index.ts` 动态加载

### DB 连接池配置 ✅（今日）
- `.env` → `DB_POOL_MAX` / `DB_POOL_IDLE_TIMEOUT` / `DB_CONN_TIMEOUT`
- `src/config/db.ts` 读取并传给 pg Pool

### 根目录临时文件清理 ✅（今日）
- 删了 21 个 `.cjs` / `.txt` 临时脚本
- 保留：`scripts/rerank-analysis.js`（阈值分析）、`scripts/startup-check.ts`（启动检查）

### 委托逻辑（Phase 5.4 B 灰区短路）✅（昨日）
- `shouldRerank` grayZone 短路：conf∈[0.60, 0.70) + G2∈{delegate_to_slow, execute_task} → 不 rerank
- 回放结果：triggerRate 92.5% → 66.0%，无误伤

### repositories.ts 拆分 ✅（前日）
- `src/db/repositories/`（2079行 → 7个文件）
- 321/321 repo 测试全绿

---

## 待执行任务

### 🔴 最高优先级：目录重命名 `src/` → `backend/`

**TASKS.md #5，这是最大风险的一步。**

步骤：
1. `git mv src backend`（保留 history）
2. 修改 `Dockerfile`：`COPY src/` → `COPY backend/`
3. 修改 `docker-compose.yml` + `docker-compose.dev.yml`：对应路径
4. Desktop 上 `npm run dev` 验证 tsc 零报错
5. Docker build 验证

**先 Desktop 跑通，再动 Docker。**

### 🟡 中优先级：阈值实验框架

**TASKS.md #6。**

方案：用 CSV 文件落地结果（不建新 DB 表）。
```
scripts/
├── rerank-analysis.js   # 扩展：--experiment-id
├── baseline.js           # 新建：快照当前指标
└── compare.js           # 新建：对比两个 experiment
```

---

## 架构速查

- **后端**：Hono + TypeScript，`src/index.ts`（端口 3001）
- **LLM**：SiliconFlow（`api.siliconflow.cn`），Prompt v4
- **DB**：PostgreSQL（Docker `trustos-postgres-1`），`smartrouter` 库
- **门控**：G1~G4 四层，G2=0.65 / G3=0.60 / high_cost_floor=0.70
- **委托**：Manager 双重输出（自然语言 + JSON），`splitManagerOutput()` 解析
- **SSE**：仅 `worker_started → chunk → done`（thinking/worker_completed 已移除）

---

## 启动命令

```bash
# Desktop 机器
cd C:\Users\ligua\Desktop\AI项目\trustos\TrustOS
npm run dev

# Docker
cd C:\Users\ligua\Desktop\AI项目\trustos\TrustOS
docker compose up -d
```

---

## 注意事项

1. **GFW 网络**：GitHub push 有时会超时，多试几次即可
2. **双机协作**：改代码在 WorkBuddy，测试验证在 Desktop，GitHub 是同步基准
3. **临时文件清理**：定期检查根目录，防止 `.cjs` / `.txt` 堆积
4. **vitest**：测试用 `vitest.repo.config.ts`，不要用默认配置跑（会触发 deadlock）
