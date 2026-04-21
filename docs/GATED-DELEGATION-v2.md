# Gated Delegation Architecture v2 — Technical Design

> 版本：v0.3 Confirmed | 日期：2026-04-21 | 状态：✅ Sprint 50 开发中（2026-04-21 完成 P1/P1.5/P2/P3）

---

## 背景

Phase C（Manager-Worker Runtime）已交付。当前 ManagerDecision 输出为单动作硬判：
```json
{ "action": "delegate_to_slow" }
```

**问题**：
- 无法判断置信度
- 无法做阈值校准
- 无法做离线错误分析
- 委托成功率难以系统优化

**参考**：MoE 门控网络（gating network）的核心思想 — 门控不是分类器，而是打分器。

---

## 目标

把委托判断从"单次拍脑袋"升级为"可校准的门控决策"：

1. 多动作打分，而不是单动作硬判
2. 置信度透明，而不是黑盒决策
3. 反馈学习校准，而不是靠 prompt 手搓 forever

---

## 架构：Gated Delegation 四层

### G1. Action Score Head（Manager 输出改造）

Manager 输出改为多动作打分结构（双轨置信度）：

```json
{
  "llm_scores": {
    "direct_answer": 0.31,
    "ask_clarification": 0.18,
    "delegate_to_slow": 0.77,
    "execute_task": 0.09
  },
  "llm_confidence_hint": 0.73,
  "features": {
    "missing_info": false,
    "needs_long_reasoning": true,
    "needs_external_tool": false,
    "high_risk_action": false
  },
  "system_confidence": 0.64,
  "selected_action": "delegate_to_slow",
  "rationale": "任务需要深度推理，direct_answer 不够"
}
```

**双轨置信度原则**：
- `llm_confidence_hint`：LLM 自报参考信号，可信但不稳定
- `system_confidence`：系统计算值，综合 top1-top2 gap / 高成本动作惩罚 / 缺信息惩罚 / policy 冲突等因素
- **所有判断、阈值、benchmark 以 `system_confidence` 为主**

**改动范围**：
- `src/types/index.ts`：新增 `ManagerDecisionV2` 类型（向后兼容 V1）
- `src/services/manager-prompt.ts`：改造 prompt，输出 JSON scores
- `src/services/llm-native-router.ts` / rule-router：适配新输出格式

---

### G2. Policy-Calibrated Gate（规则层修正）

G1 输出后，用结构化规则做二次修正。**与 G1 同 Sprint 落地最小版**。

**分层原则**：
- **硬编码**（`hard_policy.ts`）：核心安全/越权/缺信息规则，稳定不可绕过
- **可配置**（`gating-config.ts`）：阈值/权重/惩罚系数

**硬编码必须项**：
- 缺关键信息时，`execute_task` 不可直接通过
- 高风险动作不允许仅凭高分放行
- policy 禁止的动作不得被 LLM 越权覆盖
- schema 非法或 scores 不可信时必须 fallback

**可配置项**：
- 各动作基础阈值
- top1-top2 gap 阈值
- clarification 体验成本惩罚权重
- token 预算对 delegate 的惩罚系数
- latency 惩罚系数

**clarification 不是零成本**：clarification 打断用户体验，在 G2 中必须计入成本，不得作为默认兜底。

---

### G3. Rerank-on-Uncertainty（低置信度二判）

**触发条件**（满足任一）：
- `top1 - top2` gap < 阈值（默认 0.08）
- `system_confidence` < 0.6
- 高成本动作（delegate/execute）被选中且 `system_confidence` < 0.75

**第一版实现（规则优先，不引入第二个复杂模型）**：
- 规则式 rerank（轻量条件分支）
- 可选极轻 LLM judge prompt（只回答 A/B + 一句理由）

**不做**：第二大型模型并行 / learned reranker / 多 worker 并发试探。

---

### G4. Delegation Learning Loop（反馈校准）

**Sprint 51+ 再做。**

