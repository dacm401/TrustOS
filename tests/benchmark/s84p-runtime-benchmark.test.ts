/**
 * S84P: Runtime Performance Unit Benchmarks
 *
 * Measures latency of internal runtime components (no external API calls).
 * These can run in CI without API keys or running server.
 *
 * Target components:
 * 1. Intent classifier (< 10ms expected)
 * 2. Artifact verifier — deterministic checks (< 50ms expected)
 * 3. Contract verifier — criteria evaluation (< 100ms expected)
 * 4. Context package builder (< 50ms expected)
 * 5. Manager view builder (< 10ms expected)
 * 6. Cycle runtime overhead — with mock worker (< 20ms for 1-cycle accept path)
 * 7. Runtime trace helpers — createTrace / startStage / endStage (< 1ms expected)
 * 8. Call ledger extract building (< 5ms expected)
 *
 * Methodology:
 * - Warm-up: 100 iterations (discarded)
 * - Measurement: 1000 iterations
 * - Report: mean, median, p95, p99, min, max
 */

import { describe, it, expect } from "vitest";
import { classifyIntent } from "../../src/services/intent-classifier.js";
import { verifyArtifact } from "../../src/services/verifier/artifact-verifier.js";
import { verifyAgainstCriteria } from "../../src/services/verifier/contract-verifier.js";
import { buildManagerView } from "../../src/services/context/manager-view.js";
import { buildCycleAuditExtract } from "../../src/services/cycle/cycle-runtime.js";
import { contextPackageToLedgerExtract } from "../../src/services/context/context-package-builder.js";
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
import { buildRuntimeTraceExtract } from "../../src/types/runtime-trace.js";

// ── Statistics helpers ─────────────────────────────────────────────────────

interface LatencyStats {
  n: number;
  mean: number;
  median: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  totalMs: number;
}

function computeStats(times: number[]): LatencyStats {
  const sorted = [...times].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n,
    mean: sum / n,
    median: sorted[Math.floor(n / 2)],
    p95: sorted[Math.floor(n * 0.95)],
    p99: sorted[Math.floor(n * 0.99)],
    min: sorted[0],
    max: sorted[n - 1],
    totalMs: sum,
  };
}

function fmt(n: number): string {
  if (n < 1) return n.toFixed(3) + "ms";
  if (n < 100) return n.toFixed(2) + "ms";
  return Math.round(n) + "ms";
}

function fmtReport(label: string, stats: LatencyStats): string {
  return `[${label}] n=${stats.n} | mean=${fmt(stats.mean)} median=${fmt(stats.median)} p95=${fmt(stats.p95)} p99=${fmt(stats.p99)} min=${fmt(stats.min)} max=${fmt(stats.max)} | total=${fmt(stats.totalMs)}`;
}

const WARMUP = 100;
const ITERATIONS = 1000;

// ── Test data ──────────────────────────────────────────────────────────────

const SAMPLE_MESSAGES = [
  "帮我查一下茅台的股价",
  "写一个Python快速排序算法",
  "What is the capital of France?",
  "请帮我总结这份报告的要点",
  "这个bug怎么修？代码报了TypeError",
  "我今天心情不好，能聊聊天吗",
  "帮我规划一下下周的工作安排",
  "分析一下这个数据集的分布特征",
];

const SAMPLE_HISTORY = [
  { role: "user" as const, content: "你好" },
  { role: "assistant" as const, content: "你好！有什么可以帮你的？" },
  { role: "user" as const, content: "帮我查一下今天的天气" },
  { role: "assistant" as const, content: "请问你在哪个城市？" },
];

const SAMPLE_ARTIFACT_CONTENT = `# Project Report

## Executive Summary
This report summarizes the Q4 2025 performance metrics for our product line.

## Key Findings
- Revenue grew 23% year-over-year
- Customer retention improved from 87% to 92%
- New user acquisition cost decreased by 15%

## Recommendations
1. Continue investing in customer success
2. Expand into APAC markets
3. Launch mobile-first experience

## Appendix
${"Additional data points and charts would be included here. ".repeat(20)}
`;

