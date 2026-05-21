/**
 * S78P E2E: Human Review Resolution V0 — runtime proof
 *
 * 验证 S78P 端到端路径：
 *   TaskContract with human_review criterion
 *     → runCycle()
 *     → buildHumanReviewRequestFromCycle()
 *     → HumanReviewRequestRepo.create()
 *     → resolveHumanReviewRequest()
 *     → verify status transitions
 *
 * Approach: 链式调用，走真实 DB（docker postgres）
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { VerificationCriterion } from "../../../src/services/task-contract/task-contract-types.js";
import { runCycle } from "../../../src/services/cycle/cycle-runtime.js";
import {
  buildHumanReviewRequestFromCycle,
  resolveHumanReviewRequest,
} from "../../../src/services/human-review/human-review-service.js";
import { HumanReviewRequestRepo } from "../../../src/db/human-review-repo.js";

function makeHRCriterion(
  severity: VerificationCriterion["severity"] = "medium"
): VerificationCriterion {
  return {
    id: `hr-s78p-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    label: "Human review required",
    type: "human_review",
    target: "artifact",
    severity,
    required: true,
    source: "riskPolicy",
  };
}

function makeTaskContract(
  criteria: VerificationCriterion[],
  riskLevel: "low" | "medium" | "high" | "security" = "medium"
) {
  return {
    id: `contract-s78p-${Date.now()}`,
    intent: "create_artifact",
    expectedOutputKind: "artifact",
    riskLevel,
    budgetPolicy: {
      maxWorkerCalls: 3,
      maxVerifierCalls: 3,
      maxCycles: 2,
    },
    verificationCriteria: criteria,
    allowedContext: { memoryScope: "none" },
    provenance: { source: "e2e-test" },
    createdAt: new Date().toISOString(),
  };
}

describe("S78P E2E: Human Review Resolution V0", () => {
  beforeEach(async () => {
    try {
      const existing = await HumanReviewRequestRepo.list({});
      for (const req of existing.filter((r) => r.taskId.startsWith("e2e-s78p-"))) {
        await HumanReviewRequestRepo.updateStatus(req.id, "cancelled");
      }
    } catch {
      // ignore
    }
  });

  it("E1: create + resolve(accept) → approved with resolvedAt and resolution", async () => {
    const taskId = `e2e-s78p-${Date.now()}-e1`;
    const contract = makeTaskContract([makeHRCriterion("low")], "low");
    const content = "safe artifact content";

    const cycleResult = await runCycle({
      taskId,
      activeArtifactId: undefined,
      taskContract: contract,
      initialContent: content,
      security: { artifactToManager: false, rawHistoryToWorker: false, rawMemoryToWorker: false },
      executeWorker: async () => ({ content }),
      originalGoal: "Create artifact",
      originalConstraints: [],
    });

    const hrParams = buildHumanReviewRequestFromCycle(cycleResult, contract);
    const created = await HumanReviewRequestRepo.create(hrParams);

    expect(created.status).toBe("pending");
    expect(created.resolvedAt ?? null).toBeNull();

    const resolved = await resolveHumanReviewRequest(created.id, {
      action: "accept",
      note: "E2E approved",
      resolvedBy: "e2e-reviewer",
    });

    expect(resolved.status).toBe("approved");
    expect(resolved.resolvedAt).toBeDefined();
    expect(resolved.resolution?.action).toBe("accept");
    expect(resolved.resolution?.note).toBe("E2E approved");
    expect(resolved.resolution?.resolvedBy).toBe("e2e-reviewer");
  });

  it("E2: create + resolve(revise) → needs_revision", async () => {
    const taskId = `e2e-s78p-${Date.now()}-e2`;
    const contract = makeTaskContract([makeHRCriterion("high")], "high");
    const content = "artifact needing revision";

    const cycleResult = await runCycle({
      taskId,
      activeArtifactId: undefined,
      taskContract: contract,
      initialContent: content,
      security: { artifactToManager: false, rawHistoryToWorker: false, rawMemoryToWorker: false },
      executeWorker: async () => ({ content }),
      originalGoal: "Create artifact",
      originalConstraints: [],
    });

    const hrParams = buildHumanReviewRequestFromCycle(cycleResult, contract);
    const created = await HumanReviewRequestRepo.create(hrParams);

    const resolved = await resolveHumanReviewRequest(created.id, {
      action: "revise",
      note: "Please fix the issues",
    });

    expect(resolved.status).toBe("needs_revision");
    expect(resolved.resolution?.action).toBe("revise");
  });

  it("E3: create + resolve(block) → rejected", async () => {
    const taskId = `e2e-s78p-${Date.now()}-e3`;
    const contract = makeTaskContract([makeHRCriterion("high")], "high");
    const content = "unacceptable artifact";

    const cycleResult = await runCycle({
      taskId,
      activeArtifactId: undefined,
      taskContract: contract,
      initialContent: content,
      security: { artifactToManager: false, rawHistoryToWorker: false, rawMemoryToWorker: false },
      executeWorker: async () => ({ content }),
      originalGoal: "Create artifact",
      originalConstraints: [],
    });

    const hrParams = buildHumanReviewRequestFromCycle(cycleResult, contract);
    const created = await HumanReviewRequestRepo.create(hrParams);

    const resolved = await resolveHumanReviewRequest(created.id, {
      action: "block",
      note: "Violates security policy",
    });

    expect(resolved.status).toBe("rejected");
    expect(resolved.resolution?.action).toBe("block");
  });

  it("E4: getById after resolve returns full resolution payload", async () => {
    const taskId = `e2e-s78p-${Date.now()}-e4`;
    const contract = makeTaskContract([makeHRCriterion("medium")], "medium");
    const content = "content";

    const cycleResult = await runCycle({
      taskId,
      activeArtifactId: undefined,
      taskContract: contract,
      initialContent: content,
      security: { artifactToManager: false, rawHistoryToWorker: false, rawMemoryToWorker: false },
      executeWorker: async () => ({ content }),
      originalGoal: "Create artifact",
      originalConstraints: [],
    });

    const hrParams = buildHumanReviewRequestFromCycle(cycleResult, contract);
    const created = await HumanReviewRequestRepo.create(hrParams);

    await resolveHumanReviewRequest(created.id, { action: "accept" });

    const fetched = await HumanReviewRequestRepo.getById(created.id);

    expect(fetched).not.toBeNull();
    expect(fetched!.status).toBe("approved");
    expect(fetched!.resolvedAt).toBeDefined();
    expect(fetched!.resolution?.action).toBe("accept");
  });

  it("E5: list by status — resolved and pending are separated", async () => {
    const taskId = `e2e-s78p-${Date.now()}-e5`;
    const contract = makeTaskContract([makeHRCriterion("low")], "low");
    const content = "content";

    const cycleResult = await runCycle({
      taskId,
      activeArtifactId: undefined,
      taskContract: contract,
      initialContent: content,
      security: { artifactToManager: false, rawHistoryToWorker: false, rawMemoryToWorker: false },
      executeWorker: async () => ({ content }),
      originalGoal: "Create artifact",
      originalConstraints: [],
    });

    const hrParams = buildHumanReviewRequestFromCycle(cycleResult, contract);
    const created = await HumanReviewRequestRepo.create(hrParams);

    // resolve one
    await resolveHumanReviewRequest(created.id, { action: "accept" });

    // create another pending
    await HumanReviewRequestRepo.create({ ...hrParams, taskId: taskId + "-pend", cycleIndex: 99 });

    const approvedList = await HumanReviewRequestRepo.list({ status: "approved" });
    const pendingList = await HumanReviewRequestRepo.list({ status: "pending" });

    expect(approvedList.every((r) => r.status === "approved")).toBe(true);
    expect(pendingList.every((r) => r.status === "pending")).toBe(true);
    expect(approvedList.some((r) => r.taskId === taskId)).toBe(true);
    expect(pendingList.some((r) => r.taskId === taskId + "-pend")).toBe(true);
  });
});
