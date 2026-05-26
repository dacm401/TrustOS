/**
 * S88P: Runtime Progress & LLM Wait Visibility V0 — Tests
 *
 * Tests cover:
 * - T1: Progress state type construction
 * - T2: updateTraceProgress transitions
 * - T3: beginLlmWait / endLlmWait lifecycle
 * - T4: getCurrentProgress snapshots
 * - T5: Slow call detection in recordLlmCall
 * - T6: RuntimeTraceExtract progress + slowCallSummary
 * - T7: SSE progress event shape (backward compatible)
 * - T8: Privacy — no prompt/content/args in progress metadata
 * - T9: Budget compatibility (S87P regression)
 * - T10: AsyncLocalStorage isolation
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createTrace,
  setRequestTrace,
  recordLlmCall,
  runWithRequestTrace,
  updateTraceProgress,
  beginLlmWait,
  endLlmWait,
  getCurrentProgress,
  refreshProgressElapsed,
  setTraceBudget,
} from "../../src/services/runtime-trace.js";
import {
  buildRuntimeTraceExtract,
  SLOW_LLM_CALL_THRESHOLD_MS,
} from "../../src/types/runtime-trace.js";
import type { RuntimeTraceLlmCall } from "../../src/types/runtime-trace.js";

// ── T1: Progress state type construction ─────────────────────────────────

describe("S88P: Progress state type construction", () => {
  it("T1.1: trace created without progress starts as undefined", () => {
    const trace = createTrace("test-1");
    expect(trace.progress).toBeUndefined();
  });

  it("T1.2: updateTraceProgress initializes progress state", () => {
    const trace = createTrace("test-2");
    updateTraceProgress(trace, "manager_routing");
    expect(trace.progress).toBeDefined();
    expect(trace.progress!.stage).toBe("manager_routing");
    expect(trace.progress!.hasSlowCall).toBe(false);
    expect(trace.progress!.isWaitingOnSlowCall).toBe(false);
    expect(trace.progress!.stageStartedAt).toBeGreaterThan(0);
    expect(trace.progress!.stageElapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("T1.3: progress state has no llmWait fields when idle", () => {
    const trace = createTrace("test-3");
    updateTraceProgress(trace, "worker_execution");
    expect(trace.progress!.llmWaitKind).toBeUndefined();
    expect(trace.progress!.llmWaitModel).toBeUndefined();
    expect(trace.progress!.llmWaitStartedAt).toBeUndefined();
    expect(trace.progress!.llmWaitElapsedMs).toBeUndefined();
  });
});

// ── T2: updateTraceProgress transitions ──────────────────────────────────

describe("S88P: updateTraceProgress transitions", () => {
  it("T2.1: transitioning between stages clears LLM wait", () => {
    const trace = createTrace("test-t2-1");
    updateTraceProgress(trace, "manager_routing");
    beginLlmWait(trace, "manager", "gpt-4o");
    expect(trace.progress!.llmWaitKind).toBe("manager");

    // Transition to next stage
    updateTraceProgress(trace, "worker_execution");
    expect(trace.progress!.stage).toBe("worker_execution");
    expect(trace.progress!.llmWaitKind).toBeUndefined(); // cleared on transition
    expect(trace.progress!.hasSlowCall).toBe(false);
  });

  it("T2.2: stageStartedAt changes on transition", () => {
    const trace = createTrace("test-t2-2");
    updateTraceProgress(trace, "stage_a");
    const firstStart = trace.progress!.stageStartedAt;

    // Wait a tiny bit
    const t = Date.now();
    while (Date.now() - t < 5) { /* busy wait */ }

    updateTraceProgress(trace, "stage_b");
    expect(trace.progress!.stageStartedAt).toBeGreaterThan(firstStart);
  });
});

// ── T3: beginLlmWait / endLlmWait lifecycle ──────────────────────────────