const SAMPLE_CRITERIA = [
  { id: "C001", description: "Contains executive summary", type: "structure" as const, severity: "high" as const },
  { id: "C002", description: "Has numerical data", type: "content" as const, severity: "medium" as const },
  { id: "C003", description: "Contains recommendations", type: "content" as const, severity: "high" as const },
  { id: "C004", description: "No security-sensitive content", type: "security" as const, severity: "critical" as const },
  { id: "C005", description: "Professional tone", type: "quality" as const, severity: "low" as const },
];

// ── Benchmarks ─────────────────────────────────────────────────────────────

describe("S84P Benchmark: Intent Classifier", () => {
  it("classifyIntent — 1000 iterations across 8 messages", () => {
    // Warm-up
    for (let i = 0; i < WARMUP; i++) {
      classifyIntent(SAMPLE_MESSAGES[i % SAMPLE_MESSAGES.length]);
    }

    const times: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const msg = SAMPLE_MESSAGES[i % SAMPLE_MESSAGES.length];
      const start = performance.now();
      const result = classifyIntent(msg);
      times.push(performance.now() - start);
      expect(result.category).toBeDefined();
    }

    const stats = computeStats(times);
    console.log(fmtReport("IntentClassifier", stats));
    // Intent classifier should be < 10ms p95 (local regex/string ops)
    expect(stats.p95).toBeLessThan(50);
  });
});

describe("S84P Benchmark: Artifact Verifier", () => {
  it("verifyArtifact — 1000 iterations", () => {
    const security = {
      artifactToManager: false,
      rawHistoryToWorker: false,
      rawMemoryToWorker: false,
    };

    // Warm-up
    for (let i = 0; i < WARMUP; i++) {
      verifyArtifact({ traceId: "bench", artifactType: "report", content: SAMPLE_ARTIFACT_CONTENT, security });
    }

    const times: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const start = performance.now();
      const result = verifyArtifact({ traceId: "bench", artifactType: "report", content: SAMPLE_ARTIFACT_CONTENT, security });
      times.push(performance.now() - start);
      expect(result.score).toBeDefined();
    }

    const stats = computeStats(times);
    console.log(fmtReport("ArtifactVerifier", stats));
    expect(stats.p95).toBeLessThan(200);
  });

  it("verifyArtifact — minimal content (fast path)", () => {
    const security = {
      artifactToManager: false,
      rawHistoryToWorker: false,
      rawMemoryToWorker: false,
    };
    const shortContent = "OK";

    // Warm-up
    for (let i = 0; i < WARMUP; i++) {
      verifyArtifact({ traceId: "bench", content: shortContent, security });
    }

    const times: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const start = performance.now();
      verifyArtifact({ traceId: "bench", content: shortContent, security });
      times.push(performance.now() - start);
    }

    const stats = computeStats(times);
    console.log(fmtReport("ArtifactVerifier(minimal)", stats));
    expect(stats.p95).toBeLessThan(50);
  });
});

describe("S84P Benchmark: Contract Verifier (criteria evaluation)", () => {
  it("verifyAgainstCriteria — 1000 iterations with 5 criteria", () => {
    const security = {
      artifactToManager: false,
      rawHistoryToWorker: false,
      rawMemoryToWorker: false,
    };

    // Warm-up
    for (let i = 0; i < WARMUP; i++) {
      verifyAgainstCriteria({ traceId: "bench", content: SAMPLE_ARTIFACT_CONTENT, security }, SAMPLE_CRITERIA);
    }

    const times: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const start = performance.now();
      const result = verifyAgainstCriteria({ traceId: "bench", content: SAMPLE_ARTIFACT_CONTENT, security }, SAMPLE_CRITERIA);
      times.push(performance.now() - start);
      expect(result.recommendedAction).toBeDefined();
    }

    const stats = computeStats(times);
    console.log(fmtReport("ContractVerifier(5criteria)", stats));
    expect(stats.p95).toBeLessThan(200);
  });
});

