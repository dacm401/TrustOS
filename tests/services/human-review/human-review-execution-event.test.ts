/**
 * S82P: Human Review Resume Execution Event — Service 层单元测试
 *
 * 测试 buildHumanReviewResumeExecutionEvent() 和 humanReviewResumeExecutionToLedgerExtract()：
 * - T1: event 包含正确的 type 和 deterministic id
 * - T2: event 从 execution 和 decision 正确映射所有字段
 * - T3: event audit 包含 safe metadata
 * - T4: ledger extract 是 event 的精简子集
 * - T5: 不同 execution status 都能正确映射
 */

import { describe, it, expect } from "vitest";
import type { HumanReviewResumeDecision, HumanReviewResumeExecutionResult } from "../../../src/services/human-review/human-review-types.js";
import {
  buildHumanReviewResumeExecutionEvent,
  humanReviewResumeExecutionToLedgerExtract,
} from "../../../src/services/human-review/human-review-service.js";

function makeDecision(
  id = "dec-001",
  overrides: Partial<HumanReviewResumeDecision> = {}
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
    ...overrides,
  };
}

function makeExecution(
  decisionId = "dec-001",
  overrides: Partial<HumanReviewResumeExecutionResult> = {}
): HumanReviewResumeExecutionResult {
  return {
    id: `exec-${Date.now()}`,
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
    ...overrides,
  };
}

// ── T1: event type 和 deterministic id ────────────────────────────────

it("T1: event has correct type and deterministic id format", () => {
  const decision = makeDecision("dec-T1");
  const execution = makeExecution("dec-T1", { id: "exec-abc123" });
  const event = buildHumanReviewResumeExecutionEvent(execution, decision);

  expect(event.type).toBe("human_review.resume_execution");
  expect(event.id).toBe("human_review_resume_execution_event_exec-abc123");
});

// ── T2: event 正确映射 execution 和 decision 字段 ───────────────────

it("T2: event correctly maps execution and decision fields", () => {
  const decision = makeDecision("dec-T2", {
    reviewRequestId: "req-T2",
    taskId: "task-T2",
  });
  const execution = makeExecution("dec-T2", {
    id: "exec-T2",
    reviewRequestId: "req-T2",
    taskId: "task-T2",
    status: "executed",
    executedAction: "accept_final",
    createdAt: "2026-05-25T12:00:00.000Z",
  });
  const event = buildHumanReviewResumeExecutionEvent(execution, decision);

  expect(event.executionId).toBe("exec-T2");
  expect(event.decisionId).toBe("dec-T2");
  expect(event.reviewRequestId).toBe("req-T2");
  expect(event.taskId).toBe("task-T2");
  expect(event.status).toBe("executed");
  expect(event.executedAction).toBe("accept_final");
  expect(event.createdAt).toBe("2026-05-25T12:00:00.000Z");
});

// ── T3: event audit 包含 safe metadata ──────────────────────────────

it("T3: event audit contains safe metadata from decision", () => {
  const decision = makeDecision("dec-T3", {
    nextAction: "block_final",
    executionMode: "blocked",
    audit: {
      cycleIndex: 2,
      reasonCode: "high_risk_content",
      severity: "high",
      hasSecurityIssue: true,
      requiresOperatorConfirmation: true,
    },
  });
  const execution = makeExecution("dec-T3", {
    audit: {
      nextAction: "block_final",
      executionMode: "blocked",
      requiresOperatorConfirmation: true,
      reasonCode: "high_risk_content",
      severity: "high",
    },
  });
  const event = buildHumanReviewResumeExecutionEvent(execution, decision);

  expect(event.audit).toEqual({
    nextAction: "block_final",
    executionMode: "blocked",
    requiresOperatorConfirmation: true,
    reasonCode: "high_risk_content",
    severity: "high",
  });
});

// ── T4: ledger extract 是 event 的精简子集 ─────────────────────────

it("T4: ledger extract is a simplified subset of event", () => {
  const decision = makeDecision("dec-T4");
  const execution = makeExecution("dec-T4", { id: "exec-T4" });
  const event = buildHumanReviewResumeExecutionEvent(execution, decision);
  const extract = humanReviewResumeExecutionToLedgerExtract(event);

  // extract 包含关键字段
  expect(extract.executionId).toBe("exec-T4");
  expect(extract.decisionId).toBe("dec-T4");
  expect(extract.reviewRequestId).toBe("req-001");
  expect(extract.taskId).toBe("task-001");
  expect(extract.status).toBe("executed");
  expect(extract.executedAction).toBe("accept_final");
  expect(extract.nextAction).toBe("accept_final");
  expect(extract.executionMode).toBe("queued");
  expect(extract.requiresOperatorConfirmation).toBe(false);

  // extract 不含 event type/id/createdAt/audit
  expect(extract as any).not.toHaveProperty("type");
  expect(extract as any).not.toHaveProperty("id");
  expect(extract as any).not.toHaveProperty("createdAt");
  expect(extract as any).not.toHaveProperty("audit");
});

// ── T5: 不同 execution status 正确映射 ──────────────────────────────

it("T5: different execution statuses all map correctly to event", () => {
  const cases = [
    { status: "executed" as const, action: "accept_final" as const, mode: "queued" as const, nextAction: "accept_final" as const },
    { status: "blocked" as const, action: "block_final" as const, mode: "blocked" as const, nextAction: "block_final" as const },
    { status: "blocked" as const, action: "cancel_task" as const, mode: "blocked" as const, nextAction: "cancel_task" as const },
    { status: "requires_confirmation" as const, action: "none" as const, mode: "manual" as const, nextAction: "accept_final" as const },
    { status: "unsupported" as const, action: "none" as const, mode: "queued" as const, nextAction: "resume_with_revision" as const },
  ];

  for (const c of cases) {
    const decision = makeDecision(`dec-${c.status}`, {
      nextAction: c.nextAction,
      executionMode: c.mode,
    });
    const execution = makeExecution(`dec-${c.status}`, {
      id: `exec-${c.status}`,
      status: c.status,
      executedAction: c.action,
    });
    const event = buildHumanReviewResumeExecutionEvent(execution, decision);

    expect(event.status).toBe(c.status);
    expect(event.executedAction).toBe(c.action);
    expect(event.audit.nextAction).toBe(c.nextAction);
    expect(event.audit.executionMode).toBe(c.mode);
  }
});
