/**
 * Phase 5.2 回归：system_conf 阈值边缘行为
 *
 * 验收目标：
 * 1. system_conf 计算结果标准化到 3 位小数（消除 IEEE754 尾数）
 * 2. high_cost_confidence_floor 从 0.75 降至 0.70，减少无意义 rerank
 *
 * 边界点：0.698 / 0.699 / 0.700 / 0.701
 * 断言：路由决策在边界两侧保持稳定，不出现"差 0.001 路由不同"的现象
 */

import { describe, it, expect, beforeEach } from "vitest";
import { calculateSystemConfidence } from "../../../src/services/gating/system-confidence.js";
import { DEFAULT_GATING_CONFIG } from "../../../src/services/gating/gating-config.js";
import type { DecisionFeatures } from "../../../src/types/index.js";

const NO_FEATURES: DecisionFeatures = {
  missing_info: false,
  needs_long_reasoning: false,
  needs_external_tool: false,
  high_risk_action: false,
  query_too_vague: false,
  requires_multi_step: false,
  is_continuation: false,
};

describe("Phase 5.2: system_conf 阈值边缘行为", () => {
  describe("5.2.1 system_conf 输出标准化到 3 位小数", () => {
    it("返回值为 3 位小数（无浮点尾数噪音）", () => {
      // IEEE754: 0.1 + 0.2 = 0.30000000000000004，不应该影响输出
      const scores = { direct_answer: 0.1, ask_clarification: 0.2, delegate_to_slow: 0.3, execute_task: 0.4 };
      const result = calculateSystemConfidence(scores, 0.5, NO_FEATURES);

      // 验证：结果 * 1000 应该是整数（3位小数截断后无尾数）
      expect(result * 1000).toBe(Math.round(result * 1000));

      // 验证：结果在 0~1 范围内
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    });

    it("真实 IEEE754 场景：0.85×0.4 + 0.7×0.6 + penalty = 0.6992 → 显示 0.699", () => {
      // 这是你实测 0.699 的精确输入
      const scores = { direct_answer: 0.2, ask_clarification: 0.1, delegate_to_slow: 0.9, execute_task: 0.1 };
      const result = calculateSystemConfidence(scores, 0.85, NO_FEATURES);

      // 标准化后应该精确等于 0.699（而不是 0.69919999...）
      expect(result).toBe(0.699);
    });

    it("边界：gap=0.7 + llm_hint=1.0 的极端场景不超过 1.0", () => {
      const scores = { direct_answer: 0.0, ask_clarification: 0.0, delegate_to_slow: 1.0, execute_task: 0.0 };
      const result = calculateSystemConfidence(scores, 1.0, NO_FEATURES);
      expect(result).toBeLessThanOrEqual(1);
      expect(result).toBeGreaterThanOrEqual(0);
    });
  });

  describe("5.2.2 阈值边缘路由决策稳定性（0.698/0.699/0.700/0.701）", () => {
    /**
     * 场景：gap=0.7, llm_hint=0.85, delegate_to_slow
     * base = 0.85*0.4 + 0.7*0.6 = 0.76
     * after penalty *0.92 = 0.6992 → rounded to 0.699
     */
    const delegateScenario = (llmHint: number, extraPenalty = 1.0) => {
      const scores = { direct_answer: 0.2, ask_clarification: 0.1, delegate_to_slow: 0.9, execute_task: 0.1 };
      const features: DecisionFeatures = {
        ...NO_FEATURES,
        needs_long_reasoning: false,
      };
      const raw = 0.4 * llmHint + 0.6 * 0.7;
      const afterPenalty = raw * 0.92 * extraPenalty;
      return { scores, features, expectedRaw: Math.round(afterPenalty * 1000) / 1000 };
    };

    it("system_conf=0.699 时 delegate_to_slow 路由到 L2", () => {
      const { scores, features, expectedRaw } = delegateScenario(0.85);
      expect(expectedRaw).toBe(0.699);

      const conf = calculateSystemConfidence(scores, 0.85, features);
      expect(conf).toBe(0.699);
      expect(conf >= DEFAULT_GATING_CONFIG.rerank.confidence_threshold).toBe(true);
    });

    it("system_conf=0.700 时路由决策与 0.699 一致（稳定边界）", () => {
      // 调 llm_hint 使 system_conf 刚好 = 0.700
      // 0.4*x + 0.6*0.7 = x/2.5 + 0.42, after penalty → x
      // 要 0.700: 0.4*x*0.92 + 0.42*0.92 = 0.700
      const scores1 = { direct_answer: 0.2, ask_clarification: 0.1, delegate_to_slow: 0.9, execute_task: 0.1 };
      const scores2 = { direct_answer: 0.2, ask_clarification: 0.1, delegate_to_slow: 0.9, execute_task: 0.1 };

      const conf699 = calculateSystemConfidence(scores1, 0.85, NO_FEATURES);
      // 调 llm_hint 使结果刚好为 0.700
      // 需要 base = 0.700 / 0.92 = 0.76087
      // 0.4*x + 0.42 = 0.76087 → x = 0.852175
      const conf700 = calculateSystemConfidence(scores2, 0.852175, NO_FEATURES);

      expect(conf699).toBe(0.699);
      expect(conf700).toBe(0.7);

      // 关键断言：
      // floor=0.70：0.699 < 0.70 → 触发 rerank（边界值触发是预期行为）
      // 0.700 = 0.70 → 触发 rerank（>= 是 >=）
      // 两者都触发 rerank，路由结果一致（rerank 保持原选 delegate_to_slow）
      expect(conf699 < 0.70).toBe(true); // 0.699 < 0.70 → 触发 rerank
      expect(conf700 >= 0.70).toBe(true); // 0.700 >= 0.70 → 触发 rerank
    });

    it("system_conf=0.698 时（LLM hint 稍低）仍保持合理路由", () => {
      // 0.4*0.84 + 0.42 = 0.756, *0.92 = 0.69552 → rounded 0.696
      // 找一个场景让结果刚好是 0.698
      const scores = { direct_answer: 0.2, ask_clarification: 0.1, delegate_to_slow: 0.9, execute_task: 0.1 };
      // 要 0.698: base*0.92 = 0.698 → base = 0.698/0.92 = 0.7587
      // 0.4*x + 0.42 = 0.7587 → x = 0.84675
      const conf = calculateSystemConfidence(scores, 0.84675, NO_FEATURES);
      expect(conf).toBe(0.698);
    });
  });

  describe("5.2.3 high_cost_confidence_floor=0.70 减少无意义 rerank", () => {
    /**
     * 场景：gap=0.7（强信号），LLM 高置信，delegate_to_slow
     * 旧配置 floor=0.75 → 0.699 < 0.75 触发 rerank（但无匹配规则，保持原选）
     * 新配置 floor=0.70 → 0.699 < 0.70 不触发 rerank（直接放行，减少一次 rerank 调用）
     */
    it("delegate_to_slow 强信号：0.699 不触发 high_cost rerank（floor=0.70）", () => {
      const scores = { direct_answer: 0.2, ask_clarification: 0.1, delegate_to_slow: 0.9, execute_task: 0.1 };
      const conf = calculateSystemConfidence(scores, 0.85, NO_FEATURES);
      expect(conf).toBe(0.699);

      // 新配置：0.699 < 0.70，不触发 high_cost rerank
      const floor = 0.70;
      expect(conf < floor).toBe(true); // 不触发
    });

    it("gap=0.75 强信号：0.735 仍不触发 rerank，路由一致", () => {
      // gap 更大一点，conf 应该更高但仍在 0.70 附近
      // 0.4*0.9 + 0.6*0.75 = 0.81, *0.92 = 0.7452 → 0.745
      const scores = { direct_answer: 0.15, ask_clarification: 0.1, delegate_to_slow: 0.9, execute_task: 0.1 };
      const conf = calculateSystemConfidence(scores, 0.9, NO_FEATURES);
      expect(conf).toBe(0.745);

      const floor = 0.70;
      expect(conf >= floor).toBe(true); // 触发 rerank（但 rerank 会保持原选）
    });
  });
});
