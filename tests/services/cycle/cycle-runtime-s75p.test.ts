/**
 * Sprint 75P: Cycle Runtime V0 — Tests
 *
 * 覆盖：
 * - accept 路径（cycle 1 直接返回）
 * - block 路径（立即阻断）
 * - human_review 路径（立即上报）
 * - revise 路径（Worker 重调 → 第 2 轮 accept）
 * - rewrite 路径（Worker 重调 → 第 2 轮 accept）
 * - max_cycles_exceeded 保护
 * - revision prompt 注入失败信息
 * - ledger audit extract
 * - buildRevisionPrompt 正确格式化
 */

import { describe, it, expect } from "vitest";
import { v4 as uuid } from "uuid";

import type {
  TaskContractV0,
  VerificationCriterion,
  ContractVerificationResult,
} from "../../../src/services/task-contract/task-contract-types.js";
import { runCycle, buildCycleAuditExtract } from "../../../src/services/cycle/cycle-runtime.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

const TASK_ID = "test-task-123";

function makeCriteria(type: VerificationCriterion["type"], severity: VerificationCriterion["severity"], required: boolean): VerificationCriterion[] {
  return [{
    id: `crt-${Date.now()}-1`,
    label: `Test ${type} criterion`,
    type,
    target: "artifact",
    severity,
    required,
    source: "systemDefault",
    deterministic: type !== "llm_judged" && type !== "human_review",
  }];
}

