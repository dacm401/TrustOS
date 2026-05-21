/**
 * S78P Boundary: Human Review Resolution — context boundary sentinel tests
 *
 * 验证 resolution 处置不泄漏敏感内容到事件/响应中。
 */

import { describe, it, expect, vi } from "vitest";
import type { HumanReviewRequest, HumanReviewResolution } from "../../../src/services/human-review/human-review-types.js";
import { buildHumanReviewResolutionEvent } from "../../../src/services/human-review/human-review-service.js";

function makeResolved(
  overrides: Partial<HumanReviewRequest> = {}
): HumanReviewRequest {
  return {
    id: "req-boundary",
    taskId: "task-001",
    cycleIndex: 1,
    status: "approved",
    reasonCode: "required_human_review",
    severity: "medium",
    createdAt: "2026-05-21T10:00:00.000Z",
    resolvedAt: "2026-05-21T12:00:00.000Z",
    resolution: { action: "accept", note: "looks good", resolvedBy: "admin" },
    audit: {
      taskId: "task-001",
      recommendedAction: "human_review",
      criteriaCount: 2,
      blockingIssues: 0,
      hasSecurityIssue: false,
    },
    ...overrides,
  };
}

describe("S78P Boundary: Human Review Resolution", () => {

  it("B1: audit fields do not contain raw artifact content", () => {
    // 注入 raw artifact 敏感内容，验证 audit 相关字段不泄漏
    const resolved = makeResolved({
      resolution: {
        action: "accept",
        note: "Reviewer saw artifact with SECRET_TOKEN=abc123",
        resolvedBy: "admin",
      },
      audit: {
        taskId: "task-safe-id",  // taskId 是系统 ID，不是 raw artifact
        recommendedAction: "human_review",
        criteriaCount: 1,
        blockingIssues: 0,
        hasSecurityIssue: false,
      },
    });

    const event = buildHumanReviewResolutionEvent(resolved, "pending");
    const eventStr = JSON.stringify(event);

    // audit 域（reasonCode/severity/criteriaCount/blockingIssues）不含 raw artifact 关键词
    // note 字段保留（人工填写，不属于 raw content 范畴）
    expect(eventStr).not.toContain("SECRET_TOKEN=abc123");
    expect(eventStr).not.toContain("password=supersecret");
    expect(eventStr).not.toContain("api_key=xyz789");
    expect(event.reasonCode).toBe("required_human_review");  // 不含原始 criterion 文本
    expect(event.severity).toBe("medium");
  });

  it("B2: event shape is stable and all required fields present", () => {
    const resolved = makeResolved({
      status: "needs_revision",
      resolution: { action: "revise", note: "fix it" },
    });

    const event = buildHumanReviewResolutionEvent(resolved, "pending");

    // 验证所有必需字段存在
    expect(event).toHaveProperty("type", "human_review.resolved");
    expect(event).toHaveProperty("requestId");
    expect(event).toHaveProperty("taskId");
    expect(event).toHaveProperty("cycleIndex");
    expect(event).toHaveProperty("previousStatus", "pending");
    expect(event).toHaveProperty("newStatus", "needs_revision");
    expect(event).toHaveProperty("action", "revise");
    expect(event).toHaveProperty("resolvedAt");
    expect(event).toHaveProperty("reasonCode");
    expect(event).toHaveProperty("severity");

    // 验证无 undefined 字段
    expect(event.requestId).toBeTruthy();
    expect(event.taskId).toBeTruthy();
    expect(event.resolvedAt).toBeTruthy();
  });
});