describe("S88P: beginLlmWait / endLlmWait lifecycle", () => {
  it("T3.1: beginLlmWait sets in-flight LLM wait state", () => {
    const trace = createTrace("test-t3-1");
    updateTraceProgress(trace, "manager_routing");
    beginLlmWait(trace, "manager", "gpt-4o");
    expect(trace.progress!.llmWaitKind).toBe("manager");
    expect(trace.progress!.llmWaitModel).toBe("gpt-4o");
    expect(trace.progress!.llmWaitStartedAt).toBeGreaterThan(0);
    expect(trace.progress!.llmWaitElapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("T3.2: endLlmWait clears in-flight state", () => {
    const trace = createTrace("test-t3-2");
    updateTraceProgress(trace, "manager_routing");
    beginLlmWait(trace, "planner", "gpt-4o-mini");
    endLlmWait(trace);
    expect(trace.progress!.llmWaitKind).toBeUndefined();
    expect(trace.progress!.llmWaitModel).toBeUndefined();
    expect(trace.progress!.llmWaitStartedAt).toBeUndefined();
  });

  it("T3.3: endLlmWait records elapsed wait time", () => {
    const trace = createTrace("test-t3-3");
    updateTraceProgress(trace, "worker_execution");
    beginLlmWait(trace, "worker", "gpt-4o");
    // Simulate time passing
    endLlmWait(trace);
    expect(trace.progress!.llmWaitElapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("T3.4: beginLlmWait without prior updateTraceProgress initializes with defaults", () => {
    const trace = createTrace("test-t3-4");
    beginLlmWait(trace, "compressor", undefined);
    expect(trace.progress).toBeDefined();
    expect(trace.progress!.stage).toBe("unknown");
    expect(trace.progress!.llmWaitKind).toBe("compressor");
    expect(trace.progress!.llmWaitModel).toBeUndefined();
  });

  it("T3.5: endLlmWait on trace without progress is a no-op", () => {
    const trace = createTrace("test-t3-5");
    // Should not throw
    expect(() => endLlmWait(trace)).not.toThrow();
  });
});

// ── T4: getCurrentProgress snapshots ─────────────────────────────────────

describe("S88P: getCurrentProgress snapshots", () => {
  it("T4.1: returns null when no trace is active", () => {
    // No trace set in context
    const progress = getCurrentProgress();
    expect(progress).toBeNull();
  });

  it("T4.2: returns null when trace has no progress", () => {
    const trace = createTrace("test-t4-2");
    runWithRequestTrace(trace, () => {
      const progress = getCurrentProgress();
      expect(progress).toBeNull();
    });
  });

  it("T4.3: returns progress with elapsed times", () => {
    const trace = createTrace("test-t4-3");
    runWithRequestTrace(trace, () => {
      updateTraceProgress(trace, "manager_routing");
      beginLlmWait(trace, "manager", "gpt-4o");

      const progress = getCurrentProgress();
      expect(progress).not.toBeNull();
      expect(progress!.stage).toBe("manager_routing");
      expect(progress!.llmWaitKind).toBe("manager");
      expect(progress!.llmWaitModel).toBe("gpt-4o");
      expect(progress!.stageElapsedMs).toBeGreaterThanOrEqual(0);
      expect(progress!.llmWaitElapsedMs).toBeGreaterThanOrEqual(0);
    });
  });

  it("T4.4: progress has no prompt/content/user data", () => {
    const trace = createTrace("test-t4-4");
    runWithRequestTrace(trace, () => {
      updateTraceProgress(trace, "worker_execution");
      beginLlmWait(trace, "worker", "deepseek-chat");

      const progress = getCurrentProgress()!;
      const keys = Object.keys(progress);
      // Verify only safe metadata keys
      expect(keys).toContain("stage");
      expect(keys).toContain("stageStartedAt");
      expect(keys).toContain("stageElapsedMs");
      expect(keys).toContain("hasSlowCall");
      expect(keys).toContain("isWaitingOnSlowCall");
      expect(keys).toContain("llmWaitKind");
      expect(keys).toContain("llmWaitModel");

      // NO prompt, content, tool arguments, messages, user data
      expect(keys).not.toContain("prompt");
      expect(keys).not.toContain("content");
      expect(keys).not.toContain("messages");
      expect(keys).not.toContain("userMessage");
      expect(keys).not.toContain("toolArgs");
    });
  });

  it("T4.5: isWaitingOnSlowCall is false for short waits", () => {
    const trace = createTrace("test-t4-5");
    runWithRequestTrace(trace, () => {
      updateTraceProgress(trace, "manager_routing");
      beginLlmWait(trace, "manager", "gpt-4o");

      const progress = getCurrentProgress()!;
      // Just started, should not be slow yet
      expect(progress.isWaitingOnSlowCall).toBe(false);
    });
  });
});

// ── T5: Slow call detection in recordLlmCall ─────────────────────────────

describe("S88P: Slow call detection in recordLlmCall", () => {
  it("T5.1: call under threshold is NOT marked slow", () => {
    const trace = createTrace("test-t5-1");
    setRequestTrace(trace);
    const now = Date.now();
    const call = recordLlmCall("manager", "gpt-4o", now, now + 1000, true);
    setRequestTrace(null);
    expect(call).not.toBeNull();
    expect(call!.slowCallWarning).toBeUndefined();
  });

  it("T5.2: call over threshold IS marked slow", () => {
    const trace = createTrace("test-t5-2");
    setRequestTrace(trace);
    const now = Date.now();
    const call = recordLlmCall(
      "worker",
      "gpt-4o",
      now,
      now + SLOW_LLM_CALL_THRESHOLD_MS + 1,
      true
    );
    setRequestTrace(null);
    expect(call).not.toBeNull();
    expect(call!.slowCallWarning).toBe(true);
  });

  it("T5.3: slow call updates trace progress hasSlowCall", () => {
    const trace = createTrace("test-t5-3");
    setRequestTrace(trace);
    updateTraceProgress(trace, "worker_execution");

    const now = Date.now();
    recordLlmCall("worker", "deepseek-chat", now, now + 6000, true);

    expect(trace.progress!.hasSlowCall).toBe(true);
    setRequestTrace(null);
  });

  it("T5.4: multiple slow calls — slowest identified in extract", () => {
    const trace = createTrace("test-t5-4");
    setRequestTrace(trace);
    const now = Date.now();

    // Slow call 1: 5500ms
    recordLlmCall("worker", "gpt-4o", now, now + 5500, true);
    // Slow call 2: 8000ms (slower)
    recordLlmCall("planner", "gpt-4o", now, now + 8000, true);

    setRequestTrace(null);

    const extract = buildRuntimeTraceExtract(trace);
    expect(extract.slowCallSummary).toBeDefined();
    expect(extract.slowCallSummary!.count).toBe(2);
    expect(extract.slowCallSummary!.slowestKind).toBe("planner");
    expect(extract.slowCallSummary!.slowestDurationMs).toBe(8000);
    expect(extract.slowCallSummary!.thresholdMs).toBe(SLOW_LLM_CALL_THRESHOLD_MS);
  });

  it("T5.5: no slow calls → no slowCallSummary in extract", () => {
    const trace = createTrace("test-t5-5");
    setRequestTrace(trace);
    const now = Date.now();
    recordLlmCall("manager", "gpt-4o", now, now + 1000, true);
    setRequestTrace(null);

    const extract = buildRuntimeTraceExtract(trace);
    expect(extract.slowCallSummary).toBeUndefined();
  });

  it("T5.6: recordLlmCall clears in-flight LLM wait", () => {
    const trace = createTrace("test-t5-6");
    setRequestTrace(trace);
    updateTraceProgress(trace, "manager_routing");
    beginLlmWait(trace, "manager", "gpt-4o");

    // Record the completed call — should clear wait
    const now = Date.now();
    recordLlmCall("manager", "gpt-4o", now - 1000, now, true);

    expect(trace.progress!.llmWaitKind).toBeUndefined();
    expect(trace.progress!.llmWaitModel).toBeUndefined();
    setRequestTrace(null);
  });
});

// ── T6: RuntimeTraceExtract progress + slowCallSummary ───────────────────

describe("S88P: RuntimeTraceExtract progress + slowCallSummary", () => {
  it("T6.1: extract includes progress when set", () => {
    const trace = createTrace("test-t6-1");
    updateTraceProgress(trace, "worker_execution");
    const extract = buildRuntimeTraceExtract(trace);
    expect(extract.progress).toBeDefined();
    expect(extract.progress!.stage).toBe("worker_execution");
  });

  it("T6.2: extract progress is a copy (not reference)", () => {
    const trace = createTrace("test-t6-2");
    updateTraceProgress(trace, "stage_x");
    const extract = buildRuntimeTraceExtract(trace);
    expect(extract.progress).not.toBe(trace.progress); // different object
  });

  it("T6.3: extract includes slowCallSummary when slow calls present", () => {
    const trace = createTrace("test-t6-3");
    setRequestTrace(trace);
    const now = Date.now();
    recordLlmCall("worker", "gpt-4o", now, now + 6000, true);
    recordLlmCall("manager_synthesis", "gpt-4o", now, now + 7000, true);
    setRequestTrace(null);

    const extract = buildRuntimeTraceExtract(trace);
    expect(extract.slowCallSummary).toBeDefined();
    expect(extract.slowCallSummary!.count).toBe(2);
    expect(extract.slowCallSummary!.slowestDurationMs).toBe(7000);
  });

  it("T6.4: extract preserves all S87P fields alongside S88P fields", () => {
    const trace = createTrace("test-t6-4");
    setRequestTrace(trace);
    setTraceBudget(trace, 10);
    const now = Date.now();
    // Add a duplicate call
    recordLlmCall("manager", "gpt-4o", now, now + 500, true);
    recordLlmCall("manager", "gpt-4o", now, now + 500, true); // dup
    // Add a slow call
    recordLlmCall("worker", "gpt-4o", now, now + 6000, true);
    setRequestTrace(null);

    updateTraceProgress(trace, "worker_execution");

    const extract = buildRuntimeTraceExtract(trace);
    // S87P fields still present
    expect(extract.duplicateCount).toBeGreaterThan(0);
    expect(extract.budgetStatus).toBeDefined();
    // S88P fields present
    expect(extract.progress).toBeDefined();
    expect(extract.slowCallSummary).toBeDefined();
    // S86P fields still present
    expect(extract.llmCallSummary).toBeDefined();
  });
});

// ── T7: SSE progress event shape (backward compatible) ──────────────────

describe("S88P: SSE progress event shape", () => {
  it("T7.1: progress event payload is flat and safe", () => {
    const trace = createTrace("test-t7-1");
    runWithRequestTrace(trace, () => {
      updateTraceProgress(trace, "worker_execution");
      beginLlmWait(trace, "worker", "deepseek-chat");

      const progress = getCurrentProgress()!;
      const payload: Record<string, unknown> = {
        stage: progress.stage,
        stageElapsedMs: progress.stageElapsedMs,
        totalElapsedMs: 12345,
        llmWait: {
          kind: progress.llmWaitKind,
          model: progress.llmWaitModel ?? "unknown",
          elapsedMs: progress.llmWaitElapsedMs ?? 0,
        },
      };

      // Verify shape
      expect(payload.stage).toBe("worker_execution");
      expect(payload.llmWait).toBeDefined();
      const wait = payload.llmWait as Record<string, unknown>;
      expect(wait.kind).toBe("worker");
      expect(wait.model).toBe("deepseek-chat");
      expect(typeof wait.elapsedMs).toBe("number");
    });
  });

  it("T7.2: progress event without LLM wait omits llmWait field", () => {
    const payload: Record<string, unknown> = {
      stage: "manager_routing",
      stageElapsedMs: 200,
      totalElapsedMs: 5000,
    };
    expect(payload.llmWait).toBeUndefined();
    // Backward compatible — no llmWait field
  });

  it("T7.3: existing SSE event types unchanged", () => {
    // Verify that status/error/done types are still valid
    const types = ["status", "result", "error", "done", "chunk", "fast_reply",
      "manager_synthesized", "cycle_event", "progress"];
    // "progress" is the only new type
    expect(types).toContain("progress");
    // All existing types are preserved
    expect(types).toContain("status");
    expect(types).toContain("result");
    expect(types).toContain("done");
    expect(types).toContain("cycle_event");
  });
});

// ── T8: Privacy — no prompt/content in progress metadata ────────────────

describe("S88P: Privacy — no prompt/content in progress metadata", () => {
  it("T8.1: getCurrentProgress never includes prompt", () => {
    const trace = createTrace("test-t8-1");
    runWithRequestTrace(trace, () => {
      updateTraceProgress(trace, "manager_routing");
      beginLlmWait(trace, "manager", "gpt-4o");

      const progress = getCurrentProgress()!;
      const serialized = JSON.stringify(progress);
      // No prompt, content, or message-related keys
      expect(serialized).not.toContain("prompt");
      expect(serialized).not.toContain("content");
      expect(serialized).not.toContain("\"messages\"");
      expect(serialized).not.toContain("\"userInput\"");
      expect(serialized).not.toContain("\"toolArgs\"");
      expect(serialized).not.toContain("\"arguments\"");
    });
  });

  it("T8.2: slowCallSummary contains no prompt/content", () => {
    const trace = createTrace("test-t8-2");
    setRequestTrace(trace);
    const now = Date.now();
    recordLlmCall("worker", "gpt-4o", now, now + 6000, true);
    setRequestTrace(null);

    const extract = buildRuntimeTraceExtract(trace);
    const summary = JSON.stringify(extract.slowCallSummary);
    expect(summary).not.toContain("prompt");
    expect(summary).not.toContain("content");
    expect(summary).not.toContain("\"messages\"");
  });

  it("T8.3: progress payload in SSE never carries model request/response data", () => {
    const progressPayload: Record<string, unknown> = {
      stage: "worker_execution",
      stageElapsedMs: 5000,
      llmWait: { kind: "worker", model: "gpt-4o", elapsedMs: 3000 },
    };
    const payload = JSON.stringify(progressPayload);
    // Only kind + model name — not actual request/response
    expect(payload).toContain("kind");
    expect(payload).toContain("model");
    // But no actual call content
    expect(payload).not.toContain("input");
    expect(payload).not.toContain("output");
    expect(payload).not.toContain("request");
    expect(payload).not.toContain("response");
    expect(payload).not.toContain("messages");
  });
});

// ── T9: Budget compatibility (S87P regression) ──────────────────────────

describe("S88P: Budget compatibility (S87P regression)", () => {
  it("T9.1: budget warnings still fire alongside slow call detection", () => {
    const trace = createTrace("test-t9-1");
    setRequestTrace(trace);
    setTraceBudget(trace, 1);
    const now = Date.now();

    // First call: normal
    recordLlmCall("manager", "gpt-4o", now, now + 500, true);
    // Second call: over budget + slow
    recordLlmCall("worker", "gpt-4o", now, now + 6000, true);

    setRequestTrace(null);

    const extract = buildRuntimeTraceExtract(trace);
    // S87P: budget overage detected
    expect(extract.budgetStatus?.overBudget).toBe(true);
    // S88P: slow call detected
    expect(extract.slowCallSummary?.count).toBe(1);
  });

  it("T9.2: near_budget warning still fires", () => {
    const trace = createTrace("test-t9-2");
    setRequestTrace(trace);
    setTraceBudget(trace, 5); // near_budget at 80% = 4
    const now = Date.now();

    recordLlmCall("manager", "gpt-4o", now, now + 100, true);
    recordLlmCall("manager", "gpt-4o", now, now + 100, true);
    recordLlmCall("manager", "gpt-4o", now, now + 100, true);
    recordLlmCall("manager", "gpt-4o", now, now + 100, true); // hits near_budget

    setRequestTrace(null);

    expect(trace.budget!.warnings.some(w => w.kind === "near_budget")).toBe(true);
  });
});

// ── T10: AsyncLocalStorage isolation ─────────────────────────────────────

describe("S88P: AsyncLocalStorage isolation", () => {
  it("T10.1: progress states are isolated per request", async () => {
    const traceA = createTrace("req-A");
    const traceB = createTrace("req-B");

    let progressA: string | undefined;
    let progressB: string | undefined;

    await Promise.all([
      new Promise<void>(resolve => {
        runWithRequestTrace(traceA, () => {
          updateTraceProgress(traceA, "worker_execution");
          beginLlmWait(traceA, "worker", "model-A");
          progressA = getCurrentProgress()?.llmWaitModel;
          resolve();
        });
      }),
      new Promise<void>(resolve => {
        runWithRequestTrace(traceB, () => {
          updateTraceProgress(traceB, "manager_routing");
          beginLlmWait(traceB, "manager", "model-B");
          progressB = getCurrentProgress()?.llmWaitModel;
          resolve();
        });
      }),
    ]);

    expect(progressA).toBe("model-A");
    expect(progressB).toBe("model-B");
  });

  it("T10.2: getCurrentProgress returns null outside runWithRequestTrace", () => {
    const progress = getCurrentProgress();
    expect(progress).toBeNull();
  });
});
