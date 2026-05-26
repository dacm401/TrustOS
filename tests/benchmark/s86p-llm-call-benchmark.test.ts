/**
 * S86P: LLM Call Counter — Benchmark Tests
 *
 * Tests cover:
 * - recording performance (latency of recordLlmCall)
 * - extract performance with many calls
 * - counters.modelCalls consistency
 * - by-kind aggregation accuracy with large call counts
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createTrace,
  setRequestTrace,
  recordLlmCall,
  finalizeTrace,
} from "../../src/services/runtime-trace.js";
import { buildRuntimeTraceExtract } from "../../src/types/runtime-trace.js";
import type { RuntimeTrace } from "../../src/types/runtime-trace.js";

describe("S86P Benchmark: recording latency", () => {
  beforeEach(() => {
    setRequestTrace(null);
  });

  it("BM1.1: recordLlmCall latency < 1ms (100 calls avg)", () => {
    const trace = createTrace("bm_latency");
    setRequestTrace(trace);

    const iterations = 100;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      recordLlmCall("worker", "gpt-4", 1000, 1500 + i, true);
    }
    const end = performance.now();
    const avgUs = ((end - start) / iterations) * 1000;

    console.log(`[S86P BM] recordLlmCall avg latency: ${avgUs.toFixed(2)}µs (${iterations} calls)`);

    expect(avgUs).toBeLessThan(1000); // < 1ms (1000µs)
    setRequestTrace(null);
  });

  it("BM1.2: recordLlmCall with null context latency < 0.1ms (no-op path)", () => {
    setRequestTrace(null);

    const iterations = 1000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      recordLlmCall("worker", "gpt-4", 1000, 1500 + i, true);
    }
    const end = performance.now();
    const avgUs = ((end - start) / iterations) * 1000;

    console.log(`[S86P BM] recordLlmCall null-context avg latency: ${avgUs.toFixed(2)}µs (${iterations} calls)`);

    expect(avgUs).toBeLessThan(100); // < 0.1ms (100µs)
  });
});

describe("S86P Benchmark: extract performance", () => {
  beforeEach(() => {
    setRequestTrace(null);
  });

  it("BM2.1: buildRuntimeTraceExtract with 100 calls < 5ms", () => {
    const trace = createTrace("bm_extract");
    setRequestTrace(trace);

    for (let i = 0; i < 100; i++) {
      recordLlmCall(
        i % 3 === 0 ? "worker" : i % 3 === 1 ? "manager" : "compressor",
        "gpt-4",
        1000 + i * 10,
        1100 + i * 10,
        true,
      );
    }

    finalizeTrace(trace, "success");
    const start = performance.now();
    const extract = buildRuntimeTraceExtract(trace);
    const end = performance.now();
    const durationMs = end - start;

    console.log(`[S86P BM] buildRuntimeTraceExtract(100 calls): ${durationMs.toFixed(2)}ms`);

    expect(durationMs).toBeLessThan(5);
    expect(extract.llmCallSummary?.total).toBe(100);
    setRequestTrace(null);
  });

  it("BM2.2: byKind aggregation is accurate with mixed kinds", () => {
    const trace = createTrace("bm_aggregate");
    setRequestTrace(trace);

    const kinds = ["worker", "manager", "compressor", "execution_loop", "planner"] as const;
    const expected: Record<string, number> = {};

    for (let i = 0; i < 50; i++) {
      const kind = kinds[i % kinds.length];
      recordLlmCall(kind, "gpt-4", 1000 + i, 1100 + i, true);
      expected[kind] = (expected[kind] || 0) + 1;
    }

    finalizeTrace(trace, "success");
    const extract = buildRuntimeTraceExtract(trace);

    expect(extract.llmCallSummary!.total).toBe(50);
    expect(extract.llmCallSummary!.byKind).toEqual(expected);
    setRequestTrace(null);
  });
});

describe("S86P Benchmark: counters consistency", () => {
  beforeEach(() => {
    setRequestTrace(null);
  });

  it("BM3.1: counters.modelCalls matches llmCalls.length", () => {
    const trace = createTrace("bm_consistency");
    setRequestTrace(trace);

    for (let i = 0; i < 25; i++) {
      recordLlmCall("worker", "gpt-4", 1000 + i, 1100 + i, true);
    }

    expect(trace.counters.modelCalls).toBe(25);
    expect(trace.llmCalls?.length).toBe(25);
    setRequestTrace(null);
  });

  it("BM3.2: manual counter increment + recordLlmCall are consistent", () => {
    const trace = createTrace("bm_manual");
    setRequestTrace(trace);

    recordLlmCall("worker", "gpt-4", 1000, 1100, true);
    trace.counters.modelCalls = 5; // simulate manual increment (which will be corrected)

    recordLlmCall("manager", "gpt-4", 1200, 1300, true);
    // counters.modelCalls always reflects llmCalls.length (source of truth)
    expect(trace.counters.modelCalls).toBe(2); // llmCalls has 2 records

    setRequestTrace(null);
  });
});
