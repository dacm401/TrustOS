# SmartRouter Pro — Benchmark CI

离线路由质量评估套件，全部不调用外部 API，基于规则引擎模拟 LLM 路由决策。

## Suite 总览

| Suite | 用例 | CI Gate | 用途 |
|-------|------|---------|------|
| `routing` | 66 cases | Mode ≥80%, Intent ≥70% | 规则路由器 CI gate |
| `kb` | 23 cases | 准确率 ≥80% | KB Signal 检测评估 |
| `delegation` | 40 cases | Mode ≥30%, Intent ≥20% | Gated Delegation 离线参考基准（宽松阈值） |

> ⚠️ `delegation` 套件设计用于在线 LLM 路由评估，离线规则模式下 Mode/Intent 阈值仅供参考。真实 LLM 路由评估请使用 `scripts/benchmark-routing.cjs`（需后端 + SiliconFlow）。

## 本地运行

```bash
# routing suite（默认）
node scripts/benchmark-ci.cjs

# 指定 suite
node scripts/benchmark-ci.cjs --suite routing
node scripts/benchmark-ci.cjs --suite kb
node scripts/benchmark-ci.cjs --suite delegation

# 详细输出
node scripts/benchmark-ci.cjs --suite routing --verbose
```

## CI Pipeline

GitHub Actions workflow：`.github/workflows/ci.yml`

5 个独立 Job，全部并行执行：

```
ci.yml
├── typecheck              — tsc --noEmit
├── unit-tests             — vitest（无 DB/外部依赖）
├── benchmark-routing      — routing suite
├── benchmark-kb          — kb suite
└── benchmark-delegation  — delegation suite
```

artifact 上传（`if: always()`，即使 job 失败也会保留）：

| Job | Artifact 名称 | 路径 |
|-----|-------------|------|
| `benchmark-routing` | `benchmark-routing-{run_number}` | `evaluation/results/benchmark-ci-*.json` |
| `benchmark-kb` | `benchmark-kb-{run_number}` | `evaluation/results/benchmark-kb-*.json` |
| `benchmark-delegation` | `benchmark-delegation-{run_number}` | `evaluation/results/benchmark-delegation-*.json` |

## G4 回填流程（routing_success）

### 背景

`delegation_logs.routing_success` 字段用于记录 Manager 决策是否正确（对应 benchmark 中的 expected_mode），需通过离线 benchmark 结果回填。

### 步骤

```bash
# 1. 生成 routing pairs（导出 input/expected_action/scenario）
node scripts/benchmark-ci.cjs --backfill

# 2. 安装 Python 依赖
pip install psycopg2-binary

# 3. 预览（dry-run）
python scripts/backfill_routing_success.py \
  --file evaluation/results/routing-pairs-$(date +%Y-%m-%d).json --dry-run

# 4. 正式回填（PG 需先运行 Migration 013）
python scripts/backfill_routing_success.py \
  --file evaluation/results/routing-pairs-$(date +%Y-%m-%d).json
```

> **前置条件**：PG 实例必须已应用 `src/db/migrations/013_delegation_logs_success_fields.sql`

### 回填逻辑

脚本读取 `routing_pairs-{date}.json`，对每条记录：
1. 按 `input` 字段模糊匹配 `delegation_logs.prompt`
2. 按 `expected_action`（`delegate_to_slow` / `direct_answer`）过滤
3. 按 `scenario` 匹配（`scenario` 非空时）
4. 回填 `routing_success = matched`（布尔值）

## 用例文件

```
evaluation/tasks/
├── routing-benchmark.json        # routing suite（66 cases）
├── unknown-by-definition.json    # kb suite（23 cases）
└── delegation-benchmark.json     # delegation suite（40 cases）
```

每条用例结构：
```json
{
  "input": "用户 query",
  "expected_mode": "fast | slow",
  "expected_layer": "L0 | L1 | L2",
  "expected_intent": "simple_qa | reasoning | code | ...",
  "scenario": "G1 | G2 | G3 | G4 | KB | ...",   // delegation 套件
  "reason": "判断理由"                            // kb 套件
}
```

## 踩坑记录

- `delegation` 离线规则 Mode 准确率约 32%——这是正常的，因为离线规则无法覆盖 Gated Delegation 的置信度校准逻辑。真实路由质量以在线 benchmark 为准。
- `benchmark-ci.cjs` 为纯离线工具，不依赖后端服务，可直接在 CI 中运行。
