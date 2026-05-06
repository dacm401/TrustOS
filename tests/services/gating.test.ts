import { describe, it, expect } from "vitest";
import {
  calculateSystemConfidence,
  getSelectedAction,
} from "../../src/services/gating/system-confidence.js";
import { calibrateWithPolicy } from "../../src/services/gating/policy-calibrator.js";
import { shouldRerank, ruleBasedRerank } from "../../src/services/gating/delegation-reranker.js";
import { DEFAULT_GATING_CONFIG } from "../../src/services/gating/gating-config.js";
import type { DecisionFeatures } from "../../src/types/index.js";

const BASE_FEATURES: DecisionFeatures = {
  missing_info: false,
  needs_long_reasoning: false,
  needs_external_tool: false,
  high_risk_action: false,
  query_too_vague: false,
  requires_multi_step: false,
};

// ── G1: system-confidence ─────────────────────────────────────────────────────

describe("G1: calculateSystemConfidence", () => {
  it("gap大时置信度高", () => {
    // gap = 0.9 - 0.1 = 0.8 → conf = 0.8*0.4 + 0.8*0.6 = 0.32+0.48 = 0.8
    const scores = { direct_answer: 0.1, ask_clarification: 0.05, delegate_to_slow: 0.9, execute_task: 0.05 };
    const conf = calculateSystemConfidence(scores, 0.8, BASE_FEATURES);
    expect(conf).toBeGreaterThan(0.7);
  });

  it("gap小时置信度低", () => {
    const scores = { direct_answer: 0.48, ask_clarification: 0.45, delegate_to_slow: 0.52, execute_task: 0.1 };
    const conf = calculateSystemConfidence(scores, 0.8, BASE_FEATURES);
    expect(conf).toBeLessThan(0.65);
  });

  it("高成本动作被惩罚", () => {
    const scores_direct = { direct_answer: 0.8, ask_clarification: 0.2, delegate_to_slow: 0.1, execute_task: 0.1 };
    const scores_delegate = { direct_answer: 0.1, ask_clarification: 0.2, delegate_to_slow: 0.8, execute_task: 0.1 };

    const conf_direct = calculateSystemConfidence(scores_direct, 0.8, BASE_FEATURES);
    const conf_delegate = calculateSystemConfidence(scores_delegate, 0.8, BASE_FEATURES);

    // 同样的 llm hint + gap，delegate 应该有更低的 system_confidence
    expect(conf_delegate).toBeLessThan(conf_direct);
  });

  it("缺信息时惩罚", () => {
    const features_with_missing = { ...BASE_FEATURES, missing_info: true };
    const scores = { direct_answer: 0.3, ask_clarification: 0.6, delegate_to_slow: 0.85, execute_task: 0.1 };
    const conf = calculateSystemConfidence(scores, 0.8, features_with_missing);
    expect(conf).toBeLessThan(0.6);
  });

  it("高风险动作时 execute_task 惩罚", () => {
    const features_high_risk = { ...BASE_FEATURES, high_risk_action: true };
    const scores = { direct_answer: 0.2, ask_clarification: 0.2, delegate_to_slow: 0.2, execute_task: 0.8 };
    const conf = calculateSystemConfidence(scores, 0.8, features_high_risk);
    expect(conf).toBeLessThan(0.6);
  });

  it("模糊请求惩罚", () => {
    const features_vague = { ...BASE_FEATURES, query_too_vague: true };
    const scores = { direct_answer: 0.7, ask_clarification: 0.6, delegate_to_slow: 0.2, execute_task: 0.1 };
    const conf = calculateSystemConfidence(scores, 0.8, features_vague);
    expect(conf).toBeLessThan(0.7);
  });

  it("置信度在0-1之间", () => {
    const scores = { direct_answer: 0.5, ask_clarification: 0.5, delegate_to_slow: 0.5, execute_task: 0.5 };
    const conf = calculateSystemConfidence(scores, 0.5, BASE_FEATURES);
    expect(conf).toBeGreaterThanOrEqual(0);
    expect(conf).toBeLessThanOrEqual(1);
  });
});

describe("G1: getSelectedAction", () => {
  it("返回最高分动作", () => {
    const scores = { direct_answer: 0.3, ask_clarification: 0.6, delegate_to_slow: 0.85, execute_task: 0.1 };
    expect(getSelectedAction(scores)).toBe("delegate_to_slow");
  });

  it("平分时返回第一个（Object.entries顺序）", () => {
    const scores = { direct_answer: 0.8, ask_clarification: 0.8, delegate_to_slow: 0.2, execute_task: 0.1 };
    expect(getSelectedAction(scores)).toBe("direct_answer");
  });
});

