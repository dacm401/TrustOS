/**
 * S81P E2E: Resume Execution — runtime proof
 *
 * 验证 S81P 端到端路径（真实 DB）：
 *   create → resolve → createOrGetResumeDecision() → createOrGetResumeExecution()
 *
 * Approach: 链式调用，走真实 DB（docker postgres）
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { VerificationCriterion } from "../../../src/services/task-contract/task-contract-types.js";
import { runCycle } from "../../../src/services/cycle/cycle-runtime.js";
import {
  buildHumanReviewRequestFromCycle,
  resolveHumanReviewRequest,
  createOrGetResumeDecision,
  createOrGetResumeExecution,
} from "../../../src/services/human-review/human-review-service.js";
import { HumanReviewRequestRepo } from "../../../src/db/human-review-repo.js";
import { HumanReviewResumeExecutionRepo } from "../../../src/db/human-review-execution-repo.js";

function makeHRCriterion(
  severity: VerificationCriterion["severity"] = "medium"
): VerificationCriterion {
  return {
    id: `hr-s81p-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
    id: `contract-s81p-${Date.now()}`,
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

describe("S81P E2E: Resume Execution", () => {
  beforeEach(async () => {
    try {
      const existing = await HumanReviewRequestRepo.list({});
      for (const req of existing.filter((r) => r.taskId.startsWith("e2e-s81p-"))) {
        await HumanReviewRequestRepo.updateStatus(req.id, "cancelled");
      }
    } catch {
      // ignore
    }
  });

  // ── E1: accept_final decision executes ──────────────────────────────────

  it("E1: persisted accept_final decision executes and stores result", async () => {
    const taskId = `e2e-s81p-${Date.now()}-e1`;
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
    hrParams.taskId = taskId;
    const hrRequest = await HumanReviewRequestRepo.create(hrParams);

    const resolved = await resolveHumanReviewRequest(hrRequest.id, { action: "accept" });
    const decision = await createOrGetResumeDecision(resolved);
    expect(decision.nextAction).toBe("accept_final");

    const execution = await createOrGetResumeExecution(hrRequest.id, decision.id);

    expect(execution.decisionId).toBe(decision.id);
    expect(execution.reviewRequestId).toBe(hrRequest.id);
    expect(execution.taskId).toBe(taskId);
    expect(execution.status).toBe("executed");
    expect(execution.executedAction).toBe("accept_final");
    expect(execution.executedAt).toBeTruthy();
  });

  // ── E2: block_final decision stores blocked result ──────────────────────

  it("E2: persisted block_final decision stores blocked result", async () => {
    const taskId = `e2e-s81p-${Date.now()}-e2`;
    const contract = makeTaskContract([makeHRCriterion("high")], "high");
    const content = "content requiring block";

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
    hrParams.taskId = taskId;
    const hrRequest = await HumanReviewRequestRepo.create(hrParams);

    const resolved = await resolveHumanReviewRequest(hrRequest.id, { action: "block" });
    const decision = await createOrGetResumeDecision(resolved);
    expect(decision.nextAction).toBe("block_final");

    const execution = await createOrGetResumeExecution(hrRequest.id, decision.id);

    expect(execution.status).toBe("blocked");
    expect(execution.executedAction).toBe("block_final");
  });

  // ── E3: manual/security decision persists then throws REQUIRES_CONFIRMATION ─

  it("E3: manual/security decision persists execution attempt then throws REQUIRES_CONFIRMATION", async () => {
    const taskId = `e2e-s81p-${Date.now()}-e3`;
    const contract = makeTaskContract([makeHRCriterion("security")], "security");
    const content = "security sensitive content";

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
    hrParams.taskId = taskId;
    const hrRequest = await HumanReviewRequestRepo.create(hrParams);

    const resolved = await resolveHumanReviewRequest(hrRequest.id, { action: "accept" });
    const decision = await createOrGetResumeDecision(resolved);
    expect(decision.executionMode).toBe("manual");

    // service persists execution attempt then throws — must catch the error
    try {
      await createOrGetResumeExecution(hrRequest.id, decision.id);
      expect.fail("Should have thrown REQUIRES_CONFIRMATION");
    } catch (err: any) {
      expect(err.code).toBe("REQUIRES_CONFIRMATION");
    }

    // execution attempt was persisted despite the throw (audit fact)
    const persisted = await HumanReviewResumeExecutionRepo.getByDecisionId(decision.id);
    expect(persisted).not.toBeNull();
    expect(persisted!.status).toBe("requires_confirmation");
    expect(persisted!.executedAction).toBe("none");
    expect(persisted!.executedAt).toBeUndefined();
  });

  // ── E4: resume_with_revision persists then throws UNSUPPORTED ──────────

  it("E4: resume_with_revision decision persists execution attempt then throws UNSUPPORTED", async () => {
    const taskId = `e2e-s81p-${Date.now()}-e4`;
    const contract = makeTaskContract([makeHRCriterion("medium")], "medium");
    const content = "revision needed content";

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
    hrParams.taskId = taskId;
    const hrRequest = await HumanReviewRequestRepo.create(hrParams);

    const resolved = await resolveHumanReviewRequest(hrRequest.id, { action: "revise" });
    const decision = await createOrGetResumeDecision(resolved);
    expect(decision.nextAction).toBe("resume_with_revision");

    // service persists execution attempt then throws — must catch the error
    try {
      await createOrGetResumeExecution(hrRequest.id, decision.id);
      expect.fail("Should have thrown UNSUPPORTED");
    } catch (err: any) {
      expect(err.code).toBe("UNSUPPORTED");
    }

    // execution attempt was persisted despite the throw (audit fact)
    const persisted = await HumanReviewResumeExecutionRepo.getByDecisionId(decision.id);
    expect(persisted).not.toBeNull();
    expect(persisted!.status).toBe("unsupported");
    expect(persisted!.executedAction).toBe("none");
  });

  // ── E5: duplicate execute returns same execution id ─────────────────────

  it("E5: duplicate execute returns same execution id (idempotent)", async () => {
    const taskId = `e2e-s81p-${Date.now()}-e5`;
    const contract = makeTaskContract([makeHRCriterion("low")], "low");
    const content = "idempotent content";

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
    hrParams.taskId = taskId;
    const hrRequest = await HumanReviewRequestRepo.create(hrParams);

    const resolved = await resolveHumanReviewRequest(hrRequest.id, { action: "accept" });
    const decision = await createOrGetResumeDecision(resolved);

    const execution1 = await createOrGetResumeExecution(hrRequest.id, decision.id);
    const execution2 = await createOrGetResumeExecution(hrRequest.id, decision.id);

    expect(execution1.id).toBe(execution2.id);
    expect(execution1.decisionId).toBe(execution2.decisionId);
  });

  // ── E6: decision id mismatch returns error ──────────────────────────────

  it("E6: decision id mismatch returns error (REVIEW_MISMATCH)", async () => {
    const taskId = `e2e-s81p-${Date.now()}-e6`;
    const contract = makeTaskContract([makeHRCriterion("low")], "low");
    const content = "mismatch content";

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
    hrParams.taskId = taskId;
    const hrRequest = await HumanReviewRequestRepo.create(hrParams);

    const resolved = await resolveHumanReviewRequest(hrRequest.id, { action: "accept" });
    const decision = await createOrGetResumeDecision(resolved);

    // Use a different reviewRequestId that doesn't match
    try {
      await createOrGetResumeExecution("wrong-request-id", decision.id);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.code).toBe("REVIEW_MISMATCH");
    }
  });
});
