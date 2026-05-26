/**
 * S84P: Runtime Trace — Type & Helper Unit Tests
 *
 * Tests cover:
 * - createTrace() creates valid empty trace
 * - startStage()/endStage() record stage timing correctly
 * - traceStage() async wrapper records stage even on error
 * - finalizeTrace() computes totalDurationMs and finalStatus
 * - updateTrace* helpers populate optional fields
 * - buildRuntimeTraceExtract() produces safe extract with completed stages only
 * - Counter defaults and updates
 * - Edge cases: empty trace, duplicate stage names
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createTrace,
  startStage,
  endStage,
  traceStage,
  finalizeTrace,
  updateTraceCounters,
  updateTraceRouting,
  updateTraceCycleSummary,
  updateTraceWorkerSummary,
  updateTraceLedgerSummary,
} from "../../src/services/runtime-trace.js";
import {
  buildRuntimeTraceExtract,
  RUNTIME_TRACE_STAGES,
  type RuntimeTrace,
  type RuntimeTraceStageName,
} from "../../src/types/runtime-trace.js";

describe("S84P RuntimeTrace", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ── createTrace ──────────────────────────────────────────────────────────

  describe("createTrace", () => {
    it("T1: creates trace with correct traceId and startedAt", () => {
      const before = Date.now();
      const trace = createTrace("test-trace-123");
      const after = Date.now();

      expect(trace.traceId).toBe("test-trace-123");
      expect(trace.startedAt).toBeGreaterThanOrEqual(before);
      expect(trace.startedAt).toBeLessThanOrEqual(after);
      expect(trace.stages).toEqual([]);
      expect(trace.endedAt).toBeUndefined();
      expect(trace.totalDurationMs).toBeUndefined();
      expect(trace.finalStatus).toBeUndefined();
      expect(trace.counters).toEqual({
        modelCalls: 0,
        toolCalls: 0,
        verifierCalls: 0,
        cycles: 0,
        humanReviewCount: 0,
      });
    });
  });

  // ── startStage / endStage ────────────────────────────────────────────────

  describe("startStage / endStage", () => {
    it("T2: records a single stage with correct timing", async () => {
      const trace = createTrace("t1");
      const t = startStage(trace, RUNTIME_TRACE_STAGES.INTENT_CLASSIFY);

      // Simulate some work
      await new Promise((r) => setTimeout(r, 10));

      endStage(trace, RUNTIME_TRACE_STAGES.INTENT_CLASSIFY, t);

      expect(trace.stages).toHaveLength(1);
      expect(trace.stages[0].name).toBe(RUNTIME_TRACE_STAGES.INTENT_CLASSIFY);
      expect(trace.stages[0].durationMs).toBeGreaterThanOrEqual(10);
      expect(trace.stages[0].endedAt).toBeDefined();
    });

    it("T3: records multiple stages in order", () => {
      const trace = createTrace("t2");

      const t1 = startStage(trace, "stage_a");
      endStage(trace, "stage_a", t1);

      const t2 = startStage(trace, "stage_b");
      endStage(trace, "stage_b", t2);

      expect(trace.stages).toHaveLength(2);
      expect(trace.stages[0].name).toBe("stage_a");
      expect(trace.stages[1].name).toBe("stage_b");
    });

    it("T4: handles duplicate stage names (latest wins for endStage)", () => {
      const trace = createTrace("t3");

      const t1 = startStage(trace, "repeat_stage");
      const t2 = startStage(trace, "repeat_stage");
      endStage(trace, "repeat_stage", t2); // end the latest one

      // Should have 2 stage entries, latest one completed
      expect(trace.stages).toHaveLength(2);
      expect(trace.stages[0].endedAt).toBeUndefined();
      expect(trace.stages[1].endedAt).toBeDefined();
    });

    it("T5: endStage with no matching start appends new stage", () => {
      const trace = createTrace("t4");
      endStage(trace, "orphan_stage", Date.now());

      expect(trace.stages).toHaveLength(1);
      expect(trace.stages[0].name).toBe("orphan_stage");
      expect(trace.stages[0].durationMs).toBeDefined();
    });
  });

  // ── traceStage ───────────────────────────────────────────────────────────

  describe("traceStage", () => {
    it("T6: wraps async fn with stage timing", async () => {
      const trace = createTrace("t5");
      const result = await traceStage(trace, "async_op", async () => {
        await new Promise((r) => setTimeout(r, 15));
        return 42;
      });

      expect(result).toBe(42);
      expect(trace.stages).toHaveLength(1);
      expect(trace.stages[0].name).toBe("async_op");
      expect(trace.stages[0].durationMs).toBeGreaterThanOrEqual(15);
    });

    it("T7: records timing even when fn throws", async () => {
      const trace = createTrace("t6");

      await expect(
        traceStage(trace, "failing_op", async () => {
          await new Promise((r) => setTimeout(r, 5));
          throw new Error("boom");
        })
      ).rejects.toThrow("boom");

      // Stage should still be recorded (finally block)
      expect(trace.stages).toHaveLength(1);
      expect(trace.stages[0].name).toBe("failing_op");
      expect(trace.stages[0].endedAt).toBeDefined();
    });
  });

  // ── finalizeTrace ────────────────────────────────────────────────────────

  describe("finalizeTrace", () => {
    it("T8: computes totalDurationMs and sets finalStatus", () => {
      const before = Date.now();
      const trace = createTrace("t7");
      const t = startStage(trace, "some_work");
      endStage(trace, "some_work", t);

      const finalized = finalizeTrace(trace, "success");

      expect(finalized.endedAt).toBeDefined();
      expect(finalized.totalDurationMs).toBeGreaterThanOrEqual(0);
      expect(finalized.finalStatus).toBe("success");
      expect(finalized.failureReason).toBeUndefined();
    });

    it("T9: sets failureReason when provided", () => {
      const trace = createTrace("t8");
      const finalized = finalizeTrace(trace, "failed", "timeout exceeded");

      expect(finalized.finalStatus).toBe("failed");
      expect(finalized.failureReason).toBe("timeout exceeded");
    });

    it("T10: returns the same trace object (mutates in place)", () => {
      const trace = createTrace("t9");
      const result = finalizeTrace(trace, "done");
      expect(result).toBe(trace);
    });
  });

  // ── Counter helpers ──────────────────────────────────────────────────────

  describe("updateTraceCounters", () => {
    it("T11: updates counters with partial values", () => {
      const trace = createTrace("t10");
      updateTraceCounters(trace, { modelCalls: 3, cycles: 2 });

      expect(trace.counters.modelCalls).toBe(3);
      expect(trace.counters.cycles).toBe(2);
      // Others remain default
      expect(trace.counters.toolCalls).toBe(0);
      expect(trace.counters.verifierCalls).toBe(0);
    });
  });

  describe("updateTraceRouting", () => {
    it("T12: populates routing metadata", () => {
      const trace = createTrace("t11");
      updateTraceRouting(trace, {
        decisionType: "delegate_slow",
        policyRoute: "manager_llm_required",
        routingLayer: "L1",
        delegation: true,
      });

      expect(trace.routing).toEqual({
        decisionType: "delegate_slow",
        policyRoute: "manager_llm_required",
        routingLayer: "L1",
        delegation: true,
      });
    });
  });

  describe("updateTraceCycleSummary", () => {
    it("T13: populates cycle summary", () => {
      const trace = createTrace("t12");
      updateTraceCycleSummary(trace, {
        totalCycles: 3,
        maxCycles: 5,
        finalStatus: "accepted",
        cycleAuditMs: 1200,
      });

      expect(trace.cycleSummary).toEqual({
        totalCycles: 3,
        maxCycles: 5,
        finalStatus: "accepted",
        cycleAuditMs: 1200,
      });
    });
  });

  describe("updateTraceWorkerSummary", () => {
    it("T14: populates worker summary", () => {
      const trace = createTrace("t13");
      updateTraceWorkerSummary(trace, {
        inputTokens: 1000,
        outputTokens: 500,
        costUsd: 0.01,
        latencyMs: 3000,
        modelName: "qwen2.5-72b",
      });

      expect(trace.workerSummary).toEqual({
        inputTokens: 1000,
        outputTokens: 500,
        costUsd: 0.01,
        latencyMs: 3000,
        modelName: "qwen2.5-72b",
      });
    });
  });

  describe("updateTraceLedgerSummary", () => {
    it("T15: populates ledger summary", () => {
      const trace = createTrace("t14");
      updateTraceLedgerSummary(trace, {
        totalLatencyMs: 5000,
        totalModelCalls: 4,
        managerModelCalls: 2,
        slowModelCalls: 2,
        routerTaxRatio: 0.35,
        estimatedTotalCost: 0.05,
      });

      expect(trace.ledgerSummary).toEqual({
        totalLatencyMs: 5000,
        totalModelCalls: 4,
        managerModelCalls: 2,
        slowModelCalls: 2,
        routerTaxRatio: 0.35,
        estimatedTotalCost: 0.05,
      });
    });

    it("T16: handles null estimatedTotalCost", () => {
      const trace = createTrace("t15");
      updateTraceLedgerSummary(trace, {
        totalLatencyMs: 1000,
        totalModelCalls: 1,
        managerModelCalls: 1,
        slowModelCalls: 0,
        routerTaxRatio: 1.0,
        estimatedTotalCost: null,
      });

      expect(trace.ledgerSummary!.estimatedTotalCost).toBeNull();
    });
  });

  // ── buildRuntimeTraceExtract ─────────────────────────────────────────────

  describe("buildRuntimeTraceExtract", () => {
    it("T17: produces extract with completed stages only", () => {
      const trace = createTrace("t16");
      const t1 = startStage(trace, "completed_stage");
      endStage(trace, "completed_stage", t1);
      startStage(trace, "incomplete_stage"); // no endStage

      finalizeTrace(trace, "success");
      const extract = buildRuntimeTraceExtract(trace);

      expect(extract.traceId).toBe("t16");
      expect(extract.totalDurationMs).toBeGreaterThanOrEqual(0);
      expect(extract.finalStatus).toBe("success");
      expect(extract.stageCount).toBe(2); // both stages counted
      expect(extract.stageTimings).toHaveProperty("completed_stage");
      expect(extract.stageTimings).not.toHaveProperty("incomplete_stage");
    });

    it("T18: includes counters, cycleSummary, workerSummary, ledgerSummary, routing", () => {
      const trace = createTrace("t17");
      updateTraceCounters(trace, { modelCalls: 5, cycles: 3 });
      updateTraceCycleSummary(trace, {
        totalCycles: 3,
        maxCycles: 5,
        finalStatus: "revised",
        cycleAuditMs: 2000,
      });
      updateTraceWorkerSummary(trace, {
        inputTokens: 500,
        outputTokens: 200,
        costUsd: 0.005,
        latencyMs: 1500,
        modelName: "test-model",
      });
      updateTraceLedgerSummary(trace, {
        totalLatencyMs: 3000,
        totalModelCalls: 5,
        managerModelCalls: 3,
        slowModelCalls: 2,
        routerTaxRatio: 0.6,
        estimatedTotalCost: 0.005,
      });
      updateTraceRouting(trace, {
        decisionType: "delegate_slow",
        policyRoute: "manager_llm_required",
        routingLayer: "L1",
        delegation: true,
      });
      finalizeTrace(trace, "delegation_complete");

      const extract = buildRuntimeTraceExtract(trace);

      expect(extract.counters.modelCalls).toBe(5);
      expect(extract.counters.cycles).toBe(3);
      expect(extract.cycleSummary).toBeDefined();
      expect(extract.workerSummary).toBeDefined();
      expect(extract.ledgerSummary).toBeDefined();
      expect(extract.routing).toBeDefined();
      expect(extract.cycleSummary!.cycleAuditMs).toBe(2000);
      expect(extract.workerSummary!.modelName).toBe("test-model");
      expect(extract.routing!.delegation).toBe(true);
    });

    it("T19: handles unfinalized trace gracefully", () => {
      const trace = createTrace("t18");
      const extract = buildRuntimeTraceExtract(trace);

      expect(extract.totalDurationMs).toBe(0);
      expect(extract.finalStatus).toBe("unknown");
      expect(extract.stageTimings).toEqual({});
      expect(extract.cycleSummary).toBeUndefined();
      expect(extract.workerSummary).toBeUndefined();
    });

    it("T20: failureReason included when present", () => {
      const trace = createTrace("t19");
      finalizeTrace(trace, "failed", "worker timeout");
      const extract = buildRuntimeTraceExtract(trace);

      expect(extract.failureReason).toBe("worker timeout");
    });
  });

  // ── RUNTIME_TRACE_STAGES constants ───────────────────────────────────────

  describe("RUNTIME_TRACE_STAGES", () => {
    it("T21: contains all expected stage names", () => {
      expect(RUNTIME_TRACE_STAGES.INTENT_CLASSIFY).toBe("intent_classify");
      expect(RUNTIME_TRACE_STAGES.CROSS_SESSION_CONTEXT).toBe("cross_session_context");
      expect(RUNTIME_TRACE_STAGES.MANAGER_VIEW_BUILD).toBe("manager_view_build");
      expect(RUNTIME_TRACE_STAGES.MANAGER_ROUTING).toBe("manager_routing");
      expect(RUNTIME_TRACE_STAGES.WORKER_EXECUTION).toBe("worker_execution");
      expect(RUNTIME_TRACE_STAGES.CYCLE_RUNTIME).toBe("cycle_runtime");
      expect(RUNTIME_TRACE_STAGES.VERIFICATION).toBe("verification");
      expect(RUNTIME_TRACE_STAGES.SSE_DONE_PREPARE).toBe("sse_done_prepare");
    });
  });
});
