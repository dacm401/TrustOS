/**
 * S78P: Human Review Resolution — Service 层单元测试
 *
 * 测试 resolveHumanReviewRequest() 的 action→status 映射、状态守卫、
 * Error 抛掷逻辑。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HumanReviewRequest, HumanReviewResolution } from "../../../src/services/human-review/human-review-types.js";

// ── mock HumanReviewRequestRepo ────────────────────────────────────────────────

const mockGetById = vi.fn();
const mockResolve = vi.fn();

vi.mock("../../../src/db/human-review-repo.js", () => ({
  get HumanReviewRequestRepo() {
    return {
      getById: mockGetById,
      resolve: mockResolve,
    };
  },
}));

// 动态 import 以使用 mock
const { resolveHumanReviewRequest, buildHumanReviewResolutionEvent } = await import(
  "../../../src/services/human-review/human-review-service.js"
);

function makePending(id = "req-001"): HumanReviewRequest {
  return {
    id,
    taskId: "task-001",
    cycleIndex: 0,
    status: "pending",
    reasonCode: "required_human_review",
    severity: "medium",
    createdAt: "2026-05-21T10:00:00.000Z",
    audit: {
      taskId: "task-001",
      recommendedAction: "human_review",
      criteriaCount: 3,
      blockingIssues: 1,
      hasSecurityIssue: false,
    },
  };
}

function makeResolved(
  id = "req-001",
  action: HumanReviewResolution["action"] = "accept"
): HumanReviewRequest {
  const statusMap: Record<string, HumanReviewRequest["status"]> = {
    accept: "approved",
    revise: "needs_revision",
    rewrite: "needs_revision",
    block: "rejected",
  };
  return {
    ...makePending(id),
    status: statusMap[action],
    resolvedAt: "2026-05-21T11:00:00.000Z",
    resolution: { action, note: "ok", resolvedBy: "admin" },
  };
}

// ── T1: action=accept → approved ─────────────────────────────────────────────

it("T1: resolve with accept → approved", async () => {
  mockGetById.mockResolvedValue(makePending("req-T1"));
  mockResolve.mockResolvedValue(makeResolved("req-T1", "accept"));

  const result = await resolveHumanReviewRequest("req-T1", { action: "accept" });

  expect(result.status).toBe("approved");
  expect(mockResolve).toHaveBeenCalledWith("req-T1", { action: "accept" }, "approved");
});

// ── T2: action=revise → needs_revision ──────────────────────────────────────

it("T2: resolve with revise → needs_revision", async () => {
  mockGetById.mockResolvedValue(makePending("req-T2"));
  mockResolve.mockResolvedValue({ ...makeResolved("req-T2", "revise"), status: "needs_revision" });

  const result = await resolveHumanReviewRequest("req-T2", { action: "revise", note: "needs fix" });

  expect(result.status).toBe("needs_revision");
  expect(mockResolve).toHaveBeenCalledWith(
    "req-T2",
    { action: "revise", note: "needs fix" },
    "needs_revision"
  );
});

// ── T3: action=rewrite → needs_revision ─────────────────────────────────────

it("T3: resolve with rewrite → needs_revision", async () => {
  mockGetById.mockResolvedValue(makePending("req-T3"));
  mockResolve.mockResolvedValue({ ...makeResolved("req-T3", "rewrite"), status: "needs_revision" });

  const result = await resolveHumanReviewRequest("req-T3", { action: "rewrite" });

  expect(result.status).toBe("needs_revision");
  expect(mockResolve).toHaveBeenCalledWith("req-T3", { action: "rewrite" }, "needs_revision");
});

// ── T4: action=block → rejected ─────────────────────────────────────────────

it("T4: resolve with block → rejected", async () => {
  mockGetById.mockResolvedValue(makePending("req-T4"));
  mockResolve.mockResolvedValue({ ...makeResolved("req-T4", "block"), status: "rejected" });

  const result = await resolveHumanReviewRequest("req-T4", { action: "block" });

  expect(result.status).toBe("rejected");
  expect(mockResolve).toHaveBeenCalledWith("req-T4", { action: "block" }, "rejected");
});

// ── T5: resolved status can't be resolved again ─────────────────────────────

it("T5: service rejects non-pending resolution with correct error message", async () => {
  const resolvedReq: HumanReviewRequest = {
    id: "req-T5",
    taskId: "task-001",
    cycleIndex: 0,
    status: "approved",  // 已不是 pending
    reasonCode: "required_human_review",
    severity: "medium",
    createdAt: "2026-05-21T10:00:00.000Z",
    resolvedAt: "2026-05-21T11:00:00.000Z",
    resolution: { action: "accept" },
    audit: {
      taskId: "task-001",
      recommendedAction: "human_review",
      criteriaCount: 1,
      blockingIssues: 0,
      hasSecurityIssue: false,
    },
  };
  mockGetById.mockResolvedValue(resolvedReq);

  await expect(
    resolveHumanReviewRequest("req-T5", { action: "accept" })
  ).rejects.toThrow("not pending");
});

// ── T6: note 透传 ─────────────────────────────────────────────────────────────

it("T6: note is passed through resolution to repo", async () => {
  mockGetById.mockResolvedValue(makePending("req-T6"));
  mockResolve.mockResolvedValue(makeResolved("req-T6", "accept"));

  await resolveHumanReviewRequest("req-T6", { action: "accept", note: "looks good" });

  expect(mockResolve).toHaveBeenCalledWith(
    "req-T6",
    { action: "accept", note: "looks good" },
    "approved"
  );
});

// ── T7: resolvedBy 透传 ─────────────────────────────────────────────────────

it("T7: resolvedBy is passed through resolution to repo", async () => {
  mockGetById.mockResolvedValue(makePending("req-T7"));
  mockResolve.mockResolvedValue(makeResolved("req-T7", "accept"));

  await resolveHumanReviewRequest("req-T7", { action: "accept", resolvedBy: "reviewer-42" });

  expect(mockResolve).toHaveBeenCalledWith(
    "req-T7",
    { action: "accept", resolvedBy: "reviewer-42" },
    "approved"
  );
});

// ── T8: 两次 resolve 抛错 ────────────────────────────────────────────────────

it("T8: resolve a non-pending request throws", async () => {
  mockGetById.mockResolvedValue({ ...makePending("req-T8"), status: "approved" });

  await expect(
    resolveHumanReviewRequest("req-T8", { action: "accept" })
  ).rejects.toThrow("not pending");
});

// ── T9: 不存在的 id 抛错 ────────────────────────────────────────────────────

it("T9: resolve non-existent id throws", async () => {
  mockGetById.mockResolvedValue(null);

  await expect(
    resolveHumanReviewRequest("req-nonexistent", { action: "accept" })
  ).rejects.toThrow("not found");
});

// ── buildHumanReviewResolutionEvent 测试 ─────────────────────────────────────

it("buildHumanReviewResolutionEvent returns safe event without raw content", () => {
  const resolved: HumanReviewRequest = {
    id: "req-ev",
    taskId: "task-001",
    cycleIndex: 1,
    status: "approved",
    reasonCode: "required_human_review",
    severity: "high",
    createdAt: "2026-05-21T10:00:00.000Z",
    resolvedAt: "2026-05-21T12:00:00.000Z",
    resolution: { action: "accept", note: "ok", resolvedBy: "admin" },
    audit: {
      taskId: "task-001",
      recommendedAction: "human_review",
      criteriaCount: 3,
      blockingIssues: 1,
      hasSecurityIssue: false,
    },
  };

  const event = buildHumanReviewResolutionEvent(resolved, "pending");

  expect(event.type).toBe("human_review.resolved");
  expect(event.requestId).toBe("req-ev");
  expect(event.taskId).toBe("task-001");
  expect(event.previousStatus).toBe("pending");
  expect(event.newStatus).toBe("approved");
  expect(event.action).toBe("accept");
  expect(event.resolvedBy).toBe("admin");
  expect(event.reasonCode).toBe("required_human_review");
  expect(event.severity).toBe("high");
  // 验证不含 raw content
  const eventStr = JSON.stringify(event);
  expect(eventStr).not.toContain("SECRET_TOKEN");
  expect(eventStr).not.toContain("password");
  expect(eventStr).not.toContain("api_key");
});
