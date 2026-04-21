# Sprint 50 — Delegation Gate v2 (Foundation)

> 版本：v0.1 | 日期：2026-04-21 | 状态：⏳ 规划中，待执行

---

## Sprint 目标

把 Manager 的委托判断从"单动作硬判"升级为"可校准的门控决策"，为后续 G3/G4 打下数据基础。

---

## 交付范围

| 分支 | 内容 | 优先级 |
|------|------|--------|
| P1 | G1 Action Score Head（多动作打分 + 双轨置信度）| P0 |
| P1.5 | G2 Minimal Policy-Calibrated Gate（规则层 + clarification 成本）| P0 |
| P2 | G3 Reranker Skeleton（规则 rerank + 触发条件）| P1 |
| P3 | Benchmark 升级（打分格式兼容 + 新增指标）| P1 |

---

## P1：G1 Action Score Head

### 1.1 新增类型：`ManagerDecisionV2`

在 `src/types/index.ts` 新增：

```typescript
// 向后兼容 V1
export interface ManagerDecisionV2 extends ManagerDecision {
  schema_version: "manager_decision_v2";

  // G1: 多动作打分
  llm_scores: Record<ManagerDecisionType, number>; // 0.0 ~ 1.0
  llm_confidence_hint: number; // LLM 自报置信度
  features: DecisionFeatures;   // 结构化特征

  // G1: 系统计算置信度
  system_confidence: number;    // 由后处理计算得出，用于所有决策判断

  // G1: 最终动作（经 G2 policy 修正后）
  selected_action: ManagerDecisionType;
  rationale: string;            // 决策理由

  // G2: Policy 修正记录
  policy_overrides?: PolicyOverride[];
}

export interface DecisionFeatures {
  missing_info: boolean;
  needs_long_reasoning: boolean;
  needs_external_tool: boolean;
  high_risk_action: boolean;
  query_too_vague: boolean;
  requires_multi_step: boolean;
}

export interface PolicyOverride {
  rule: string;        // 规则名称
  action: "penalize" | "block" | "boost" | "force";
  target: ManagerDecisionType;
  original_score: number;
  adjusted_score: number;
  reason: string;
}
```

**向后兼容策略**：
- `ManagerDecisionV2` 继承 `ManagerDecision`（V1 字段全部保留）
- SSE 事件中的 `decision` 字段继续使用 V1 兼容字段
- V2 的 `llm_scores` / `system_confidence` / `selected_action` 作为扩展字段存在

### 1.2 Manager Prompt 改造

在 `src/services/manager-prompt.ts` 改造 prompt，输出 JSON：

```
你是一个任务委托决策系统。对于用户的请求，你需要对以下四个动作分别打分（0.0~1.0）：

- direct_answer: 直接回答
- ask_clarification: 询问澄清
- delegate_to_slow: 委托给慢速深度模型
- execute_task: 执行任务（调用工具）

输出 JSON：
{
  "scores": {
    "direct_answer": <分数>,
    "ask_clarification": <分数>,
    "delegate_to_slow": <分数>,
    "execute_task": <分数>
  },
  "confidence_hint": <0.0~1.0>,
  "features": {
    "missing_info": <boolean>,
    "needs_long_reasoning": <boolean>,
    "needs_external_tool": <boolean>,
    "high_risk_action": <boolean>,
    "query_too_vague": <boolean>,
    "requires_multi_step": <boolean>
  },
  "rationale": "<一句话理由>"
}
```

### 1.3 后处理：System Confidence 计算

在 `src/services/gating/system-confidence.ts`（新建）：

```typescript
export function calculateSystemConfidence(
  llmScores: Record<ManagerDecisionType, number>,
  llmConfidenceHint: number,
  features: DecisionFeatures,
  config: GatingConfig
): number {
  const scores = Object.values(llmScores).sort((a, b) => b - a);
  const top1 = scores[0];
  const top2 = scores[1] ?? 0;
  const gap = top1 - top2;

  // 1. 基础置信度：top1 + gap 奖励
  let confidence = llmConfidenceHint * 0.4 + (gap * 0.6);

  // 2. 高成本动作惩罚
  const selectedAction = getSelectedAction(llmScores);
  if (selectedAction === "execute_task") confidence *= 0.85;
  if (selectedAction === "delegate_to_slow") confidence *= 0.92;

  // 3. 缺信息惩罚
  if (features.missing_info) confidence *= 0.80;

  // 4. 高风险动作惩罚
  if (features.high_risk_action) confidence *= 0.80;

  // 5. 不确定特征惩罚
  if (features.query_too_vague) confidence *= 0.85;

  return Math.max(0, Math.min(1, confidence));
}
```

---

## P1.5：G2 Minimal Policy-Calibrated Gate

