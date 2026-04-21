# Gated Delegation Architecture v2 — Technical Design

> 版本：v0.1 Draft | 日期：2026-04-21 | 状态：⏳ 规划中

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

Manager 输出改为多动作打分结构：

```json
{
  "scores": {
    "direct_answer": 0.35,
    "ask_clarification": 0.22,
    "delegate_to_slow": 0.81,
    "execute_task": 0.14
  },
  "features": {
    "missing_info": false,
    "needs_long_reasoning": true,
    "needs_external_tool": false,
    "high_risk_action": false
  },
  "confidence": 0.81,
  "selected_action": "delegate_to_slow",
  "rationale": "任务需要深度推理，direct_answer 不够"
}
```

**改动范围**：
- `src/types/index.ts`：新增 `ManagerDecisionV2` 类型
- `src/services/manager-prompt.ts`：改造 prompt，输出 JSON scores
- `src/services/llm-native-router.ts`（或 rule-router）：适配新输出格式

**阈值策略**（初步，可调）：
| 动作 | 阈值 |
|------|------|
| direct_answer | 0.55 |
| ask_clarification | 0.60 |
| delegate_to_slow | 0.72 |
| execute_task | 0.80 |

> 注：`delegate_to_slow` 和 `execute_task` 阈值更高，因为代价更大。

---

### G2. Policy-Calibrated Gate（规则层修正）

G1 输出后，用结构化规则做二次修正，防止 LLM 的系统性偏差。

**修正规则示例**：
- 若 `missing_info = true` → `delegate_to_slow` 分数上限 × 0.7（信息不全不该委托）
- 若 token 预算紧张 → 抬高 `direct_answer` 阈值
- 若历史上有连续 delegation 失败 → 临时降低 delegation 权重
- 若 `direct_answer` 和 `delegate_to_slow` 差值 < 0.08 → 倾向保守（clarification 或 direct）

**改动范围**：
- `src/services/phase4/delegation-policy.ts`（新建）：规则引擎
- `src/config.ts`：阈值配置化

---

### G3. Rerank-on-Uncertainty（低置信度二判）

触发条件（满足任一）：
- `top1 - top2` 差值 < 0.08
- `confidence` < 0.6
- 高成本动作（delegate/execute）被选中且 confidence < 0.75

**Reranker 可以很轻**：
- 更小的本地 fast model（如 qwen2.5-7B）
- 或专门的 delegation judge prompt
- 或规则+分数校验器

**改动范围**：
- `src/services/delegation-reranker.ts`（新建）
- 触发条件在 router 层判断

---

### G4. Delegation Learning Loop（反馈校准）

**目标**：记录 delegation 真实后果，用于离线分析和轻量学习。

**记录字段**（每次 Manager 决策）：
```
- manager_input_features: { ... }
- action_scores: { ... }
- chosen_action: string
- worker_type: string
- latency_ms: number
- token_cost: number
- user_followup: boolean  // 用户是否追问
- fallback_triggered: boolean  // 是否回退
- final_quality: "better" | "same" | "worse"  // 相对 direct_answer
```

**使用方式**：
1. **离线分析**：哪些特征导致误派单
2. **阈值调优**：基于真实数据调整 G1/G2 阈值
3. **长期**：简单二分类/排序模型（v1.2/v1.3 再做）

**改动范围**：
- `src/db/schema.sql`：新增 `delegation_logs` 表
- `src/services/delegation-logger.ts`（新建）
- `src/api/chat.ts`：在决策点注入日志写入

---

## 成功标准（四层）

| 层级 | 定义 | 衡量指标 |
|------|------|---------|
| 路由成功 | 选对了动作 | Delegation Log 中 `chosen_action == optimal_action` 比率 |
| 执行成功 | Worker 真完成了任务 | WorkerResult.success 比率 |
| 价值成功 | Worker 产出比 direct_answer 有增益 | `final_quality = better` 比率 |
| 用户成功 | 用户未追问/未改写 | `user_followup = false` 比率 |

> 不区分这四层，router 优化永远是盲射。

---

## Sprint 规划

### Sprint 50 P1：G1 + G2（核心）
- ManagerDecision 改为多动作打分输出
- Policy-Calibrated Gate 规则层
- Benchmark CI 同步升级（打分格式）
- tsc + vitest 全绿

### Sprint 50 P2：G3（Rerank）
- Top1/Top2 接近时触发轻量二判
- Reranker 实现（fast model 或规则）

### Sprint 51+：G4（Learning Loop）
- `delegation_logs` 表
- 日志写入 pipeline
- 离线分析 dashboard
- 阈值调优数据基础

### Sprint 51+：P5（Intent 持续优化）
- LLM-Native Routing 替代规则路由
- 基于 G4 数据做 router 微调

---

## 与现有 Phase 3.0 的兼容性

- ManagerDecision 输出升级为 V2，不影响 SSE 协议（`archive_written` / `worker_completed` 等事件不变）
- Archive / Worker / Manager Synthesis 全部保持兼容
- Benchmark CI 需要同步升级（离线规则路由不受影响，因为走的是 rule-router 分支）
- LLM-Native Router（`use_llm_native_routing=true`）需要同步适配 G1 输出格式

---

## 风险与注意事项

1. **打分格式改变会导致 Benchmark CI 短期下降**：需要同步更新 benchmark-ci.cjs 的 expected 输出
2. **阈值需要真实数据校准**：G1 上线初期阈值是 guess，需要 G4 数据反馈后调优
3. **不要一次做 G1~G4**：分 Sprint 做，每 Sprint 有可测量交付
4. **clarification 也是高成本动作**：分析里把 clarification 当保守选项，但实际上打断用户体验，成本不低于 delegation

---

## 待确认项

- [ ] G1 的 `confidence` 字段：是由 LLM 直接输出，还是由 `max(scores) - second_max(scores)` 计算得出？
- [ ] G2 规则层：哪些是"必须硬编码"vs"可配置"？需要老板拍板初始规则集
- [ ] G3 Reranker：用更小的 fast model 还是规则+校验器？
- [ ] G4 delegation_logs 表：userId / sessionId / taskId 的关联设计
