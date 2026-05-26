/**
 * S86P: LLM Call Counter — Unit Tests
 *
 * Tests cover:
 * - trace context lifecycle (set/clear, runWithRequestTrace)
 * - recordLlmCall creates correct entries
 * - all call kinds are distinguishable
 * - counters.modelCalls increments automatically
 * - error recording works (success=false, errorCode set)
 * - no prompt/content data leaked in RuntimeTraceLlmCall
 * - no trace context → recordLlmCall is safe no-op
 * - multiple calls accumulate correctly
 * - buildRuntimeTraceExtract includes llmCallSummary
 * - AsyncLocalStorage: parallel traces do not cross-contaminate
 * - AsyncLocalStorage: nested async calls preserve correct trace
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createTrace,
  setRequestTrace,
  getRequestTrace,
  recordLlmCall,
  runWithRequestTrace,
  finalizeTrace,
} from "../../src/services/runtime-trace.js";
import { buildRuntimeTraceExtract } from "../../src/types/runtime-trace.js";
import type { RuntimeTrace, RuntimeTraceLlmCall } from "../../src/types/runtime-trace.js";

describe("S86P: Trace context lifecycle", () => {
  beforeEach(() => {
    // Clean up any leaked trace context
    setRequestTrace(null);
  });

  it("T1.1: setRequestTrace sets active trace", () => {
    const trace = createTrace("test_1");
    setRequestTrace(trace);
    expect(getRequestTrace()).toBe(trace);
    setRequestTrace(null);
  });

  it("T1.2: getRequestTrace returns null when no trace is set", () => {
    setRequestTrace(null);
    expect(getRequestTrace()).toBeNull();
  });

  it("T1.3: setRequestTrace initializes llmCalls array", () => {
    const trace = createTrace("test_init");
    expect(trace.llmCalls).toBeUndefined();

    setRequestTrace(trace);
    expect(trace.llmCalls).toEqual([]);
    setRequestTrace(null);
  });

  it("T1.4: runWithRequestTrace sets trace context for the callback", () => {
    const trace = createTrace("test_als_1");
    const captured = runWithRequestTrace(trace, () => {
      return { trace: getRequestTrace(), isTrace: getRequestTrace() === trace };
    });
    expect(captured.isTrace).toBe(true);
    expect(captured.trace).toBe(trace);
    // After runWithRequestTrace exits, no trace should be active
    expect(getRequestTrace()).toBeNull();
  });

  it("T1.5: runWithRequestTrace initializes llmCalls array", () => {
    const trace = createTrace("test_als_init");
    expect(trace.llmCalls).toBeUndefined();
    runWithRequestTrace(trace, () => {
      expect(trace.llmCalls).toEqual([]);
    });
  });

  it("T1.6: llmCalls persist after runWithRequestTrace exits", () => {
    const trace = createTrace("test_persist");
    runWithRequestTrace(trace, () => {
      recordLlmCall("worker", "gpt-4", 1000, 1500, true);
    });
    // llmCalls should still be there after context exits
    expect(trace.llmCalls?.length).toBe(1);
    // No trace context outside
    expect(getRequestTrace()).toBeNull();
  });
});

describe("S86P: recordLlmCall — basic recording", () => {
  let trace: RuntimeTrace;

  beforeEach(() => {
    setRequestTrace(null);
    trace = createTrace("test_record");
    setRequestTrace(trace);
  });

  it("T2.1: recordLlmCall adds entry to trace.llmCalls", () => {
    recordLlmCall("worker", "gpt-4o-mini", 1000, 1500, true);
    expect(trace.llmCalls?.length).toBe(1);

    const call = trace.llmCalls![0];
    expect(call.kind).toBe("worker");
    expect(call.model).toBe("gpt-4o-mini");
    expect(call.startedAt).toBe(1000);
    expect(call.endedAt).toBe(1500);
    expect(call.durationMs).toBe(500);
    expect(call.success).toBe(true);
    expect(call.errorCode).toBeUndefined();
  });

  it("T2.2: recordLlmCall auto-increments counters.modelCalls", () => {
    expect(trace.counters.modelCalls).toBe(0);
    recordLlmCall("worker", undefined, 1000, 1500, true);
    expect(trace.counters.modelCalls).toBe(1);
    recordLlmCall("manager", undefined, 2000, 2500, true);
    expect(trace.counters.modelCalls).toBe(2);
  });

  it("T2.3: recordLlmCall without trace context is safe no-op", () => {
    setRequestTrace(null);
    const result = recordLlmCall("worker", "gpt-4", 1000, 1500, true);
    expect(result).toBeNull();
  });

  it("T2.4: recordLlmCall with error sets success=false and errorCode", () => {
    recordLlmCall("manager", "claude-3-sonnet", 1000, 2000, false, "timeout");
    expect(trace.llmCalls![0].success).toBe(false);
    expect(trace.llmCalls![0].errorCode).toBe("timeout");
  });

  it("T2.5: multiple calls accumulate with unique IDs", () => {
    recordLlmCall("worker", "gpt-4", 1000, 1500, true);
    recordLlmCall("worker", "gpt-4", 1600, 2100, true);
    recordLlmCall("manager", "gpt-4o-mini", 2000, 2300, true);

    expect(trace.llmCalls?.length).toBe(3);
    const ids = trace.llmCalls!.map((c) => c.id);
    expect(new Set(ids).size).toBe(3); // all unique
    expect(ids[0]).toContain("test_record_llm_");
  });

  it("T2.6: missing startedAt/endedAt — uses Date.now() defaults", () => {
    const before = Date.now();
    recordLlmCall("unknown", undefined, undefined, undefined, true);
    const after = Date.now();

    const call = trace.llmCalls![0];
    expect(call.startedAt).toBeGreaterThanOrEqual(before);
    expect(call.startedAt).toBeLessThanOrEqual(after);
    expect(call.durationMs).toBeUndefined();
    expect(call.endedAt).toBeUndefined();
  });
});

describe("S86P: Call kind classification", () => {
  let trace: RuntimeTrace;

  beforeEach(() => {
    setRequestTrace(null);
    trace = createTrace("test_kinds");
    setRequestTrace(trace);
  });

  const ALL_KINDS = [
    "worker",
    "manager",
    "manager_synthesis",
    "execution_loop",
    "planner",
    "compressor",
    "unknown",
  ] as const;

  for (const kind of ALL_KINDS) {
    it(`T3.${ALL_KINDS.indexOf(kind) + 1}: records kind "${kind}" correctly`, () => {
      recordLlmCall(kind, undefined, 1000, 1100, true);
      expect(trace.llmCalls![0].kind).toBe(kind);
    });
  }
});

describe("S86P: Trace extract includes llmCallSummary", () => {
  let trace: RuntimeTrace;

  beforeEach(() => {
    setRequestTrace(null);
    trace = createTrace("test_extract");
    setRequestTrace(trace);
  });

  it("T4.1: extract without llmCalls has no summary", () => {
    setRequestTrace(null);
    const extract = buildRuntimeTraceExtract(trace);
    expect(extract.llmCallSummary).toBeUndefined();
  });

  it("T4.2: extract with llmCalls has correct by-kind summary", () => {
    recordLlmCall("worker", "gpt-4", 1000, 1500, true);
    recordLlmCall("worker", "gpt-4", 1600, 2000, true);
    recordLlmCall("manager", "gpt-4o-mini", 1000, 1200, true);
    recordLlmCall("compressor", "qwen-7b", 1000, 1100, true);

    finalizeTrace(trace, "success");
    const extract = buildRuntimeTraceExtract(trace);

    expect(extract.llmCallSummary).toBeDefined();
    expect(extract.llmCallSummary!.total).toBe(4);
    expect(extract.llmCallSummary!.byKind).toEqual({
      worker: 2,
      manager: 1,
      compressor: 1,
    });
  });

  it("T4.3: extract with errors — errors counted in total", () => {
    recordLlmCall("worker", "gpt-4", 1000, 1500, true);
    recordLlmCall("worker", "gpt-4", 1600, 1700, false, "timeout");
    recordLlmCall("manager", "gpt-4o-mini", 1000, 1200, false, "http_429");

    finalizeTrace(trace, "failed");
    const extract = buildRuntimeTraceExtract(trace);

    expect(extract.llmCallSummary!.total).toBe(3);
    expect(extract.llmCallSummary!.byKind.worker).toBe(2);
    expect(extract.llmCallSummary!.byKind.manager).toBe(1);
  });
});

describe("S86P: Safety — no prompt/content leakage", () => {
  it("T5.1: RuntimeTraceLlmCall type has no prompt/content fields", () => {
    // This is a compile-time check. We verify at runtime that
    // a recorded call object has the expected safe shape.
    const trace = createTrace("test_safety");
    setRequestTrace(trace);

    recordLlmCall("worker", "gpt-4", 1000, 1500, true);

    const call = trace.llmCalls![0];
    const safeKeys = [
      "id",
      "kind",
      "model",
      "startedAt",
      "endedAt",
      "durationMs",
      "success",
      "errorCode",
    ];

    const actualKeys = Object.keys(call).sort();
    const expectedKeys = safeKeys.sort();

    // Must contain all safe keys
    for (const k of expectedKeys) {
      expect(actualKeys).toContain(k);
    }

    // Must NOT contain dangerous keys
    const dangerousKeys = ["prompt", "content", "completion", "messages", "tools", "arguments", "userData", "apiKey"];
    for (const k of dangerousKeys) {
      expect(actualKeys).not.toContain(k);
    }

    setRequestTrace(null);
  });
});

describe("S86P: AsyncLocalStorage — parallel trace isolation", () => {
  beforeEach(() => {
    setRequestTrace(null);
  });

  it("T7.1: two parallel traces via runWithRequestTrace do not cross-contaminate", async () => {
    const traceA = createTrace("trace_a");
    const traceB = createTrace("trace_b");

    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    await Promise.all([
      runWithRequestTrace(traceA, async () => {
        await delay(5);
        recordLlmCall("worker", "model-a", 1000, 1100, true);
        // After delay, B might have started its call
        await delay(5);
        recordLlmCall("worker", "model-a", 1200, 1300, true);
      }),
      runWithRequestTrace(traceB, async () => {
        recordLlmCall("planner", "model-b", 1000, 1100, true);
        await delay(10);
        recordLlmCall("manager", "model-b", 1200, 1300, true);
      }),
    ]);

    // traceA should ONLY have "worker" calls
    expect(traceA.llmCalls?.length).toBe(2);
    for (const call of traceA.llmCalls!) {
      expect(call.kind).toBe("worker");
      expect(call.model).toBe("model-a");
    }

    // traceB should ONLY have "planner" and "manager" calls
    expect(traceB.llmCalls?.length).toBe(2);
    expect(traceB.llmCalls![0].kind).toBe("planner");
    expect(traceB.llmCalls![1].kind).toBe("manager");
    for (const call of traceB.llmCalls!) {
      expect(call.model).toBe("model-b");
    }
  });

  it("T7.2: nested async calls preserve correct trace", async () => {
    const outerTrace = createTrace("outer");
    const innerTrace = createTrace("inner");

    await runWithRequestTrace(outerTrace, async () => {
      recordLlmCall("worker", "outer-model", 1000, 1100, true);

      // Inner runWithRequestTrace creates a new context
      await runWithRequestTrace(innerTrace, async () => {
        recordLlmCall("manager", "inner-model", 1000, 1100, true);

        // Nested await — should still be in inner context
        await new Promise((r) => setTimeout(r, 1));
        recordLlmCall("planner", "inner-model", 1200, 1300, true);
      });

      // Back in outer context
      recordLlmCall("worker", "outer-model", 1500, 1600, true);
    });

    // Outer trace should have 2 worker calls (no inner calls leaked)
    expect(outerTrace.llmCalls?.length).toBe(2);
    for (const call of outerTrace.llmCalls!) {
      expect(call.kind).toBe("worker");
      expect(call.model).toBe("outer-model");
    }

    // Inner trace should have 2 calls (manager + planner)
    expect(innerTrace.llmCalls?.length).toBe(2);
    expect(innerTrace.llmCalls![0].kind).toBe("manager");
    expect(innerTrace.llmCalls![1].kind).toBe("planner");
  });

  it("T7.3: no trace context — recordLlmCall is safe no-op, no throw", () => {
    // Confirm no trace is active
    setRequestTrace(null);
    expect(getRequestTrace()).toBeNull();

    // recordLlmCall should not throw
    const result = recordLlmCall("worker", "no-trace-model", 1000, 1100, true);
    expect(result).toBeNull();
  });

  it("T7.4: llmCallSeq is per-trace (not global)", () => {
    const t1 = createTrace("t1");
    const t2 = createTrace("t2");

    runWithRequestTrace(t1, () => {
      recordLlmCall("worker", undefined, 1000, 1500, true);
      recordLlmCall("worker", undefined, 1000, 1500, true);
    });

    runWithRequestTrace(t2, () => {
      recordLlmCall("worker", undefined, 1000, 1500, true);
    });

    expect(t1.llmCalls![0].id).toBe("t1_llm_000");
    expect(t1.llmCalls![1].id).toBe("t1_llm_001");
    // t2 starts fresh at 000
    expect(t2.llmCalls![0].id).toBe("t2_llm_000");
  });
});
