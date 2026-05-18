// Sprint 64P: Budget Manager V0 - 单元测试
// 覆盖 BM-01~10

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runBudgetPreflight } from "../../src/services/budget/budget-manager.js";

const TRACE = "trace-budget-test-001";
const KNOWN_MODEL = "deepseek-ai/DeepSeek-V4-Flash"; // input: 0.07/M, output: 0.28/M (cheap)
const EXPENSIVE_MODEL = "gpt-4o";                     // input: 5.0/M, output: 15.0/M (reasoning)
const FALLBACK_MODEL = "deepseek-ai/DeepSeek-V3";     // standard tier

// 保存/恢复 env
const originalEnv = { ...process.env };

function resetEnv() {
  for (const key of ["TRUSTOS_REQUEST_BUDGET_USD", "TRUSTOS_SESSION_BUDGET_USD",
    "TRUSTOS_ALLOW_UNKNOWN_PRICING", "TRUSTOS_BUDGET_MANAGER_ENABLED"]) {
    delete process.env[key];
  }
}

beforeEach(() => { resetEnv(); });
afterEach(() => { resetEnv(); });

// ── BM-01: 低于 requestBudget → allow ────────────────────────────────────────
describe("BM-01: 低于 requestBudget → allow", () => {
  it("cheap model with default budget should be allowed", () => {
    // DeepSeek-V4-Flash: 1000 input * 0.07/M + 300 output * 0.28/M
    // = 0.00007 + 0.000084 = 0.000154 USD — well under $0.02 default
    process.env.TRUSTOS_REQUEST_BUDGET_USD = "0.02";
    const result = runBudgetPreflight({
      traceId: TRACE,
      route: "direct_artifact_revision",
      requestedModel: KNOWN_MODEL,
      modelRole: "worker",
      estimatedOutputTokens: 300,
    });
    expect(result.action).toBe("allow");
    expect(result.blocked).toBe(false);
    expect(result.enabled).toBe(true);
    expect(result.pricingKnown).toBe(true);
    expect(result.estimatedCostUsd).not.toBeNull();
    expect(result.estimatedCostUsd as number).toBeGreaterThan(0);
    expect(result.originalModel).toBe(KNOWN_MODEL);
    expect(result.selectedModel).toBe(KNOWN_MODEL);
    expect(result.downgraded).toBe(false);
  });
});

// ── BM-02: pricingUnknown → ask_user_confirm ─────────────────────────────────
describe("BM-02: pricingUnknown → ask_user_confirm", () => {
  it("unknown model with ALLOW_UNKNOWN_PRICING=false should ask_user_confirm", () => {
    delete process.env.TRUSTOS_ALLOW_UNKNOWN_PRICING;
    const result = runBudgetPreflight({
      traceId: TRACE,
      route: "direct_create_artifact",
      requestedModel: "my-custom-unknown-model-xyz",
      modelRole: "worker",
    });
    expect(result.action).toBe("ask_user_confirm");
    expect(result.pricingKnown).toBe(false);
    expect(result.estimatedCostUsd).toBeNull();
    expect(result.requiresUserConfirm).toBe(true);
    expect(result.blocked).toBe(false);
  });

  it("unknown model with ALLOW_UNKNOWN_PRICING=true should allow", () => {
    process.env.TRUSTOS_ALLOW_UNKNOWN_PRICING = "true";
    const result = runBudgetPreflight({
      traceId: TRACE,
      route: "direct_create_artifact",
      requestedModel: "my-custom-unknown-model-xyz",
      modelRole: "worker",
    });
    expect(result.action).toBe("allow");
    expect(result.pricingKnown).toBe(false);
    expect(result.estimatedCostUsd).toBeNull(); // unknown 不等于 0
  });
});