describe("S84P Benchmark: Manager View Builder", () => {
  it("buildManagerView — 1000 iterations", () => {
    // Warm-up
    for (let i = 0; i < WARMUP; i++) {
      buildManagerView(SAMPLE_HISTORY);
    }

    const times: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const start = performance.now();
      const view = buildManagerView(SAMPLE_HISTORY);
      times.push(performance.now() - start);
      expect(view.messages).toBeDefined();
    }

    const stats = computeStats(times);
    console.log(fmtReport("ManagerViewBuild", stats));
    expect(stats.p95).toBeLessThan(20);
  });

  it("buildManagerView — empty history (fast path)", () => {
    const times: number[] = [];
    for (let i = 0; i < WARMUP; i++) buildManagerView([]);
    for (let i = 0; i < ITERATIONS; i++) {
      const start = performance.now();
      buildManagerView([]);
      times.push(performance.now() - start);
    }
    const stats = computeStats(times);
    console.log(fmtReport("ManagerViewBuild(empty)", stats));
    expect(stats.p95).toBeLessThan(10);
  });
});

describe("S84P Benchmark: Cycle Audit Extract", () => {
  it("buildCycleAuditExtract — 1000 iterations", () => {
    const sampleAudit = {
      taskId: "bench-task",
      totalCycles: 2,
      maxCycles: 5,
      finalStatus: "accepted" as const,
      finalRecommendedAction: "accept" as const,
      steps: [
        {
          cycleIndex: 1,
          verificationResult: null,
          recommendedAction: "revise" as const,
          contentLength: 500,
          workerCalled: false,
        },
        {
          cycleIndex: 2,
          verificationResult: null,
          recommendedAction: "accept" as const,
          contentLength: 800,
          workerCalled: true,
        },
      ],
      totalMs: 5000,
    };

    // Warm-up
    for (let i = 0; i < WARMUP; i++) buildCycleAuditExtract(sampleAudit);

    const times: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const start = performance.now();
      const extract = buildCycleAuditExtract(sampleAudit);
      times.push(performance.now() - start);
      expect(extract.taskId).toBe("bench-task");
    }

    const stats = computeStats(times);
    console.log(fmtReport("CycleAuditExtract", stats));
    expect(stats.p95).toBeLessThan(10);
  });
});

describe("S84P Benchmark: Runtime Trace Helpers", () => {
  it("createTrace + 4 stages + finalizeTrace + buildExtract — 1000 iterations", () => {
    // Warm-up
    for (let i = 0; i < WARMUP; i++) {
      const t = createTrace("bench");
      const t1 = startStage(t, "a");
      endStage(t, "a", t1);
      const t2 = startStage(t, "b");
      endStage(t, "b", t2);
      finalizeTrace(t, "success");
      buildRuntimeTraceExtract(t);
    }

    const times: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const start = performance.now();
      const trace = createTrace("bench-" + i);
      const t1 = startStage(trace, "stage_a");
      endStage(trace, "stage_a", t1);
      const t2 = startStage(trace, "stage_b");
      endStage(trace, "stage_b", t2);
      const t3 = startStage(trace, "stage_c");
      endStage(trace, "stage_c", t3);
      const t4 = startStage(trace, "stage_d");
      endStage(trace, "stage_d", t4);
      updateTraceCounters(trace, { modelCalls: 3, cycles: 2 });
      updateTraceRouting(trace, { decisionType: "delegate", policyRoute: "llm_required", routingLayer: "L1", delegation: true });
      updateTraceCycleSummary(trace, { totalCycles: 2, maxCycles: 5, finalStatus: "accepted", cycleAuditMs: 1200 });
      updateTraceWorkerSummary(trace, { inputTokens: 500, outputTokens: 200, costUsd: 0.005, latencyMs: 3000, modelName: "test" });
      updateTraceLedgerSummary(trace, { totalLatencyMs: 5000, totalModelCalls: 3, managerModelCalls: 1, slowModelCalls: 2, routerTaxRatio: 0.35, estimatedTotalCost: 0.005 });
      finalizeTrace(trace, "success");
      const extract = buildRuntimeTraceExtract(trace);
      times.push(performance.now() - start);
      expect(extract.stageTimings).toHaveProperty("stage_a");
    }

    const stats = computeStats(times);
    console.log(fmtReport("RuntimeTrace(full)", stats));
    // Trace overhead should be negligible
    expect(stats.p95).toBeLessThan(10);
  });
});
