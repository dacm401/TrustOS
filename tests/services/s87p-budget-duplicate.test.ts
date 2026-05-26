/**
 * S87P: LLM Call Budget & Duplicate Detection — Unit Tests
 *
 * Tests cover:
 * - LlmCallBudget metadata creation
 * - Budget checks: over_budget, near_budget, within budget
 * - Duplicate detection: consecutive same (kind, model)
 * - Budget status in RuntimeTraceExtract
 * - duplicateCount in RuntimeTraceExtract
 * - Safe metadata: no prompt/content leakage
 * - Multiple warnings accumulate
 * - No budget → no warnings (backward compat)
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createTrace,
  setRequestTrace,
  getRequestTrace,
  recordLlmCall,
  runWithRequestTrace,
  setTraceBudget,
} from "../../src/services/runtime-trace.js";
import { buildRuntimeTraceExtract } from "../../src/types/runtime-trace.js";
import type { RuntimeTrace, RuntimeTraceLlmCall } from "../../src/types/runtime-trace.js";

describe("S87P: Budget metadata", () => {
  beforeEach(() => {
    setRequestTrace(null);
  });

  it("T1.1: setTraceBudget creates budget with maxTotalCalls", () => {
    const trace = createTrace("budget_test_1");
    setTraceBudget(trace, 5);
    expect(trace.budget).toBeDefined();
    expect(trace.budget!.maxTotalCalls).toBe(5);
    expect(trace.budget!.warnings).toEqual([]);
  });

  it("T1.2: budget persists across multiple calls", () => {
    const trace = createTrace("budget_persist");
    setTraceBudget(trace, 5);
    const t = setRequestTrace(trace);
    recordLlmCall("manager", "gpt-4o", undefined, undefined, true);
    recordLlmCall("worker", "gpt-4o-mini", undefined, undefined, true);
    expect(trace.budget!.maxTotalCalls).toBe(5);
    expect(trace.budget!.warnings.length).toBe(0); // 2/5 not over
    setRequestTrace(null);
  });
});

describe("S87P: Budget checks", () => {
  beforeEach(() => {
    setRequestTrace(null);
  });

  it("T2.1: over_budget warning when llmCalls > maxTotalCalls", () => {
    const trace = createTrace("over_budget");
    setTraceBudget(trace, 3);
    runWithRequestTrace(trace, () => {
      recordLlmCall("manager", "m1", undefined, undefined, true);
      recordLlmCall("worker", "m2", undefined, undefined, true);
      recordLlmCall("manager_synthesis", "m1", undefined, undefined, true);
      // 4th call exceeds budget of 3
      recordLlmCall("execution_loop", "m2", undefined, undefined, true);
    });

    const overBudgetWarnings = trace.budget!.warnings.filter(w => w.kind === "over_budget");
    expect(overBudgetWarnings.length).toBeGreaterThanOrEqual(1);
    expect(overBudgetWarnings[0].message).toContain("exceeds budget");
  });

  it("T2.2: near_budget warning at 80% threshold", () => {
    const trace = createTrace("near_budget");
    setTraceBudget(trace, 5);
    runWithRequestTrace(trace, () => {
      recordLlmCall("manager", "m1", undefined, undefined, true); // 1
      recordLlmCall("worker", "m2", undefined, undefined, true);  // 2
      recordLlmCall("manager_synthesis", "m1", undefined, undefined, true); // 3
      // 4th call: 4/5 = 80%, should trigger near_budget
      recordLlmCall("execution_loop", "m2", undefined, undefined, true); // 4
    });

    const nearWarnings = trace.budget!.warnings.filter(w => w.kind === "near_budget");
    expect(nearWarnings.length).toBe(1);
    expect(nearWarnings[0].message).toContain("approaching budget");
  });

  it("T2.3: near_budget warns only once", () => {
    const trace = createTrace("near_once");
    setTraceBudget(trace, 5);
    runWithRequestTrace(trace, () => {
      recordLlmCall("manager", "m1", undefined, undefined, true); // 1
      recordLlmCall("worker", "m2", undefined, undefined, true);  // 2
      recordLlmCall("manager_synthesis", "m1", undefined, undefined, true); // 3
      recordLlmCall("execution_loop", "m2", undefined, undefined, true); // 4 → near_budget
      recordLlmCall("planner", "m2", undefined, undefined, true); // 5 → still within
    });

    const nearWarnings = trace.budget!.warnings.filter(w => w.kind === "near_budget");
    expect(nearWarnings.length).toBe(1);
  });

  it("T2.4: no warnings when within budget", () => {
    const trace = createTrace("within_budget");
    setTraceBudget(trace, 10);
    runWithRequestTrace(trace, () => {
      recordLlmCall("manager", "m1", undefined, undefined, true);
      recordLlmCall("worker", "m2", undefined, undefined, true);
    });

    expect(trace.budget!.warnings.length).toBe(0);
  });

  it("T2.5: no warnings when budget is not set (backward compat)", () => {
    const trace = createTrace("no_budget");
    runWithRequestTrace(trace, () => {
      recordLlmCall("manager", "m1", undefined, undefined, true);
      recordLlmCall("worker", "m2", undefined, undefined, true);
      recordLlmCall("manager_synthesis", "m1", undefined, undefined, true);
      recordLlmCall("worker", "m2", undefined, undefined, true);
      recordLlmCall("execution_loop", "m2", undefined, undefined, true);
      recordLlmCall("planner", "m2", undefined, undefined, true);
      recordLlmCall("worker", "m2", undefined, undefined, true);
      recordLlmCall("manager_synthesis", "m1", undefined, undefined, true);
    });

    expect(trace.budget).toBeUndefined();
    expect(trace.llmCalls!.length).toBe(8);
    // No budget, no warnings — backward compat
  });
});

describe("S87P: Duplicate detection", () => {
  beforeEach(() => {
    setRequestTrace(null);
  });

  it("T3.1: consecutive same kind+model flags duplicateWarning", () => {
    const trace = createTrace("dup_detect");
    setTraceBudget(trace, 10);
    runWithRequestTrace(trace, () => {
      recordLlmCall("worker", "gpt-4o", undefined, undefined, true);
      // Same kind + model → duplicate
      const dupCall = recordLlmCall("worker", "gpt-4o", undefined, undefined, true);
      expect(dupCall!.duplicateWarning).toBe(true);
    });
  });

  it("T3.2: different kind = not duplicate", () => {
    const trace = createTrace("diff_kind");
    setTraceBudget(trace, 10);
    runWithRequestTrace(trace, () => {
      recordLlmCall("manager", "gpt-4o", undefined, undefined, true);
      const call2 = recordLlmCall("worker", "gpt-4o", undefined, undefined, true);
      expect(call2!.duplicateWarning).toBeUndefined();
    });
  });

  it("T3.3: different model = not duplicate", () => {
    const trace = createTrace("diff_model");
    setTraceBudget(trace, 10);
    runWithRequestTrace(trace, () => {
      recordLlmCall("worker", "gpt-4o", undefined, undefined, true);
      const call2 = recordLlmCall("worker", "gpt-4o-mini", undefined, undefined, true);
      expect(call2!.duplicateWarning).toBeUndefined();
    });
  });

  it("T3.4: failed previous call = not flagged as duplicate", () => {
    const trace = createTrace("failed_prev");
    setTraceBudget(trace, 10);
    runWithRequestTrace(trace, () => {
      recordLlmCall("worker", "gpt-4o", undefined, undefined, false, "timeout");
      const call2 = recordLlmCall("worker", "gpt-4o", undefined, undefined, true);
      expect(call2!.duplicateWarning).toBeUndefined();
    });
  });

  it("T3.5: duplicate generates duplicate_consecutive budget warning", () => {
    const trace = createTrace("dup_warn");
    setTraceBudget(trace, 10);
    runWithRequestTrace(trace, () => {
      recordLlmCall("compressor", "gpt-4o", undefined, undefined, true);
      recordLlmCall("compressor", "gpt-4o", undefined, undefined, true);
    });

    const dupWarnings = trace.budget!.warnings.filter(w => w.kind === "duplicate_consecutive");
    expect(dupWarnings.length).toBe(1);
    expect(dupWarnings[0].message).toContain("compressor");
    expect(dupWarnings[0].message).toContain("gpt-4o");
  });

  it("T3.6: first call never flagged as duplicate", () => {
    const trace = createTrace("first_call");
    setTraceBudget(trace, 10);
    runWithRequestTrace(trace, () => {
      const call1 = recordLlmCall("planner", "gpt-4o", undefined, undefined, true);
      expect(call1!.duplicateWarning).toBeUndefined();
    });
  });

  it("T3.7: three-way not duplicate (A-B-A pattern)", () => {
    const trace = createTrace("aba_pattern");
    setTraceBudget(trace, 10);
    runWithRequestTrace(trace, () => {
      recordLlmCall("worker", "gpt-4o", undefined, undefined, true);
      recordLlmCall("manager", "gpt-4o", undefined, undefined, true); // diff kind
      const call3 = recordLlmCall("worker", "gpt-4o", undefined, undefined, true);
      // Not consecutive same — previous was manager, not worker
      expect(call3!.duplicateWarning).toBeUndefined();
    });
  });
});

describe("S87P: RuntimeTraceExtract budget & duplicate fields", () => {
  beforeEach(() => {
    setRequestTrace(null);
  });

  it("T4.1: extract includes budgetStatus when budget is set", () => {
    const trace = createTrace("ext_budget");
    setTraceBudget(trace, 5);
    runWithRequestTrace(trace, () => {
      recordLlmCall("manager", "m1", undefined, undefined, true);
      recordLlmCall("worker", "m2", undefined, undefined, true);
      recordLlmCall("manager_synthesis", "m1", undefined, undefined, true);
    });

    const extract = buildRuntimeTraceExtract(trace);
    expect(extract.budgetStatus).toBeDefined();
    expect(extract.budgetStatus!.total).toBe(3);
    expect(extract.budgetStatus!.max).toBe(5);
    expect(extract.budgetStatus!.overBudget).toBe(false);
  });

  it("T4.2: extract overBudget = true when exceeded", () => {
    const trace = createTrace("ext_over");
    setTraceBudget(trace, 3);
    runWithRequestTrace(trace, () => {
      recordLlmCall("manager", "m1", undefined, undefined, true);
      recordLlmCall("worker", "m2", undefined, undefined, true);
      recordLlmCall("manager_synthesis", "m1", undefined, undefined, true);
      recordLlmCall("execution_loop", "m2", undefined, undefined, true);
    });

    const extract = buildRuntimeTraceExtract(trace);
    expect(extract.budgetStatus!.total).toBe(4);
    expect(extract.budgetStatus!.overBudget).toBe(true);
  });

  it("T4.3: extract budgetStatus undefined when no budget set", () => {
    const trace = createTrace("ext_nobudget");
    runWithRequestTrace(trace, () => {
      recordLlmCall("manager", "m1", undefined, undefined, true);
    });

    const extract = buildRuntimeTraceExtract(trace);
    expect(extract.budgetStatus).toBeUndefined();
  });

  it("T4.4: extract duplicateCount reports correctly", () => {
    const trace = createTrace("ext_dups");
    setTraceBudget(trace, 10);
    runWithRequestTrace(trace, () => {
      recordLlmCall("worker", "m1", undefined, undefined, true);
      recordLlmCall("worker", "m1", undefined, undefined, true); // dup #1
      recordLlmCall("manager", "m2", undefined, undefined, true);
      recordLlmCall("manager", "m2", undefined, undefined, true); // dup #2
    });

    const extract = buildRuntimeTraceExtract(trace);
    expect(extract.duplicateCount).toBe(2);
  });

  it("T4.5: extract duplicateCount = 0 when no duplicates", () => {
    const trace = createTrace("ext_nodups");
    setTraceBudget(trace, 10);
    runWithRequestTrace(trace, () => {
      recordLlmCall("manager", "m1", undefined, undefined, true);
      recordLlmCall("worker", "m2", undefined, undefined, true);
      recordLlmCall("manager_synthesis", "m1", undefined, undefined, true);
    });

    const extract = buildRuntimeTraceExtract(trace);
    expect(extract.duplicateCount).toBe(0);
  });
});

describe("S87P: Safe metadata", () => {
  beforeEach(() => {
    setRequestTrace(null);
  });

  it("T5.1: budget warnings never contain prompt or content", () => {
    const trace = createTrace("safe_warn");
    setTraceBudget(trace, 2);
    runWithRequestTrace(trace, () => {
      recordLlmCall("manager", "m1", undefined, undefined, true);
      recordLlmCall("worker", "m2", undefined, undefined, true);
      recordLlmCall("manager_synthesis", "m1", undefined, undefined, true); // over
    });

    const allWarnings = trace.budget!.warnings;
    for (const w of allWarnings) {
      const msg = JSON.stringify(w);
      expect(msg).not.toContain("prompt");
      expect(msg).not.toContain("content");
      expect(msg).not.toContain("completion");
      expect(msg).not.toMatch(/api[_-]?key/i);
    }
  });

  it("T5.2: RuntimeTraceLlmCall never contains prompt/content", () => {
    const trace = createTrace("safe_llmcall");
    setTraceBudget(trace, 10);
    runWithRequestTrace(trace, () => {
      recordLlmCall("worker", "gpt-4o", undefined, undefined, true);
    });

    const call = trace.llmCalls![0];
    const serialized = JSON.stringify(call);
    expect(serialized).not.toContain("prompt");
    expect(serialized).not.toContain("content");
    expect(serialized).not.toContain("completion");
    expect(serialized).not.toContain("messages");
    expect(serialized).not.toContain("arguments");
    expect(serialized).not.toMatch(/api[_-]?key/i);
  });
});

describe("S87P: AsyncLocalStorage isolation with budget", () => {
  beforeEach(() => {
    setRequestTrace(null);
  });

  it("T6.1: budgets do not cross-contaminate between parallel traces", async () => {
    const traceA = createTrace("iso_a");
    const traceB = createTrace("iso_b");
    setTraceBudget(traceA, 5);
    setTraceBudget(traceB, 3);

    const resultA = runWithRequestTrace(traceA, () => {
      recordLlmCall("worker", "m1", undefined, undefined, true);
      recordLlmCall("worker", "m1", undefined, undefined, true); // dup
      return { total: traceA.llmCalls!.length, budget: traceA.budget!.maxTotalCalls, dupCount: traceA.llmCalls!.filter(c => c.duplicateWarning).length };
    });

    const resultB = runWithRequestTrace(traceB, () => {
      recordLlmCall("manager", "m2", undefined, undefined, true);
      recordLlmCall("manager_synthesis", "m2", undefined, undefined, true);
      recordLlmCall("worker", "m1", undefined, undefined, true);
      recordLlmCall("execution_loop", "m1", undefined, undefined, true); // over budget 3
      return { total: traceB.llmCalls!.length, budget: traceB.budget!.maxTotalCalls, overBudget: traceB.budget!.warnings.some(w => w.kind === "over_budget") };
    });

    // Trace A: 2 calls, budget 5, 1 duplicate
    expect(resultA.total).toBe(2);
    expect(resultA.budget).toBe(5);
    expect(resultA.dupCount).toBe(1);

    // Trace B: 4 calls, budget 3, over budget
    expect(resultB.total).toBe(4);
    expect(resultB.budget).toBe(3);
    expect(resultB.overBudget).toBe(true);
  });
});

// ── S87P: shouldSkipSynthesis() Boundary Tests ─────────────────────────────

import { shouldSkipSynthesis } from "../../src/services/phase3/sse-poller.js";

describe("S87P: shouldSkipSynthesis() — safe skip", () => {
  it("T7.1: short normal worker result → skip", () => {
    expect(shouldSkipSynthesis("这是一个简短的答案。")).toBe(true);
  });

  it("T7.2: short English result → skip", () => {
    expect(shouldSkipSynthesis("The answer is 42.")).toBe(true);
  });

  it("T7.3: no execution metadata + short clean content → skip", () => {
    expect(shouldSkipSynthesis("OK", undefined)).toBe(true);
  });

  it("T7.4: short result with execution containing no veto fields → skip", () => {
    expect(shouldSkipSynthesis("看起来不错", { confidence: 0.85 })).toBe(true);
  });
});

describe("S87P: shouldSkipSynthesis() — no skip (content-level)", () => {
  it("T8.1: empty content → no skip", () => {
    expect(shouldSkipSynthesis("")).toBe(false);
    expect(shouldSkipSynthesis("   ")).toBe(false);
  });

  it("T8.2: long content ≥ 200 chars → no skip", () => {
    expect(shouldSkipSynthesis("a".repeat(200))).toBe(false);
    expect(shouldSkipSynthesis("a".repeat(201))).toBe(false);
  });

  it("T8.3: error keyword present → no skip", () => {
    expect(shouldSkipSynthesis("发生了错误")).toBe(false);
    expect(shouldSkipSynthesis("Operation failed")).toBe(false);
  });

  it("T8.4: tool_call indicators → no skip", () => {
    expect(shouldSkipSynthesis("Used tool_call to fetch")).toBe(false);
    expect(shouldSkipSynthesis("<tool>read</tool>")).toBe(false);
  });
});

describe("S87P: shouldSkipSynthesis() — no skip (execution-level errors)", () => {
  it("T9.1: errors array present → no skip", () => {
    expect(shouldSkipSynthesis("short ok", { errors: ["something wrong"] })).toBe(false);
  });

  it("T9.2: empty errors array → still checks other conditions", () => {
    // Empty errors array is not treated as an error
    expect(shouldSkipSynthesis("ok", { errors: [] as string[] })).toBe(true);
  });
});

describe("S87P: shouldSkipSynthesis() — no skip (verification failure)", () => {
  it("T10.1: V0 verification failed → no skip", () => {
    expect(shouldSkipSynthesis("short ok", {
      verification: { passed: false },
    })).toBe(false);
  });

  it("T10.2: V0 verification passed → can still skip", () => {
    expect(shouldSkipSynthesis("short ok", {
      verification: { passed: true },
    })).toBe(true);
  });

  it("T10.3: contract verification failed → no skip", () => {
    expect(shouldSkipSynthesis("short ok", {
      contractVerification: { passed: false },
    })).toBe(false);
  });
});

describe("S87P: shouldSkipSynthesis() — no skip (contract violation / security)", () => {
  it("T11.1: security failure → no skip", () => {
    expect(shouldSkipSynthesis("short ok", {
      contractVerification: { hasSecurityFailure: true },
    })).toBe(false);
  });

  it("T11.2: blocking issues → no skip", () => {
    expect(shouldSkipSynthesis("short ok", {
      contractVerification: { blockingIssues: 1 },
    })).toBe(false);
  });

  it("T11.3: recommendedAction = block → no skip", () => {
    expect(shouldSkipSynthesis("short ok", {
      contractVerification: { recommendedAction: "block" },
    })).toBe(false);
  });
});

describe("S87P: shouldSkipSynthesis() — no skip (human_review)", () => {
  it("T12.1: contract verification human_review → no skip", () => {
    expect(shouldSkipSynthesis("short ok", {
      contractVerification: { recommendedAction: "human_review" },
    })).toBe(false);
  });

  it("T12.2: contract verification hasHumanReviewRequired → no skip", () => {
    expect(shouldSkipSynthesis("short ok", {
      contractVerification: { hasHumanReviewRequired: true },
    })).toBe(false);
  });

  it("T12.3: cycle audit finalStatus = human_review → no skip", () => {
    expect(shouldSkipSynthesis("short ok", {
      cycleAudit: { finalStatus: "human_review" },
    })).toBe(false);
  });

  it("T12.4: cycle audit finalRecommendedAction = human_review → no skip", () => {
    expect(shouldSkipSynthesis("short ok", {
      cycleAudit: { finalRecommendedAction: "human_review" },
    })).toBe(false);
  });

  it("T12.5: cycle audit blocked = true → no skip", () => {
    expect(shouldSkipSynthesis("short ok", {
      cycleAudit: { blocked: true },
    })).toBe(false);
  });
});

describe("S87P: shouldSkipSynthesis() — no skip (patch/rewrite/revise)", () => {
  it("T13.1: contract verify revise → no skip", () => {
    expect(shouldSkipSynthesis("short ok", {
      contractVerification: { recommendedAction: "revise" },
    })).toBe(false);
  });

  it("T13.2: contract verify rewrite → no skip", () => {
    expect(shouldSkipSynthesis("short ok", {
      contractVerification: { recommendedAction: "rewrite" },
    })).toBe(false);
  });

  it("T13.3: cycle audit revise → no skip", () => {
    expect(shouldSkipSynthesis("short ok", {
      cycleAudit: { finalRecommendedAction: "revise" },
    })).toBe(false);
  });

  it("T13.4: cycle audit rewrite → no skip", () => {
    expect(shouldSkipSynthesis("short ok", {
      cycleAudit: { finalRecommendedAction: "rewrite" },
    })).toBe(false);
  });

  it("T13.5: cycle audit totalCycles > 0 → no skip (revision occurred)", () => {
    expect(shouldSkipSynthesis("short ok", {
      cycleAudit: { totalCycles: 1 },
    })).toBe(false);
  });

  it("T13.6: accepted cycle with totalCycles = 0 → can skip", () => {
    expect(shouldSkipSynthesis("short ok", {
      cycleAudit: { finalStatus: "accepted", totalCycles: 0 },
    })).toBe(true);
  });
});

describe("S87P: shouldSkipSynthesis() — no skip (blocked/suspended state)", () => {
  it("T14.1: cycle audit finalStatus = blocked → no skip", () => {
    expect(shouldSkipSynthesis("short ok", {
      cycleAudit: { finalStatus: "blocked" },
    })).toBe(false);
  });

  it("T14.2: cycle audit finalRecommendedAction = block → no skip", () => {
    expect(shouldSkipSynthesis("short ok", {
      cycleAudit: { finalRecommendedAction: "block" },
    })).toBe(false);
  });

  it("T14.3: contract verify recommendedAction = block + cycle blocked → no skip", () => {
    expect(shouldSkipSynthesis("short ok", {
      contractVerification: { recommendedAction: "block", hasSecurityFailure: true },
      cycleAudit: { finalStatus: "blocked", blocked: true },
    })).toBe(false);
  });
});
