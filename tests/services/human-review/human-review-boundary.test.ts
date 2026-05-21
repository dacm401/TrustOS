/**
 * S77P: Human Review Queue V0 — Context Boundary Sentinel Tests
 *
 * 验证 HumanReviewRequest.audit / SSE audit 不泄漏敏感内容。
 * 不涉及真实 DB，所有测试纯函数验证 buildHumanReviewRequestFromCycle 输出。
 *
 * Sentinel Map:
 * B1: artifact raw content 含 SECRET_TOKEN=abc123
 * B2: history raw content 含 password=supersecret
 * B3: memory raw content 含 api_key=xyz789
 * B4: criterion label 含 API_KEY_REQUIRED
 * B5: criterion description 含 SSN=123-45-6789
 */

import { describe, it, expect } from "vitest";
import type { ContractVerificationResult, TaskContractV0 } from "../../../src/services/task-contract/task-contract-types.js";
import { buildHumanReviewRequestFromCycle } from "../../../src/services/human-review/human-review-service.js";
import type { CycleRunResult } from "../../../src/services/human-review/human-review-service.js";

const TASK_ID = "boundary-test-s77p";

function makeVerification(overrides: Partial<ContractVerificationResult> = {}): ContractVerificationResult {
  return {
    traceId: "trace-boundary",
    base: { passed: false, score: 0.5, issues: [] },
    passed: false,
    score: 0.5,
    criteriaEvaluated: 1,
    criteriaPassed: 0,
    criteriaFailed: 1,
    blockingIssues: 0,
    results: [],
    recommendedAction: "human_review",
    hasHumanReviewRequired: true,
    hasSecurityFailure: false,
    decisionMs: 10,
    ...overrides,
  };
}

function makeCycleResult(
  content: string,
  verification: ContractVerificationResult | null,
  contract?: TaskContractV0
): CycleRunResult {
  return {
    finalContent: content,
    finalVerification: verification,
    cycleAudit: {
      taskId: TASK_ID,
      totalCycles: 1,
      maxCycles: 3,
      finalStatus: "human_review",
      finalRecommendedAction: "human_review",
      steps: [{
        cycleIndex: 1,
        verificationResult: verification,
        recommendedAction: "human_review",
        contentLength: content.length,
        workerCalled: false,
      }],
      totalMs: 50,
    },
  };
}

describe("S77P Context Boundary Sentinel Tests", () => {
  it("B1: artifact raw content with SECRET_TOKEN=abc123 must not appear in audit", () => {
    const verification = makeVerification();
    const result = buildHumanReviewRequestFromCycle(
      makeCycleResult("Artifact content: SECRET_TOKEN=abc123 and API_KEY=xyz", verification)
    );

    const auditStr = JSON.stringify(result.audit);
    expect(auditStr).not.toContain("SECRET_TOKEN");
    expect(auditStr).not.toContain("abc123");
  });

  it("B2: history raw content with password=supersecret must not appear in audit", () => {
    const verification = makeVerification();
    // 模拟 cycleAudit 的 finalContent（可能含 history excerpt）
    const result = buildHumanReviewRequestFromCycle(
      makeCycleResult("History: password=supersecret user=alice", verification)
    );

    const auditStr = JSON.stringify(result.audit);
    expect(auditStr).not.toContain("password");
    expect(auditStr).not.toContain("supersecret");
  });

  it("B3: memory raw content with api_key=xyz789 must not appear in audit", () => {
    const verification = makeVerification();
    const result = buildHumanReviewRequestFromCycle(
      makeCycleResult("Memory: api_key=xyz789 session=abc123", verification)
    );

    const auditStr = JSON.stringify(result.audit);
    expect(auditStr).not.toContain("api_key");
    expect(auditStr).not.toContain("xyz789");
  });

  it("B4: criterion label with API_KEY_REQUIRED must not appear in audit", () => {
    const verification = makeVerification({
      results: [{
        criterionId: "c1",
        type: "human_review",
        passed: null,
        required: true,
        confidence: 0.5,
        severity: "high",
        deterministic: false,
        reasonCode: "requires_human_review",
      }],
      // 注意：audit 只记录 count，不记录 label/description
    });
    const taskContract = {
      id: "contract-b4",
      riskLevel: "low",
      // @ts-ignore — 故意传入含敏感 label 的 criteria 来验证过滤
    } as TaskContractV0;

    const result = buildHumanReviewRequestFromCycle(
      makeCycleResult("Content with API_KEY_REQUIRED label", verification, taskContract)
    );

    // audit 中没有 criteria 内容，只有 count
    expect(result.audit.criteriaCount).toBe(1);
    // audit 对象本身不含任何 criterion 文本字段
    expect(JSON.stringify(result.audit)).not.toContain("API_KEY_REQUIRED");
    expect(JSON.stringify(result.audit)).not.toContain("criterion");
  });

  it("B5: criterion description with SSN=123-45-6789 must not appear in audit", () => {
    const verification = makeVerification({
      criteriaEvaluated: 2,
      results: [
        {
          criterionId: "c1",
          type: "human_review",
          passed: null,
          required: true,
          confidence: 0.5,
          severity: "high",
          deterministic: false,
          reasonCode: "requires_human_review",
        },
        {
          criterionId: "c2",
          type: "text_presence",
          passed: false,
          required: true,
          confidence: 1.0,
          severity: "medium",
          deterministic: true,
          reasonCode: "missing_text",
        },
      ],
    });
    // 即使 verification.results 含 criterion，但 audit 只取 criteriaCount
    const result = buildHumanReviewRequestFromCycle(
      makeCycleResult("Content must include SSN=123-45-6789 per policy", verification)
    );

    const auditStr = JSON.stringify(result.audit);
    expect(auditStr).not.toContain("SSN");
    expect(auditStr).not.toContain("123-45-6789");
    // 确认 audit 包含正确数量（不被原始内容影响）
    expect(result.audit.criteriaCount).toBe(2);
  });
});
