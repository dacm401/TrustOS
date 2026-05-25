/**
 * S82P E2E: Resume Execution Event — runtime proof
 *
 * 验证 S82P 端到端路径（真实 DB）：
 *   create → resolve → createOrGetResumeDecision() → createOrGetResumeExecution()
 *   → buildHumanReviewResumeExecutionEvent() / humanReviewResumeExecutionToLedgerExtract()
 *
 * Approach: 链式调用，走真实 DB（docker postgres）
 * 每条路径验证 event 和 ledger extract 字段
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { VerificationCriterion } from "../../../src/services/task-contract/task-contract-types.js";
import { runCycle } from "../../../src/services/cycle/cycle-runtime.js";
import {
  buildHumanReviewRequestFromCycle,
  resolveHumanReviewRequest,
  createOrGetResumeDecision,
  createOrGetResumeExecution,
  buildHumanReviewResumeExecutionEvent,
  humanReviewResumeExecutionToLedgerExtract,
} from "../../../src/services/human-review/human-review-service.js";
import { HumanReviewRequestRepo } from "../../../src/db/human-review-repo.js";
import { HumanReviewResumeExecutionRepo } from "../../../src/db/human-review-execution-repo.js";
import { HumanReviewResumeDecisionRepo } from "../../../src/db/human-review-decision-repo.js";

function makeHRCriterion(
  severity: VerificationCriterion["severity"] = "medium"
): VerificationCriterion {
  return {
    id: `hr-s82p-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
    id: `contract-s82p-${Date.now()}`,
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

describe("S82P E2E: Resume Execution Event", () => {
  beforeEach(async () => {
    try {
      const existing = await HumanReviewRequestRepo.list({});
      for (const req of existing.filter((r) => r.taskId.startsWith("e2e-s82p-"))) {
        await HumanReviewRequestRepo.updateStatus(req.id, "cancelled");
      }
    } catch {
      // ignore
    }
  });

  // ── E1: accept_final → event type/id/status/action 正确 ──────────

  it("E1: accept_final execution produces correct event and ledger extract", async () => {
    const taskId = `e2e-s82p-${Date.now()}-e1`;
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
    expect(execution.status).toBe("executed");

    // S82P: 构造 event
    const event = buildHumanReviewResumeExecutionEvent(execution, decision);
    expect(event.type).toBe("human_review.resume_execution");
    expect(event.id).toBe(`human_review_resume_execution_event_${execution.id}`);
    expect(event.executionId).toBe(execution.id);
    expect(event.decisionId).toBe(decision.id);
    expect(event.reviewRequestId).toBe(hrRequest.id);
    expect(event.taskId).toBe(taskId);
    expect(event.status).toBe("executed");
    expect(event.executedAction).toBe("accept_final");
    expect(event.createdAt).toBeTruthy();
    expect(event.audit.nextAction).toBe("accept_final");
    expect(event.audit.executionMode).toBe("queued");
    expect(event.audit.requiresOperatorConfirmation).toBe(false);

    // S82P: ledger extract
    const extract = humanReviewResumeExecutionToLedgerExtract(event);
    expect(extract.executionId).toBe(execution.id);
    expect(extract.status).toBe("executed");
    expect(extract.executedAction).toBe("accept_final");
    expect(extract.nextAction).toBe("accept_final");
  });

  // ── E2: block_final → event status=blocked ───────────────────────

  it("E2: block_final execution produces correct event with blocked status", async () => {
    const taskId = `e2e-s82p-${Date.now()}-e2`;
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
    const event = buildHumanReviewResumeExecutionEvent(execution, decision);

    expect(event.status).toBe("blocked");
    expect(event.executedAction).toBe("block_final");
    expect(event.audit.nextAction).toBe("block_final");
    expect(event.audit.executionMode).toBe("blocked");
  });

  // ── E3: manual/security → event status=requires_confirmation ─────

  it("E3: manual/security execution produces event with requires_confirmation status", async () => {
    const taskId = `e2e-s82p-${Date.now()}-e3`;
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

    try {
      await createOrGetResumeExecution(hrRequest.id, decision.id);
      expect.fail("Should have thrown REQUIRES_CONFIRMATION");
    } catch (err: any) {
      expect(err.code).toBe("REQUIRES_CONFIRMATION");
    }

    // persisted execution → event
    const persisted = await HumanReviewResumeExecutionRepo.getByDecisionId(decision.id);
    expect(persisted).not.toBeNull();
    expect(persisted!.status).toBe("requires_confirmation");

    const event = buildHumanReviewResumeExecutionEvent(persisted!, decision);
    expect(event.status).toBe("requires_confirmation");
    expect(event.executedAction).toBe("none");
    expect(event.audit.nextAction).toBe(decision.nextAction);
    expect(event.audit.executionMode).toBe("manual");
    expect(event.audit.requiresOperatorConfirmation).toBe(true);
  });

  // ── E4: unsupported (resume_with_revision) → event status=unsupported ─

  it("E4: resume_with_revision execution produces event with unsupported status", async () => {
    const taskId = `e2e-s82p-${Date.now()}-e4`;
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

    try {
      await createOrGetResumeExecution(hrRequest.id, decision.id);
      expect.fail("Should have thrown UNSUPPORTED");
    } catch (err: any) {
      expect(err.code).toBe("UNSUPPORTED");
    }

    // persisted execution → event
    const persisted = await HumanReviewResumeExecutionRepo.getByDecisionId(decision.id);
    expect(persisted).not.toBeNull();
    expect(persisted!.status).toBe("unsupported");

    const event = buildHumanReviewResumeExecutionEvent(persisted!, decision);
    expect(event.status).toBe("unsupported");
    expect(event.executedAction).toBe("none");
    expect(event.audit.nextAction).toBe("resume_with_revision");
  });
});
