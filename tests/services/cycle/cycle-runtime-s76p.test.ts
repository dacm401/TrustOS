/**
 * Sprint 76P: Cycle Runtime SSE Events V0 — Tests
 *
 * 覆盖：
 * - T1: CycleEvent 类型正确导出
 * - T2: accept 路径正确发射 cycle.started / verifying / verifier_done / terminal 事件
 * - T3: block 路径正确发射 terminal 事件
 * - T4: revise 路径正确发射 worker_started / worker_done / verifying / verifier_done 事件
 * - T5: rewrite 路径正确发射 worker_started / worker_done 事件
 * - T6: max_cycles_exceeded 路径正确发射 terminal 事件
 * - T7: 不传 onCycleEvent 时行为不变（向后兼容）
 * - T8: emitEvent 对 async/sync 错误安全
 */

import { describe, it, expect } from "vitest";
import { v4 as uuid } from "uuid";

import type {
  TaskContractV0,
  VerificationCriterion,
} from "../../../src/services/task-contract/task-contract-types.js";
import { runCycle } from "../../../src/services/cycle/cycle-runtime.js";
import type { CycleEvent, CycleEventType } from "../../../src/services/cycle/cycle-events.js";

// ── Fixtures ───────────────────────────────────────────────────────────────

const TASK_ID = "test-task-76p";

