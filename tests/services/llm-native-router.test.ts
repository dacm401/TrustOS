/**
 * llm-native-router.ts — parseGatedDecision 单元测试
 *
 * T-01: 覆盖核心 JSON 解析与降级逻辑
 * - 无 JSON / 损坏 JSON → null（降级到 direct_answer）
 * - schema_version 缺失/未知 → throw PROTOCOL_VIOLATION（R-07 修复）
 * - 有效 v4/v3 JSON → GatedDelegationContext
 * - 边界值（confidence 超范围、features 缺失等）
 *
 * 注意：routeWithManagerDecision 的 mock 测试通过 API 集成测试覆盖
 * （tests/api/chat.test.ts），避免复杂的模块 mock。
 */

import { describe, it, expect } from "vitest";
import { parseGatedDecision } from "../../src/services/llm-native-router.js";

// ── 辅助：构造合法 v4 JSON 字符串 ────────────────────────────────────────

function makeV4Json(overrides: Record<string, any> = {}): string {
  return JSON.stringify({
    schema_version: "manager_decision_v4",
    scores: {
      direct_answer: 0.1,
      ask_clarification: 0.05,
      delegate_to_slow: 0.85,
      execute_task: 0.05,
    },
    confidence_hint: 0.82,
    features: {},
    ...overrides,
  });
}

// ── 降级路径测试 ────────────────────────────────────────────────────────────

describe("parseGatedDecision: 降级路径（返回 null 或 throw）", () => {
  it("TR-01: 纯文本无 JSON → 返回 null", () => {
    const result = parseGatedDecision("这是一个普通的回答，没有任何 JSON。");
    expect(result).toBeNull();
  });

  it("TR-02: JSON 格式损坏（缺逗号）→ PROTOCOL_VIOLATION → throw", () => {
    const broken = '```json\n{"scores": {"direct_answer": 0.9 "delegate_to_slow": 0.05}}\n```';
    expect(() => parseGatedDecision(broken)).toThrow("PROTOCOL_VIOLATION");
  });

  it("TR-03: schema_version 缺失 → PROTOCOL_VIOLATION → throw", () => {
    const noVersion = JSON.stringify({
      scores: { direct_answer: 0.9, ask_clarification: 0.05, delegate_to_slow: 0.05, execute_task: 0.05 },
      confidence_hint: 0.85,
    });
    // 需要包裹在 ```json 块中才会被解析
    expect(() =>
      parseGatedDecision(`\`\`\`json\n${noVersion}\n\`\`\``)
    ).toThrow("PROTOCOL_VIOLATION: schema_version missing");
  });

  it("TR-04: schema_version 非法 → PROTOCOL_VIOLATION → throw", () => {
    expect(() =>
      parseGatedDecision(makeV4Json({ schema_version: "manager_decision_v99" }))
    ).toThrow("PROTOCOL_VIOLATION: unknown schema_version");
  });

  it("TR-05: 裸 JSON（无 ```json 包裹）且无 schema_version → PROTOCOL_VIOLATION → throw", () => {
    expect(() =>
      parseGatedDecision('{"scores": {"direct_answer": 0.7}}')
    ).toThrow("PROTOCOL_VIOLATION: schema_version missing");
  });
});

// ── 正常解析路径 ────────────────────────────────────────────────────────────

describe("parseGatedDecision: 正常解析路径", () => {
  it("TR-06: 有效 v4 JSON → 返回 GatedDelegationContext", () => {
    const json = makeV4Json();
    const result = parseGatedDecision(`好的，我来处理。\n\`\`\`json\n${json}\n\`\`\``);
    expect(result).not.toBeNull();
    expect(result!.routedAction).toBe("delegate_to_slow");
    expect(result!.llmScores.delegate_to_slow).toBeCloseTo(0.85);
  });

  it("TR-07: 有效 v3 JSON → 仍然能解析（向后兼容）", () => {
    const v3 = JSON.stringify({
      schema_version: "manager_decision_v3",
      scores: {
        direct_answer: 0.1,
        ask_clarification: 0.05,
        delegate_to_slow: 0.85,
        execute_task: 0.05,
      },
      confidence_hint: 0.82,
    });
    const result = parseGatedDecision(`好的，正在为您分析...\n\`\`\`json\n${v3}\n\`\`\``);
    expect(result).not.toBeNull();
    expect(result!.routedAction).toBe("delegate_to_slow");
    expect(result!.llmScores.delegate_to_slow).toBe(0.85);
  });

  it("TR-08: v4 JSON → 正确解析 routedAction 和 calibratedScores", () => {
    const json = makeV4Json();
    const result = parseGatedDecision(`好的，正在分析...\n\`\`\`json\n${json}\n\`\`\``);
    expect(result).not.toBeNull();
    expect(result!.routedAction).toBe("delegate_to_slow");
    expect(typeof result!.systemConfidence).toBe("number");
    expect(typeof result!.calibratedScores.delegate_to_slow).toBe("number");
  });
});

// ── 边界值测试 ──────────────────────────────────────────────────────────────

describe("parseGatedDecision: 边界值", () => {
  it("TR-10: confidence_hint > 1 → 被 clamp 到 [0, 1]", () => {
    const json = makeV4Json({ confidence_hint: 1.5 });
    const result = parseGatedDecision(`\`\`\`json\n${json}\n\`\`\``);
    expect(result).not.toBeNull();
    expect(result!.llmConfidenceHint).toBeLessThanOrEqual(1);
    expect(result!.llmConfidenceHint).toBeGreaterThanOrEqual(0);
  });

  it("TR-11: confidence_hint < 0 → 被 clamp 到 [0, 1]", () => {
    const json = makeV4Json({ confidence_hint: -0.5 });
    const result = parseGatedDecision(`\`\`\`json\n${json}\n\`\`\``);
    expect(result).not.toBeNull();
    expect(result!.llmConfidenceHint).toBeGreaterThanOrEqual(0);
  });

  it("TR-12: features 缺失字段 → 默认 false", () => {
    const json = makeV4Json({ features: undefined });
    const result = parseGatedDecision(`\`\`\`json\n${json}\n\`\`\``);
    expect(result).not.toBeNull();
    // 当 features 缺失时，system-confidence.ts 里各检测函数返回 false
    expect(result!.features).toBeDefined();
  });

  it("TR-13: routedAction 总是四种合法值之一（全零分兜底）", () => {
    const allZeros = makeV4Json({
      scores: { direct_answer: 0, ask_clarification: 0, delegate_to_slow: 0, execute_task: 0 },
    });
    const result = parseGatedDecision(`\`\`\`json\n${allZeros}\n\`\`\``);
    expect(result).not.toBeNull();
    expect(["direct_answer", "ask_clarification", "delegate_to_slow", "execute_task"]).toContain(
      result!.routedAction
    );
  });
});

// ── KB 信号集成（轻量）─────────────────────────────────────────────────────

describe("parseGatedDecision: KB 信号影响（轻量集成）", () => {
  it("TR-14: 传入 kbSignals 不影响解析成功", () => {
    const json = makeV4Json();
    const result = parseGatedDecision(`\`\`\`json\n${json}\n\`\`\``, [
      { type: "current_price_query", matched_pattern: "实时股价" },
    ]);
    expect(result).not.toBeNull();
    expect(result!.systemConfidence).toBeTypeOf("number");
  });
});
