# scripts/ — 数据库运维脚本

> Sprint 55+ 积累的 backfill 和 benchmark 脚本集。所有脚本可直接用 `npx tsx` 运行。

## Backfill Scripts

| 脚本 | 用途 | 依赖 |
|------|------|------|
| `backfill-routing-layer.ts` | 回填 `routing_layer` 列（Sprint 68, Migration 017） | PG + delegation_logs 表 |
| `backfill-delegation-success.ts` | 回填 `routing_success` / `user_success`（Sprint 55, Migration 013） | PG + delegation_logs 表 |
| `backfill-embeddings.ts` | 补算历史 memory 条目的 embedding（首次开启 embedding 时用） | PG + memory_entries 表 |
| `backfill_routing_success.py` | Python 版 routing_success 回填（备选） | Python + psycopg2 |

## Benchmark Scripts

| 脚本 | 用途 |
|------|------|
| `benchmark-ci.cjs` | CI 端到端 benchmark 入口，支持 `--mode layer1\|layer2\|full`，输出 JSON 结果 |

## 运行示例

```bash
# routing_layer 回填（Migration 017）
npx tsx scripts/backfill-routing-layer.ts

# delegation success 回填（Migration 013）
npx tsx scripts/backfill-delegation-success.ts

# CI benchmark
npx tsx scripts/benchmark-ci.cjs --mode layer2
```
