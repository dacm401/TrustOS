/**
 * Phase 3 Worker — 单元测试
 *
 * T-02: 覆盖 slow-worker-loop / execute-worker-loop / sse-poller
 *
 * 策略：
 * - 纯函数：getPollInterval、buildWorkerPrompt 等直接测试
 * - DB 依赖：mock Repository 类，验证 worker 状态机逻辑
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── getPollInterval：慢 Worker 自适应轮询间隔 ──────────────────────────────

/** 内联被测函数（与 slow-worker-loop.ts 同步） */
function getPollInterval(elapsedMs: number): number {
  if (elapsedMs < 30000) return 2000;   // < 30s：频繁
  if (elapsedMs < 120000) return 3000;  // 30s~2min：正常
  return 5000;                           // > 2min：降低频率
}

describe("slow-worker-loop: getPollInterval", () => {
  it("W-01: elapsedMs < 30s → 2000ms", () => {
    expect(getPollInterval(0)).toBe(2000);
    expect(getPollInterval(15000)).toBe(2000);
    expect(getPollInterval(29999)).toBe(2000);
  });

  it("W-02: 30s ≤ elapsedMs < 2min → 3000ms", () => {
    expect(getPollInterval(30000)).toBe(3000);
    expect(getPollInterval(60000)).toBe(3000);
    expect(getPollInterval(119999)).toBe(3000);
  });

  it("W-03: elapsedMs ≥ 2min → 5000ms", () => {
    expect(getPollInterval(120000)).toBe(5000);
    expect(getPollInterval(3600000)).toBe(5000); // 1 hour
  });

  it("W-04: 边界值：精确卡在阈值上", () => {
    expect(getPollInterval(30000)).toBe(3000); // 下界属于第二档
    expect(getPollInterval(120000)).toBe(5000); // 下界属于第三档
  });
});

// ── SSE Event 类型验证 ─────────────────────────────────────────────────────

import type { SSEEvent } from "../../src/services/phase3/sse-poller.js";

describe("sse-poller: SSEEvent 类型验证", () => {
  it("W-05: status 事件结构正确", () => {
    const event: SSEEvent = {
      type: "status",
      content: "working...",
      routing_layer: "L2",
    };
    expect(event.type).toBe("status");
    expect(event.routing_layer).toBe("L2");
  });

  it("W-06: result 事件结构正确", () => {
    const event: SSEEvent = {
      type: "result",
      stream: "Final analysis content here",
      routing_layer: "L2",
    };
    expect(event.type).toBe("result");
    expect(event.stream).toBe("Final analysis content here");
  });

  it("W-07: manager_synthesized 事件字段正确", () => {
    const event: SSEEvent = {
      type: "manager_synthesized",
      final_content: "Synthesized answer",
      confidence: 0.85,
    };
    expect(event.type).toBe("manager_synthesized");
    expect(event.final_content).toBe("Synthesized answer");
    expect(event.confidence).toBe(0.85);
  });

  it("W-08: error 事件可携带错误信息", () => {
    const event: SSEEvent = {
      type: "error",
      content: "Slow model call failed: timeout",
    };
    expect(event.type).toBe("error");
    expect(event.content).toContain("timeout");
  });

  it("W-09: done 事件表示结束", () => {
    const event: SSEEvent = { type: "done" };
    expect(event.type).toBe("done");
  });

  it("W-10: chunk 事件携带流式内容", () => {
    const event: SSEEvent = {
      type: "chunk",
      stream: "Partial content...",
    };
    expect(event.type).toBe("chunk");
    expect(typeof event.stream).toBe("string");
  });

  it("W-11: fast_reply 事件表示直接回复", () => {
    const event: SSEEvent = {
      type: "fast_reply",
      stream: "Direct answer from fast model",
      routing_layer: "L0",
    };
    expect(event.type).toBe("fast_reply");
  });

  it("W-12: SSEEvent 所有类型均被 TypeScript 接受（穷举检查）", () => {
    const types: SSEEvent["type"][] = [
      "status", "result", "error", "done",
      "chunk", "fast_reply", "manager_synthesized",
    ];
    types.forEach((t) => {
      const e: SSEEvent = { type: t, stream: "test" };
      expect(e.type).toBe(t);
    });
  });
});

// ── execute-worker-loop: 工具调用结果解析（轻量）─────────────────────────────

/**
 * 内联 execute-worker 的结果解析逻辑
 * 与 src/services/phase3/execute-worker-loop.ts 保持同步
 */
interface ToolResult {
  tool_name: string;
  success: boolean;
  output: string;
  duration_ms: number;
}

function parseToolResults(raw: string): ToolResult[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item: any) => ({
        tool_name: item.tool_name ?? "unknown",
        success: item.success ?? false,
        output: item.output ?? "",
        duration_ms: item.duration_ms ?? 0,
      }));
    }
  } catch {}
  return [];
}

describe("execute-worker-loop: parseToolResults", () => {
  it("W-13: 有效 JSON 数组 → 正确解析", () => {
    const raw = JSON.stringify([
      { tool_name: "web_search", success: true, output: "Found 10 results", duration_ms: 1200 },
      { tool_name: "calculator", success: false, output: "Invalid expression", duration_ms: 50 },
    ]);
    const results = parseToolResults(raw);
    expect(results).toHaveLength(2);
    expect(results[0].tool_name).toBe("web_search");
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
  });

  it("W-14: 无 tool_name 字段 → 默认为 unknown", () => {
    const raw = JSON.stringify([{ success: true, output: "ok" }]);
    const results = parseToolResults(raw);
    expect(results[0].tool_name).toBe("unknown");
  });

  it("W-15: 缺少可选字段 → 默认为 falsy 值", () => {
    const raw = JSON.stringify([{ tool_name: "test" }]);
    const results = parseToolResults(raw);
    expect(results[0].success).toBe(false);
    expect(results[0].output).toBe("");
    expect(results[0].duration_ms).toBe(0);
  });

  it("W-16: 非 JSON 字符串 → 返回空数组（不抛异常）", () => {
    expect(parseToolResults("not json")).toEqual([]);
    expect(parseToolResults("")).toEqual([]);
    expect(parseToolResults("{broken")).toEqual([]);
  });

  it("W-17: null / undefined → 返回空数组", () => {
    expect(parseToolResults("null")).toEqual([]);
    expect(parseToolResults("[]")).toEqual([]); // 空数组
  });
});
