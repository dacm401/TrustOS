/**
 * S79P Boundary: Human Review Resume Decision — context boundary sentinel tests
 *
 * 验证 resume decision 不泄漏敏感内容。
 */

import { describe, it, expect } from "vitest";
import type { HumanReviewRequest } from "../../../src/services/human-review/human-review-types.js";
import { buildHumanReviewResumeDecision } from "../../../src/services/human-review/human-review-service.js";

function makeResolved(overrides: Partial<HumanReviewRequest> = {}): HumanReviewRequest {
  return {
    id: "req-boundary",
    taskId: "task-001",
    cycleIndex: 1,
    status: "approved",
    reasonCode: "required_human_review",
    severity: "medium",
    createdAt: "2026-05-21T10:00:00.000Z",
    resolvedAt: "2026-05-21T12:00:00.000Z",
    resolution: { action: "accept", note: "looks good", resolvedBy: "admin" },
    audit: {
      taskId: "task-001",
      recommendedAction: "human_review",
      criteriaCount: 2,
      blockingIssues: 0,
      hasSecurityIssue: false,
    },
    ...overrides,
  };
}

describe("S79P Boundary: Human Review Resume Decision", () => {

  it("B1: decision audit does not contain raw artifact content", () => {
    const request = makeResolved({
      // 注入 raw artifact 敏感内容到 resolution note
      resolution: {
        action: "accept",
        note: "Reviewer saw SECRET_TOKEN=abc123 and password=supersecret",
        resolvedBy: "admin",
      },
    });

    const decision = buildHumanReviewResumeDecision(request);
    const decisionStr = JSON.stringify(decision);

    // decision.audit 域不含 raw artifact 关键词
    expect(decisionStr).not.toContain("SECRET_TOKEN=abc123");
    expect(decisionStr).not.toContain("password=supersecret");
    expect(decisionStr).not.toContain("api_key=xyz789");

    // audit 只含 safe metadata
    expect(decision.audit.cycleIndex).toBe(1);
    expect(decision.audit.reasonCode).toBe("required_human_review");
    expect(decision.audit.severity).toBe("medium");
  });

  it("B2: decision shape is stable and all fields present", () => {
    const request = makeResolved({
      status: "needs_revision",
      resolution: { action: "revise", note: "fix it" },
      severity: "security",
    });

    const decision = buildHumanReviewResumeDecision(request);

    expect(decision).toHaveProperty("id");
    expect(decision).toHaveProperty("reviewRequestId", "req-boundary");
    expect(decision).toHaveProperty("taskId", "task-001");
    expect(decision).toHaveProperty("createdAt");
    expect(decision).toHaveProperty("source");
    expect(decision.source).toHaveProperty("reviewStatus", "needs_revision");
    expect(decision.source).toHaveProperty("resolutionAction", "revise");
    expect(decision).toHaveProperty("nextAction", "resume_with_revision");
    expect(decision).toHaveProperty("executionMode", "manual"); // security override
    expect(decision).toHaveProperty("audit");
    expect(decision.audit).toHaveProperty("requiresOperatorConfirmation", true);

    // no undefined fields
    expect(decision.id).toBeTruthy();
    expect(decision.createdAt).toBeTruthy();
  });
});