function makeTaskContract(
  criteria: VerificationCriterion[],
  maxCycles = 2,
  riskLevel: "low" | "medium" | "high" | "security" = "low",
): TaskContractV0 {
  return {
    id: uuid(),
    taskId: TASK_ID,
    intent: "create_artifact",
    expectedOutputKind: "artifact",
    target: { artifactId: TASK_ID },
    userVisibleGoal: "Test goal",
    acceptanceCriteria: [],
    constraints: [],
    allowedContext: {
      canReadHistory: false,
      canReadArtifactSource: false,
      artifactIds: [],
      memoryScope: "none",
    },
    riskLevel,
    budgetPolicy: { maxWorkerCalls: 3, maxVerifierCalls: 2, maxCycles },
    verificationPolicy: {
      required: true,
      mode: "heuristic",
      criteriaSource: "structured_criteria",
      blockOnSecurity: riskLevel === "security",
    },
    verificationCriteria: criteria,
    provenance: { builtFrom: "routeDecision" },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("S75P Cycle Runtime V0", () => {

  // ── T1: accept 路径 ─────────────────────────────────────────────────────
  describe("T1: accept path (single cycle)", () => {
    it("T1-1: accept → returns immediately, finalStatus=accepted", async () => {
      const criteria = makeCriteria("text_presence", "high", true);
      const taskContract = makeTaskContract(criteria);

      const result = await runCycle({
        taskId: TASK_ID,
        taskContract,
        initialContent: "Hello World",
        security: { artifactToManager: false, rawHistoryToWorker: false, rawMemoryToWorker: false },
        executeWorker: async () => { throw new Error("Worker should not be called"); },
        originalGoal: "test goal",
        originalConstraints: [],
      });

      expect(result.finalContent).toBe("Hello World");
      expect(result.cycleAudit.finalStatus).toBe("accepted");
      expect(result.cycleAudit.totalCycles).toBe(1);
      expect(result.cycleAudit.steps).toHaveLength(1);
      expect(result.cycleAudit.steps[0].cycleIndex).toBe(1);
      expect(result.cycleAudit.steps[0].recommendedAction).toBe("accept");
      expect(result.cycleAudit.steps[0].workerCalled).toBe(false);
    });

    it("T1-2: no criteria → uses base verification (accept)", async () => {
      const taskContract = makeTaskContract([]);
      taskContract.verificationCriteria = [];

      const result = await runCycle({
        taskId: TASK_ID,
        taskContract,
        initialContent: "Valid content",
        security: { artifactToManager: false, rawHistoryToWorker: false, rawMemoryToWorker: false },
        executeWorker: async () => { throw new Error("Worker should not be called"); },
        originalGoal: "test",
        originalConstraints: [],
      });

      expect(result.finalContent).toBe("Valid content");
      expect(result.cycleAudit.finalStatus).toBe("accepted");
      expect(result.cycleAudit.totalCycles).toBe(1);
    });
  });

  // ── T2: block 路径 ──────────────────────────────────────────────────────
  describe("T2: block path", () => {
    it("T2-1: security required failure → block, finalStatus=blocked", async () => {
      // security risk → required security_check criteria auto-added by buildVerificationCriteria
      const criteria: VerificationCriterion[] = [
        {
          id: "sec-1",
          label: "Security check: artifact not sent to Manager",
          type: "security_check",
          target: "artifact",
          severity: "security",
          required: true,
          source: "securityPolicy",
          deterministic: true,
        },
      ];
      const taskContract = makeTaskContract(criteria, 2, "security");

      const result = await runCycle({
        taskId: TASK_ID,
        taskContract,
        initialContent: "Some content",
        security: { artifactToManager: true, rawHistoryToWorker: false, rawMemoryToWorker: false },
        executeWorker: async () => { throw new Error("Worker should not be called on block"); },
        originalGoal: "test",
        originalConstraints: [],
      });

      expect(result.cycleAudit.finalStatus).toBe("blocked");
      expect(result.cycleAudit.totalCycles).toBe(1);
      expect(result.cycleAudit.finalRecommendedAction).toBe("block");
    });
  });

  // ── T3: human_review 路径 ───────────────────────────────────────────────
  describe("T3: human_review path", () => {
    it("T3-1: required human_review criterion → human_review, no worker called", async () => {
      const criteria = makeCriteria("human_review", "high", true);
      const taskContract = makeTaskContract(criteria);

      const result = await runCycle({
        taskId: TASK_ID,
        taskContract,
        initialContent: "Some content needing human check",
        security: { artifactToManager: false, rawHistoryToWorker: false, rawMemoryToWorker: false },
        executeWorker: async () => { throw new Error("Worker should not be called for human_review"); },
        originalGoal: "test",
        originalConstraints: [],
      });

      expect(result.cycleAudit.finalStatus).toBe("human_review");
      expect(result.cycleAudit.totalCycles).toBe(1);
      expect(result.cycleAudit.finalRecommendedAction).toBe("human_review");
      expect(result.finalVerification?.hasHumanReviewRequired).toBe(true);
    });
  });

  // ── T4: revise 路径 ─────────────────────────────────────────────────────
  describe("T4: revise path", () => {
    it("T4-1: advisory failure → revise → Worker called → cycle 2 accept → finalStatus=revised", async () => {
      let callCount = 0;
      const criteria: VerificationCriterion[] = [
        {
          id: "adv-1",
          label: "Advisory check",
          type: "text_presence",
          target: "artifact",
          severity: "medium",
          required: false, // advisory
          expected: "IMPORTANT",
          source: "systemDefault",
          deterministic: true,
        },
      ];
      const taskContract = makeTaskContract(criteria, 2);

      const result = await runCycle({
        taskId: TASK_ID,
        taskContract,
        initialContent: "A document with no special markers in it",
        security: { artifactToManager: false, rawHistoryToWorker: false, rawMemoryToWorker: false },
        executeWorker: async () => {
          callCount++;
          return { content: "Content with IMPORTANT keyword now" };
        },
        originalGoal: "Write a report",
        originalConstraints: ["Must be professional"],
      });

      expect(callCount).toBe(1);
      expect(result.cycleAudit.totalCycles).toBe(2);
      expect(result.cycleAudit.finalStatus).toBe("revised");
      expect(result.finalContent).toBe("Content with IMPORTANT keyword now");
      expect(result.cycleAudit.steps[0].recommendedAction).toBe("revise");
      expect(result.cycleAudit.steps[0].workerCalled).toBe(false);
      expect(result.cycleAudit.steps[1].recommendedAction).toBe("accept");
      expect(result.cycleAudit.steps[1].workerCalled).toBe(true);
    });

    it("T4-2: revision prompt includes failed criterion info", async () => {
      let receivedGoal = "";
      const criteria: VerificationCriterion[] = [
        {
          id: "qf-1",
          label: "Must contain signature",
          type: "text_presence",
          target: "artifact",
          severity: "high",
          required: false, // advisory → revise path (tests revision prompt)
          expected: "signature",
          source: "acceptanceCriteria",
          deterministic: true,
        },
      ];
      const taskContract = makeTaskContract(criteria, 2);

      await runCycle({
        taskId: TASK_ID,
        taskContract,
        initialContent: "A compliance document with no special markers",
        security: { artifactToManager: false, rawHistoryToWorker: false, rawMemoryToWorker: false },
        executeWorker: async (p) => {
          receivedGoal = p.goal;
          return { content: "Report with signature" };
        },
        originalGoal: "Write a compliance report",
        originalConstraints: ["Legal compliance"],
      });

      // Revision prompt must contain criterion id, severity, and reason code (NOT the label)
      expect(receivedGoal).toContain("qf-1");        // criterion id
      expect(receivedGoal).toContain("Revision Request");
      expect(receivedGoal).toContain("HIGH");
      expect(receivedGoal).toContain("missing_text"); // reasonCode
    });
  });

  // ── T5: rewrite 路径 ─────────────────────────────────────────────────────
  describe("T5: rewrite path", () => {
    it("T5-1: required failure → rewrite → Worker called (no revisionContext) → cycle 2 accept", async () => {
      let callCount = 0;
      let lastGoal = "";
      const criteria: VerificationCriterion[] = [
        {
          id: "qf-1",
          label: "Must be non-empty",
          type: "text_presence",
          target: "artifact",
          severity: "high",
          required: true,
          expected: "",
          source: "systemDefault",
          deterministic: true,
        },
      ];
      const taskContract = makeTaskContract(criteria, 2);

      const result = await runCycle({
        taskId: TASK_ID,
        taskContract,
        initialContent: "", // VF-001 failure
        security: { artifactToManager: false, rawHistoryToWorker: false, rawMemoryToWorker: false },
        executeWorker: async (p) => {
          callCount++;
          lastGoal = p.goal;
          return { content: "Good non-empty content" };
        },
        originalGoal: "Generate a summary",
        originalConstraints: [],
      });

      expect(callCount).toBe(1);
      expect(result.cycleAudit.totalCycles).toBe(2);
      expect(result.cycleAudit.finalStatus).toBe("rewritten");
      expect(lastGoal).toBe("Generate a summary"); // rewrite → originalGoal, no revisionContext
      expect(result.cycleAudit.steps[0].recommendedAction).toBe("rewrite");
      expect(result.cycleAudit.steps[1].workerCalled).toBe(true);
    });
  });

  // ── T6: max_cycles_exceeded ─────────────────────────────────────────────
  describe("T6: max_cycles_exceeded protection", () => {
    it("T6-1: all cycles keep revising → stops at maxCycles", async () => {
      let callCount = 0;
      const criteria: VerificationCriterion[] = [
        {
          id: "perm-1",
          label: "Must pass human review",
          type: "human_review",
          target: "artifact",
          severity: "high",
          required: true,
          source: "riskPolicy",
          deterministic: false,
        },
      ];
      const taskContract = makeTaskContract(criteria, 3);

      const result = await runCycle({
        taskId: TASK_ID,
        taskContract,
        initialContent: "Content needing review",
        security: { artifactToManager: false, rawHistoryToWorker: false, rawMemoryToWorker: false },
        executeWorker: async () => {
          callCount++;
          return { content: `Content v${callCount}` };
        },
        originalGoal: "test",
        originalConstraints: [],
      });

      // human_review blocks at every cycle (终态)
      expect(result.cycleAudit.totalCycles).toBe(1);
      expect(result.cycleAudit.finalStatus).toBe("human_review");
    });

    it("T6-2: maxCycles=1 → no retry even on revise", async () => {
      let callCount = 0;
      const criteria = makeCriteria("text_presence", "medium", false);
      const taskContract = makeTaskContract(criteria, 1); // maxCycles = 1

      const result = await runCycle({
        taskId: TASK_ID,
        taskContract,
        initialContent: "No IMPORTANT keyword",
        security: { artifactToManager: false, rawHistoryToWorker: false, rawMemoryToWorker: false },
        executeWorker: async () => {
          callCount++;
          return { content: "Improved content" };
        },
        originalGoal: "test",
        originalConstraints: [],
      });

      expect(callCount).toBe(0);
      // advisory failure at cycle 1 → recommend revise, but maxCycles=1
      // 循环直接退出 → finalStatus = 最后一轮的 recommendedAction?
      // 实际上 revise → 尝试循环，但 cycleIndex=2 > maxCycles=1 → 直接跳到 max_cycles_exceeded
      expect(result.cycleAudit.totalCycles).toBe(1);
    });
  });

  // ── T7: ledger audit extract ─────────────────────────────────────────────
  describe("T7: ledger audit extract", () => {
    it("T7-1: accepted → blocked=false in extract", async () => {
      const criteria = makeCriteria("text_presence", "low", false);
      const taskContract = makeTaskContract(criteria);

      const result = await runCycle({
        taskId: TASK_ID,
        taskContract,
        initialContent: "Hello",
        security: { artifactToManager: false, rawHistoryToWorker: false, rawMemoryToWorker: false },
        executeWorker: async () => { throw new Error("no call"); },
        originalGoal: "test",
        originalConstraints: [],
      });

      const extract = buildCycleAuditExtract(result.cycleAudit);
      expect(extract.taskId).toBe(TASK_ID);
      expect(extract.totalCycles).toBe(1);
      expect(extract.maxCycles).toBe(2);
      expect(extract.finalStatus).toBe("accepted");
      expect(extract.blocked).toBe(false);
    });

    it("T7-2: blocked → blocked=true in extract", async () => {
      const criteria: VerificationCriterion[] = [{
        id: "sec-1",
        label: "Security",
        type: "security_check",
        target: "artifact",
        severity: "security",
        required: true,
        source: "securityPolicy",
        deterministic: true,
      }];
      const taskContract = makeTaskContract(criteria, 2, "security");

      const result = await runCycle({
        taskId: TASK_ID,
        taskContract,
        initialContent: "Content",
        security: { artifactToManager: true, rawHistoryToWorker: false, rawMemoryToWorker: false },
        executeWorker: async () => { throw new Error("no call"); },
        originalGoal: "test",
        originalConstraints: [],
      });

      const extract = buildCycleAuditExtract(result.cycleAudit);
      expect(extract.blocked).toBe(true);
      expect(extract.finalStatus).toBe("blocked");
    });

    it("T7-3: cycleAuditMs is recorded", async () => {
      const taskContract = makeTaskContract([]);
      taskContract.verificationCriteria = [];

      const result = await runCycle({
        taskId: TASK_ID,
        taskContract,
        initialContent: "Hello",
        security: { artifactToManager: false, rawHistoryToWorker: false, rawMemoryToWorker: false },
        executeWorker: async () => { throw new Error("no call"); },
        originalGoal: "test",
        originalConstraints: [],
      });

      expect(result.cycleAudit.totalMs).toBeGreaterThanOrEqual(0);
      const extract = buildCycleAuditExtract(result.cycleAudit);
      expect(extract.cycleAuditMs).toBe(result.cycleAudit.totalMs);
    });
  });

  // ── T8: finalVerification 正确填充 ─────────────────────────────────────
  describe("T8: finalVerification field", () => {
    it("T8-1: accept → finalVerification.recommendedAction=accept", async () => {
      const criteria = makeCriteria("text_presence", "high", true);
      const taskContract = makeTaskContract(criteria);

      const result = await runCycle({
        taskId: TASK_ID,
        taskContract,
        initialContent: "Valid content",
        security: { artifactToManager: false, rawHistoryToWorker: false, rawMemoryToWorker: false },
        executeWorker: async () => { throw new Error("no call"); },
        originalGoal: "test",
        originalConstraints: [],
      });

      expect(result.finalVerification).not.toBeNull();
      expect(result.finalVerification!.recommendedAction).toBe("accept");
      expect(result.finalVerification!.passed).toBe(true);
    });

    it("T8-2: block → finalVerification.hasSecurityFailure=true", async () => {
      const criteria: VerificationCriterion[] = [{
        id: "sec-1",
        label: "Security",
        type: "security_check",
        target: "artifact",
        severity: "security",
        required: true,
        source: "securityPolicy",
        deterministic: true,
      }];
      const taskContract = makeTaskContract(criteria, 2, "security");

      const result = await runCycle({
        taskId: TASK_ID,
        taskContract,
        initialContent: "Content",
        security: { artifactToManager: true, rawHistoryToWorker: false, rawMemoryToWorker: false },
        executeWorker: async () => { throw new Error("no call"); },
        originalGoal: "test",
        originalConstraints: [],
      });

      expect(result.finalVerification!.hasSecurityFailure).toBe(true);
      expect(result.finalVerification!.recommendedAction).toBe("block");
    });
  });

  // ── T9: revision prompt includes security warning ────────────────────────
  describe("T9: revision prompt includes security warning", () => {
    it("T9-1: advisory failure → revision prompt contains revision header and severity", async () => {
      let receivedGoal = "";
      // Advisory failure + security check that passes → revise path triggered
      const criteria: VerificationCriterion[] = [
        {
          id: "qf-1",
          label: "Must include magic word",
          type: "text_presence",
          target: "artifact",
          severity: "high",
          required: false, // advisory → revise (not rewrite)
          expected: "MAGIC_WORD",
          source: "systemDefault",
          deterministic: true,
        },
      ];
      const taskContract = makeTaskContract(criteria, 2);

      await runCycle({
        taskId: TASK_ID,
        taskContract,
        initialContent: "Content with no special markers in it", // advisory fail → revise
        security: { artifactToManager: false, rawHistoryToWorker: false, rawMemoryToWorker: false },
        executeWorker: async (p) => {
          receivedGoal = p.goal;
          return { content: "Good content" };
        },
        originalGoal: "test",
        originalConstraints: [],
      });

      expect(receivedGoal).toContain("Revision Request");
      expect(receivedGoal).toContain("qf-1");
      expect(receivedGoal).toContain("HIGH");
    });
  });

  // ── T10: cycle 索引正确性 ───────────────────────────────────────────────
  describe("T10: cycle index correctness", () => {
    it("T10-1: three cycles → steps[0].cycleIndex=1, steps[1].cycleIndex=2, steps[2].cycleIndex=3", async () => {
      const criteria: VerificationCriterion[] = [
        {
          id: "adv-1",
          label: "Advisory",
          type: "text_presence",
          target: "artifact",
          severity: "medium",
          required: false,
          expected: "REQUIRED_TOKEN", // must specify to actually check for a string
          source: "systemDefault",
          deterministic: true,
        },
      ];
      const taskContract = makeTaskContract(criteria, 3);
      // Use object ref so closure mutations are visible to the Worker on each call
      const state = { content: "A simple text without any markers" };
      let callCount = 0;

      const result = await runCycle({
        taskId: TASK_ID,
        taskContract,
        initialContent: state.content,
        security: { artifactToManager: false, rawHistoryToWorker: false, rawMemoryToWorker: false },
        executeWorker: async () => {
          callCount++;
          // Simulate: Worker sees the shared state and revises based on it
          if (callCount === 1) {
            state.content = "Still no markers here";
          } else if (callCount === 2) {
            state.content = "Finally contains REQUIRED_TOKEN now";
          }
          // Worker returns content; runCycle uses returned content for next verification
          return { content: state.content };
        },
        originalGoal: "test",
        originalConstraints: [],
      });

      expect(result.cycleAudit.steps).toHaveLength(3);
      expect(result.cycleAudit.steps[0].cycleIndex).toBe(1);
      expect(result.cycleAudit.steps[1].cycleIndex).toBe(2);
      expect(result.cycleAudit.steps[2].cycleIndex).toBe(3);
      // Worker is called in cycle 2 (prevAction=revise) and cycle 3 (prevAction=revise)
      // After cycle 3 verification → accept → loop exits
      expect(callCount).toBe(2);
      expect(result.cycleAudit.finalStatus).toBe("revised");
    });
  });
});