// ── G2: policy-calibrator ─────────────────────────────────────────────────────

describe("G2: calibrateWithPolicy", () => {
  it("缺信息时 execute_task 被 block", () => {
    const features_missing = { ...BASE_FEATURES, missing_info: true, query_too_vague: true };
    const scores = { direct_answer: 0.2, ask_clarification: 0.5, delegate_to_slow: 0.7, execute_task: 0.85 };
    const result = calibrateWithPolicy(scores, features_missing);
    expect(result.adjustedScores.execute_task).toBe(0);
    expect(result.policyOverrides.some((o) => o.rule === "execute_requires_info")).toBe(true);
  });

  it("高风险时 execute_task 被 block", () => {
    const features_high_risk = { ...BASE_FEATURES, high_risk_action: true };
    const scores = { direct_answer: 0.2, ask_clarification: 0.5, delegate_to_slow: 0.7, execute_task: 0.85 };
    const result = calibrateWithPolicy(scores, features_high_risk);
    expect(result.adjustedScores.execute_task).toBe(0);
    expect(result.policyOverrides.some((o) => o.rule === "high_risk_blocks_execute")).toBe(true);
  });

  it("clarification 有体验成本惩罚", () => {
    // 0.75 * 0.85 = 0.6375 >= 0.60 阈值，通过
    const scores = { direct_answer: 0.3, ask_clarification: 0.75, delegate_to_slow: 0.2, execute_task: 0.1 };
    const result = calibrateWithPolicy(scores, BASE_FEATURES);
    expect(result.adjustedScores.ask_clarification).toBeLessThan(0.75);
    expect(result.adjustedScores.ask_clarification).toBe(0.75 * (1 - DEFAULT_GATING_CONFIG.clarification_cost_weight));
    // 验证 penalty 被记录
    const penalty = result.policyOverrides.find((o) => o.rule === "clarification_cost_penalty");
    expect(penalty).toBeDefined();
    expect(penalty?.original_score).toBe(0.75);
    expect(penalty?.adjusted_score).toBe(0.75 * (1 - DEFAULT_GATING_CONFIG.clarification_cost_weight));
  });

  it("缺信息时 delegate 被惩罚", () => {
    const features_missing = { ...BASE_FEATURES, missing_info: true };
    // 0.9 penalty → 0.9 * 0.5 = 0.45 < 0.72 threshold → 0
    const scores = { direct_answer: 0.3, ask_clarification: 0.5, delegate_to_slow: 0.9, execute_task: 0.1 };
    const result = calibrateWithPolicy(scores, features_missing);
    expect(result.adjustedScores.delegate_to_slow).toBeLessThan(0.9);
  });

  it("模糊时 ask_clarification 被 boost", () => {
    const features_vague = { ...BASE_FEATURES, query_too_vague: true };
    const scores = { direct_answer: 0.3, ask_clarification: 0.7, delegate_to_slow: 0.2, execute_task: 0.1 };
    const result = calibrateWithPolicy(scores, features_vague);
    // boost 后 clarification 应该高于 boost 前（0.7 penalty后=0.595，boost后=0.745）
    expect(result.adjustedScores.ask_clarification).toBeGreaterThan(0.595);
  });

  it("低于阈值的动作被置零", () => {
    const scores = { direct_answer: 0.3, ask_clarification: 0.3, delegate_to_slow: 0.5, execute_task: 0.1 };
    const result = calibrateWithPolicy(scores, BASE_FEATURES);
    expect(result.adjustedScores.direct_answer).toBe(0);
    expect(result.adjustedScores.ask_clarification).toBe(0);
  });

  it("返回 policyOverrides 记录", () => {
    const features_missing = { ...BASE_FEATURES, missing_info: true };
    const scores = { direct_answer: 0.3, ask_clarification: 0.5, delegate_to_slow: 0.7, execute_task: 0.85 };
    const result = calibrateWithPolicy(scores, features_missing);
    expect(result.policyOverrides.length).toBeGreaterThan(0);
    expect(result.policyOverrides[0].original_score).toBeDefined();
    expect(result.policyOverrides[0].adjusted_score).toBeDefined();
    expect(result.policyOverrides[0].rule).toBeDefined();
  });

  it("policyOverrides 为空时 finalAction 仍有效", () => {
    const scores = { direct_answer: 0.3, ask_clarification: 0.2, delegate_to_slow: 0.85, execute_task: 0.1 };
    const result = calibrateWithPolicy(scores, BASE_FEATURES);
    expect(result.finalAction).toBe("delegate_to_slow");
  });
});

// ── G3: delegation-reranker ───────────────────────────────────────────────────

