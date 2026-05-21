/**
 * S80P E2E: Resume Decision Persistence — runtime proof
 *
 * 验证 S80P 端到端路径（真实 DB）：
 *   create → resolve → createOrGetResumeDecision() → verify persistence
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
} from "../../../src/services/human-review/human-review-service.js";
import { HumanReviewRequestRepo } from "../../../src/db/human-review-repo.js";
import { HumanReviewResumeDecisionRepo } from "../../../src/db/human-review-decision-repo.js";

function makeHRCriterion(
  severity: VerificationCriterion["severity"] = "medium"
): VerificationCriterion {
  return {
    id: `hr-s80p-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
    id: `contract-s80p-${Date.now()}`,
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

describe("S80P E2E: Resume Decision Persistence", () => {
  beforeEach(async () => {
    try {
      // 清理 S80P E2E 测试数据
      const existing = await HumanReviewRequestRepo.list({});
      for (const req of existing.filter((r) => r.taskId.startsWith("e2e-s80p-"))) {
        await HumanReviewRequestRepo.updateStatus(req.id, "cancelled");
      }
    } catch {
      // ignore
    }
  });

  it("E1: create → resolve(accept) → createOrGetResumeDecision → persisted", async () => {
    const taskId = `e2e-s80p-${Date.now()}-e1`;
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

    const decision = await createOrGetResumeDecision(resolved);

    expect(decision.nextAction).toBe("accept_final");
    expect(decision.executionMode).toBe("queued");
    expect(decision.id).toBeDefined();

    // 验证可从 DB 直接读取
    const fromDb = await HumanReviewResumeDecisionRepo.getById(decision.id);
    expect(fromDb).not.toBeNull();
    expect(fromDb!.nextAction).toBe("accept_final");
  });

  it("E2: idempotent — two calls return same decision", async () => {
    const taskId = `e2e-s80p-${Date.now()}-e2`;
    const contract = makeTaskContract([makeHRCriterion("low")], "low");
    const content = "content for idempotency test";

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

    const first = await createOrGetResumeDecision(resolved);
    const second = await createOrGetResumeDecision(resolved);

    expect(first.id).toBe(second.id);
    expect(first.nextAction).toBe("resume_with_revision");
  });

  it("E3: security decision persists manual mode", async () => {
    const taskId = `e2e-s80p-${Date.now()}-e3`;
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
    const created = await HumanReviewRequestRepo.create(hrParams);
    const resolved = await resolveHumanReviewRequest(created.id, { action: "accept" });

    const decision = await createOrGetResumeDecision(resolved);

    expect(decision.executionMode).toBe("manual");
    expect(decision.audit.requiresOperatorConfirmation).toBe(true);

    // 验证 DB 读取回来不降级
    const fromDb = await HumanReviewResumeDecisionRepo.getByReviewRequestId(created.id);
    expect(fromDb!.executionMode).toBe("manual");
    expect(fromDb!.audit.requiresOperatorConfirmation).toBe(true);
  });

  it("E4: getByReviewRequestId returns correct decision", async () => {
    const taskId = `e2e-s80p-${Date.now()}-e4`;
    const contract = makeTaskContract([makeHRCriterion("high")], "high");
    const content = "block test content";

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

    const decision = await createOrGetResumeDecision(resolved);

    // 按 review request ID 查询
    const byRequestId = await HumanReviewResumeDecisionRepo.getByReviewRequestId(created.id);
    expect(byRequestId).not.toBeNull();
    expect(byRequestId!.id).toBe(decision.id);
    expect(byRequestId!.nextAction).toBe("block_final");
  });
});