### 2.1 规则分层

**文件结构**：
```
src/services/gating/
  hard-policy.ts      # 硬编码核心规则
  gating-config.ts    # 可配置阈值/权重
  policy-calibrator.ts # G2 核心逻辑
```

### 2.2 硬编码规则（`hard-policy.ts`）

这些规则无条件执行，LLM 不可覆盖：

```typescript
export const HARD_RULES: HardPolicyRule[] = [
  {
    id: "execute_requires_info",
    condition: (features) => features.missing_info && features.query_too_vague,
    action: "block",
    target: "execute_task",
    reason: "信息缺失时禁止执行任务"
  },
  {
    id: "delegate_blocked_without_goal",
    condition: (features) => features.missing_info,
    action: "penalize",
    target: "delegate_to_slow",
    penalty: 0.5,
    reason: "信息缺失时不建议委托"
  },
  {
    id: "high_risk_blocks_execute",
    condition: (features) => features.high_risk_action,
    action: "block",
    target: "execute_task",
    reason: "高风险动作禁止直接执行"
  },
];
```

### 2.3 可配置参数（`gating-config.ts`）

```typescript
export const DEFAULT_GATING_CONFIG: GatingConfig = {
  // 动作基础阈值
  thresholds: {
    direct_answer: 0.55,
    ask_clarification: 0.60,
    delegate_to_slow: 0.72,
    execute_task: 0.80,
  },

  // Clarification 体验成本惩罚（打断用户、对话轮次增加）
  clarification_cost_weight: 0.15, // 降低 clarification 的 effective score

  // Rerank 触发阈值
  rerank: {
    top_gap_threshold: 0.08,        // top1 - top2 < 此值时触发 rerank
    confidence_threshold: 0.60,     // system_confidence < 此值时触发 rerank
    high_cost_confidence_floor: 0.75, // delegate/execute 在此 confidence 以下触发 rerank
  },

  // 成本惩罚系数
  cost_penalty: {
    delegate_token_penalty: 0.02,   // 每 1000 token 额外惩罚
    latency_penalty: 0.01,         // 每 10s latency 额外惩罚
  },
};
```

### 2.4 Policy Calibrator（`policy-calibrator.ts`）

接收 G1 输出，输出修正后的 scores + overrides：

```typescript
export interface CalibratedDecision {
  adjustedScores: Record<ManagerDecisionType, number>;
  policyOverrides: PolicyOverride[];
  finalAction: ManagerDecisionType;
}

export function calibrateWithPolicy(
  llmScores: Record<ManagerDecisionType, number>,
  features: DecisionFeatures,
  config: GatingConfig
): CalibratedDecision {
  let adjustedScores = { ...llmScores };

  // 1. 应用硬编码规则
  for (const rule of HARD_RULES) {
    if (rule.condition(features)) {
      adjustedScores = applyRule(rule, adjustedScores);
    }
  }

  // 2. 应用 clarification 体验成本
  adjustedScores.ask_clarification *= (1 - config.clarification_cost_weight);

  // 3. 应用配置化阈值
  for (const [action, score] of Object.entries(adjustedScores)) {
    if (score < config.thresholds[action as ManagerDecisionType]) {
      // 低于阈值，score 降低到 0（相当于否决）
      adjustedScores[action as ManagerDecisionType] = 0;
    }
  }

  // 4. 选取得分最高的有效动作
  const finalAction = getTopAction(adjustedScores);

  return { adjustedScores, policyOverrides, finalAction };
}
```

---

## P2：G3 Reranker Skeleton

### 3.1 触发条件

```typescript
export function shouldRerank(
  llmScores: Record<ManagerDecisionType, number>,
  systemConfidence: number,
  selectedAction: ManagerDecisionType,
  config: GatingConfig
): boolean {
  const scores = Object.values(llmScores).sort((a, b) => b - a);
  const topGap = scores[0] - (scores[1] ?? 0);

  const isHighCostAction = selectedAction === "delegate_to_slow" || selectedAction === "execute_task";

  return (
    topGap < config.rerank.top_gap_threshold ||
    systemConfidence < config.rerank.confidence_threshold ||
    (isHighCostAction && systemConfidence < config.rerank.high_cost_confidence_floor)
  );
}
```

### 3.2 规则式 Rerank（第一版）

