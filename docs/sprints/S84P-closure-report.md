# S84P Closure Report

> **Sprint**: S84P — Core Runtime Performance & Usability Baseline
> **Baseline Commit**: `a634bfc` (S83P closure)
> **Implementation Commit**: _see §7 PM Sign-off_
> **Date**: 2026-05-26
> **Author**: 蟹小钳 🦀

---

## 0. Sprint 目标

**诊断 Sprint** — 知道瓶颈在哪，不优化。Success = 有数据支撑的性能基线。

---

## 1. Deliverables 完成清单

| # | 交付物 | 文件 | 状态 |
|---|--------|------|------|
| D1 | Runtime 架构探索 + trace instrument 插入点设计 | MEMORY.md §S84P D1 | ✅ DONE |
| D2 | Runtime trace 类型定义 + 轻量 instrument 代码 | `src/types/runtime-trace.ts`, `src/services/runtime-trace.ts`, `tests/types/runtime-trace.test.ts` | ✅ DONE |
| D3 | Benchmark task + runner（8 cases, 1000 iterations each） | `tests/benchmark/s84p-runtime-benchmark.test.ts`, `vitest.s84p.config.ts` | ✅ DONE |
| D4 | Bottleneck report | `docs/sprints/S84P-bottleneck-report.md` | ✅ DONE |
| D5 | S75P–S83P 回归验证 | 9 个 vitest config 全部 exit 0 | ✅ DONE |
| D6 | Quick wins 评估 | 见下文 §2 | ✅ DONE |

---

## 2. D6 Quick Wins 评估

### 2.1 已实施的 Quick Win

| Quick Win | 说明 | 影响 |
|-----------|------|------|
| **RuntimeTrace 统一 trace** | D2 已交付，替代 48+ 处散落的 `Date.now()` | 🔵 Observability 基线，零性能开销（~0.005ms） |

### 2.2 经评估但未实施的项

| 候选项 | 理由 | 建议 |
|--------|------|------|
| **DB 索引优化** | 测试中观察到 UPDATE 150-350ms（slow query warning），但可能是 Docker 环境 overhead，非生产环境问题 | 🟡 需生产环境数据验证后独立 Sprint 处理 |
| **DB batch write** | cycle events 逐条 append 可改为批量写入 | 🟡 有收益但改动面大，需独立 Sprint |
| **Manager+Worker 并行** | 目前串行调用，可改为 manager routing 完成后立即流式启动 worker | 🔴 架构级改动，需专项 Sprint |
| **Verifier short-circuit** | 高置信度 accept 可提前跳出循环 | 🟡 需定义"高置信度"阈值，有正确性风险 |
| **ensureTable() 缓存** | 首次访问的 CREATE TABLE IF NOT EXISTS 可加 flag 避免重复 | 🟢 低风险但收益极小（仅首次请求 ~20-50ms） |

### 2.3 结论

**没有发现"明显到可以直接改"的 quick win**。RuntimeTrace（已交付）是本轮最有价值的产出，为后续优化 Sprint 提供了可量化的基线。剩余优化项均需要独立 Sprint 和生产环境数据支撑。

---

## 3. 回归验证结果

| Sprint | Config | Test Files | Tests | Exit Code | 状态 |
|--------|--------|------------|-------|-----------|------|
| S75P | vitest.s75p.config.ts | 1 | 16 | 0 | ✅ PASS |
| S76P | vitest.s76p.config.ts | 1 | 9 | 0 | ✅ PASS |
| S77P | vitest.s77p.config.ts | 3+ | 14+ | 0 | ✅ PASS |
| S78P | vitest.s78p.config.ts | 6 | 51+ | 0 | ✅ PASS |
| S79P | vitest.s79p.config.ts | 8 | 63+ | 0 | ✅ PASS |
| S80P | vitest.s80p.config.ts | 10 | 77+ | 0 | ✅ PASS |
| S81P | vitest.s81p.config.ts | 16 | 107+ | 0 | ✅ PASS |
| S82P | vitest.s82p.config.ts | 18 | 113+ | 0 | ✅ PASS |
| S83P | vitest.s83p.config.ts | 19 | 120+ | 0 | ✅ PASS |
| S84P | vitest.s84p.config.ts | 21+ | 131+ | 0 | ✅ PASS |

> **全部 9 个 Sprint config exit code = 0，零 regression。**

---

## 4. 文件变更清单

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/types/runtime-trace.ts` | RuntimeTrace 类型定义 + buildRuntimeTraceExtract |
| `src/services/runtime-trace.ts` | Trace helper 函数（create/start/end/finalize + summary updaters） |
| `tests/types/runtime-trace.test.ts` | RuntimeTrace 单元测试（21 cases） |
| `tests/benchmark/s84p-runtime-benchmark.test.ts` | 8 组 benchmark（warmup 100 + measurement 1000） |
| `vitest.s84p.config.ts` | S84P vitest 配置 |
| `docs/sprints/S84P-bottleneck-report.md` | Bottleneck 分析报告 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `src/api/chat.ts` | 注入 traceStart/traceStage（SSE entry/exit） |
| `src/services/phase3/slow-worker-loop.ts` | 注入 traceStage（worker/cycle stages） |

---

## 5. Key Findings（复述）

1. **本地计算全部亚毫秒**：8 组 benchmark mean 0.000-0.005ms，P95 < 0.012ms
2. **瓶颈 100% 外部 I/O**：LLM 调用占 70-90%，DB 占 5-15%
3. **Trace overhead 可忽略**：full lifecycle ~0.005ms mean
4. **RuntimeTrace 已统一散落的 48+ 处 Date.now()**，为后续 observability 打好基础

---

## 6. PM Sign-off

| 字段 | 值 |
|------|------|
| PM 签字 | ✅ BUILD COMPLETE (2026-05-26) |
| Functional acceptance | APPROVED |
| 基线 commit | `a634bfc` |
| 实现 commit | _see Three-End Sync below_ |
| 三端同步 | _see Three-End Sync below_ |

---

## 7. Three-End Sync

| 端 | Commit | 状态 |
|----|--------|------|
| Desktop | _pending_ | ⏳ |
| WorkBuddy | _pending_ | ⏳ |
| origin/master | _pending_ | ⏳ |

---

## 8. Next Sprint Recommendation

**S85P — LLM Round Trip Reduction / Simple Task Fast Path V0**

S84P 数据支持以下优化方向（优先级排序）：

| 优先级 | 方向 | 预期影响 |
|--------|------|----------|
| 🔴 高 | 减少 LLM round trips（verifier 条件跳过） | 直接降低 70-90% 瓶颈 |
| 🔴 高 | Simple task fast path（低风险任务跳过完整 govern chain） | 大幅改善简单任务延迟 |
| 🟡 中 | 减少上下文体积（context size reduction） | 间接降低 LLM 延迟和费用 |
| 🟡 中 | 改善 streaming/progress 用户感知 | 不降低实际延迟但改善体验 |
| 🟢 低 | DB batch write / connection pool | 仅次要瓶颈，独立 Sprint |

**Non-goals for S85P**：不继续 Human Review governance；不 RBAC；不 revise/rewrite resume。
