/**
 * Sprint 60P-H2: setSlowExecution merge patch 语义验证
 *
 * 验证 PostgreSQL `slow_execution = slow_execution || $1::jsonb` 的 top-level merge 行为。
 * 用 JS 对象模拟该行为（shallow merge），证明：
 *   1. traceId 在后续写入后被保留（不被覆盖）
 *   2. result/usage 字段正常写入
 *   3. 后续写入 { traceId: null } 不会抹掉原 traceId（jsonb || 语义：右侧 null 值会覆盖左侧）
 *      → 注意：这是 PostgreSQL jsonb || 的实际语义，上层必须确保不传 { traceId: null }
 *   4. 模型调用数据（tokens_input / tokens_output / cost_usd）正确写入并可读取
 */

import { describe, it, expect } from "vitest";

/**
 * 模拟 PostgreSQL: slow_execution = slow_execution || $1::jsonb
 * jsonb || 是 top-level shallow merge（右侧覆盖左侧同名 key）
 */
function jsonbMerge(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return { ...existing, ...patch };
}

describe("setSlowExecution: JSONB merge patch 语义", () => {

  it("SE-01: 初始写入 traceId，后续写入 result/usage 后 traceId 仍存在", () => {
    // Step 1: archive.create 写入 { traceId }
    let slowExecution: Record<string, unknown> = { traceId: "trace-abc-123" };

    // Step 2: slow-worker-loop 写入执行结果（不包含 traceId）
    const workerPatch = {
      result: "some content",
      confidence: 0.85,
      model_used: "deepseek-ai/DeepSeek-V4-Flash",
      tokens_input: 1200,
      tokens_output: 800,
      cost_usd: 0.000196,
      duration_ms: 35000,
      completed_at: new Date().toISOString(),
    };
    slowExecution = jsonbMerge(slowExecution, workerPatch);

    // 验证：traceId 仍然存在
    expect(slowExecution.traceId).toBe("trace-abc-123");
    // 验证：result 已写入
    expect(slowExecution.result).toBe("some content");
    expect(slowExecution.tokens_input).toBe(1200);
    expect(slowExecution.tokens_output).toBe(800);
    expect(slowExecution.cost_usd).toBeCloseTo(0.000196);
    expect(slowExecution.model_used).toBe("deepseek-ai/DeepSeek-V4-Flash");
  });

  it("SE-02: 连续多次 merge patch 均不丢失 traceId", () => {
    let slowExecution: Record<string, unknown> = { traceId: "trace-xyz-456" };

    // 第一次写：状态更新
    slowExecution = jsonbMerge(slowExecution, { status: "running" });
    expect(slowExecution.traceId).toBe("trace-xyz-456");

    // 第二次写：result
    slowExecution = jsonbMerge(slowExecution, {
      result: "final result",
      tokens_input: 500,
      tokens_output: 300,
    });
    expect(slowExecution.traceId).toBe("trace-xyz-456");
    expect(slowExecution.result).toBe("final result");

    // 第三次写：完成时间
    slowExecution = jsonbMerge(slowExecution, {
      completed_at: "2026-05-15T10:00:00.000Z",
    });
    expect(slowExecution.traceId).toBe("trace-xyz-456");
    expect(slowExecution.result).toBe("final result");
    expect(slowExecution.completed_at).toBe("2026-05-15T10:00:00.000Z");
  });

  it("SE-03: jsonb || 语义 — 右侧显式 null 会覆盖左侧（上层必须避免传 { traceId: null }）", () => {
    // 这个测试记录 jsonb || 的真实语义，作为架构约束的文档
    let slowExecution: Record<string, unknown> = { traceId: "trace-should-persist" };

    // ⚠️ 危险写法：如果上层不小心传入 { traceId: null }，traceId 会被覆盖
    const badPatch = { traceId: null as null, result: "content" };
    const afterBadPatch = jsonbMerge(slowExecution, badPatch);

    // 文档：这确实会覆盖 traceId
    expect(afterBadPatch.traceId).toBeNull();

    // ✅ 正确写法：上层不应传入 traceId 字段（不含 traceId key 的 patch）
    const goodPatch = { result: "content" };
    const afterGoodPatch = jsonbMerge(slowExecution, goodPatch);
    expect(afterGoodPatch.traceId).toBe("trace-should-persist");
  });

  it("SE-04: Worker usage 字段完整性 — 所有 Ledger 需要的字段必须存在", () => {
    let slowExecution: Record<string, unknown> = { traceId: "trace-e2e-001" };

    const workerPatch = {
      result: "artifact content",
      confidence: 0.85,
      model_used: "deepseek-ai/DeepSeek-V4-Flash",
      tokens_input: 3500,
      tokens_output: 1200,
      cost_usd: 0.000581, // (3500 * 0.07 + 1200 * 0.28) / 1_000_000 ≈ 0.000581
      duration_ms: 42000,
      completed_at: "2026-05-15T10:14:00.000Z",
    };
    slowExecution = jsonbMerge(slowExecution, workerPatch);

    // Ledger rebuild 需要的字段
    expect(typeof slowExecution.tokens_input).toBe("number");
    expect(typeof slowExecution.tokens_output).toBe("number");
    expect(typeof slowExecution.cost_usd).toBe("number");
    expect(typeof slowExecution.duration_ms).toBe("number");
    expect(typeof slowExecution.model_used).toBe("string");
    // traceId 用于关联 request ledger 和 worker ledger
    expect(typeof slowExecution.traceId).toBe("string");
  });

  it("SE-05: 无 traceId 的旧 archive 不会因 merge patch 产生 traceId", () => {
    // 旧 archive（S60P 之前创建的）slow_execution 初始没有 traceId
    let slowExecution: Record<string, unknown> = {};

    const workerPatch = {
      result: "legacy content",
      tokens_input: 800,
      tokens_output: 400,
      cost_usd: 0.000168,
      duration_ms: 28000,
    };
    slowExecution = jsonbMerge(slowExecution, workerPatch);

    // 无 traceId：Ledger Worker entry 中 traceId 为 undefined（而非 null）
    expect(slowExecution.traceId).toBeUndefined();
    expect(slowExecution.result).toBe("legacy content");
  });
});