```typescript
export function ruleBasedRerank(
  llmScores: Record<ManagerDecisionType, number>,
  features: DecisionFeatures,
  selectedAction: ManagerDecisionType
): ManagerDecisionType {
  // 如果 delegate 和 clarification 接近，且缺信息 → clarification
  if (
    features.missing_info &&
    Math.abs(llmScores.delegate_to_slow - llmScores.ask_clarification) < 0.1
  ) {
    return "ask_clarification";
  }

  // 如果 delegate 和 direct_answer 接近，且 query 明确 → direct
  if (
    !features.missing_info &&
    !features.needs_long_reasoning &&
    Math.abs(llmScores.delegate_to_slow - llmScores.direct_answer) < 0.1
  ) {
    return "direct_answer";
  }

  // execute_task 无明确工具需求时禁止
  if (
    selectedAction === "execute_task" &&
    !features.needs_external_tool &&
    !features.requires_multi_step
  ) {
    return "direct_answer";
  }

  // 默认保持原选
  return selectedAction;
}
```

---

## P3：Benchmark 升级

### 3.1 新增指标

Benchmark CI 新增以下指标（不影响现有 Mode/Intent/Layer 判断）：

| 指标 | 说明 |
|------|------|
| `score_distribution` | 各 action 的 score 均值/标准差分布 |
| `top1_margin` | top1 - top2 差值分布 |
| `rerank_trigger_rate` | rerank 触发率 |
| `policy_override_rate` | policy 修正率 |
| `confidence_calibration` | system_confidence 与实际正确率的偏差 |

### 3.2 Benchmark CI 改动

`scripts/benchmark-ci.cjs` 新增：
- 读取 `llm_scores` 字段（由模拟 ManagerDecisionV2 注入）
- 计算 `system_confidence` 并验证阈值触发逻辑
- 断言 `rerank_trigger_rate` < 0.3（防止过度 rerank）

---

## 与现有实现的兼容关系

### ManagerDecision V1 → V2 兼容

```
SSE 事件流（不变）：
Fast Model → ManagerDecisionV2 → orchestrator
                              ↓
                         SSE archive_written
                         (使用 V1 兼容字段)

rule-router（不变）：
  离线规则路由，不走 LLM-native path
  Benchmark CI 独立运行

llm-native-router.ts（需改）：
  适配 ManagerDecisionV2 输出格式
  传递 llm_scores / system_confidence 到 orchestrator
```

### Archive / Worker / SSE 兼容性

- `archive_written` / `worker_started` / `worker_completed` / `manager_synthesized` SSE 事件 **不变**
- `TaskArchiveRepo` / `TaskArchiveEventRepo` **不变**
- `CommandPayload` / `WorkerResult` **不变**

---

## 不做事项（Out of Scope）

以下内容明确不在 Sprint 50 范围内：

| 事项 | 原因 |
|------|------|
| G4 Delegation Learning Loop | Sprint 51+，需先有数据积累 |
| Worker taxonomy 重划分 | Sprint 51+，G1/G2 稳定后再做 |
| Learned reranker | 需要 G4 数据反馈 |
| 并行多 worker 试探 | 成本/复杂度太高 |
| Feedback pipeline 改造 | 现有 feedback_events 足够 |
| Archive 存储后端改动 | Phase 5 已完成 |

---

## Sprint 50 交付物清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `src/types/index.ts` | 改 | 新增 ManagerDecisionV2 / DecisionFeatures / PolicyOverride |
| `src/services/manager-prompt.ts` | 改 | 改造 prompt，输出多动作打分 JSON |
| `src/services/gating/system-confidence.ts` | 新 | system_confidence 计算逻辑 |
| `src/services/gating/hard-policy.ts` | 新 | 硬编码核心规则 |
| `src/services/gating/gating-config.ts` | 新 | 可配置阈值/权重 |
| `src/services/gating/policy-calibrator.ts` | 新 | G2 Policy Calibrator |
| `src/services/gating/delegation-reranker.ts` | 新 | G3 规则 reranker |
| `src/services/llm-native-router.ts` | 改 | 适配 V2 输出格式 |
| `src/api/chat.ts` | 改 | 注入 G1/G2/G3 调用 |
| `src/db/migrations/012_delegation_logs.sql` | 新 | delegation_logs 决策事实表（Schema only，G4 写入） |
| `scripts/benchmark-ci.cjs` | 改 | 新增多动作打分 + Benchmark 指标 |
| `tests/services/gating.test.ts` | 新 | G1/G2/G3 单元测试 |
| `docs/GATED-DELEGATION-v2.md` | 改 | v0.2 Confirmed |

---

## Sprint 50 收口标准

- [ ] `tsc --noEmit` 0 errors
- [ ] `vitest` 全绿（新增 gating tests）
- [ ] `npm run benchmark:ci` Mode >= 80% / Intent >= 70%（现有基准不变）
- [ ] G1/G2/G3 流程可从 trace panel 观测（分数 / policy 修正 / rerank 原因）
- [ ] 所有改动向后兼容（V1 API 不受影响）
- [ ] commit + push 到 GitHub V2 仓库
