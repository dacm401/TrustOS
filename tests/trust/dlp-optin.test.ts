/**
 * TRST-4F R1 红线重设 — Opt-in Pattern DLP test.
 *
 * 原 TRST-0.3 R1 "No DLP detection" 已放宽为企业可选能力。
 * 本测试验证：当 config.permission.dlpEnabled=true 时，4F 的 buildEngine
 * 注入的模式 DLP 规则（DEFAULT_POLICY_RULES）能在 dry_run 影子窗口采集
 * PII 分歧信号（strictly_private → deny，confidential → ask_user），
 * 且不依赖任何语义模型。
 *
 * 由于 4F engine 是模块级单例，这里直接验证 DLP 规则集与分类器组件，
 * 确认 opt-in 路径可用。
 */

import { describe, it, expect } from "vitest";
import { DEFAULT_POLICY_RULES, createDefaultPolicyEngine } from "../../src/trust/policy-rules.js";
import { inferClassification } from "../../src/trust/policy-engine.js";
import { getStrictlyPrivateFields } from "../../src/trust/field-classification.js";
import type { PolicyCheckRequest } from "../../src/trust/policy-engine.js";

describe("R1 opt-in pattern DLP", () => {
  it("DEFAULT_POLICY_RULES exists and contains a strictly_private deny rule", () => {
    expect(DEFAULT_POLICY_RULES.length).toBeGreaterThan(0);
    const deny = DEFAULT_POLICY_RULES.find((r) => r.id === "strictly-private-no-cloud");
    expect(deny).toBeDefined();
    expect(deny!.decision.decision).toBe("deny");
  });

  it("createDefaultPolicyEngine evaluates strictly_private → deny (no semantic model)", () => {
    const engine = createDefaultPolicyEngine();
    // source 指向已标注 strictly_private 字段（memory_entries.user_id）
    const req: PolicyCheckRequest = {
      data: { key: "AKIA-XXXX-SECRET" },
      dataType: "user_message",
      recipient: "external_api",
      userId: "u1",
      sessionId: "s1",
      source: "memory_entries.user_id",
    };
    const res = engine.check(req);
    expect(res.decision).toBe("deny");
  });

  it("createDefaultPolicyEngine evaluates confidential → ask_user (advisory, not block)", () => {
    const engine = createDefaultPolicyEngine();
    // source 指向已标注 confidential 字段（task_commands.task）
    const req: PolicyCheckRequest = {
      data: { msg: "user preference summary" },
      dataType: "user_message",
      recipient: "slow_worker",
      userId: "u1",
      sessionId: "s1",
      source: "task_commands.task",
    };
    const res = engine.check(req);
    expect(res.decision).toBe("ask_user");
  });

  it("inferClassification detects PII patterns from field path without external model", () => {
    const apiKey = inferClassification(["user_api_key"], "xxxx");
    expect(apiKey).toBe("strictly_private");
    const pref = inferClassification(["user_preference_summary"], "xxxx");
    expect(pref).toBe("confidential");
    const plain = inferClassification(["task_status"], "xxxx");
    expect(plain).not.toBe("strictly_private");
  });

  it("field-classification marks known PII columns as strictly_private", () => {
    const fields = getStrictlyPrivateFields();
    expect(fields).toContain("memory_entries.user_id");
    expect(fields).toContain("decision_logs.user_id");
  });
});
