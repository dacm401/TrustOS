# TrustOS 阈值体系文档

本文档记录 TrustOS 中所有关键阈值的**业务语义、来源依据和调优历史**。
所有阈值旁必须包含来源注释，修改时更新本文档。

---

## 1. Gated Delegation 阈值

### G2 — Action 有效性阈值

**常量**: `confidence_threshold = 0.65`
**位置**: `src/services/gating/policy-calibrator.ts`
**含义**: Manager 的 confidence_hint 低于此值时，当前的 G2 action 被认为"不可信"，需要触发 rerank 或 fallback。
**来源**: Phase 5.2 生产数据分析（2026-05-06，53 条样本）。观察 confidence_hint 分布：action 切换点集中在 0.60~0.70 区间，0.65 是该区间的中心。

### G3 — 通用 Rerank 触发阈值

**常量**: `confidence_threshold = 0.60`
**位置**: `src/services/gating/delegation-reranker.ts` (`shouldRerank` 函数)
**含义**: confidence_hint < 0.60 时，路由不确定性强，rerank 作为安全网兜底。
**来源**: Phase 5.2 生产数据分析（2026-05-06，53 条样本）。confidence_hint < 0.60 的样本共 8 条，其中 7 条 rerank 后 change=0，1 条 change=1。设置 0.60 作为rerank 触发底线。

### G3 — 高成本 Rerank 触发线（grayZone 上界）

**常量**: `high_cost_confidence_floor = 0.70`
**位置**: `src/services/gating/delegation-reranker.ts` (`shouldRerank` 函数)
**含义**: delegate_to_slow / execute_task 的 confidence_hint ≥ 0.70 时，rerank 高置信，强制触发（不走 grayZone 短路）。
**来源**: Phase 5.2 阈值对齐调整（2026-05-06）。原值为 0.75，为与 G2 的 0.65 保持梯度一致性，调整为 0.70（0.65 + 0.05 梯度）。

### grayZone — 灰区短路区间

**常量**: `conf ∈ [0.60, 0.70)`（左闭右开）
**位置**: `src/services/gating/delegation-reranker.ts` (`shouldRerank` 函数)
**含义**: confidence_hint 在此区间内，且 G2 action 为 `delegate_to_slow` 或 `execute_task` 时，rerank 被短路（不触发）。理由：灰区任务本身不贵，rerank 负 ROI。
**来源**: Phase 5.4 grayZone 短路分析（2026-05-06，53 条历史样本回放）。v2 grayZone 短路 14 次，全部 change=0，triggerRate 从 92.5% 降至 66.0%。

---

## 2. system_confidence 标准化

**常量**: `Math.round(system_confidence * 1000) / 1000`
**位置**: `src/services/gating/system-confidence.ts` (`calculateSystemConfidence` 函数)
**含义**: 消除 IEEE754 浮点数尾数噪音，标准化到 3 位小数，保证阈值比较的确定性。
**来源**: Phase 5.2 边界用例测试（2026-05-06）。发现 0.60 和 0.699 在浮点运算后可能产生尾数差，导致阈值判断不稳定。

---

## 3. 阈值修改规则

1. **必须加注释**: 每个阈值常量旁必须注明 `// 来源：YYYY-MM-DD，N 条样本，见 scripts/rerank-analysis.js`
2. **先回放再上线**: 新阈值必须用历史样本回放验证，确认 changeRate 不下降
3. **灰度观察**: 上线后持续监控 `delegation_logs` 中的 `triggerRate` 和 `changeRate`，确认与回放一致

---

## 4. 相关脚本

- `scripts/rerank-analysis.js`: 统计 rerank triggerRate / changeRate / 无效 rerank 占比
- `scripts/grayzone-comparison.ts`: grayZone 策略回放对比（v1 vs v2）