function makeCriteria(
  type: VerificationCriterion["type"],
  severity: VerificationCriterion["severity"],
  required: boolean
): VerificationCriterion[] {
  return [{
    id: `s76p-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

describe("S76P CycleEvent emission", () => {

  // ── T2: accept 路径 ─────────────────────────────────────────────────────
  it("T2: accept path emits cycle.started / verifying / verifier_done / terminal (type=accepted)", async () => {
    const events: CycleEvent[] = [];
    // severity=high + required=true + expected="MAGIC" (content has it) → accept
    const criteria: VerificationCriterion[] = [{
      id: `s76p-t2-${Date.now()}`,
      label: "Must contain MAGIC",
      type: "text_presence",
      target: "artifact",
      severity: "high",
      required: true,
      expected: "MAGIC",
      source: "systemDefault",
      deterministic: true,
    }];
    const taskContract = makeTaskContract(criteria);

    const result = await runCycle({
      taskId: TASK_ID,
      taskContract,
      initialContent: "Content with MAGIC",
      security: { artifactToManager: false, rawHistoryToWorker: false, rawMemoryToWorker: false },
      executeWorker: () => Promise.resolve({ content: "Should not be called" }),
      originalGoal: "test",
      originalConstraints: [],
      onCycleEvent: (e) => events.push(e),
    });

    expect(result.cycleAudit.finalStatus).toBe("accepted");
    expect(events).toHaveLength(4);
    expect(events[0].type).toBe("cycle.started");
    expect(events[1].type).toBe("cycle.verifying");
    expect(events[2].type).toBe("cycle.verifier_done");
    expect(events[3].type).toBe("cycle.terminal");
    expect(events[3].finalStatus).toBe("accepted");
    expect(events[3].score).toBe(1.0);
    expect(events[3].passed).toBe(true);
    // All events have taskId
    for (const e of events) {
      expect(e.taskId).toBe(TASK_ID);
      expect(e.cycleIndex).toBe(1);
      expect(e.timestamp).toBeGreaterThan(0);
    }
  });

  // ── T3: block 路径 ─────────────────────────────────────────────────────
  it("T3: block path emits terminal with finalStatus=blocked", async () => {
    const events: CycleEvent[] = [];
    // security_check + artifactToManager=true → block (from S75P T2-1)
    const criteria: VerificationCriterion[] = [{
      id: `s76p-t3-${Date.now()}`,
      label: "Security check",
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
      initialContent: "Some content",
      security: { artifactToManager: true, rawHistoryToWorker: false, rawMemoryToWorker: false },
      executeWorker: () => Promise.resolve({ content: "Should not be called" }),
      originalGoal: "test",
      originalConstraints: [],
      onCycleEvent: (e) => events.push(e),
    });

    expect(result.cycleAudit.finalStatus).toBe("blocked");
    expect(events[events.length - 1].type).toBe("cycle.terminal");
    expect(events[events.length - 1].finalStatus).toBe("blocked");
  });

  // ── T4: revise 路径 ───────────────────────────────────────────────────
  it("T4: revise path emits worker_started / worker_done + second verifying/verifier_done", async () => {
    const events: CycleEvent[] = [];
    // Advisory (required=false, severity=medium, expected=MAGIC) → revise (from S75P T4-1)
    const criteria: VerificationCriterion[] = [{
      id: `s76p-t4-${Date.now()}`,
      label: "Advisory check",
      type: "text_presence",
      target: "artifact",
      severity: "medium",
      required: false,
      expected: "MAGIC",
      source: "systemDefault",
      deterministic: true,
    }];
    const taskContract = makeTaskContract(criteria, 2);

    let workerCallCount = 0;
    const result = await runCycle({
      taskId: TASK_ID,
      taskContract,
      // Must NOT contain "MAGIC" — otherwise text_presence passes immediately
      initialContent: "Content without the required keyword",
      security: { artifactToManager: false, rawHistoryToWorker: false, rawMemoryToWorker: false },
      executeWorker: async () => {
        workerCallCount++;
        return { content: "Content with MAGIC" };
      },
      originalGoal: "test",
      originalConstraints: [],
      onCycleEvent: (e) => events.push(e),
    });

    expect(result.cycleAudit.finalStatus).toBe("revised");
    expect(workerCallCount).toBe(1);

    // cycle 1: started / verifying / verifier_done / (no terminal — revise → continue)
    const startedEvents = events.filter(e => e.type === "cycle.started");
    expect(startedEvents).toHaveLength(1);
    expect(startedEvents[0].cycleIndex).toBe(1);

    const verifyingEvents = events.filter(e => e.type === "cycle.verifying");
    expect(verifyingEvents).toHaveLength(2); // cycle 1 + cycle 2

    const workerStartedEvents = events.filter(e => e.type === "cycle.worker_started");
    expect(workerStartedEvents).toHaveLength(1);
    expect(workerStartedEvents[0].cycleIndex).toBe(2);
    expect(workerStartedEvents[0].workerCalled).toBe(true);

    const workerDoneEvents = events.filter(e => e.type === "cycle.worker_done");
    expect(workerDoneEvents).toHaveLength(1);
    expect(workerDoneEvents[0].workerCalled).toBe(true);

    const verifierDoneEvents = events.filter(e => e.type === "cycle.verifier_done");
    expect(verifierDoneEvents).toHaveLength(2); // cycle 1 (revise) + cycle 2 (accept)

    const terminalEvents = events.filter(e => e.type === "cycle.terminal");
    expect(terminalEvents).toHaveLength(1);
    expect(terminalEvents[0].finalStatus).toBe("revised");

    // Event sequence order: started → verifying(cycle1) → worker_started(cycle2) → worker_done(cycle2) → verifying(cycle2) → terminal
    const eventTypes = events.map(e => e.type);
    expect(eventTypes.indexOf("cycle.started")).toBeLessThan(eventTypes.indexOf("cycle.verifying"));
    expect(eventTypes.indexOf("cycle.worker_started")).toBeLessThan(eventTypes.indexOf("cycle.worker_done"));
    // worker_done(cycle2) comes BEFORE verifying(cycle2) starts
    expect(eventTypes.lastIndexOf("cycle.worker_done")).toBeLessThan(eventTypes.lastIndexOf("cycle.verifying"));
  });

  // ── T5: rewrite 路径 ───────────────────────────────────────────────────
  it("T5: rewrite path emits worker_started / worker_done for cycle 2", async () => {
    const events: CycleEvent[] = [];
    // No criteria → baseResult → rewrite (from S75P T5)
    const taskContract = makeTaskContract([], 2);

    let workerCallCount = 0;
    const result = await runCycle({
      taskId: TASK_ID,
      taskContract,
      // Empty string triggers VF-001 → baseResult.passed = false → rewrite
      initialContent: "",
      security: { artifactToManager: false, rawHistoryToWorker: false, rawMemoryToWorker: false },
      executeWorker: async () => {
        workerCallCount++;
        return { content: "Rewritten content" };
      },
      originalGoal: "test",
      originalConstraints: [],
      onCycleEvent: (e) => events.push(e),
    });

    expect(result.cycleAudit.finalStatus).toBe("rewritten");
    expect(workerCallCount).toBe(1);

    const workerStartedEvents = events.filter(e => e.type === "cycle.worker_started");
    expect(workerStartedEvents).toHaveLength(1);
    expect(workerStartedEvents[0].cycleIndex).toBe(2);

    const workerDoneEvents = events.filter(e => e.type === "cycle.worker_done");
    expect(workerDoneEvents).toHaveLength(1);

    const terminalEvents = events.filter(e => e.type === "cycle.terminal");
    expect(terminalEvents).toHaveLength(1);
    expect(terminalEvents[0].finalStatus).toBe("rewritten");
  });

  // ── T6: max_cycles_exceeded 路径 ──────────────────────────────────────
  it("T6: max_cycles_exceeded emits terminal with finalStatus=max_cycles_exceeded", async () => {
    const events: CycleEvent[] = [];
    const criteria: VerificationCriterion[] = [{
      id: `s76p-t6-${Date.now()}`,
      label: "Advisory check",
      type: "text_presence",
      target: "artifact",
      severity: "medium",
      required: false,
      expected: "MAGIC",
      source: "systemDefault",
      deterministic: true,
    }];
    const taskContract = makeTaskContract(criteria, 2);

    // Worker always returns failing content
    const result = await runCycle({
      taskId: TASK_ID,
      taskContract,
      // Must NOT contain "MAGIC" — otherwise text_presence passes immediately
      initialContent: "No keyword here",
      security: { artifactToManager: false, rawHistoryToWorker: false, rawMemoryToWorker: false },
      executeWorker: async () => ({ content: "Still no keyword here" }),
      originalGoal: "test",
      originalConstraints: [],
      onCycleEvent: (e) => events.push(e),
    });

    expect(result.cycleAudit.finalStatus).toBe("max_cycles_exceeded");
    const terminalEvents = events.filter(e => e.type === "cycle.terminal");
    expect(terminalEvents).toHaveLength(1);
    expect(terminalEvents[0].finalStatus).toBe("max_cycles_exceeded");
  });

  // ── T7: 向后兼容 ────────────────────────────────────────────────────────
  it("T7: without onCycleEvent, runCycle returns same result as S75P (backward compatible)", async () => {
    const criteria: VerificationCriterion[] = [{
      id: `s76p-t7-${Date.now()}`,
      label: "Must contain MAGIC",
      type: "text_presence",
      target: "artifact",
      severity: "high",
      required: true,
      expected: "MAGIC",
      source: "systemDefault",
      deterministic: true,
    }];
    const taskContract = makeTaskContract(criteria);

    const result = await runCycle({
      taskId: TASK_ID,
      taskContract,
      initialContent: "Content with MAGIC",
      security: { artifactToManager: false, rawHistoryToWorker: false, rawMemoryToWorker: false },
      executeWorker: () => Promise.resolve({ content: "Should not be called" }),
      originalGoal: "test",
      originalConstraints: [],
      // 不传 onCycleEvent
    });

    expect(result.cycleAudit.finalStatus).toBe("accepted");
    expect(result.cycleAudit.totalCycles).toBe(1);
    expect(result.finalVerification?.passed).toBe(true);
  });

  // ── T8: verifier_done 包含 recommendedAction ─────────────────────────────
  it("T8: verifier_done events include recommendedAction / score / passed", async () => {
    const events: CycleEvent[] = [];
    const criteria: VerificationCriterion[] = [{
      id: `s76p-t8-${Date.now()}`,
      label: "Advisory check",
      type: "text_presence",
      target: "artifact",
      severity: "medium",
      required: false,
      expected: "MAGIC",
      source: "systemDefault",
      deterministic: true,
    }];
    const taskContract = makeTaskContract(criteria, 2);

    await runCycle({
      taskId: TASK_ID,
      taskContract,
      // Must NOT contain "MAGIC" — otherwise text_presence passes immediately
      initialContent: "No keyword here",
      security: { artifactToManager: false, rawHistoryToWorker: false, rawMemoryToWorker: false },
      executeWorker: async () => ({ content: "With MAGIC" }),
      originalGoal: "test",
      originalConstraints: [],
      onCycleEvent: (e) => events.push(e),
    });

    const verifierDoneEvents = events.filter(e => e.type === "cycle.verifier_done");
    expect(verifierDoneEvents.length).toBeGreaterThan(0);

    // Cycle 1 verifier_done: recommendedAction should be revise
    const cycle1VerifierDone = verifierDoneEvents.find(e => e.cycleIndex === 1);
    expect(cycle1VerifierDone?.recommendedAction).toBe("revise");
    expect(cycle1VerifierDone?.score).toBeLessThan(1.0);

    // Cycle 2 verifier_done: recommendedAction should be accept
    const cycle2VerifierDone = verifierDoneEvents.find(e => e.cycleIndex === 2);
    expect(cycle2VerifierDone?.recommendedAction).toBe("accept");
    expect(cycle2VerifierDone?.passed).toBe(true);
  });

  // ── T9: terminal 包含 score / passed ───────────────────────────────────
  it("T9: terminal event includes score and passed", async () => {
    const events: CycleEvent[] = [];
    // security_check → block (from S75P T2-1)
    const criteria: VerificationCriterion[] = [{
      id: `s76p-t9-${Date.now()}`,
      label: "Security check",
      type: "security_check",
      target: "artifact",
      severity: "security",
      required: true,
      source: "securityPolicy",
      deterministic: true,
    }];
    const taskContract = makeTaskContract(criteria, 2, "security");

    await runCycle({
      taskId: TASK_ID,
      taskContract,
      initialContent: "Some content",
      security: { artifactToManager: true, rawHistoryToWorker: false, rawMemoryToWorker: false },
      executeWorker: () => Promise.resolve({ content: "x" }),
      originalGoal: "test",
      originalConstraints: [],
      onCycleEvent: (e) => events.push(e),
    });

    const terminalEvent = events.find(e => e.type === "cycle.terminal");
    expect(terminalEvent?.finalStatus).toBe("blocked");
    // score and passed should be present (from verifier result)
    expect(typeof terminalEvent?.score).toBe("number");
    expect(typeof terminalEvent?.passed).toBe("boolean");
  });

  // ── T10: human_review 路径 ─────────────────────────────────────────────
  it("T10: human_review path emits terminal with finalStatus=human_review", async () => {
    const events: CycleEvent[] = [];
    // llm_judged + required=true → human_review (from S75P T3)
    const criteria: VerificationCriterion[] = [{
      id: `s76p-t10-${Date.now()}`,
      label: "Human review required",
      type: "human_review",
      target: "artifact",
      severity: "high",
      required: true,
      source: "systemDefault",
      deterministic: false,
    }];
    const taskContract = makeTaskContract(criteria);

    const result = await runCycle({
      taskId: TASK_ID,
      taskContract,
      initialContent: "Content",
      security: { artifactToManager: false, rawHistoryToWorker: false, rawMemoryToWorker: false },
      executeWorker: () => Promise.resolve({ content: "Should not be called" }),
      originalGoal: "test",
      originalConstraints: [],
      onCycleEvent: (e) => events.push(e),
    });

    expect(result.cycleAudit.finalStatus).toBe("human_review");
    const terminalEvents = events.filter(e => e.type === "cycle.terminal");
    expect(terminalEvents).toHaveLength(1);
    expect(terminalEvents[0].finalStatus).toBe("human_review");
  });

});
