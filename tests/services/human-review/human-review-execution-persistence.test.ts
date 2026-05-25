/**
 * S81P: Human Review Resume Execution — Persistence Tests
 *
 * 测试 HumanReviewResumeExecutionRepo 的 CRUD 操作和幂等性。
 * 使用 mock 避免真实 DB 依赖。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HumanReviewResumeExecutionResult } from "../../../src/services/human-review/human-review-types.js";
import { HumanReviewResumeExecutionRepo } from "../../../src/db/human-review-execution-repo.js";

vi.mock("../../../src/db/connection.js", () => ({
  query: vi.fn(),
}));

const { query } = await import("../../../src/db/connection.js");

function resetMocks() {
  vi.mocked(query).mockReset();
  vi.mocked(query).mockResolvedValue({ rows: [] });
}

function makeExecution(
  overrides: Partial<HumanReviewResumeExecutionResult> = {}
): Omit<HumanReviewResumeExecutionResult, "id"> {
  return {
    decisionId: "dec-001",
    reviewRequestId: "req-001",
    taskId: "task-001",
    status: "executed",
    executedAction: "accept_final",
    createdAt: "2026-05-21T10:00:00.000Z",
    executedAt: "2026-05-21T10:00:01.000Z",
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

beforeEach(() => {
  resetMocks();
});

// ── P1: create execution ────────────────────────────────────────────────

it("P1: create execution stores all fields correctly", async () => {
  const mockRow = {
    id: "exec-001",
    decision_id: "dec-001",
    review_request_id: "req-001",
    task_id: "task-001",
    status: "executed",
    executed_action: "accept_final",
    audit_json: JSON.stringify({
      nextAction: "accept_final",
      executionMode: "queued",
      requiresOperatorConfirmation: false,
      reasonCode: "required_human_review",
      severity: "medium",
    }),
    created_at: "2026-05-21T10:00:00.000Z",
    executed_at: "2026-05-21T10:00:01.000Z",
  };

  vi.mocked(query).mockResolvedValue({ rows: [mockRow] });

  const execution = makeExecution();
  const result = await HumanReviewResumeExecutionRepo.create(execution);

  expect(result.id).toBe("exec-001");
  expect(result.decisionId).toBe("dec-001");
  expect(result.status).toBe("executed");
  expect(result.executedAction).toBe("accept_final");
  expect(query).toHaveBeenCalled();
});

// ── P2: getById ─────────────────────────────────────────────────────────

it("P2: getById returns execution by id", async () => {
  const mockRow = {
    id: "exec-002",
    decision_id: "dec-002",
    review_request_id: "req-002",
    task_id: "task-002",
    status: "blocked",
    executed_action: "block_final",
    audit_json: JSON.stringify({
      nextAction: "block_final",
      executionMode: "blocked",
      requiresOperatorConfirmation: false,
      reasonCode: "high_risk",
      severity: "high",
    }),
    created_at: "2026-05-21T11:00:00.000Z",
    executed_at: "2026-05-21T11:00:01.000Z",
  };

  vi.mocked(query).mockResolvedValue({ rows: [mockRow] });

  const result = await HumanReviewResumeExecutionRepo.getById("exec-002");

  expect(result).not.toBeNull();
  expect(result!.id).toBe("exec-002");
  expect(result!.decisionId).toBe("dec-002");
  expect(result!.status).toBe("blocked");
});

// ── P3: getByDecisionId ──────────────────────────────────────────────────

it("P3: getByDecisionId returns execution by decision id", async () => {
  const mockRow = {
    id: "exec-003",
    decision_id: "dec-003",
    review_request_id: "req-003",
    task_id: "task-003",
    status: "requires_confirmation",
    executed_action: "none",
    audit_json: JSON.stringify({
      nextAction: "accept_final",
      executionMode: "manual",
      requiresOperatorConfirmation: true,
      reasonCode: "security_sensitive",
      severity: "security",
    }),
    created_at: "2026-05-21T12:00:00.000Z",
    executed_at: null,
  };

  vi.mocked(query).mockResolvedValue({ rows: [mockRow] });

  const result = await HumanReviewResumeExecutionRepo.getByDecisionId("dec-003");

  expect(result).not.toBeNull();
  expect(result!.decisionId).toBe("dec-003");
  expect(result!.status).toBe("requires_confirmation");
  expect(result!.executedAction).toBe("none");
});

// ── P4: duplicate create returns existing execution ──────────────────────

it("P4: create returns newly created execution on first write", async () => {
  const newRow = {
    id: "exec-new-004",
    decision_id: "dec-004",
    review_request_id: "req-004",
    task_id: "task-004",
    status: "executed",
    executed_action: "accept_final",
    audit_json: JSON.stringify({
      nextAction: "accept_final",
      executionMode: "queued",
      requiresOperatorConfirmation: false,
      reasonCode: "required_human_review",
      severity: "medium",
    }),
    created_at: "2026-05-21T13:00:00.000Z",
    executed_at: "2026-05-21T13:00:01.000Z",
  };

  // ensureTable call, then INSERT RETURNING
  vi.mocked(query)
    .mockResolvedValueOnce({ rows: [] })  // ensureTable
    .mockResolvedValueOnce({ rows: [newRow] });  // INSERT RETURNING

  const execution = makeExecution({
    decisionId: "dec-004",
    reviewRequestId: "req-004",
    taskId: "task-004",
  });

  const result = await HumanReviewResumeExecutionRepo.create(execution);

  expect(result.id).toBe("exec-new-004");
  expect(result.decisionId).toBe("dec-004");
});

// ── P5: list by status / executedAction ────────────────────────────────

it("P5: list by status returns filtered executions", async () => {
  const mockRows = [
    {
      id: "exec-005a",
      decision_id: "dec-005a",
      review_request_id: "req-005a",
      task_id: "task-005",
      status: "executed",
      executed_action: "accept_final",
      audit_json: JSON.stringify({
        nextAction: "accept_final",
        executionMode: "queued",
        requiresOperatorConfirmation: false,
        reasonCode: "required_human_review",
        severity: "medium",
      }),
      created_at: "2026-05-21T14:00:00.000Z",
      executed_at: "2026-05-21T14:00:01.000Z",
    },
    {
      id: "exec-005b",
      decision_id: "dec-005b",
      review_request_id: "req-005b",
      task_id: "task-005",
      status: "executed",
      executed_action: "accept_final",
      audit_json: JSON.stringify({
        nextAction: "accept_final",
        executionMode: "queued",
        requiresOperatorConfirmation: false,
        reasonCode: "required_human_review",
        severity: "medium",
      }),
      created_at: "2026-05-21T14:00:02.000Z",
      executed_at: "2026-05-21T14:00:03.000Z",
    },
  ];

  vi.mocked(query).mockResolvedValue({ rows: mockRows });

  const results = await HumanReviewResumeExecutionRepo.list({
    status: "executed",
    executedAction: "accept_final",
    limit: 10,
  });

  expect(results).toHaveLength(2);
  expect(results[0].status).toBe("executed");
  expect(results[1].status).toBe("executed");
});
