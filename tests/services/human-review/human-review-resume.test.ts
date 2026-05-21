/**
 * S79P: Human Review Resume Decision — Service 层单元测试
 *
 * 测试 buildHumanReviewResumeDecision() 的 action+status→nextAction 映射、
 * security override、状态守卫。
 */

import { describe, it, expect } from "vitest";
import type { HumanReviewRequest } from "../../../src/services/human-review/human-review-types.js";
import { buildHumanReviewResumeDecision } from "../../../src/services/human-review/human-review-service.js";

function makeResolved(
  id = "req-001",
  overrides: Partial<HumanReviewRequest> = {}
): HumanReviewRequest {
  return {
    id,
    taskId: "task-001",
    cycleIndex: 1,
    status: "approved",
    reasonCode: "required_human_review",
    severity: "medium",
    createdAt: "2026-05-21T10:00:00.000Z",
    resolvedAt: "2026-05-21T12:00:00.000Z",
    resolution: { action: "accept", note: "ok", resolvedBy: "admin" },
    audit: {
      taskId: "task-001",
      recommendedAction: "human_review",
      criteriaCount: 3,
      blockingIssues: 0,
      hasSecurityIssue: false,
    },
    ...overrides,
  };
}

// ── T1: approved+accept → accept_final, queued ────────────────────────────

it("T1: approved + accept → accept_final, queued", () => {
  const request = makeResolved("req-T1", { status: "approved", resolution: { action: "accept" } });
  const decision = buildHumanReviewResumeDecision(request);

  expect(decision.nextAction).toBe("accept_final");
  expect(decision.executionMode).toBe("queued");
  expect(decision.source.reviewStatus).toBe("approved");
  expect(decision.source.resolutionAction).toBe("accept");
});

// ── T2: needs_revision+revise → resume_with_revision, queued ──────────────

it("T2: needs_revision + revise → resume_with_revision, queued", () => {
  const request = makeResolved("req-T2", {
    status: "needs_revision",
    resolution: { action: "revise" },
  });
  const decision = buildHumanReviewResumeDecision(request);

  expect(decision.nextAction).toBe("resume_with_revision");
  expect(decision.executionMode).toBe("queued");
});

// ── T3: needs_revision+rewrite → resume_with_rewrite, queued ─────────────

it("T3: needs_revision + rewrite → resume_with_rewrite, queued", () => {
  const request = makeResolved("req-T3", {
    status: "needs_revision",
    resolution: { action: "rewrite" },
  });
  const decision = buildHumanReviewResumeDecision(request);

  expect(decision.nextAction).toBe("resume_with_rewrite");
  expect(decision.executionMode).toBe("queued");
});

// ── T4: rejected+block → block_final, blocked ────────────────────────────

it("T4: rejected + block → block_final, blocked", () => {
  const request = makeResolved("req-T4", {
    status: "rejected",
    resolution: { action: "block" },
  });
  const decision = buildHumanReviewResumeDecision(request);

  expect(decision.nextAction).toBe("block_final");
  expect(decision.executionMode).toBe("blocked");
});

// ── T5: cancelled → cancel_task, blocked ─────────────────────────────────

it("T5: cancelled → cancel_task, blocked", () => {
  const request = makeResolved("req-T5", {
    status: "cancelled",
    resolution: undefined,
  });
  const decision = buildHumanReviewResumeDecision(request);

  expect(decision.nextAction).toBe("cancel_task");
  expect(decision.executionMode).toBe("blocked");
});

// ── T6: security severity → executionMode=manual, requiresOperatorConfirmation ──

it("T6: severity=security overrides executionMode to manual", () => {
  const request = makeResolved("req-T6", {
    status: "approved",
    resolution: { action: "accept" },
    severity: "security",
  });
  const decision = buildHumanReviewResumeDecision(request);

  expect(decision.nextAction).toBe("accept_final");  // nextAction 不变
  expect(decision.executionMode).toBe("manual");
  expect(decision.audit.requiresOperatorConfirmation).toBe(true);
});

// ── T7: hasSecurityIssue=true → executionMode=manual ────────────────────

it("T7: hasSecurityIssue=true overrides executionMode to manual", () => {
  const request = makeResolved("req-T7", {
    status: "approved",
    resolution: { action: "accept" },
    audit: {
      ...makeResolved().audit,
      hasSecurityIssue: true,
    },
  });
  const decision = buildHumanReviewResumeDecision(request);

  expect(decision.nextAction).toBe("accept_final");
  expect(decision.executionMode).toBe("manual");
  expect(decision.audit.requiresOperatorConfirmation).toBe(true);
});

// ── T8: pending request → throws ─────────────────────────────────────────

it("T8: pending request throws error", () => {
  const request = makeResolved("req-T8", { status: "pending", resolution: undefined });

  expect(() => buildHumanReviewResumeDecision(request)).toThrow("Cannot build resume decision for pending request");
});

// ── T9: non-mapped status → no_action, blocked ───────────────────────────

it("T9: non-mapped status (no resolution) → no_action, blocked", () => {
  // Simulate an edge case: resolved but with unknown status
  const request = makeResolved("req-T9", {
    status: "approved",
    resolution: { action: "revise" },  // approved+revise is not in the map
  });
  const decision = buildHumanReviewResumeDecision(request);

  expect(decision.nextAction).toBe("no_action");
  expect(decision.executionMode).toBe("blocked");
});

// ── T10: decision shape has all required fields ───────────────────────────

it("T10: decision shape has all required fields with no undefined", () => {
  const request = makeResolved("req-T10");
  const decision = buildHumanReviewResumeDecision(request);

  expect(decision.id).toBeTruthy();
  expect(decision.reviewRequestId).toBe("req-T10");
  expect(decision.taskId).toBe("task-001");
  expect(decision.createdAt).toBeTruthy();
  expect(decision.source.reviewStatus).toBe("approved");
  expect(decision.source.resolutionAction).toBe("accept");
  expect(decision.nextAction).toBe("accept_final");
  expect(decision.executionMode).toBe("queued");
  expect(decision.audit).toEqual({
    cycleIndex: 1,
    reasonCode: "required_human_review",
    severity: "medium",
    hasSecurityIssue: false,
    requiresOperatorConfirmation: false,
  });
});
