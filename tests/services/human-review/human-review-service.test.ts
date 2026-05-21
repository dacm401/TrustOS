/**
 * S77P: Human Review Queue V0 — Service Tests
 *
 * 覆盖：
 * - T1: buildHumanReviewRequestFromCycle 基本路径
 * - T2: reasonCode = "security_sensitive"（hasSecurityFailure=true）
 * - T3: reasonCode = "required_human_review"（无 security failure）
 * - T4: severity = "security"（最高 criterion severity = security）
 * - T5: severity = "high"（最高 criterion severity = high）
 * - T6: severity = "low"（所有 hr criterion severity = low）
 * - T7: audit 不含 raw content
 * - T8: contractId 正确传递
 * - T9: 无 verification 结果时默认值
 */

import { describe, it, expect } from "vitest";
import type { ContractVerificationResult, TaskContractV0 } from "../../../src/services/task-contract/task-contract-types.js";
import { buildHumanReviewRequestFromCycle } from "../../../src/services/human-review/human-review-service.js";
import type { CycleRunResult } from "../../../src/services/human-review/human-review-service.js";

const TASK_ID = "test-task-s77p";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeVerification(overrides: Partial<ContractVerificationResult> = {}): ContractVerificationResult {
  return {
    traceId: "trace-1",
    base: { passed: false, score: 0.5, issues: [] },
    passed: false,
    score: 0.5,
    criteriaEvaluated: 1,
    criteriaPassed: 0,
    criteriaFailed: 1,
    blockingIssues: 0,
    results: [],
    recommendedAction: "human_review",
    hasHumanReviewRequired: false,
    hasSecurityFailure: false,
    decisionMs: 10,
    ...overrides,
  };
}

function makeHRCriterion(
  severity: ContractVerificationResult["results"][0]["severity"],
  hasSecurityFailure = false
) {
  return {
    criterionId: `hr-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: "human_review" as const,
    passed: null as boolean | null,
    required: true,
    confidence: 0.5,
    severity,
    deterministic: false,
    reasonCode: "requires_human_review" as const,
  };
}

function makeCycleResult(verification: ContractVerificationResult | null): CycleRunResult {
  return {
    finalContent: "Some content with SECRET_TOKEN=abc123 and password=supersecret",
    finalVerification: verification,
    cycleAudit: {
      taskId: TASK_ID,
      totalCycles: 2,
      maxCycles: 3,
      finalStatus: "human_review",
      finalRecommendedAction: "human_review",
      steps: verification ? [{
        cycleIndex: 2,
        verificationResult: verification,
        recommendedAction: "human_review",
        contentLength: 50,
        workerCalled: true,
      }] : [],
      totalMs: 100,
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("S77P Human Review Service", () => {
  it("T1: basic path — returns correct HumanReviewRequest shape", () => {
    const verification = makeVerification({ hasHumanReviewRequired: true });
    const result = buildHumanReviewRequestFromCycle(makeCycleResult(verification));

    expect(result.taskId).toBe(TASK_ID);
    expect(result.cycleIndex).toBe(2);
    expect(result.reasonCode).toBe("required_human_review");
    expect(result.severity).toBe("medium"); // no hr criterion → default medium
    expect(result.audit.taskId).toBe(TASK_ID);
    expect(result.audit.recommendedAction).toBe("human_review");
    expect(result.audit.criteriaCount).toBe(1);
  });

  it("T2: reasonCode = security_sensitive when hasSecurityFailure=true", () => {
    const verification = makeVerification({
      hasSecurityFailure: true,
      hasHumanReviewRequired: true,
    });
    const result = buildHumanReviewRequestFromCycle(makeCycleResult(verification));
    expect(result.reasonCode).toBe("security_sensitive");
    expect(result.audit.hasSecurityIssue).toBe(true);
  });

  it("T3: reasonCode = required_human_review without security failure", () => {
    const verification = makeVerification({
      hasSecurityFailure: false,
      hasHumanReviewRequired: true,
      results: [makeHRCriterion("high")],
    });
    const result = buildHumanReviewRequestFromCycle(makeCycleResult(verification));
    expect(result.reasonCode).toBe("required_human_review");
  });

  it("T4: severity = security when highest hr criterion severity is security", () => {
    const verification = makeVerification({
      hasSecurityFailure: false,
      results: [
        makeHRCriterion("low"),
        makeHRCriterion("high"),
        makeHRCriterion("security"),
      ],
    });
    const result = buildHumanReviewRequestFromCycle(makeCycleResult(verification));
    expect(result.severity).toBe("security");
  });

  it("T5: severity = high when highest hr criterion severity is high", () => {
    const verification = makeVerification({
      hasSecurityFailure: false,
      results: [
        makeHRCriterion("low"),
        makeHRCriterion("medium"),
        makeHRCriterion("high"),
      ],
    });
    const result = buildHumanReviewRequestFromCycle(makeCycleResult(verification));
    expect(result.severity).toBe("high");
  });

  it("T6: severity = low when all hr criterion severity is low", () => {
    const verification = makeVerification({
      hasSecurityFailure: false,
      results: [makeHRCriterion("low")],
    });
    const result = buildHumanReviewRequestFromCycle(makeCycleResult(verification));
    expect(result.severity).toBe("low");
  });

  it("T7: audit does not contain raw artifact / history / memory content", () => {
    const verification = makeVerification({ hasHumanReviewRequired: true });
    const result = buildHumanReviewRequestFromCycle(makeCycleResult(verification));

    // cycleResult.finalContent 含敏感信息，但 audit 不应包含
    const auditStr = JSON.stringify(result.audit);
    expect(auditStr).not.toContain("SECRET_TOKEN");
    expect(auditStr).not.toContain("password");
    expect(auditStr).not.toContain("supersecret");
  });

  it("T8: contractId is passed when taskContract has id", () => {
    const verification = makeVerification({ hasHumanReviewRequired: true });
    const taskContract = { id: "contract-123" } as TaskContractV0;
    const result = buildHumanReviewRequestFromCycle(makeCycleResult(verification), taskContract);
    expect(result.contractId).toBe("contract-123");
  });

  it("T9: defaults when verification is null", () => {
    const result = buildHumanReviewRequestFromCycle(makeCycleResult(null));
    expect(result.reasonCode).toBe("manual_escalation"); // no verification → manual
    expect(result.audit.criteriaCount).toBe(0);
    expect(result.audit.blockingIssues).toBe(0);
  });
});
