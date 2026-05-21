/**
 * S77P E2E: Human Review Queue V0 — runtime proof
 *
 * 验证 S77P 端到端路径：
 *   TaskContract with human_review criterion
 *     → runCycle()
 *     → buildHumanReviewRequestFromCycle()
 *     → verify output shape and context boundary
 *
 * Approach: 链式调用，不走 SSR 完整路径（不依赖 DB）
 *
 * E1: human_review with security failure → security_sensitive reasonCode
 * E2: human_review required → required_human_review reasonCode
 * E3: buildHumanReviewRequestFromCycle audit has no raw content
 * E4: resolve updates status and resolvedAt
 * E5: list filters by status correctly
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { VerificationCriterion, TaskContractV0 } from "../../../src/services/task-contract/task-contract-types.js";
import { runCycle } from "../../../src/services/cycle/cycle-runtime.js";
import { buildHumanReviewRequestFromCycle } from "../../../src/services/human-review/human-review-service.js";
import { HumanReviewRequestRepo } from "../../../src/db/human-review-repo.js";

// ── Human Review Criterion Fixtures ─────────────────────────────────────────

function makeHRCriterion(
  severity: VerificationCriterion["severity"],
  deterministic = false
): VerificationCriterion {
  return {
    id: `hr-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    label: "Human review required",
    type: "human_review",
    target: "artifact",
    severity,
    required: true,
    source: "riskPolicy",
    deterministic,
  };
}

function makeSecurityHRCriterion(): VerificationCriterion {
  return {
    id: `hr-sec-${Date.now()}`,
    label: "SECURITY_ALERT_LABEL",
    type: "human_review",
    target: "artifact",
    severity: "security",
    required: true,
    source: "securityPolicy",
    deterministic: false,
  };
}

function makeTaskContract(
  criteria: VerificationCriterion[],
  riskLevel: TaskContractV0["riskLevel"] = "medium"
): TaskContractV0 {
  return {
    id: `contract-s77p-${Date.now()}`,
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

// ── E2E Tests ─────────────────────────────────────────────────────────────────

describe("S77P Human Review Queue E2E", () => {
  beforeEach(async () => {
    // 清空测试数据（幂等）
    try {
      const existing = await HumanReviewRequestRepo.list({});
      for (const req of existing.filter((r) => r.taskId.startsWith("e2e-s77p-"))) {
        await HumanReviewRequestRepo.updateStatus(req.id, "cancelled");
      }
    } catch {
      // ignore
    }
  });

  it("E1: severity=security criterion → reasonCode = required_human_review, severity = security", async () => {
    const taskId = `e2e-s77p-${Date.now()}-e1`;
    // severity=security 的 human_review criterion → severity 推断为 security
    // reasonCode 走 required_human_review（因为 hasSecurityFailure=false 但 hasHumanReviewRequired=true）
    const contract = makeTaskContract([makeSecurityHRCriterion()], "security");
    const content = " innocuous content ";

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

    expect(cycleResult.finalVerification?.recommendedAction).toBe("human_review");
    expect(cycleResult.cycleAudit.finalStatus).toBe("human_review");

    const hrParams = buildHumanReviewRequestFromCycle(cycleResult, contract);
    // hasSecurityFailure=false 时，reasonCode = required_human_review
    // severity 从 security criterion 推断为 security
    expect(hrParams.reasonCode).toBe("required_human_review");
    expect(hrParams.severity).toBe("security");
    expect(hrParams.taskId).toBe(taskId);
    expect(hrParams.audit.criteriaCount).toBe(1);
  });

  it("E2: required_human_review without security → reasonCode = required_human_review", async () => {
    const taskId = `e2e-s77p-${Date.now()}-e2`;
    const contract = makeTaskContract([makeHRCriterion("high", false)], "high");
    const content = "This artifact contains api_key=xyz789 in plain text";

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

    expect(cycleResult.finalVerification?.recommendedAction).toBe("human_review");

    const hrParams = buildHumanReviewRequestFromCycle(cycleResult, contract);
    expect(hrParams.reasonCode).toBe("required_human_review");
    expect(hrParams.severity).toBe("high");
    expect(hrParams.audit.criteriaCount).toBe(1);
  });

  it("E3: audit has no raw content — artifact/history/memory not leaked", async () => {
    const taskId = `e2e-s77p-${Date.now()}-e3`;
    const contract = makeTaskContract([makeHRCriterion("medium")], "medium");
    const content = "Content with password=supersecret and SSN=123-45-6789 and API_KEY=xyz";

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
    const auditStr = JSON.stringify(hrParams);

    expect(auditStr).not.toContain("password");
    expect(auditStr).not.toContain("supersecret");
    expect(auditStr).not.toContain("SSN");
    expect(auditStr).not.toContain("123-45-6789");
    expect(auditStr).not.toContain("API_KEY");
    expect(auditStr).not.toContain("xyz");
  });

  it("E4: create + resolve — status transitions from pending to approved", async () => {
    const taskId = `e2e-s77p-${Date.now()}-e4`;
    const contract = makeTaskContract([makeHRCriterion("low")], "low");
    const content = " innocuous content ";

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
    expect(created.resolvedAt ?? null).toBeNull(); // DB NULL → null (not undefined)

    const resolved = await HumanReviewRequestRepo.resolve(created.id, {
      action: "accept",
      note: "E2E test approval",
    });

    expect(resolved.status).toBe("approved");
    expect(resolved.resolvedAt).toBeDefined();
    expect(resolved.resolution?.action).toBe("accept");
  });

  it("E5: list filters by status — only returns approved requests", async () => {
    const taskId = `e2e-s77p-${Date.now()}-e5`;
    const contract = makeTaskContract([makeHRCriterion("low")], "low");
    const content = " innocuous ";

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

    // approve it
    await HumanReviewRequestRepo.resolve(created.id, { action: "accept" });

    // create a pending one
    const pendingParams = { ...hrParams, taskId: taskId + "-pending" };
    await HumanReviewRequestRepo.create(pendingParams);

    const approved = await HumanReviewRequestRepo.list({ status: "approved" });
    const pending = await HumanReviewRequestRepo.list({ status: "pending" });

    expect(approved.every((r) => r.status === "approved")).toBe(true);
    expect(pending.every((r) => r.status === "pending")).toBe(true);
    expect(approved.some((r) => r.taskId === taskId)).toBe(true);
    expect(pending.some((r) => r.taskId === taskId + "-pending")).toBe(true);
  });
});