// ── BM-03: 超预算但有 fallback model → downgrade_model ───────────────────────
describe("BM-03: 超预算但有 fallback model → downgrade_model", () => {
  it("gpt-4o with tiny budget and no patch eligible should downgrade to gpt-4o-mini", () => {
    process.env.TRUSTOS_REQUEST_BUDGET_USD = "0.000001"; // 极低预算
    const result = runBudgetPreflight({
      traceId: TRACE,
      route: "direct_create_artifact",
      requestedModel: EXPENSIVE_MODEL,
      modelRole: "worker",
      patchFirstEligible: false,
    });
    expect(result.action).toBe("downgrade_model");
    expect(result.downgraded).toBe(true);
    expect(result.originalModel).toBe(EXPENSIVE_MODEL);
    expect(result.selectedModel).toBe("gpt-4o-mini");
    expect(result.downgradeReason).toBeDefined();
    expect(result.blocked).toBe(false);
  });

  it("DeepSeek-V3 with tiny budget should downgrade to DeepSeek-V4-Flash", () => {
    process.env.TRUSTOS_REQUEST_BUDGET_USD = "0.000001";
    const result = runBudgetPreflight({
      traceId: TRACE,
      route: "direct_create_artifact",
      requestedModel: FALLBACK_MODEL,
      modelRole: "worker",
    });
    expect(result.action).toBe("downgrade_model");
    expect(result.selectedModel).toBe("deepseek-ai/DeepSeek-V4-Flash");
    expect(result.downgraded).toBe(true);
  });
});

// ── BM-04: 超过 2x requestBudget 且无 fallback → block ──────────────────────
describe("BM-04: 超过 2x requestBudget 且无 fallback → block", () => {
  it("cheap model that is significantly over budget with no fallback should block", () => {
    // DeepSeek-V4-Flash (cheap): 费用极低，但设置超低预算且让估算很大
    // 用很高的 inputTokens 来模拟大成本
    // 实际成本约 = 100000 * 0.07/M + 100000 * 0.28/M = 0.007 + 0.028 = 0.035
    // 设置 requestBudget = 0.000001 (< 0.035/2)
    // 但 cheap model 没有 fallback，所以应该 block
    process.env.TRUSTOS_REQUEST_BUDGET_USD = "0.000001";
    const result = runBudgetPreflight({
      traceId: TRACE,
      route: "direct_create_artifact",
      requestedModel: KNOWN_MODEL, // cheap, no fallback
      modelRole: "worker",
      contextPackage: {
        kind: "create",
        metrics: { estimatedInputTokens: 100000 },
      },
      estimatedOutputTokens: 100000,
    });
    expect(result.action).toBe("block");
    expect(result.blocked).toBe(true);
    expect(result.requiresUserConfirm).toBe(false);
    expect(result.downgraded).toBe(false);
  });
});

// ── BM-05: patchFirstEligible → preferPatch=true ─────────────────────────────
describe("BM-05: patchFirstEligible=true → prefer_patch", () => {
  it("over budget revision with patchFirstEligible should prefer_patch", () => {
    process.env.TRUSTOS_REQUEST_BUDGET_USD = "0.000001";
    const result = runBudgetPreflight({
      traceId: TRACE,
      route: "direct_artifact_revision",
      requestedModel: EXPENSIVE_MODEL,
      modelRole: "worker",
      patchFirstEligible: true,
    });
    expect(result.action).toBe("prefer_patch");
    expect(result.preferPatch).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.downgraded).toBe(false);
  });
});

// ── BM-06: sessionBudget 剩余不足 → block ────────────────────────────────────
describe("BM-06: sessionBudget 剩余不足 → block", () => {
  it("when sessionBudget is exhausted, should block even if requestBudget is fine", () => {
    const result = runBudgetPreflight({
      traceId: TRACE,
      route: "direct_create_artifact",
      requestedModel: KNOWN_MODEL,
      modelRole: "worker",
      requestBudgetUsd: 1.0,      // 单次预算够大
      sessionBudgetUsd: 0.001,    // 会话总预算很小
      sessionSpentUsd: 0.001,     // 已经耗尽
    });
    expect(result.action).toBe("block");
    expect(result.blocked).toBe(true);
    expect(result.remainingSessionBudgetUsd).toBe(0);
  });
});

// ── BM-07: decisionMs 有记录 ─────────────────────────────────────────────────
describe("BM-07: decisionMs 有记录", () => {
  it("decision should record decisionMs >= 0", () => {
    const result = runBudgetPreflight({
      traceId: TRACE,
      route: "direct_artifact_revision",
      requestedModel: KNOWN_MODEL,
      modelRole: "worker",
    });
    expect(result.decisionMs).toBeGreaterThanOrEqual(0);
  });
});

