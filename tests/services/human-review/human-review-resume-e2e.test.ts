/**
 * S79P E2E: Human Review Resume Decision — runtime proof
 *
 * 验证 S79P 端到端路径：
 *   create → resolve → buildHumanReviewResumeDecision() → verify decision
 *
 * Approach: 链式调用，走真实 DB（docker postgres）
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { VerificationCriterion } from "../../../src/services/task-contract/task-contract-types.js";
import { runCycle } from "../../../src/services/cycle/cycle-runtime.js";
import {
  buildHumanReviewRequestFromCycle,
  resolveHumanReviewRequest,
  buildHumanReviewResumeDecision,
} from "../../../src/services/human-review/human-review-service.js";
import { HumanReviewRequestRepo } from "../../../src/db/human-review-repo.js";

function makeHRCriterion(
  severity: VerificationCriterion["severity"] = "medium"
): VerificationCriterion {
  return {
    id: `hr-s79p-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
    id: `contract-s79p-${Date.now()}`,
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

describe("S79P E2E: Human Review Resume Decision", () => {
  beforeEach(async () => {
    try {
      const existing = await HumanReviewRequestRepo.list({});
      for (const req of existing.filter((r) => r.taskId.startsWith("e2e-s79p-"))) {
        await HumanReviewRequestRepo.updateStatus(req.id, "cancelled");
      }
    } catch {
      // ignore
    }
  });

  it("E1: create → resolve(accept) → resume-decision = accept_final", async () => {
    const taskId = `e2e-s79p-${Date.now()}-e1`;
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
    const resolved = await resolveHumanReviewRequest(created.id, { action: "accept" });

    const decision = buildHumanReviewResumeDecision(resolved);

    expect(decision.nextAction).toBe("accept_final");
    expect(decision.executionMode).toBe("queued");
    expect(decision.reviewRequestId).toBe(created.id);
    expect(decision.audit.requiresOperatorConfirmation).toBe(false);
  });

  it("E2: create → resolve(revise) → resume-decision = resume_with_revision", async () => {
    const taskId = `e2e-s79p-${Date.now()}-e2`;
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
    const resolved = await resolveHumanReviewRequest(created.id, { action: "revise" });

    const decision = buildHumanReviewResumeDecision(resolved);

    expect(decision.nextAction).toBe("resume_with_revision");
    expect(decision.executionMode).toBe("queued");
  });

  it("E3: create → resolve(block) → resume-decision = block_final", async () => {
    const taskId = `e2e-s79p-${Date.now()}-e3`;
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
    const resolved = await resolveHumanReviewRequest(created.id, { action: "block" });

    const decision = buildHumanReviewResumeDecision(resolved);

    expect(decision.nextAction).toBe("block_final");
    expect(decision.executionMode).toBe("blocked");
  });

  it("E4: buildHumanReviewResumeDecision on pending throws", async () => {
    const taskId = `e2e-s79p-${Date.now()}-e4`;
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

    // status is still pending — should throw
    expect(() => buildHumanReviewResumeDecision(created)).toThrow(
      "Cannot build resume decision for pending request"
    );
  });
});
