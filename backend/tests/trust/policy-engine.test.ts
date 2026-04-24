/**
 * TrustPolicy Engine — 单元测试
 *
 * 覆盖：TrustPolicyEngine.check()、checkAll()、SourceBasedClassifier、
 * inferClassification()、默认规则集
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  TrustPolicyEngine,
  SourceBasedClassifier,
  inferClassification,
  defaultClassificationForDataType,
  type PolicyCheckRequest,
  type DataClassification,
  type PolicyDecision,
} from "../../src/trust/policy-engine.js";
import {
  DEFAULT_POLICY_RULES,
  RULE_STRICTLY_PRIVATE_NO_CLOUD,
  RULE_CONFIDENTIAL_CLOUD需CONFIRM,
  RULE_INTERNAL_ALLOW,
} from "../../src/trust/policy-rules.js";

// ── 测试辅助 ──────────────────────────────────────────────────────────────────

function makeRequest(overrides: Partial<PolicyCheckRequest> = {}): PolicyCheckRequest {
  return {
    data: {},
    dataType: "command",
    recipient: "slow_worker",
    userId: "user-1",
    sessionId: "sess-1",
    ...overrides,
  };
}

// ── TrustPolicyEngine 核心测试 ────────────────────────────────────────────────

describe("TrustPolicyEngine", () => {
  describe("check()", () => {
    it("无规则时默认 deny（fail-closed）", () => {
      const engine = new TrustPolicyEngine([]);
      const result = engine.check(makeRequest({ dataType: "command" }));
      expect(result.decision).toBe("deny");
    });

    it("无规则时配置 failOpen=true 则返回 allow", () => {
      const engine = new TrustPolicyEngine([], undefined, { failOpen: true });
      const result = engine.check(makeRequest({ dataType: "command" }));
      expect(result.decision).toBe("allow");
    });

    it("按规则注册顺序，第一个匹配规则决定结果", () => {
      const engine = new TrustPolicyEngine([
        { id: "r1", description: "", condition: () => true, decision: "allow" },
        { id: "r2", description: "", condition: () => true, decision: "deny" },
      ]);
      const result = engine.check(makeRequest());
      expect(result.decision).toBe("allow");
      expect(result.ruleId).toBe("r1");
    });

    it("规则 condition 抛异常时跳过该规则，继续评估下一条", () => {
      const engine = new TrustPolicyEngine([
        { id: "r1", description: "", condition: () => { throw new Error("boom"); }, decision: "deny" },
        { id: "r2", description: "", condition: () => true, decision: "allow" },
      ]);
      const result = engine.check(makeRequest());
      expect(result.decision).toBe("allow");
      expect(result.ruleId).toBe("r2");
    });

    it("返回结果包含 ruleId 和 classification", () => {
      const engine = new TrustPolicyEngine([
        RULE_INTERNAL_ALLOW,
      ]);
      const result = engine.check(makeRequest({ dataType: "command" }));
      expect(result.ruleId).toBe("internal-allow");
      expect(result.classification).toBe("internal");
    });

    it("deny 决策包含 reason 字段", () => {
      const engine = new TrustPolicyEngine([
        RULE_STRICTLY_PRIVATE_NO_CLOUD,
      ]);
      const result = engine.check(makeRequest({
        dataType: "memory",
        recipient: "slow_worker",
      }));
      expect(result.decision).toBe("deny");
      expect(result.reason).toBeDefined();
      expect(result.reason!.length).toBeGreaterThan(0);
    });

    it("ask_user 决策包含 prompt 字段", () => {
      const engine = new TrustPolicyEngine([
        RULE_CONFIDENTIAL_CLOUD需CONFIRM,
      ]);
      const result = engine.check(makeRequest({
        dataType: "user_message",
        recipient: "slow_worker",
      }));
      expect(result.decision).toBe("ask_user");
      expect(result.prompt).toBeDefined();
    });

    it("verbose 模式打印日志", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const engine = new TrustPolicyEngine([], undefined, { verbose: true });
      engine.check(makeRequest({ dataType: "command" }));
      // fail-closed 无匹配时会打印 deny 日志（因为 failOpen=false 无规则时 deny）
      // 只验证不抛异常
      consoleSpy.mockRestore();
    });
  });

  describe("checkAll()", () => {
    it("批量评估返回每个请求的结果数组", () => {
      const engine = new TrustPolicyEngine([
        RULE_INTERNAL_ALLOW,
      ]);
      const requests = [
        makeRequest({ dataType: "command" }),
        makeRequest({ dataType: "task_archive" }),
      ];
      const results = engine.checkAll(requests);
      expect(results).toHaveLength(2);
      expect(results[0].decision).toBe("allow");
      expect(results[1].decision).toBe("allow");
    });

    it("批量评估遇到 deny 时不提前退出", () => {
      const engine = new TrustPolicyEngine([
        RULE_STRICTLY_PRIVATE_NO_CLOUD,
        RULE_INTERNAL_ALLOW,
      ]);
      const requests = [
        makeRequest({ dataType: "memory", recipient: "slow_worker" }), // → deny
        makeRequest({ dataType: "command" }),                           // → allow
      ];
      const results = engine.checkAll(requests);
      expect(results[0].decision).toBe("deny");
      expect(results[1].decision).toBe("allow");
    });
  });

  describe("addRule() / clearRules()", () => {
    it("addRule 追加新规则", () => {
      const engine = new TrustPolicyEngine([RULE_INTERNAL_ALLOW]);
      engine.addRule(RULE_STRICTLY_PRIVATE_NO_CLOUD);
      // memory → defaultClassification = confidential → not internal → RULE_INTERNAL_ALLOW doesn't match
      // So RULE_STRICTLY_PRIVATE_NO_CLOUD won't match either (requires strictly_private)
      // Use a custom rule that matches memory
      engine.addRule({
        id: "memory-deny",
        description: "",
        condition: (req) => req.dataType === "memory",
        decision: "deny",
      });
      const result = engine.check(makeRequest({ dataType: "memory" }));
      expect(result.decision).toBe("deny");
      expect(result.ruleId).toBe("memory-deny");
    });

    it("clearRules 清空所有规则", () => {
      const engine = new TrustPolicyEngine([RULE_INTERNAL_ALLOW]);
      engine.clearRules();
      const result = engine.check(makeRequest({ dataType: "command" }));
      expect(result.decision).toBe("deny"); // fail-closed
    });
  });
});

// ── SourceBasedClassifier 测试 ────────────────────────────────────────────────

describe("SourceBasedClassifier", () => {
  it("按 source 字段返回对应分类", () => {
    const classifier = new SourceBasedClassifier({
      "task_commands.user_preference_summary": "strictly_private",
      "task_commands.task": "internal",
    });
    const result = classifier.getClassification(
      makeRequest({ source: "task_commands.user_preference_summary" })
    );
    expect(result).toBe("strictly_private");
  });

  it("无对应 source 时按 dataType 推断", () => {
    const classifier = new SourceBasedClassifier();
    const result = classifier.getClassification(
      makeRequest({ dataType: "memory", source: undefined })
    );
    expect(result).toBe("confidential");
  });

  it("addRule 追加规则", () => {
    const classifier = new SourceBasedClassifier();
    classifier.addRule("custom.field", "confidential");
    const result = classifier.getClassification(
      makeRequest({ source: "custom.field" })
    );
    expect(result).toBe("confidential");
  });
});

// ── inferClassification 测试 ───────────────────────────────────────────────────

describe("inferClassification()", () => {
  it("password / token / apikey → strictly_private", () => {
    expect(inferClassification(["user", "password"], "")).toBe("strictly_private");
    expect(inferClassification(["api", "api_key"], "")).toBe("strictly_private");
    expect(inferClassification(["auth", "token"], "")).toBe("strictly_private");
  });

  it("email / phone → strictly_private", () => {
    expect(inferClassification(["user", "email"], "")).toBe("strictly_private");
    expect(inferClassification(["contact", "phone"], "")).toBe("strictly_private");
  });

  it("preference / bias → confidential", () => {
    expect(inferClassification(["user", "preference"], "")).toBe("confidential");
    expect(inferClassification(["settings", "bias"], "")).toBe("confidential");
    expect(inferClassification(["profile", "personal"], "")).toBe("confidential");
  });

  it("result / summary / analysis → internal（作为路径片段时）", () => {
    expect(inferClassification(["task_result"], "")).toBe("internal");
    expect(inferClassification(["output_summary"], "")).toBe("internal");
    expect(inferClassification(["analysis_field"], "")).toBe("internal");
  });

  it("纯字段名 result → public", () => {
    expect(inferClassification(["result"], "")).toBe("public");
    expect(inferClassification(["status"], "")).toBe("public");
    expect(inferClassification(["type"], "")).toBe("public");
    expect(inferClassification(["id"], "")).toBe("public");
  });

  it("未知字段默认 internal", () => {
    expect(inferClassification(["custom", "data"], "")).toBe("internal");
    expect(inferClassification(["field", "xyz"], "")).toBe("internal");
  });
});

// ── defaultClassificationForDataType 测试 ────────────────────────────────────

describe("defaultClassificationForDataType()", () => {
  it("user_message → confidential", () => {
    expect(defaultClassificationForDataType("user_message")).toBe("confidential");
  });
  it("memory → confidential", () => {
    expect(defaultClassificationForDataType("memory")).toBe("confidential");
  });
  it("command → internal", () => {
    expect(defaultClassificationForDataType("command")).toBe("internal");
  });
  it("task_archive → internal", () => {
    expect(defaultClassificationForDataType("task_archive")).toBe("internal");
  });
  it("result → internal", () => {
    expect(defaultClassificationForDataType("result")).toBe("internal");
  });
});

// ── 默认规则集测试 ────────────────────────────────────────────────────────────

describe("默认规则集（DEFAULT_POLICY_RULES）", () => {
  const engine = new TrustPolicyEngine(DEFAULT_POLICY_RULES);

  it("strictly_private → slow_worker → deny", () => {
    const classifier = new SourceBasedClassifier();
    classifier.addRule("test.field", "strictly_private");
    const policy = new TrustPolicyEngine(DEFAULT_POLICY_RULES, classifier);

    const result = policy.check(makeRequest({
      dataType: "memory",
      recipient: "slow_worker",
      source: "test.field",
    }));
    expect(result.decision).toBe("deny");
  });

  it("confidential → slow_worker → ask_user", () => {
    const result = engine.check(makeRequest({
      dataType: "user_message",
      recipient: "slow_worker",
    }));
    expect(result.decision).toBe("ask_user");
  });

  it("internal → slow_worker → allow", () => {
    const result = engine.check(makeRequest({
      dataType: "command",
      recipient: "slow_worker",
    }));
    expect(result.decision).toBe("allow");
  });

  it("result → user → allow（无隐私风险）", () => {
    const result = engine.check(makeRequest({
      dataType: "result",
      recipient: "user",
    }));
    expect(result.decision).toBe("allow");
  });

  it("fast_manager → 无需检查，直接 allow", () => {
    const result = engine.check(makeRequest({
      recipient: "fast_manager",
    }));
    expect(result.decision).toBe("allow");
  });

  it("external_api → ask_user", () => {
    const result = engine.check(makeRequest({
      recipient: "external_api",
    }));
    expect(result.decision).toBe("ask_user");
    expect(result.prompt).toContain("外部服务");
  });

  it("confidential → user → deny（fail-closed，无明确放行规则）", () => {
    const result = engine.check(makeRequest({
      dataType: "memory",
      recipient: "user",
    }));
    // 默认 deny（fail-closed），因为没有明确规则放行 confidential → user
    expect(result.decision).toBe("deny");
  });
});
