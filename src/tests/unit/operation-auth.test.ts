/**
 * Sprint 65 — Operation Authorization Matrix Tests
 */

import { describe, it, expect } from "vitest";
import {
  OperationType,
  detectOperationType,
  validateWithAuthMatrix,
  requiresSlow,
  requiresPermission,
  OPERATION_MATRIX,
} from "../../services/operation-auth-matrix.js";
import type { DecisionFeatures } from "../../types/index.js";

const baseFeatures: DecisionFeatures = {
  missing_info: false,
  needs_long_reasoning: false,
  needs_external_tool: false,
  high_risk_action: false,
  query_too_vague: false,
  requires_multi_step: false,
  is_continuation: false,
};

describe("OPERATION_MATRIX", () => {
  it("should cover all OperationType variants", () => {
    const types = Object.values(OperationType);
    types.forEach((t) => {
      expect(OPERATION_MATRIX[t]).toBeDefined();
    });
  });
});

describe("detectOperationType", () => {
  it("detects WEB_SEARCH when needs_external_tool + search keywords", () => {
    const f = { ...baseFeatures, needs_external_tool: true };
    const t = detectOperationType(f, "帮我搜索一下最新的 AI 新闻");
    expect(t).toBe(OperationType.WEB_SEARCH);
  });

  it("detects CODE_EXECUTION when needs_external_tool + run keywords", () => {
    const f = { ...baseFeatures, needs_external_tool: true };
    const t = detectOperationType(f, "帮我运行这段代码");
    expect(t).toBe(OperationType.CODE_EXECUTION);
  });

  it("detects FINANCIAL_OP when high_risk + financial keywords", () => {
    const f = { ...baseFeatures, high_risk_action: true };
    const t = detectOperationType(f, "帮我转账给朋友");
    expect(t).toBe(OperationType.FINANCIAL_OP);
  });

  it("detects HIGH_RISK when high_risk flag without specific category", () => {
    const f = { ...baseFeatures, high_risk_action: true };
    const t = detectOperationType(f, "修改我的账户设置");
    expect(t).toBe(OperationType.HIGH_RISK);
  });

  it("detects CROSS_SESSION when is_continuation", () => {
    const f = { ...baseFeatures, is_continuation: true };
    const t = detectOperationType(f, "继续上次的任务");
    expect(t).toBe(OperationType.CROSS_SESSION);
  });

  it("detects MULTI_STEP when requires_multi_step", () => {
    const f = { ...baseFeatures, requires_multi_step: true };
    const t = detectOperationType(f, "帮我完成这个复杂的多步骤任务");
    expect(t).toBe(OperationType.MULTI_STEP);
  });

  it("detects DEEP_REASONING when needs_long_reasoning", () => {
    const f = { ...baseFeatures, needs_long_reasoning: true };
    const t = detectOperationType(f, "深入分析这个问题");
    expect(t).toBe(OperationType.DEEP_REASONING);
  });

  it("detects PII_ACCESS from message keywords", () => {
    const t = detectOperationType(baseFeatures, "填写我的手机号");
    expect(t).toBe(OperationType.PII_ACCESS);
  });

  it("detects SIMPLE_QA for basic questions", () => {
    const t = detectOperationType(baseFeatures, "REST API 是什么");
    expect(t).toBe(OperationType.SIMPLE_QA);
  });

  it("detects GREETING for greetings", () => {
    const t = detectOperationType(baseFeatures, "你好");
    expect(t).toBe(OperationType.GREETING);
  });
});

describe("validateWithAuthMatrix", () => {
  it("should not escalate SIMPLE_QA direct_answer", () => {
    const result = validateWithAuthMatrix("direct_answer", baseFeatures, "今天几号");
    expect(result.escalated).toBe(false);
    expect(result.finalAction).toBe("direct_answer");
  });

  it("should escalate WEB_SEARCH direct_answer to delegate_to_slow", () => {
    const f = { ...baseFeatures, needs_external_tool: true };
    const result = validateWithAuthMatrix("direct_answer", f, "帮我搜索最新消息");
    expect(result.escalated).toBe(true);
    expect(result.finalAction).toBe("delegate_to_slow");
    expect(result.escalationReason).toBeDefined();
  });

  it("should not escalate WEB_SEARCH that's already delegate_to_slow", () => {
    const f = { ...baseFeatures, needs_external_tool: true };
    const result = validateWithAuthMatrix("delegate_to_slow", f, "帮我搜索最新消息");
    expect(result.escalated).toBe(false);
    expect(result.finalAction).toBe("delegate_to_slow");
  });

  it("should escalate FINANCIAL_OP to delegate_to_slow", () => {
    const f = { ...baseFeatures, high_risk_action: true };
    const result = validateWithAuthMatrix("direct_answer", f, "帮我转账");
    expect(result.escalated).toBe(true);
    expect(result.finalAction).toBe("delegate_to_slow");
  });

  it("should not escalate execute_task for CODE_EXECUTION", () => {
    const f = { ...baseFeatures, needs_external_tool: true };
    const result = validateWithAuthMatrix("execute_task", f, "运行这段代码");
    expect(result.escalated).toBe(false);
  });

  it("auto operations (ANALYSIS) pass through unchanged", () => {
    const f = { ...baseFeatures };
    const result = validateWithAuthMatrix("direct_answer", f, "分析这个业务逻辑");
    expect(result.escalated).toBe(false);
    expect(result.finalAction).toBe("direct_answer");
  });
});

describe("requiresSlow", () => {
  it("returns true for web search", () => {
    const f = { ...baseFeatures, needs_external_tool: true };
    expect(requiresSlow(f, "帮我搜索最新新闻")).toBe(true);
  });

  it("returns false for simple QA", () => {
    expect(requiresSlow(baseFeatures, "什么是 REST API")).toBe(false);
  });
});

describe("requiresPermission", () => {
  it("returns true for financial operations", () => {
    const f = { ...baseFeatures, high_risk_action: true };
    expect(requiresPermission(f, "帮我转账")).toBe(true);
  });

  it("returns false for simple QA", () => {
    expect(requiresPermission(baseFeatures, "你好")).toBe(false);
  });
});
