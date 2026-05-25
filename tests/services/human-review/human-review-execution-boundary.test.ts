/**
 * S81P: Human Review Resume Execution — Boundary Sentinel Tests
 *
 * 验证 execution audit 不泄漏敏感内容：
 * - B1: no raw artifact source
 * - B2: no raw history text
 * - B3: no raw memory text
 * - B4: no criterion label/description/expected
 * - B5: no resolution.note
 * - B6: no undefined fields in execution result
 */

import { describe, it, expect } from "vitest";
import type { HumanReviewResumeDecision } from "../../../src/services/human-review/human-review-types.js";
import { buildHumanReviewResumeExecutionResult } from "../../../src/services/human-review/human-review-service.js";

const SENSITIVE_KEYWORDS = [
  "artifact_content",
  "raw_content",
  "source_code",
  "history_text",
  "conversation_history",
  "memory_text",
  "user_memory",
  "criterion_label",
  "criterion_description",
  "criterion_expected",
  "expected_value",
  "resolution_note",
  "note_content",
];

function makeDecision(
  id = "dec-boundary"
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
  };
}

// ── B1: no raw artifact source in execution audit ───────────────────────

it("B1: execution audit does not contain raw artifact source keywords", () => {
  const decision = makeDecision("dec-B1");
  const result = buildHumanReviewResumeExecutionResult(decision);
  const auditStr = JSON.stringify(result.audit);

  for (const keyword of SENSITIVE_KEYWORDS) {
    expect(auditStr.toLowerCase()).not.toContain(keyword.toLowerCase());
  }
});

// ── B2: no raw history text in execution audit ───────────────────────────

it("B2: execution audit does not contain raw history text keywords", () => {
  const decision = makeDecision("dec-B2");
  const result = buildHumanReviewResumeExecutionResult(decision);
  const resultStr = JSON.stringify(result);

  for (const keyword of ["history", "conversation", "message"]) {
    expect(resultStr.toLowerCase()).not.toContain(`${keyword}_text`);
  }
});

// ── B3: no raw memory text in execution audit ─────────────────────────────

it("B3: execution audit does not contain raw memory text keywords", () => {
  const decision = makeDecision("dec-B3");
  const result = buildHumanReviewResumeExecutionResult(decision);
  const resultStr = JSON.stringify(result);

  expect(resultStr.toLowerCase()).not.toContain("memory_text");
  expect(resultStr.toLowerCase()).not.toContain("user_memory");
});

// ── B4: no criterion label/description/expected in execution audit ────────

it("B4: execution audit does not contain criterion text fields", () => {
  const decision = makeDecision("dec-B4");
  const result = buildHumanReviewResumeExecutionResult(decision);
  const auditStr = JSON.stringify(result.audit);

  expect(auditStr).not.toContain("criterion_label");
  expect(auditStr).not.toContain("criterion_description");
  expect(auditStr).not.toContain("criterion_expected");
  expect(auditStr).not.toContain("expected_value");
});

// ── B5: no resolution.note in execution audit ─────────────────────────────

it("B5: execution audit does not contain resolution.note", () => {
  const decision = makeDecision("dec-B5");
  const result = buildHumanReviewResumeExecutionResult(decision);
  const resultStr = JSON.stringify(result);

  expect(resultStr).not.toContain("resolution_note");
  expect(resultStr).not.toContain("note_content");
  expect(resultStr).not.toContain('"note"');
});

// ── B6: execution result has no undefined fields ───────────────────────────

it("B6: execution result has no undefined/null fields (except executedAt)", () => {
  const decision = makeDecision("dec-B6");
  const result = buildHumanReviewResumeExecutionResult(decision);

  expect(result.id).toBeUndefined();  // id IS in Omit<..., "id">, so it is correctly excluded
  expect(result.decisionId).toBe("dec-B6");
  expect(result.reviewRequestId).toBe("req-001");
  expect(result.taskId).toBe("task-001");
  expect(result.status).toBeTruthy();
  expect(result.executedAction).toBeTruthy();
  expect(result.createdAt).toBeTruthy();
  expect(result.audit).toBeTruthy();
  expect(result.audit.nextAction).toBeTruthy();
  expect(result.audit.executionMode).toBeTruthy();
  expect(result.audit.requiresOperatorConfirmation).toBe(false);
  expect(result.audit.reasonCode).toBeTruthy();
  expect(result.audit.severity).toBeTruthy();
});
