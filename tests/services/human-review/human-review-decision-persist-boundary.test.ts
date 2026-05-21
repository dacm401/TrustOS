/**
 * S80P: Resume Decision Persistence — Boundary Tests
 *
 * 验证持久化 decision 不含 raw content：
 * - 无 raw artifact source
 * - 无 raw history text
 * - 无 raw memory text
 * - 无 criterion text/label
 * - audit 字段只含 safe metadata
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { HumanReviewRequest } from "../../../src/services/human-review/human-review-types.js";

// ── Mock Decision Repo ────────────────────────────────────────────────────

let mockDb: Map<string, import("../../../src/services/human-review/human-review-types.js").HumanReviewResumeDecision> = new Map();

function resetMockDb() {
  mockDb = new Map();
}

const mockDecisionRepo = {
  async create(decision: any) {
    for (const [, existing] of mockDb) {
      if (existing.reviewRequestId === decision.reviewRequestId) return existing;
    }
    const persisted = { ...decision, id: `persisted-${decision.reviewRequestId}` };
    mockDb.set(persisted.id, persisted);
    return persisted;
  },
  async getByReviewRequestId(reviewRequestId: string) {
    for (const [, d] of mockDb) {
      if (d.reviewRequestId === reviewRequestId) return d;
    }
    return null;
  },
  async getById() { return null; },
  async list() { return []; },
};

vi.mock("../../../src/db/human-review-repo.js", () => ({
  HumanReviewRequestRepo: {},
}));

vi.mock("../../../src/db/human-review-decision-repo.js", () => ({
  HumanReviewResumeDecisionRepo: mockDecisionRepo,
}));

// ── Sentinel Check ────────────────────────────────────────────────────────

const RAW_ARTIFACT_SENTINELS = ["raw_artifact", "artifact_source", "final_content"];
const RAW_HISTORY_SENTINELS = ["raw_history", "history_text", "conversation_log"];
const RAW_MEMORY_SENTINELS = ["raw_memory", "memory_content", "user_memory"];
const CRITERION_SENTINELS = ["criterion_text", "criterion_label", "verification_criteria_text"];

function checkNoSentinels(obj: unknown, sentinels: string[], path: string = "root"): string[] {
  const violations: string[] = [];
  if (obj === null || obj === undefined) return violations;
  if (typeof obj === "string") {
    for (const s of sentinels) {
      if (obj.toLowerCase().includes(s)) {
        violations.push(`${path}: contains sentinel "${s}"`);
      }
    }
    return violations;
  }
  if (typeof obj === "object") {
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      violations.push(...checkNoSentinels(value, sentinels, `${path}.${key}`));
    }
  }
  return violations;
}

function makeResolvedRequest(): HumanReviewRequest {
  return {
    id: `hr-boundary-${Date.now()}`,
    taskId: "task-boundary",
    contractId: "contract-boundary",
    cycleIndex: 2,
    status: "approved",
    reasonCode: "security_sensitive",
    severity: "security",
    createdAt: "2026-05-21T10:00:00.000Z",
    resolvedAt: "2026-05-21T10:05:00.000Z",
    resolution: { action: "accept", note: "reviewed carefully", resolvedBy: "operator" },
    audit: {
      taskId: "task-boundary",
      riskLevel: "security",
      recommendedAction: "human_review",
      criteriaCount: 5,
      blockingIssues: 1,
      hasSecurityIssue: true,
    },
  };
}

describe("S80P Boundary: Persisted Decision Context Safety", () => {
  beforeEach(() => resetMockDb());
  afterEach(() => vi.restoreAllMocks());

  it("B1: persisted decision contains no raw artifact sentinels", async () => {
    const request = makeResolvedRequest();
    const { createOrGetResumeDecision } = await import(
      "../../../src/services/human-review/human-review-service.js"
    );

    const decision = await createOrGetResumeDecision(request);
    const violations = checkNoSentinels(decision, RAW_ARTIFACT_SENTINELS);
    expect(violations).toEqual([]);
  });

  it("B2: persisted decision contains no raw history sentinels", async () => {
    const request = makeResolvedRequest();
    const { createOrGetResumeDecision } = await import(
      "../../../src/services/human-review/human-review-service.js"
    );

    const decision = await createOrGetResumeDecision(request);
    const violations = checkNoSentinels(decision, RAW_HISTORY_SENTINELS);
    expect(violations).toEqual([]);
  });

  it("B3: persisted decision contains no raw memory sentinels", async () => {
    const request = makeResolvedRequest();
    const { createOrGetResumeDecision } = await import(
      "../../../src/services/human-review/human-review-service.js"
    );

    const decision = await createOrGetResumeDecision(request);
    const violations = checkNoSentinels(decision, RAW_MEMORY_SENTINELS);
    expect(violations).toEqual([]);
  });

  it("B4: persisted decision contains no criterion text sentinels", async () => {
    const request = makeResolvedRequest();
    const { createOrGetResumeDecision } = await import(
      "../../../src/services/human-review/human-review-service.js"
    );

    const decision = await createOrGetResumeDecision(request);
    const violations = checkNoSentinels(decision, CRITERION_SENTINELS);
    expect(violations).toEqual([]);
  });

  it("B5: persisted decision audit has no undefined fields", async () => {
    const request = makeResolvedRequest();
    const { createOrGetResumeDecision } = await import(
      "../../../src/services/human-review/human-review-service.js"
    );

    const decision = await createOrGetResumeDecision(request);
    const auditFields = Object.values(decision.audit);
    for (const field of auditFields) {
      expect(field).not.toBeUndefined();
    }
  });
});
