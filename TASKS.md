# TrustOS 任务规划（2026-05-08）

## 目录结构重构

### 1. types/index.ts 拆分
**目标**：2141 行 → 6 个按领域拆分的子文件

**拆分方案**：
| 新文件 | 内容 | 行数估算 |
|--------|------|----------|
| `delegation.ts` | ManagerDecision、DirectResponse、CommandPayload、WorkerResult、SSE事件 | ~450 |
| `memory.ts` | MemoryEntry、MemoryRetrieval、Evidence | ~200 |
| `execution.ts` | ExecutionPlan、ToolDefinition、Step | ~200 |
| `gating.ts` | GatingConfig、DecisionFeatures、KnowledgeBoundary | ~200 |
| `task.ts` | Task、TaskArchive、TaskStatus | ~200 |
| `redaction.ts` | 脱敏/权限/数据分类相关 | ~300 |
| `index.ts` | 统一 re-export，保留向后兼容 | ~100 |

**验收**：tsc 零错误，所有 import 链不破，321/321 repo 测试全绿

---

### 2. 目录重命名 src/ → backend/
**目标**：标准 monorepo 布局

**步骤**：
1. `git mv src backend`（保留 history）
2. 修改 `Dockerfile`：`COPY src/` → `COPY backend/`
3. 修改 `docker-compose.yml` 和 `docker-compose.dev.yml`：对应路径
4. 修改 `package.json` scripts（如果引用了 `src/` 路径）
5. Desktop 侧 `npm run dev` 验证 tsc 零报错
6. Docker build 验证

**风险点**：Docker 路径遗漏会导致 build 失败，先测 Desktop 再动 Docker

---

### 3. Frontend 目录清理
**目标**：清理根目录临时文件

需删除的临时文件（约 25 个）：
```
run_decision_test.cjs
run_test_temp.cjs
run_test_temp.js
test_out2.txt
vitest_out2.txt
v_all.txt
v_d.txt
v_de.txt
v_del.txt
v_del2.txt
check-db.cjs
check-new.cjs
diagnose.cjs
quick-check.cjs
run-e2e.cjs
show-delegation.cjs
show-logs.cjs
show-tables.cjs
test-e2e.cjs
test-raw.cjs
trigger.cjs
tsc-status.txt
vitest_out2.txt
vitest_out3.txt
backfill-*.ts / backfill-*.py
benchmark-*.cjs
check-schema.ts
grayzone-comparison.ts
rerank-analysis.js
startup-check.ts
```

保留的脚本（有实际用途）：
- `scripts/rerank-analysis.js`（阈值分析）
- `scripts/startup-check.ts`（启动检查）

---

## 功能改进

### 4. Prompt 版本热切换
**目标**：`.env` 加 `PROMPT_VERSION`，后端动态加载对应版本

**改动点**：
- `.env`：加 `PROMPT_VERSION=v4`
- `.env.example`：同步更新
- `src/prompts/manager/index.ts`：动态导出，fallback 到 v4

**验收**：改 `.env` 后重启服务，SSE 输出验证版本变化

---

### 5. DB 连接池配置项
**目标**：三个 `.env` 配置项，代码读环境变量控制连接池

**改动点**：
- `.env`：加 `DB_POOL_MAX=10`、`DB_POOL_IDLE_TIMEOUT=30000`、`DB_CONN_TIMEOUT=5000`
- `.env.example`：同步
- `src/db/index.ts` 或 `src/config/index.ts`：读取并传给 pg Pool

**验收**：服务正常启动，`npm run dev` 无 DB 报错

---

### 6. 阈值实验框架
**目标**：rerank-analysis.js formalize，支持 baseline 对比

**方案**：不建新 DB 表，用 CSV 文件落地结果
```
scripts/
├── rerank-analysis.js      # 扩展：JSON 输出 + --experiment-id
├── baseline.js             # 新建：快照当前指标到 CSV
└── compare.js             # 新建：对比两个 experiment
```

**后续**（不在本次任务里）：
- Migration 021 建 `experiment_baselines` 表
- `src/config/experiment-config.ts`：ThresholdExperiment 类型

---

## 执行顺序

1. ✅ **临时文件清理**（无风险，先清）
2. **Prompt 版本热切换**（轻量，先跑通）
3. **DB 连接池配置项**（轻量，不依赖 2）
4. **types 拆分**（tsc 验证为主）
5. **目录重命名**（风险最高，放最后）
6. **阈值实验框架**（收尾）

---

## 验收标准

- [ ] types 拆分后 tsc 零错误
- [ ] 321/321 repo 测试全绿
- [ ] `npm run dev` 在 Desktop 正常启动
- [ ] Docker build 成功
- [ ] 根目录临时文件清空
