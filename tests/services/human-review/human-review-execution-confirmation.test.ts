/**
 * S83P: Resume Execution Confirmation — Service Unit Tests
 *
 * 测试范围：
 *   T1: confirm manual accept_final → executed
 *   T2: confirm manual block_final → blocked
 *   T3: confirm manual cancel_task → blocked
 *   T4: cannot confirm already executed (INVALID_STATUS)
 *   T5: cannot confirm unsupported nextAction (UNSUPPORTED_ACTION)
 *   T6: duplicate confirmation idempotent
 *   T7: execution not found (NOT_FOUND)
 *   T8: buildHumanReviewConfirmationEvent deterministic id
 *   T9: humanReviewConfirmationToLedgerExtract fields
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB repos
vi.mock("../../../src/db/human-review-execution-repo.js", () => ({
  HumanReviewResumeExecutionRepo: {
    getById: vi.fn(),
    getByDecisionId: vi.fn(),
  },
}));

vi.mock("../../../src/db/human-review-decision-repo.js", () => ({
  HumanReviewResumeDecisionRepo: {
    getById: vi.fn(),
  },
}));

vi.mock("../../../src/db/human-review-execution-confirmation-repo.js", () => ({
  HumanReviewResumeExecutionConfirmationRepo: {
    create: vi.fn(),
    getByExecutionId: vi.fn(),
  },
}));

import {
  confirmResumeExecution,
  buildHumanReviewConfirmationEvent,
  humanReviewConfirmationToLedgerExtract,
} from "../../../src/services/human-review/human-review-service.js";
import { HumanReviewResumeExecutionRepo } from "../../../src/db/human-review-execution-repo.js";
import { HumanReviewResumeDecisionRepo } from "../../../src/db/human-review-decision-repo.js";
import { HumanReviewResumeExecutionConfirmationRepo } from "../../../src/db/human-review-execution-confirmation-repo.js";

const mockedExecutionRepo = vi.mocked(HumanReviewResumeExecutionRepo);
const mockedDecisionRepo = vi.mocked(HumanReviewResumeDecisionRepo);
const mockedConfirmationRepo = vi.mocked(HumanReviewResumeExecutionConfirmationRepo);

// ── Test fixtures ─────────────────────────────────────────────────────

function makeExecution(overrides: Record<string, unknown> = {}) {
  return {
    id: "exec-001",
    decisionId: "decision-001",
    reviewRequestId: "request-001",
    taskId: "task-001",
    status: "requires_confirmation",
    executedAction: "none",
    createdAt: new Date().toISOString(),
    audit: {
      nextAction: "accept_final",
      executionMode: "manual",
      requiresOperatorConfirmation: true,
      reasonCode: "security_sensitive",
      severity: "security",
    },
    ...overrides,
  };
}

function makeDecision(overrides: Record<string, unknown> = {}) {
  return {
    id: "decision-001",
    reviewRequestId: "request-001",
    taskId: "task-001",
    createdAt: new Date().toISOString(),
    source: { reviewStatus: "approved", resolutionAction: "accept" },
    nextAction: "accept_final",
    executionMode: "manual",
    audit: {
      cycleIndex: 1,
      reasonCode: "security_sensitive",
      severity: "security",
      hasSecurityIssue: true,
      requiresOperatorConfirmation: true,
    },
    ...overrides,
  };
}

function makeConfirmation(overrides: Record<string, unknown> = {}) {
  return {
    id: "conf-001",
    executionId: "exec-001",
    decisionId: "decision-001",
    reviewRequestId: "request-001",
    taskId: "task-001",
    confirmedBy: "operator-1",
    resultStatus: "executed" as const,
    executedAction: "accept_final" as const,
    confirmedAt: new Date().toISOString(),
    audit: {
      previousStatus: "requires_confirmation" as const,
      nextAction: "accept_final" as const,
      reasonCode: "security_sensitive",
      severity: "security",
      requiresOperatorConfirmation: true as const,
    },
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("S83P: confirmResumeExecution()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── T1: confirm manual accept_final → executed ─────────────────

  it("T1: confirm accept_final → executed", async () => {
    const execution = makeExecution();
    const decision = makeDecision({ nextAction: "accept_final" });

    mockedExecutionRepo.getById.mockResolvedValue(execution);
    mockedDecisionRepo.getById.mockResolvedValue(decision);
    mockedConfirmationRepo.getByExecutionId.mockResolvedValue(null);

    const persistedConfirmation = makeConfirmation({
      resultStatus: "executed",
      executedAction: "accept_final",
    });
    mockedConfirmationRepo.create.mockResolvedValue(persistedConfirmation);

    const { confirmation, event } = await confirmResumeExecution("exec-001", "operator-1");

    expect(confirmation.resultStatus).toBe("executed");
    expect(confirmation.executedAction).toBe("accept_final");
    expect(confirmation.confirmedBy).toBe("operator-1");
    expect(confirmation.audit.previousStatus).toBe("requires_confirmation");

    expect(event.type).toBe("human_review.confirmation");
    expect(event.resultStatus).toBe("executed");
    expect(event.executedAction).toBe("accept_final");
  });

  // ── T2: confirm manual block_final → blocked ───────────────────

  it("T2: confirm block_final → blocked", async () => {
    const execution = makeExecution({ audit: { ...makeExecution().audit, nextAction: "block_final" } });
    const decision = makeDecision({ nextAction: "block_final" });

    mockedExecutionRepo.getById.mockResolvedValue(execution);
    mockedDecisionRepo.getById.mockResolvedValue(decision);
    mockedConfirmationRepo.getByExecutionId.mockResolvedValue(null);

    const persistedConfirmation = makeConfirmation({
      resultStatus: "blocked",
      executedAction: "block_final",
    });
    mockedConfirmationRepo.create.mockResolvedValue(persistedConfirmation);

    const { confirmation } = await confirmResumeExecution("exec-001", "operator-2");

    expect(confirmation.resultStatus).toBe("blocked");
    expect(confirmation.executedAction).toBe("block_final");
  });

  // ── T3: confirm manual cancel_task → blocked ──────────────────

  it("T3: confirm cancel_task → blocked", async () => {
    const execution = makeExecution({ audit: { ...makeExecution().audit, nextAction: "cancel_task" } });
    const decision = makeDecision({ nextAction: "cancel_task" });

    mockedExecutionRepo.getById.mockResolvedValue(execution);
    mockedDecisionRepo.getById.mockResolvedValue(decision);
    mockedConfirmationRepo.getByExecutionId.mockResolvedValue(null);

    const persistedConfirmation = makeConfirmation({
      resultStatus: "blocked",
      executedAction: "cancel_task",
    });
    mockedConfirmationRepo.create.mockResolvedValue(persistedConfirmation);

    const { confirmation } = await confirmResumeExecution("exec-001", "operator-3");

    expect(confirmation.resultStatus).toBe("blocked");
    expect(confirmation.executedAction).toBe("cancel_task");
  });

  // ── T4: cannot confirm already executed ───────────────────────

  it("T4: cannot confirm already executed execution (INVALID_STATUS)", async () => {
    const execution = makeExecution({ status: "executed" });
    mockedExecutionRepo.getById.mockResolvedValue(execution);

    try {
      await confirmResumeExecution("exec-001", "operator-1");
      expect.fail("Should have thrown INVALID_STATUS");
    } catch (err: any) {
      expect(err.code).toBe("INVALID_STATUS");
      expect(err.message).toContain("not in requires_confirmation state");
    }
  });

  // ── T5: cannot confirm unsupported nextAction ─────────────────

  it("T5: cannot confirm resume_with_revision (UNSUPPORTED_ACTION)", async () => {
    const execution = makeExecution();
    const decision = makeDecision({ nextAction: "resume_with_revision" });

    mockedExecutionRepo.getById.mockResolvedValue(execution);
    mockedDecisionRepo.getById.mockResolvedValue(decision);
    mockedConfirmationRepo.getByExecutionId.mockResolvedValue(null);

    try {
      await confirmResumeExecution("exec-001", "operator-1");
      expect.fail("Should have thrown UNSUPPORTED_ACTION");
    } catch (err: any) {
      expect(err.code).toBe("UNSUPPORTED_ACTION");
      expect(err.message).toContain("not a terminal action");
    }
  });

  // ── T6: duplicate confirmation idempotent ─────────────────────

  it("T6: duplicate confirmation returns existing", async () => {
    const execution = makeExecution();
    const decision = makeDecision();
    const existingConfirmation = makeConfirmation();

    mockedExecutionRepo.getById.mockResolvedValue(execution);
    mockedDecisionRepo.getById.mockResolvedValue(decision);
    mockedConfirmationRepo.getByExecutionId.mockResolvedValue(existingConfirmation);

    const { confirmation } = await confirmResumeExecution("exec-001", "operator-1");

    expect(confirmation.id).toBe(existingConfirmation.id);
    // create should NOT be called for duplicate
    expect(mockedConfirmationRepo.create).not.toHaveBeenCalled();
  });

  // ── T7: execution not found ───────────────────────────────────

  it("T7: execution not found (NOT_FOUND)", async () => {
    mockedExecutionRepo.getById.mockResolvedValue(null);

    try {
      await confirmResumeExecution("nonexistent", "operator-1");
      expect.fail("Should have thrown NOT_FOUND");
    } catch (err: any) {
      expect(err.code).toBe("NOT_FOUND");
    }
  });

  // ── T8: buildHumanReviewConfirmationEvent deterministic id ────

  it("T8: event has deterministic id", () => {
    const confirmation = makeConfirmation({ id: "conf-abc123" });
    const event = buildHumanReviewConfirmationEvent(confirmation);

    expect(event.type).toBe("human_review.confirmation");
    expect(event.id).toBe("human_review_confirmation_event_conf-abc123");
    expect(event.confirmationId).toBe("conf-abc123");
    expect(event.executionId).toBe("exec-001");
    expect(event.decisionId).toBe("decision-001");
    expect(event.reviewRequestId).toBe("request-001");
    expect(event.taskId).toBe("task-001");
    expect(event.resultStatus).toBe("executed");
    expect(event.executedAction).toBe("accept_final");
    expect(event.confirmedBy).toBe("operator-1");
    expect(event.confirmedAt).toBeTruthy();
    expect(event.audit.previousStatus).toBe("requires_confirmation");
    expect(event.audit.nextAction).toBe("accept_final");
  });

  // ── T9: humanReviewConfirmationToLedgerExtract fields ─────────

  it("T9: ledger extract contains correct fields", () => {
    const confirmation = makeConfirmation({ id: "conf-xyz" });
    const event = buildHumanReviewConfirmationEvent(confirmation);
    const extract = humanReviewConfirmationToLedgerExtract(event);

    expect(extract.confirmationId).toBe("conf-xyz");
    expect(extract.executionId).toBe("exec-001");
    expect(extract.decisionId).toBe("decision-001");
    expect(extract.reviewRequestId).toBe("request-001");
    expect(extract.taskId).toBe("task-001");
    expect(extract.resultStatus).toBe("executed");
    expect(extract.executedAction).toBe("accept_final");
    expect(extract.confirmedBy).toBe("operator-1");
    expect(extract.previousStatus).toBe("requires_confirmation");
    expect(extract.nextAction).toBe("accept_final");
  });
});
