/**
 * S83P E2E: Resume Execution Confirmation — runtime proof
 *
 * 验证 S83P 端到端路径（真实 DB）：
 *   create → resolve → createOrGetResumeDecision() → createOrGetResumeExecution()
 *   → confirmResumeExecution() → buildHumanReviewConfirmationEvent()
 *
 * Approach: 链式调用，走真实 DB（docker postgres）
 * 4 条路径：
 *   E1: accept_final confirmation → executed
 *   E2: block_final confirmation → blocked
 *   E3: cancel_task confirmation → blocked
 *   E4: unsupported (resume_with_revision) confirmation → UNSUPPORTED_ACTION
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { VerificationCriterion } from "../../../src/services/task-contract/task-contract-types.js";
import { runCycle } from "../../../src/services/cycle/cycle-runtime.js";
import {
  buildHumanReviewRequestFromCycle,
  resolveHumanReviewRequest,
  createOrGetResumeDecision,
  createOrGetResumeExecution,
  confirmResumeExecution,
  buildHumanReviewConfirmationEvent,
  humanReviewConfirmationToLedgerExtract,
} from "../../../src/services/human-review/human-review-service.js";
import { HumanReviewRequestRepo } from "../../../src/db/human-review-repo.js";
import { HumanReviewResumeExecutionRepo } from "../../../src/db/human-review-execution-repo.js";
import { HumanReviewResumeExecutionConfirmationRepo } from "../../../src/db/human-review-execution-confirmation-repo.js";

function makeHRCriterion(
  severity: VerificationCriterion["severity"] = "security"
): VerificationCriterion {
  return {
    id: `hr-s83p-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    label: "Human review required",
    type: "human_review",
    target: "artifact",
    severity,
    required: true,
    source: "riskPolicy",
  };
}

function makeTaskContract() {
  return {
    id: `contract-s83p-${Date.now()}`,
    intent: "create_artifact",
    expectedOutputKind: "artifact",
    riskLevel: "security" as const,
    budgetPolicy: {
      maxWorkerCalls: 3,
      maxVerifierCalls: 3,
      maxCycles: 2,
    },
    verificationCriteria: [makeHRCriterion("security")],
    allowedContext: { memoryScope: "none" },
    provenance: { source: "e2e-test" },
    createdAt: new Date().toISOString(),
  };
}

describe("S83P E2E: Resume Execution Confirmation", () => {
  beforeEach(async () => {
    try {
      const existing = await HumanReviewRequestRepo.list({});
      for (const req of existing.filter((r) => r.taskId.startsWith("e2e-s83p-"))) {
        await HumanReviewRequestRepo.updateStatus(req.id, "cancelled");
      }
    } catch {
      // ignore
    }
  });

  // ── E1: accept_final confirmation → executed ───────────────────

  it("E1: confirm accept_final → executed with correct event and ledger extract", async () => {
    const taskId = `e2e-s83p-${Date.now()}-e1`;
    const contract = makeTaskContract();
    const content = "security content to confirm accept";

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

    // Resolve → accept → security → manual → requires_confirmation
    const resolved = await resolveHumanReviewRequest(hrRequest.id, { action: "accept" });
    const decision = await createOrGetResumeDecision(resolved);
    expect(decision.executionMode).toBe("manual");
    expect(decision.nextAction).toBe("accept_final");

    // Execute → 409 requires_confirmation
    try {
      await createOrGetResumeExecution(hrRequest.id, decision.id);
      expect.fail("Should have thrown REQUIRES_CONFIRMATION");
    } catch (err: any) {
      expect(err.code).toBe("REQUIRES_CONFIRMATION");
    }

    // Get persisted execution
    const execution = await HumanReviewResumeExecutionRepo.getByDecisionId(decision.id);
    expect(execution).not.toBeNull();
    expect(execution!.status).toBe("requires_confirmation");

    // S83P: Confirm
    const { confirmation, event } = await confirmResumeExecution(execution!.id, "operator-e1");

    expect(confirmation.resultStatus).toBe("executed");
    expect(confirmation.executedAction).toBe("accept_final");
    expect(confirmation.confirmedBy).toBe("operator-e1");
    expect(confirmation.audit.previousStatus).toBe("requires_confirmation");
    expect(confirmation.executionId).toBe(execution!.id);

    expect(event.type).toBe("human_review.confirmation");
    expect(event.id).toBe(`human_review_confirmation_event_${confirmation.id}`);
    expect(event.resultStatus).toBe("executed");
    expect(event.audit.nextAction).toBe("accept_final");

    // Ledger extract
    const extract = humanReviewConfirmationToLedgerExtract(event);
    expect(extract.resultStatus).toBe("executed");
    expect(extract.executedAction).toBe("accept_final");
    expect(extract.previousStatus).toBe("requires_confirmation");

    // Verify persisted in DB
    const dbConfirmation = await HumanReviewResumeExecutionConfirmationRepo.getByExecutionId(execution!.id);
    expect(dbConfirmation).not.toBeNull();
    expect(dbConfirmation!.resultStatus).toBe("executed");
  });

  // ── E2: block_final confirmation → blocked ─────────────────────

  it("E2: confirm block_final → blocked", async () => {
    const taskId = `e2e-s83p-${Date.now()}-e2`;
    const contract = makeTaskContract();
    const content = "security content to block";

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
    expect(decision.executionMode).toBe("manual");
    expect(decision.nextAction).toBe("block_final");

    try {
      await createOrGetResumeExecution(hrRequest.id, decision.id);
    } catch (err: any) {
      expect(err.code).toBe("REQUIRES_CONFIRMATION");
    }

    const execution = await HumanReviewResumeExecutionRepo.getByDecisionId(decision.id);
    const { confirmation, event } = await confirmResumeExecution(execution!.id, "operator-e2");

    expect(confirmation.resultStatus).toBe("blocked");
    expect(confirmation.executedAction).toBe("block_final");
    expect(event.resultStatus).toBe("blocked");
    expect(event.audit.nextAction).toBe("block_final");
  });

  // ── E3: cancel_task confirmation → blocked ─────────────────────

  it("E3: confirm cancel_task → blocked", async () => {
    const taskId = `e2e-s83p-${Date.now()}-e3`;
    const contract = makeTaskContract();
    const content = "security content to cancel";

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

    // Set to cancelled directly (cancel_task requires status=cancelled in S79P mapping)
    await HumanReviewRequestRepo.updateStatus(hrRequest.id, "cancelled");

    // Re-read from DB to get updated status
    const cancelledRequest = await HumanReviewRequestRepo.getById(hrRequest.id);
    expect(cancelledRequest!.status).toBe("cancelled");

    const decision = await createOrGetResumeDecision(cancelledRequest!);
    expect(decision.nextAction).toBe("cancel_task");
    expect(decision.executionMode).toBe("manual"); // security override

    try {
      await createOrGetResumeExecution(hrRequest.id, decision.id);
    } catch (err: any) {
      expect(err.code).toBe("REQUIRES_CONFIRMATION");
    }

    const execution = await HumanReviewResumeExecutionRepo.getByDecisionId(decision.id);
    const { confirmation, event } = await confirmResumeExecution(execution!.id, "operator-e3");

    expect(confirmation.resultStatus).toBe("blocked");
    expect(confirmation.executedAction).toBe("cancel_task");
    expect(event.resultStatus).toBe("blocked");
    expect(event.audit.nextAction).toBe("cancel_task");
  });

  // ── E4: unsupported (resume_with_revision) confirmation → 422 ──
  //
  // Note: security severity overrides executionMode to manual.
  // In buildHumanReviewResumeExecutionResult(), manual check (priority 1) runs
  // before unsupported check (priority 2), so the execution gets
  // requires_confirmation (not unsupported).
  // When trying to confirm, the nextAction is resume_with_revision (not terminal),
  // so confirmResumeExecution throws UNSUPPORTED_ACTION.

  it("E4: confirm resume_with_revision execution → UNSUPPORTED_ACTION", async () => {
    const taskId = `e2e-s83p-${Date.now()}-e4`;
    const contract = makeTaskContract();
    const content = "revision needed security content";

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

    // resolve with revise → needs_revision → resume_with_revision
    const resolved = await resolveHumanReviewRequest(hrRequest.id, { action: "revise" });
    const decision = await createOrGetResumeDecision(resolved);
    expect(decision.nextAction).toBe("resume_with_revision");
    expect(decision.executionMode).toBe("manual"); // security override

    // Execute → 409 requires_confirmation (manual mode takes priority over unsupported)
    try {
      await createOrGetResumeExecution(hrRequest.id, decision.id);
      expect.fail("Should have thrown REQUIRES_CONFIRMATION");
    } catch (err: any) {
      expect(err.code).toBe("REQUIRES_CONFIRMATION");
    }

    // Persisted execution has status=requires_confirmation
    const execution = await HumanReviewResumeExecutionRepo.getByDecisionId(decision.id);
    expect(execution!.status).toBe("requires_confirmation");

    // Confirm fails because nextAction=resume_with_revision is not terminal
    try {
      await confirmResumeExecution(execution!.id, "operator-e4");
      expect.fail("Should have thrown UNSUPPORTED_ACTION");
    } catch (err: any) {
      expect(err.code).toBe("UNSUPPORTED_ACTION");
      expect(err.message).toContain("not a terminal action");
    }
  });

  // ── E5: idempotent confirmation (duplicate call) ───────────────

  it("E5: duplicate confirmation returns same record", async () => {
    const taskId = `e2e-s83p-${Date.now()}-e5`;
    const contract = makeTaskContract();
    const content = "idempotent test content";

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

    try {
      await createOrGetResumeExecution(hrRequest.id, decision.id);
    } catch (err: any) {
      expect(err.code).toBe("REQUIRES_CONFIRMATION");
    }

    const execution = await HumanReviewResumeExecutionRepo.getByDecisionId(decision.id);

    // First confirmation
    const result1 = await confirmResumeExecution(execution!.id, "operator-e5");
    // Second confirmation (idempotent)
    const result2 = await confirmResumeExecution(execution!.id, "operator-e5");

    expect(result1.confirmation.id).toBe(result2.confirmation.id);
    expect(result1.event.id).toBe(result2.event.id);
  });
});
