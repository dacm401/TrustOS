/**
 * S80P: Resume Decision Persistence — Service Tests
 *
 * 验证 createOrGetResumeDecision() 行为：
 * - 首次调用：计算 + 持久化
 * - 重复调用：返回已有记录（幂等）
 * - pending 状态：throws
 * - security override 在持久化后保持一致
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  HumanReviewRequest,
  HumanReviewResumeDecision,
} from "../../../src/services/human-review/human-review-types.js";

// ── Mock Decision Repo ────────────────────────────────────────────────────

let mockDb: Map<string, HumanReviewResumeDecision> = new Map();

function resetMockDb() {
  mockDb = new Map();
}

const mockDecisionRepo = {
  async create(decision: Omit<HumanReviewResumeDecision, "id">): Promise<HumanReviewResumeDecision> {
    // 检查 review_request_id 唯一性
    for (const [, existing] of mockDb) {
      if (existing.reviewRequestId === decision.reviewRequestId) {
        return existing; // 幂等
      }
    }
    const persisted: HumanReviewResumeDecision = {
      ...decision,
      id: `persisted-${decision.reviewRequestId}`,
    };
    mockDb.set(persisted.id, persisted);
    return persisted;
  },
  async getByReviewRequestId(reviewRequestId: string): Promise<HumanReviewResumeDecision | null> {
    for (const [, decision] of mockDb) {
      if (decision.reviewRequestId === reviewRequestId) return decision;
    }
    return null;
  },
  async getById(id: string): Promise<HumanReviewResumeDecision | null> {
    return mockDb.get(id) ?? null;
  },
  async list(): Promise<HumanReviewResumeDecision[]> {
    return Array.from(mockDb.values());
  },
};

// ── Mock Request Repo (not directly used, but imported by service) ────────

vi.mock("../../../src/db/human-review-repo.js", () => ({
  HumanReviewRequestRepo: {},
}));

vi.mock("../../../src/db/human-review-decision-repo.js", () => ({
  HumanReviewResumeDecisionRepo: mockDecisionRepo,
}));

// ── Fixtures ──────────────────────────────────────────────────────────────

function makeResolvedRequest(
  overrides: Partial<HumanReviewRequest> = {}
): HumanReviewRequest {
  return {
    id: `hr-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    taskId: "task-123",
    contractId: "contract-456",
    cycleIndex: 1,
    status: "approved",
    reasonCode: "required_human_review",
    severity: "low",
    createdAt: "2026-05-21T10:00:00.000Z",
    resolvedAt: "2026-05-21T10:05:00.000Z",
    resolution: { action: "accept", resolvedBy: "admin" },
    audit: {
      taskId: "task-123",
      riskLevel: "low",
      recommendedAction: "human_review",
      criteriaCount: 3,
      blockingIssues: 0,
      hasSecurityIssue: false,
    },
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("S80P Service: createOrGetResumeDecision", () => {
  beforeEach(() => {
    resetMockDb();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("T1: first call creates and persists decision", async () => {
    const request = makeResolvedRequest();

    const { createOrGetResumeDecision } = await import(
      "../../../src/services/human-review/human-review-service.js"
    );

    const decision = await createOrGetResumeDecision(request);

    expect(decision.nextAction).toBe("accept_final");
    expect(decision.executionMode).toBe("queued");
    expect(decision.reviewRequestId).toBe(request.id);
    expect(decision.id).toBeDefined();
    expect(decision.id).toMatch(/^persisted-/);

    // 验证 DB 中有记录
    const fromDb = await mockDecisionRepo.getByReviewRequestId(request.id);
    expect(fromDb).not.toBeNull();
    expect(fromDb!.id).toBe(decision.id);
  });

  it("T2: second call returns same decision (idempotent)", async () => {
    const request = makeResolvedRequest();

    const { createOrGetResumeDecision } = await import(
      "../../../src/services/human-review/human-review-service.js"
    );

    const first = await createOrGetResumeDecision(request);
    const second = await createOrGetResumeDecision(request);

    expect(second.id).toBe(first.id);
    expect(second.nextAction).toBe(first.nextAction);
    expect(second.executionMode).toBe(first.executionMode);
    expect(second.createdAt).toBe(first.createdAt);
  });

  it("T3: pending request throws", async () => {
    const request = makeResolvedRequest({ status: "pending", resolution: undefined });

    const { createOrGetResumeDecision } = await import(
      "../../../src/services/human-review/human-review-service.js"
    );

    await expect(createOrGetResumeDecision(request)).rejects.toThrow(
      "Cannot build resume decision for pending request"
    );
  });

  it("T4: revise → resume_with_revision persisted correctly", async () => {
    const request = makeResolvedRequest({
      status: "needs_revision",
      resolution: { action: "revise" },
    });

    const { createOrGetResumeDecision } = await import(
      "../../../src/services/human-review/human-review-service.js"
    );

    const decision = await createOrGetResumeDecision(request);

    expect(decision.nextAction).toBe("resume_with_revision");
    expect(decision.executionMode).toBe("queued");
    expect(decision.source.reviewStatus).toBe("needs_revision");
    expect(decision.source.resolutionAction).toBe("revise");
  });

  it("T5: block → block_final persisted correctly", async () => {
    const request = makeResolvedRequest({
      status: "rejected",
      resolution: { action: "block" },
    });

    const { createOrGetResumeDecision } = await import(
      "../../../src/services/human-review/human-review-service.js"
    );

    const decision = await createOrGetResumeDecision(request);

    expect(decision.nextAction).toBe("block_final");
    expect(decision.executionMode).toBe("blocked");
  });

  it("T6: cancelled → cancel_task persisted correctly", async () => {
    const request = makeResolvedRequest({
      status: "cancelled",
      resolution: undefined,
    });

    const { createOrGetResumeDecision } = await import(
      "../../../src/services/human-review/human-review-service.js"
    );

    const decision = await createOrGetResumeDecision(request);

    expect(decision.nextAction).toBe("cancel_task");
    expect(decision.executionMode).toBe("blocked");
  });

  it("T7: security override → executionMode=manual persisted", async () => {
    const request = makeResolvedRequest({
      severity: "security",
      audit: {
        taskId: "task-123",
        riskLevel: "security",
        recommendedAction: "human_review",
        criteriaCount: 3,
        blockingIssues: 1,
        hasSecurityIssue: true,
      },
    });

    const { createOrGetResumeDecision } = await import(
      "../../../src/services/human-review/human-review-service.js"
    );

    const decision = await createOrGetResumeDecision(request);

    expect(decision.nextAction).toBe("accept_final");
    expect(decision.executionMode).toBe("manual");
    expect(decision.audit.requiresOperatorConfirmation).toBe(true);
    expect(decision.audit.hasSecurityIssue).toBe(true);
    expect(decision.audit.severity).toBe("security");
  });

  it("T8: security decision does not silently downgrade on second read", async () => {
    const request = makeResolvedRequest({
      severity: "security",
      audit: {
        taskId: "task-sec",
        riskLevel: "security",
        recommendedAction: "human_review",
        criteriaCount: 1,
        blockingIssues: 0,
        hasSecurityIssue: true,
      },
    });

    const { createOrGetResumeDecision } = await import(
      "../../../src/services/human-review/human-review-service.js"
    );

    const first = await createOrGetResumeDecision(request);
    const second = await createOrGetResumeDecision(request);

    // 第二次从 DB 读取回来，security override 必须保持
    expect(second.executionMode).toBe("manual");
    expect(second.audit.requiresOperatorConfirmation).toBe(true);
    expect(second.id).toBe(first.id);
  });

  it("T9: different review requests get different decisions", async () => {
    const req1 = makeResolvedRequest();
    const req2 = makeResolvedRequest();

    const { createOrGetResumeDecision } = await import(
      "../../../src/services/human-review/human-review-service.js"
    );

    const d1 = await createOrGetResumeDecision(req1);
    const d2 = await createOrGetResumeDecision(req2);

    expect(d1.id).not.toBe(d2.id);
    expect(d1.reviewRequestId).toBe(req1.id);
    expect(d2.reviewRequestId).toBe(req2.id);
  });

  it("T10: persisted decision source field is correct", async () => {
    const request = makeResolvedRequest({
      status: "needs_revision",
      resolution: { action: "rewrite", note: "poor quality" },
    });

    const { createOrGetResumeDecision } = await import(
      "../../../src/services/human-review/human-review-service.js"
    );

    const decision = await createOrGetResumeDecision(request);

    expect(decision.source.reviewStatus).toBe("needs_revision");
    expect(decision.source.resolutionAction).toBe("rewrite");
  });
});
