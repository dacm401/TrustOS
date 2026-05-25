/**
 * S83P: Resume Execution Confirmation — Boundary Sentinel Tests
 *
 * 验证 confirmation event / ledger extract 不泄露：
 *   - raw artifact / history / memory
 *   - criterion label / description / expected / content
 *   - resolution.note
 *   - 任何非 safe metadata 字段
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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

function makeExecution() {
  return {
    id: "exec-b1",
    decisionId: "decision-b1",
    reviewRequestId: "request-b1",
    taskId: "task-b1",
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
  };
}

function makeDecision() {
  return {
    id: "decision-b1",
    reviewRequestId: "request-b1",
    taskId: "task-b1",
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
  };
}

function makeConfirmation() {
  return {
    id: "conf-b1",
    executionId: "exec-b1",
    decisionId: "decision-b1",
    reviewRequestId: "request-b1",
    taskId: "task-b1",
    confirmedBy: "operator-b1",
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
  };
}

describe("S83P Boundary: Confirmation event/extract context safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── B1: event JSON does not contain raw artifact ──────────────

  it("B1: event JSON does not contain raw artifact references", () => {
    const confirmation = makeConfirmation();
    const event = buildHumanReviewConfirmationEvent(confirmation);
    const json = JSON.stringify(event);
    expect(json).not.toContain("artifact");
    expect(json).not.toContain("content");
    expect(json).not.toContain("source_text");
  });

  // ── B2: event JSON does not contain raw history ───────────────

  it("B2: event JSON does not contain raw history references", () => {
    const confirmation = makeConfirmation();
    const event = buildHumanReviewConfirmationEvent(confirmation);
    const json = JSON.stringify(event);
    expect(json).not.toContain("history");
  });

  // ── B3: event JSON does not contain raw memory ────────────────

  it("B3: event JSON does not contain raw memory references", () => {
    const confirmation = makeConfirmation();
    const event = buildHumanReviewConfirmationEvent(confirmation);
    const json = JSON.stringify(event);
    expect(json).not.toContain("memory");
  });

  // ── B4: event JSON does not contain criterion text ────────────

  it("B4: event JSON does not contain criterion text/label/description/expected", () => {
    const confirmation = makeConfirmation();
    const event = buildHumanReviewConfirmationEvent(confirmation);
    const json = JSON.stringify(event);
    expect(json).not.toContain("criterion");
    expect(json).not.toContain("label");
    expect(json).not.toContain("description");
    expect(json).not.toContain("expected");
  });

  // ── B5: event JSON does not contain resolution.note ───────────

  it("B5: event JSON does not contain resolution.note", () => {
    const confirmation = makeConfirmation();
    const event = buildHumanReviewConfirmationEvent(confirmation);
    const json = JSON.stringify(event);
    expect(json).not.toContain('"note"');
    expect(json).not.toContain("resolution");
  });

  // ── B6: ledger extract is safe subset ─────────────────────────

  it("B6: ledger extract only contains safe metadata fields", () => {
    const confirmation = makeConfirmation();
    const event = buildHumanReviewConfirmationEvent(confirmation);
    const extract = humanReviewConfirmationToLedgerExtract(event);
    const json = JSON.stringify(extract);

    expect(json).not.toContain("artifact");
    expect(json).not.toContain("history");
    expect(json).not.toContain("memory");
    expect(json).not.toContain('"note"');
    expect(json).not.toContain("criterion");
  });

  // ── B7: confirmResumeExecution returns context-safe result ────

  it("B7: confirmResumeExecution returns context-safe confirmation", async () => {
    const execution = makeExecution();
    const decision = makeDecision();
    const persistedConfirmation = makeConfirmation();

    mockedExecutionRepo.getById.mockResolvedValue(execution);
    mockedDecisionRepo.getById.mockResolvedValue(decision);
    mockedConfirmationRepo.getByExecutionId.mockResolvedValue(null);
    mockedConfirmationRepo.create.mockResolvedValue(persistedConfirmation);

    const { confirmation, event } = await confirmResumeExecution("exec-b1", "operator-b1");

    // Serialize both to verify no leaks
    const confirmJson = JSON.stringify(confirmation);
    const eventJson = JSON.stringify(event);

    // Safe keywords that SHOULD be present
    expect(confirmJson).toContain("executed");
    expect(eventJson).toContain("executed");

    // Unsafe keywords that must NOT be present
    for (const json of [confirmJson, eventJson]) {
      expect(json).not.toContain("artifact");
      expect(json).not.toContain("history");
      expect(json).not.toContain("memory");
      expect(json).not.toContain('"note"');
      expect(json).not.toContain("criterion");
    }
  });
});