describe("G3: shouldRerank", () => {
  it("top gap小时触发 rerank（gray zone conf=0.60 跳过）", () => {
    // conf=0.60 处于灰区下界（0.60 ≤ 0.60 < 0.70），delegate_to_slow 不 rerank
    const scores = { direct_answer: 0.49, ask_clarification: 0.45, delegate_to_slow: 0.52, execute_task: 0.1 };
    expect(shouldRerank(scores, 0.60, "delegate_to_slow").should).toBe(false);
  });

  it("低置信度（<0.60）触发 rerank", () => {
    // conf=0.5 低于 base threshold，不在 gray zone，正常触发
    const scores = { direct_answer: 0.3, ask_clarification: 0.2, delegate_to_slow: 0.85, execute_task: 0.1 };
    expect(shouldRerank(scores, 0.5, "delegate_to_slow").should).toBe(true);
  });

  it("高成本动作+灰区置信度（0.60≤conf<0.70）不触发 rerank", () => {
    // conf=0.68 在灰区，delegate_to_slow 不 rerank
    const scores = { direct_answer: 0.2, ask_clarification: 0.2, delegate_to_slow: 0.8, execute_task: 0.1 };
    expect(shouldRerank(scores, 0.68, "delegate_to_slow").should).toBe(false);
  });

  it("gap大+高置信度（≥0.70）不触发 rerank", () => {
    // conf=0.85 超出灰区，gap 大，正常不触发
    const scores = { direct_answer: 0.3, ask_clarification: 0.2, delegate_to_slow: 0.85, execute_task: 0.1 };
    expect(shouldRerank(scores, 0.85, "delegate_to_slow").should).toBe(false);
  });

  it("execute_task 在灰区（0.60≤conf<0.70）仍触发 rerank（灰区仅适用于 delegate_to_slow）", () => {
    // execute_task 不在 gray zone，仍然走普通高成本逻辑
    const scores = { direct_answer: 0.2, ask_clarification: 0.2, delegate_to_slow: 0.2, execute_task: 0.75 };
    expect(shouldRerank(scores, 0.68, "execute_task").should).toBe(true); // 0.68 < 0.70
  });

  it("delegate_to_slow 在灰区上界 conf=0.70 不触发（gray zone 左闭右开）", () => {
    // conf=0.70 < 0.70 不成立，gray zone 不触发，但 conf=0.70 >= 0.60，conf 条件不触发，
    // gap 大 → 最终不触发 rerank
    const scores = { direct_answer: 0.3, ask_clarification: 0.2, delegate_to_slow: 0.85, execute_task: 0.1 };
    expect(shouldRerank(scores, 0.70, "delegate_to_slow").should).toBe(false);
  });
});

describe("G3: ruleBasedRerank", () => {
  it("缺信息时 delegate+clarification 接近则降级到 clarification", () => {
    const features_missing = { ...BASE_FEATURES, missing_info: true };
    const scores = { direct_answer: 0.2, ask_clarification: 0.7, delegate_to_slow: 0.72, execute_task: 0.1 };
    const result = ruleBasedRerank(scores, features_missing, "delegate_to_slow");
    expect(result.reranked).toBe(true);
    expect(result.finalAction).toBe("ask_clarification");
  });

  it("问题明确时 delegate+direct 接近则降级到 direct_answer", () => {
    const scores = { direct_answer: 0.68, ask_clarification: 0.2, delegate_to_slow: 0.7, execute_task: 0.1 };
    const result = ruleBasedRerank(scores, BASE_FEATURES, "delegate_to_slow");
    expect(result.reranked).toBe(true);
    expect(result.finalAction).toBe("direct_answer");
  });

  it("execute_task 无匹配规则，保持 execute_task（Rule 3 已删除）", () => {
    // Rule 3 已删除：execute_task 的降级由 shouldRerank 的阈值过滤控制，
    // ruleBasedRerank 不主动降级 execute_task（避免误伤复杂代码任务）。
    const scores = { direct_answer: 0.3, ask_clarification: 0.2, delegate_to_slow: 0.2, execute_task: 0.75 };
    const result = ruleBasedRerank(scores, BASE_FEATURES, "execute_task");
    expect(result.finalAction).toBe("execute_task");
  });

  it("无匹配规则时保持原选", () => {
    const scores = { direct_answer: 0.3, ask_clarification: 0.2, delegate_to_slow: 0.85, execute_task: 0.1 };
    const result = ruleBasedRerank(scores, BASE_FEATURES, "delegate_to_slow");
    expect(result.reranked).toBe(true);
    expect(result.finalAction).toBe("delegate_to_slow");
  });
});
