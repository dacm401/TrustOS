/**
 * S82P: Human Review Resume Execution Event — Boundary Sentinel Tests
 *
 * 验证 event 不泄漏敏感内容：
 * - B1: no raw artifact source
 * - B2: no raw history text
 * - B3: no raw memory text
 * - B4: no criterion label/description/expected
 * - B5: no resolution.note
 * - B6: no undefined fields in event
 * - B7: ledger extract 无敏感字段
 */

import { describe, it, expect } from "vitest";
import type { HumanReviewResumeDecision, HumanReviewResumeExecutionResult } from "../../../src/services/human-review/human-review-types.js";
import {
  buildHumanReviewResumeExecutionEvent,
  humanReviewResumeExecutionToLedgerExtract,
} from "../../../src/services/human-review/human-review-service.js";

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
    createdAt: "2026-05-25T10:00:00.000Z",
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

function makeExecution(
  decisionId = "dec-boundary"
): HumanReviewResumeExecutionResult {
  return {
    id: `exec-${decisionId}`,
    decisionId,
    reviewRequestId: "req-001",
    taskId: "task-001",
    status: "executed",
    executedAction: "accept_final",
    createdAt: "2026-05-25T10:00:01.000Z",
    executedAt: "2026-05-25T10:00:01.000Z",
    audit: {
      nextAction: "accept_final",
      executionMode: "queued",
      requiresOperatorConfirmation: false,
      reasonCode: "required_human_review",
      severity: "medium",
    },
  };
}

// ── B1: no raw artifact source in event ─────────────────────────────

it("B1: event does not contain raw artifact source keywords", () => {
  const decision = makeDecision("dec-B1");
  const execution = makeExecution("dec-B1");
  const event = buildHumanReviewResumeExecutionEvent(execution, decision);
  const eventStr = JSON.stringify(event);

  for (const keyword of SENSITIVE_KEYWORDS) {
    expect(eventStr.toLowerCase()).not.toContain(keyword.toLowerCase());
  }
});

// ── B2: no raw history text in event ─────────────────────────────────

it("B2: event does not contain raw history text keywords", () => {
  const decision = makeDecision("dec-B2");
  const execution = makeExecution("dec-B2");
  const event = buildHumanReviewResumeExecutionEvent(execution, decision);
  const eventStr = JSON.stringify(event);

  for (const keyword of ["history", "conversation", "message"]) {
    expect(eventStr.toLowerCase()).not.toContain(`${keyword}_text`);
  }
});

// ── B3: no raw memory text in event ──────────────────────────────────

it("B3: event does not contain raw memory text keywords", () => {
  const decision = makeDecision("dec-B3");
  const execution = makeExecution("dec-B3");
  const event = buildHumanReviewResumeExecutionEvent(execution, decision);
  const eventStr = JSON.stringify(event);

  expect(eventStr.toLowerCase()).not.toContain("memory_text");
  expect(eventStr.toLowerCase()).not.toContain("user_memory");
});

// ── B4: no criterion text fields in event ────────────────────────────

it("B4: event does not contain criterion text fields", () => {
  const decision = makeDecision("dec-B4");
  const execution = makeExecution("dec-B4");
  const event = buildHumanReviewResumeExecutionEvent(execution, decision);
  const auditStr = JSON.stringify(event.audit);

  expect(auditStr).not.toContain("criterion_label");
  expect(auditStr).not.toContain("criterion_description");
  expect(auditStr).not.toContain("criterion_expected");
  expect(auditStr).not.toContain("expected_value");
});

// ── B5: no resolution.note in event ──────────────────────────────────

it("B5: event does not contain resolution.note", () => {
  const decision = makeDecision("dec-B5");
  const execution = makeExecution("dec-B5");
  const event = buildHumanReviewResumeExecutionEvent(execution, decision);
  const eventStr = JSON.stringify(event);

  expect(eventStr).not.toContain("resolution_note");
  expect(eventStr).not.toContain("note_content");
  expect(eventStr).not.toContain('"note"');
});

// ── B6: event has no undefined/null fields ──────────────────────────

it("B6: event has no undefined/null fields", () => {
  const decision = makeDecision("dec-B6");
  const execution = makeExecution("dec-B6");
  const event = buildHumanReviewResumeExecutionEvent(execution, decision);

  expect(event.type).toBeTruthy();
  expect(event.id).toBeTruthy();
  expect(event.executionId).toBeTruthy();
  expect(event.decisionId).toBeTruthy();
  expect(event.reviewRequestId).toBeTruthy();
  expect(event.taskId).toBeTruthy();
  expect(event.status).toBeTruthy();
  expect(event.executedAction).toBeTruthy();
  expect(event.createdAt).toBeTruthy();
  expect(event.audit).toBeTruthy();
  expect(event.audit.nextAction).toBeTruthy();
  expect(event.audit.executionMode).toBeTruthy();
  expect(event.audit.requiresOperatorConfirmation).not.toBeNull();
  expect(event.audit.reasonCode).toBeTruthy();
  expect(event.audit.severity).toBeTruthy();
});

// ── B7: ledger extract 无敏感字段 ──────────────────────────────────

it("B7: ledger extract does not contain sensitive keywords", () => {
  const decision = makeDecision("dec-B7");
  const execution = makeExecution("dec-B7");
  const event = buildHumanReviewResumeExecutionEvent(execution, decision);
  const extract = humanReviewResumeExecutionToLedgerExtract(event);
  const extractStr = JSON.stringify(extract);

  for (const keyword of SENSITIVE_KEYWORDS) {
    expect(extractStr.toLowerCase()).not.toContain(keyword.toLowerCase());
  }
});
