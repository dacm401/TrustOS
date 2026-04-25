# Phase 2.0 — Layer 2 全量上线规划

> 状态：规划中 | 更新：2026-04-25 | 负责人：老板拍板

---

## 背景

当前 Phase D G1~G3 已稳定，Phase 1.5 全部完成。
Phase 2.0 的目标：**Layer 2 复杂任务正式接入生产流量**，并建立完整的质量护栏。

---

## Layer 分层现状

| Layer | 描述 | 当前状态 | 触发条件 |
|-------|------|---------|---------|
| **Layer 0** | 简单问答，无需搜索/执行 | ✅ 已上线 | `complexity_score < 20` |
| **Layer 1** | 搜索增强 / 简单工具调用 | ✅ 已上线 | `complexity_score 20~50` |
| **Layer 2** | 多跳推理 / 复杂工作流 / 多次工具调用 | ⚠️ 灰度 | `complexity_score > 50` |

---

## L2 接入前提（Gate Criteria）

> **原则：Layer 2 上线必须有可测量的质量基线。**

| 前置条件 | 状态 | 说明 |
|---------|------|------|
| G4 delegation_logs 有足够数据（≥ 200 条） | ⏳ 待积累 | 生产流量跑 3~5 天后可达 |
| 四层成功率基线已建立 | ⏳ 待建立 | routing ≥ 80%，execution ≥ 85% |
| Benchmark L2 suite ≥ 80% | ⏳ 待做 | L2-B |
| Phase 5（Archive）Storage 稳定 | ✅ 已有 | 本地/s3/pg 三种后端 |
| Rate Limiting Middleware | ✅ 已有 | Sprint 52 已上线 |
| SSE done 事件双路推送 | ✅ 已有 | Sprint 53 |

---

## L2 分阶段计划

### 阶段 1：L2-B Benchmark 扩测（可并行，不依赖 G4 数据）

**目标**：为 Layer 2 建立独立的 benchmark suite，作为后续所有变更的质量护栏。

**新增 cases（目标 30 条）**：

| 类型 | 数量 | 示例 |
|------|------|------|
| 多跳推理 | 8 | "对比 A 和 B 的 X 指标，并给出推荐" |
| 复杂工具调用链 | 8 | "先搜索 X，再筛选 Y，最后写入 Z" |
| 长文档摘要+分析 | 6 | "阅读这份报告，总结关键发现并分析趋势" |
| 跨 session 状态 | 4 | "继续上次的任务，完成剩余部分" |
| 边界条件 | 4 | 空查询 / 超长输入 / 多语言混合 |

**预期输出**：`benchmark-layer2.json`（30 cases），独立 CI job。

**时间估算**：0.5 sprint。

---

### 阶段 2：L2 数据积累与基线建立（G4 数据就绪后）

**目标**：基于 delegation_logs 真实数据，确认 Layer 2 的 routing/execution/vale 成功率基线。

**分析维度**：
- `complexity_score` 分桶（50~70 / 70~90 / 90+）的 routing accuracy 差异
- Layer 2 中 `delegate_to_slow` vs `execute_task` 的 value_success 对比
- Rerank 触发率在 Layer 2 的特殊性（gap 阈值是否需要调高）
- Latency/Cost 在 Layer 2 的 P99 值（确认 SLA）

**输出**：L2 基线报告，确认进入灰度的阈值。

---

### 阶段 3：L2 灰度上线（5% → 20% → 50% → 100%）

**灰度策略**：

| 阶段 | 流量比例 | 条件 |
|------|---------|------|
| 灰度 5% | 5% 用户 | L2 基线 report 通过 |
| 灰度 20% | 20% 用户 | 48h 无 P0 bug，routing success ≥ 78% |
| 灰度 50% | 50% 用户 | 7d routing success ≥ 80%，execution success ≥ 85% |
| 全量 | 100% | 14d 各项指标稳定 |

**监控告警阈值**：
- routing success < 75% → 自动降级 Layer 2 流量至 0
- execution success < 80% → PagerDuty 告警
- avg latency > 15s → 告警

---

### 阶段 4：L2-C Router 微调（G4 + L2-B 数据就绪后）

**触发条件**：L2 Benchmark ≥ 80% 且 delegation_logs 有 500+ Layer 2 条目。

**方向**：
- 基于 G4 `value_success=false` 的 case 分析，识别慢模型低效场景
- 调整 `complexity_score` 阈值（可能需要把边界从 50 调到 45 或 55）
- 调整 `delegate_to_slow` 阈值（当前 0.75 是否适合 Layer 2）
- intent classifier 在 Layer 2 任务上的 recall 是否足够

---

## 不在 L2 范围的事项

- **多 worker 并发**：Phase D 明确不做，放在 Phase E 考虑
- **Learned reranker**：G3 rerank 保持规则式，learned reranker 放在 Phase E
- **L1 search/RAG 增强**：Manager 直接检索方向已否决，保持薄路由

---

## L2 与其他 Sprint 的依赖关系

```
Sprint 56     L2-B Benchmark 扩测（独立，不依赖 G4）
                ↓
Sprint 57     L2 数据积累 + 基线报告（依赖生产流量）
                ↓
Sprint 58     L2 灰度 5% 上线
Sprint 59     L2 灰度 20%
Sprint 60     L2 灰度 50%
Sprint 61     L2 全量 + L2-C Router 微调（依赖足够数据）
```

> 注：上述时间线为估算，实际根据 G4 数据积累速度调整。

---

## 风险与注意事项

1. **Layer 2 的 complexity_score 阈值可能是 guess**：真实流量中的分布需要观察后再决定是否微调
2. **慢模型成本在 Layer 2 会显著上升**：需要提前告知老板 ROI 影响
3. **L2 灰度期间会污染 delegation_logs**：需要做好分层查询（`WHERE complexity_score > 50`）
4. **Benchmark 和生产表现可能不一致**：Benchmark 是规则题，生产是开放式，需要分层分析
