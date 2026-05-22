/**
 * S81P: Human Review Resume Execution — Service 层单元测试
 *
 * 测试 buildHumanReviewResumeExecutionResult() 的执行策略：
 * - accept_final + queued → executed / accept_final
 * - block_final + blocked → blocked / block_final
 * - cancel_task + blocked → blocked / cancel_task
 * - manual → requires_confirmation / none
 * - resume_with_revision → unsupported / none
 * - resume_with_rewrite → unsupported / none
 */

import { describe, it, expect } from "vitest";
import type { HumanReviewResumeDecision } from "../../../src/services/human-review/human-review-types.js";
import { buildHumanReviewResumeExecutionResult } from "../../../src/services/human-review/human-review-service.js";

function makeDecision(
  id = "dec-001",
  overrides: Partial<HumanReviewResumeDecision> = {}
): HumanReviewResumeDecision {
  return {
    id,
    reviewRequestId: "req-001",
    taskId: "task-001",
    createdAt: "2026-05-21T10:00:00.000Z",
    source: {
      reviewStatus: "approved",
      resolutionAction: "accept",
    },
    nextAction: "accept_final",
    executionMode: "queued",
    audit: {
      cycleIndex: 1,
      reasonCode: "required_human_review",
      severity: "medium",
      hasSecurityIssue: false,
      requiresOperatorConfirmation: false,
    },
    ...overrides,
  };
}

// ── T1: accept_final + queued → executed / accept_final ──────────────────

it("T1: accept_final + queued → executed / accept_final", () => {
  const decision = makeDecision("dec-T1", {
    nextAction: "accept_final",
    executionMode: "queued",
  });
  const result = buildHumanReviewResumeExecutionResult(decision);

  expect(result.status).toBe("executed");
  expect(result.executedAction).toBe("accept_final");
  expect(result.decisionId).toBe("dec-T1");
  expect(result.reviewRequestId).toBe("req-001");
  expect(result.taskId).toBe("task-001");
  expect(result.executedAt).toBeTruthy();
});

// ── T2: block_final + blocked → blocked / block_final ────────────────────

it("T2: block_final + blocked → blocked / block_final", () => {
  const decision = makeDecision("dec-T2", {
    nextAction: "block_final",
    executionMode: "blocked",
  });
  const result = buildHumanReviewResumeExecutionResult(decision);

  expect(result.status).toBe("blocked");
  expect(result.executedAction).toBe("block_final");
  expect(result.decisionId).toBe("dec-T2");
  expect(result.executedAt).toBeTruthy();
});

// ── T3: cancel_task + blocked → blocked / cancel_task ───────────────────

it("T3: cancel_task + blocked → blocked / cancel_task", () => {
  const decision = makeDecision("dec-T3", {
    nextAction: "cancel_task",
    executionMode: "blocked",
  });
  const result = buildHumanReviewResumeExecutionResult(decision);

  expect(result.status).toBe("blocked");
  expect(result.executedAction).toBe("cancel_task");
  expect(result.decisionId).toBe("dec-T3");
  expect(result.executedAt).toBeTruthy();
});

// ── T4: manual accept_final → requires_confirmation / none ──────────────

it("T4: manual accept_final → requires_confirmation / none", () => {
  const decision = makeDecision("dec-T4", {
    nextAction: "accept_final",
    executionMode: "manual",
  });
  const result = buildHumanReviewResumeExecutionResult(decision);

  expect(result.status).toBe("requires_confirmation");
  expect(result.executedAction).toBe("none");
  expect(result.decisionId).toBe("dec-T4");
  expect(result.executedAt).toBeUndefined();
});

// ── T5: resume_with_revision → unsupported / none ────────────────────────

it("T5: resume_with_revision → unsupported / none", () => {
  const decision = makeDecision("dec-T5", {
    nextAction: "resume_with_revision",
    executionMode: "queued",
  });
  const result = buildHumanReviewResumeExecutionResult(decision);

  expect(result.status).toBe("unsupported");
  expect(result.executedAction).toBe("none");
  expect(result.decisionId).toBe("dec-T5");
  expect(result.executedAt).toBeUndefined();
});

// ── T6: resume_with_rewrite → unsupported / none ─────────────────────────

it("T6: resume_with_rewrite → unsupported / none", () => {
  const decision = makeDecision("dec-T6", {
    nextAction: "resume_with_rewrite",
    executionMode: "queued",
  });
  const result = buildHumanReviewResumeExecutionResult(decision);

  expect(result.status).toBe("unsupported");
  expect(result.executedAction).toBe("none");
  expect(result.decisionId).toBe("dec-T6");
  expect(result.executedAt).toBeUndefined();
});

// ── T7: execution audit contains expected safe fields ─────────────────────

it("T7: execution audit contains expected safe fields", () => {
  const decision = makeDecision("dec-T7");
  const result = buildHumanReviewResumeExecutionResult(decision);

  expect(result.audit).toEqual({
    nextAction: "accept_final",
    executionMode: "queued",
    requiresOperatorConfirmation: false,
    reasonCode: "required_human_review",
    severity: "medium",
  });
});

// ── T8: execution result includes decisionId/reviewRequestId/taskId ──────

it("T8: execution result includes decisionId/reviewRequestId/taskId", () => {
  const decision = makeDecision("dec-T8", {
    reviewRequestId: "req-T8",
    taskId: "task-T8",
  });
  const result = buildHumanReviewResumeExecutionResult(decision);

  expect(result.decisionId).toBe("dec-T8");
  expect(result.reviewRequestId).toBe("req-T8");
  expect(result.taskId).toBe("task-T8");
  expect(result.createdAt).toBeTruthy();
});