**第一版目标**：设计 `delegation_logs` 决策事实表，以分析和回放为第一目标，不以训练为第一目标。

**记录字段**（决策事实表最小集）：
- id / user_id / session_id / task_id / timestamp
- query_text / query_features_json
- llm_scores_json / llm_confidence_hint / system_confidence
- selected_action / final_action_after_policy
- rerank_triggered / rerank_reason
- policy_adjustments_json
- selected_worker_type / archive_id / command_id
- latency_ms / input_tokens / output_tokens / total_cost_usd
- **routing_success / execution_success / value_success / user_success**（四层成功标准）
- feedback_source / notes_json

---

## 成功标准（四层）

| 层级 | 定义 | 衡量指标 |
|------|------|---------|
| 路由成功 | manager 选对了动作 | delegation_logs 中 routing_success 比率 |
| 执行成功 | Worker 真完成了任务 | execution_success 比率 |
| 价值成功 | Worker 产出比 direct_answer 有增益 | value_success = "better" 比率 |
| 用户成功 | 用户未追问/未改写 | user_success = true 比率 |

> 不区分这四层，router 优化永远是盲射。Benchmark 也要分层，不要把所有失败都算在 routing 头上。

---

## Sprint 规划

### Sprint 50 P1：G1 Action Score Head
- ManagerDecision 改为多动作打分输出（双轨置信度）
- Benchmark CI 同步升级（打分格式）
- tsc + vitest 全绿

### Sprint 50 P1.5：G2 Minimal Policy-Calibrated Gate
- hard_policy.ts（核心安全规则硬编码）
- gating-config.ts（阈值/权重可配置）
- clarification 体验成本惩罚
- policy 修正前后分数可观测

### Sprint 50 P2：G3 Reranker Skeleton
- top1-top2 gap 阈值触发
- 规则式 rerank + 可选极轻 judge prompt
- 可观测 rerank 触发率

### Sprint 51+：G4（Learning Loop）
- `delegation_logs` 决策事实表
- 日志写入 pipeline
- 离线分析数据基础
- 阈值调优

### Sprint 51+：P5（Intent 持续优化）
- LLM-Native Routing 替代规则路由
- 基于 G4 数据做 router 微调

---

## 与现有 Phase 3.0 的兼容性

- ManagerDecision 输出升级为 V2，**不影响 SSE 协议**（`archive_written` / `worker_completed` 等事件不变）
- Archive / Worker / Manager Synthesis 全部保持兼容
- LLM-Native Router（`use_llm_native_routing=true`）需要同步适配 G1 输出格式
- Benchmark CI 离线规则路由**不受影响**（rule-router 分支独立）

---

## 已确认决策（老板拍板）

| 问题 | 决策 |
|------|------|
| confidence 如何得出 | 双轨制：`llm_confidence_hint`（LLM输出） + `system_confidence`（系统计算），以系统计算为主 |
| G2 规则分层 | 硬编码（安全/越权/缺信息）+ 可配置（阈值/权重/惩罚系数） |
| G3 reranker 方案 | 规则式 rerank + 可选极轻 judge prompt，不引入第二个复杂模型 |
| G4 目标 | 决策事实表，分析和回放为第一目标，不以训练为第一目标 |
| worker taxonomy | **不改**。保持现有 worker 类型，只升级 routing gate |
| clarification 成本 | **有显著体验成本**，不得作为默认低成本保守选项，必须计入 G2 成本模型 |

---

## 风险与注意事项

1. **打分格式改变会导致 Benchmark CI 短期下降**：需要同步更新 benchmark-ci.cjs 的 expected 输出
2. **阈值需要真实数据校准**：G1 上线初期阈值是 guess，需要 G4 数据反馈后调优
3. **不要一次做 G1~G4**：分 Sprint 做，每 Sprint 有可测量交付
4. **delegation 成功率低可能有三个来源**：gate 选错 / worker 产出不稳 / manager synthesis 体验差。Benchmark 要分层，不全算 routing 的锅
