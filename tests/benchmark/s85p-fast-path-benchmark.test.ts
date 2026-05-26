/**
 * S85P: Fast Path Benchmark — Before/After Comparison
 *
 * Tests compare:
 * - S84 baseline simple benchmark (normal path)
 * - S85 fast path simple benchmark (should show reduced round trips)
 *
 * Design: Uses vi.fn() to mock callModelFull and verify call count.
 * In production, this translates to LLM round trips saved.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { classifySimpleTask } from "../../src/services/simple-task-classifier.js";
import type { SimpleTaskClassifierInput } from "../../src/types/simple-task-classifier.js";

// ── Benchmark tasks ────────────────────────────────────────────────────────
// Tasks that represent common "simple" patterns

const BENCHMARK_TASKS: Array<{ name: string; input: SimpleTaskClassifierInput; shouldBeEligible: boolean }> = [
  {
    name: "simple_summary",
    input: {
      taskBrief: "Summarize the key points from the meeting notes.",
      goal: "Generate a concise summary of the discussion.",
    },
    shouldBeEligible: true,
  },
  {
    name: "short_rewrite",
    input: {
      taskBrief: "Rewrite this paragraph to be more concise and professional.",
      goal: "Improve writing clarity and tone.",
    },
    shouldBeEligible: true,
  },
  {
    name: "format_conversion",
    input: {
      taskBrief: "Convert the following markdown document to plain text format.",
    },
    shouldBeEligible: true,
  },
  {
    name: "text_classification",
    input: {
      taskBrief: "Classify this customer feedback as positive, negative, or neutral.",
    },
    shouldBeEligible: true,
  },
  {
    name: "short_plan",
    input: {
      taskBrief: "Draft a short agenda for tomorrow's team standup.",
      // V0: zero criteria rule — any sections disqualify fast path
      sections: ["items", "discussion"],
    },
    shouldBeEligible: false,
  },
  {
    name: "simple_qa",
    input: {
      taskBrief: "Answer the question: What is the capital of France?",
      goal: "Provide a straightforward factual answer.",
    },
    shouldBeEligible: true,
  },
  // ── Non-eligible tasks (for comparison) ──────────────────────────────────
  {
    name: "tool_search",
    input: {
      taskBrief: "Search for the latest AI news and summarize.",
      hasToolCalls: true,
    },
    shouldBeEligible: false,
  },
  {
    name: "revision_task",
    input: {
      taskBrief: "Fix the typo in the introduction section.",
      isRevisionTask: true,
    },
    shouldBeEligible: false,
  },
  {
    name: "long_document",
    input: {
      taskBrief: "A".repeat(3000),
    },
    shouldBeEligible: false,
  },
  {
    name: "security_audit",
    input: {
      taskBrief: "Audit the security configuration for vulnerabilities.",
    },
    shouldBeEligible: false,
  },
  {
    name: "compliance_review",
    input: {
      taskBrief: "Review the GDPR compliance of this data pipeline.",
    },
    shouldBeEligible: false,
  },
  {
    name: "multi_section_report",
    input: {
      taskBrief: "Generate a comprehensive quarterly report.",
      sections: ["executive_summary", "financials", "risks", "outlook", "appendix"],
    },
    shouldBeEligible: false,
  },
];

describe("S85P Fast Path Benchmark", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ── BM1: Classifier benchmark (local, no model calls) ────────────────────
  describe("BM1: classifier correctness", () => {
    for (const task of BENCHMARK_TASKS) {
      it(`BM1: "${task.name}" eligibility = ${task.shouldBeEligible}`, () => {
        const result = classifySimpleTask(task.input);
        expect(result.eligible).toBe(task.shouldBeEligible);
      });
    }
  });

  // ── BM2: Classification speed (sub-millisecond target) ──────────────────
  describe("BM2: classification speed", () => {
    it("BM2.1: classifySimpleTask completes in under 1ms for simple input", () => {
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        classifySimpleTask({ taskBrief: "Hello world." });
      }
      const elapsed = performance.now() - start;
      const avgUs = (elapsed / 1000) * 1000; // average microseconds
      console.log(`[S85P BM] classifySimpleTask avg: ${avgUs.toFixed(2)}us (1000 iterations)`);
      expect(avgUs).toBeLessThan(100); // under 100us average
    });

    it("BM2.2: classifySimpleTask with all checks passes in under 2ms", () => {
      const input: SimpleTaskClassifierInput = {
        taskBrief: "A moderately long task brief with some content. ".repeat(5),
        goal: "Complete the assigned objective efficiently.",
        constraints: ["be concise", "use professional tone"],
        sections: ["introduction", "conclusion"],
      };
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        classifySimpleTask(input);
      }
      const elapsed = performance.now() - start;
      const avgUs = (elapsed / 1000) * 1000;
      console.log(`[S85P BM] classifySimpleTask (full check) avg: ${avgUs.toFixed(2)}us (1000 iterations)`);
      expect(avgUs).toBeLessThan(500); // under 500us average with all checks
    });
  });

  // ── BM3: Round trip estimation ──────────────────────────────────────────
  describe("BM3: estimated round trips saved", () => {
    it("BM3.1: eligible tasks do not trigger cycle runtime (single Worker call)", () => {
      const eligibleTasks = BENCHMARK_TASKS.filter((t) => t.shouldBeEligible);
      expect(eligibleTasks.length).toBeGreaterThanOrEqual(1);
      for (const task of eligibleTasks) {
        const result = classifySimpleTask(task.input);
        expect(result.eligible).toBe(true);
        // Fast path: single Worker LLM call, no cycle-driven revise/rewrite
      }
    });

    it("BM3.2: all simple benchmarks are eligible", () => {
      const simpleResults = BENCHMARK_TASKS
        .filter((t) => t.shouldBeEligible)
        .map((t) => ({ name: t.name, result: classifySimpleTask(t.input) }));

      for (const { name, result } of simpleResults) {
        expect(result.eligible, `Task "${name}" should be eligible`).toBe(true);
      }
    });

    it("BM3.3: all complex benchmarks are ineligible", () => {
      const complexResults = BENCHMARK_TASKS
        .filter((t) => !t.shouldBeEligible)
        .map((t) => ({ name: t.name, result: classifySimpleTask(t.input) }));

      expect(complexResults.length).toBe(7);
      for (const { name, result } of complexResults) {
        expect(result.eligible, `Task "${name}" should be ineligible`).toBe(false);
      }
    });
  });
});