// ── BM-08: estimatedInputTokens 从 inputBytes 推导 ───────────────────────────
describe("BM-08: estimatedInputTokens 从 inputBytes 推导", () => {
  it("should derive estimatedInputTokens from inputBytes (ceil(inputBytes/4))", () => {
    const result = runBudgetPreflight({
      traceId: TRACE,
      route: "direct_artifact_revision",
      requestedModel: KNOWN_MODEL,
      modelRole: "worker",
      contextPackage: {
        kind: "revision",
        metrics: { inputBytes: 4000 },
      },
    });
    // ceil(4000 / 4) = 1000
    expect(result.estimatedInputTokens).toBe(1000);
  });

  it("should use estimatedInputTokens directly if provided", () => {
    const result = runBudgetPreflight({
      traceId: TRACE,
      route: "direct_artifact_revision",
      requestedModel: KNOWN_MODEL,
      modelRole: "worker",
      contextPackage: {
        kind: "revision",
        metrics: { estimatedInputTokens: 888, inputBytes: 9999 }, // estimatedInputTokens 优先
      },
    });
    expect(result.estimatedInputTokens).toBe(888);
  });
});

// ── BM-09: estimatedOutputTokens 按 create/revision/manager role 推导 ─────────
describe("BM-09: estimatedOutputTokens 按 create/revision/manager 推导", () => {
  it("manager role should use lower outputToken estimate (800)", () => {
    const result = runBudgetPreflight({
      traceId: TRACE,
      route: "manager_llm_required",
      requestedModel: KNOWN_MODEL,
      modelRole: "manager",
    });
    expect(result.estimatedOutputTokens).toBe(800);
  });

  it("revision + patchFirst should use lower outputToken estimate (300)", () => {
    const result = runBudgetPreflight({
      traceId: TRACE,
      route: "direct_artifact_revision",
      requestedModel: KNOWN_MODEL,
      modelRole: "worker",
      patchFirstEligible: true,
    });
    // 注意: patchFirstEligible 会触发 prefer_patch，但 estimatedOutputTokens 仍是 300
    expect(result.estimatedOutputTokens).toBe(300);
  });

  it("create should use higher outputToken estimate (1500)", () => {
    const result = runBudgetPreflight({
      traceId: TRACE,
      route: "direct_create_artifact",
      requestedModel: KNOWN_MODEL,
      modelRole: "worker",
    });
    expect(result.estimatedOutputTokens).toBe(1500);
  });

  it("custom estimatedOutputTokens should override default", () => {
    const result = runBudgetPreflight({
      traceId: TRACE,
      route: "direct_create_artifact",
      requestedModel: KNOWN_MODEL,
      modelRole: "worker",
      estimatedOutputTokens: 999,
    });
    expect(result.estimatedOutputTokens).toBe(999);
  });
});

// ── BM-10: unknown pricing 不返回 estimatedCostUsd=0 ─────────────────────────
describe("BM-10: unknown pricing 不返回 estimatedCostUsd=0", () => {
  it("unknown pricing should return estimatedCostUsd=null, NOT 0", () => {
    const result = runBudgetPreflight({
      traceId: TRACE,
      route: "direct_create_artifact",
      requestedModel: "my-totally-unknown-model",
      modelRole: "worker",
    });
    expect(result.estimatedCostUsd).not.toBe(0);
    expect(result.estimatedCostUsd).toBeNull();
    expect(result.pricingKnown).toBe(false);
  });
});

// ── BM-11: Budget Manager 未启用 → allow (enabled=false) ─────────────────────
describe("BM-11: TRUSTOS_BUDGET_MANAGER_ENABLED=false → allow", () => {
  it("disabled budget manager should allow everything", () => {
    process.env.TRUSTOS_BUDGET_MANAGER_ENABLED = "false";
    const result = runBudgetPreflight({
      traceId: TRACE,
      route: "direct_create_artifact",
      requestedModel: EXPENSIVE_MODEL,
      modelRole: "worker",
      requestBudgetUsd: 0.000001, // 极低预算
    });
    expect(result.action).toBe("allow");
    expect(result.enabled).toBe(false);
    expect(result.blocked).toBe(false);
  });
});
