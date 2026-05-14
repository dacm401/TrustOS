/**
 * Sprint 60P: Execution Policy — 单元测试
 * Sprint 60P-H1: Bypass Worker Call Ledger Completion
 *
 * 覆盖：
 * - direct_artifact_revision bypass（activeArtifact + 修订动词）
 * - direct_create_artifact bypass（新建 artifact）
 * - local_answer_from_meta bypass（纯本地元数据）
 * - manager_llm_required 兜底
 * - 修订 vs 新建 区分
 * - CallLedgerEntry Worker 类型结构
 */

import { describe, it, expect } from "vitest";
import { evaluateExecutionPolicy } from "../../src/services/policy/execution-policy.js";
import type { ActiveArtifactContext } from "../../src/services/context/active-artifact.js";
import type { CallLedgerEntry } from "../../src/types/call-ledger.js";

// ── 辅助：构造 ActiveArtifactContext ──────────────────────────────────────

function makeActiveArtifact(overrides: Partial<ActiveArtifactContext> = {}): ActiveArtifactContext {
  return {
    artifactId: "artifact-001",
    taskId: "task-001",
    summaryForManager: "A React login page component with username/password fields.",
    contentKind: "text/html",
    createdAt: Date.now(),
    ...overrides,
  };
}

// ── 辅助：构造 Worker CallLedgerEntry ─────────────────────────────────────

function makeWorkerEntry(overrides: Partial<CallLedgerEntry> = {}): CallLedgerEntry {
  return {
    traceId: "trace-001",
    modelRole: "worker",
    modelName: "Qwen2.5-72B-Instruct",
    inputTokens: 500,
    outputTokens: 1200,
    estimatedCost: 0.0029,
    latencyMs: 45000,
    startedAt: 1700000000000,
    completedAt: 1700000450000,
    usedAuthOverride: false,
    wasCircuitBroken: false,
    archiveId: "archive-001",
    taskId: "task-001",
    ...overrides,
  };
}

// ── Execution Policy 测试 ──────────────────────────────────────────────────

describe("evaluateExecutionPolicy: direct_artifact_revision bypass", () => {
  const activeArtifact = makeActiveArtifact();

  it("H1-01: '把按钮改成蓝色' → bypass Manager LLM", () => {
    const result = evaluateExecutionPolicy("把按钮改成蓝色", activeArtifact);
    expect(result.route).toBe("direct_artifact_revision");
    expect(result.managerLlmRequired).toBe(false);
    expect(result.workerRequired).toBe(true);
    expect(result.costTier).toBe("medium");
    expect(result.latencyTier).toBe("fast");
  });

  it("H1-02: '再把标题改大一点' → bypass Manager LLM（continuation）", () => {
    const result = evaluateExecutionPolicy("再把标题改大一点", activeArtifact);
    expect(result.route).toBe("direct_artifact_revision");
    expect(result.managerLlmRequired).toBe(false);
    expect(result.workerRequired).toBe(true);
  });

  it("H1-03: '调整一下样式' → bypass Manager LLM", () => {
    const result = evaluateExecutionPolicy("调整一下样式", activeArtifact);
    expect(result.route).toBe("direct_artifact_revision");
    expect(result.managerLlmRequired).toBe(false);
  });

  it("H1-04: '再改一下颜色' → bypass Manager LLM（短消息）", () => {
    const result = evaluateExecutionPolicy("再改一下颜色", activeArtifact);
    expect(result.route).toBe("direct_artifact_revision");
    expect(result.managerLlmRequired).toBe(false);
  });

  it("H1-05: 无 activeArtifact 时修订消息 → 不走 revision bypass", () => {
    const result = evaluateExecutionPolicy("把按钮改成蓝色", undefined);
    // 没有 activeArtifact，不能 bypass
    expect(result.route).not.toBe("direct_artifact_revision");
    expect(result.route).toBe("manager_llm_required");
  });

  it("H1-06: '再写一个注册页' → 不走 revision bypass（是新建）", () => {
    const result = evaluateExecutionPolicy("再帮我写一个注册页", activeArtifact);
    expect(result.route).not.toBe("direct_artifact_revision");
    // 实际命中 direct_create_artifact
    expect(result.route).toBe("direct_create_artifact");
  });
});

describe("evaluateExecutionPolicy: direct_create_artifact bypass", () => {
  it("H1-10: '帮我写一个 React 登录页' → bypass Manager LLM（新建）", () => {
    const result = evaluateExecutionPolicy("帮我写一个 React 登录页", undefined);
    expect(result.route).toBe("direct_create_artifact");
    expect(result.managerLlmRequired).toBe(false);
    expect(result.workerRequired).toBe(true);
    expect(result.costTier).toBe("medium");
  });

  it("H1-11: '再帮我写一个注册页' → bypass Manager LLM（新建 continuation）", () => {
    const result = evaluateExecutionPolicy("再帮我写一个注册页", undefined);
    expect(result.route).toBe("direct_create_artifact");
    expect(result.managerLlmRequired).toBe(false);
  });

  it("H1-12: '帮我写一个注册页面' → bypass Manager LLM（帮我写=create 模式）", () => {
    const result = evaluateExecutionPolicy("帮我写一个注册页面", undefined);
    expect(result.route).toBe("direct_create_artifact");
  });

  it("H1-13: 'write a login page' → bypass Manager LLM（英文）", () => {
    const result = evaluateExecutionPolicy("write a login page", undefined);
    expect(result.route).toBe("direct_create_artifact");
    expect(result.managerLlmRequired).toBe(false);
  });
});

describe("evaluateExecutionPolicy: local_answer_from_meta bypass", () => {
  it("H1-20: '刚才生成的是哪个' → 不调任何模型", () => {
    const result = evaluateExecutionPolicy("刚才生成的是哪个", undefined);
    expect(result.route).toBe("local_answer_from_meta");
    expect(result.managerLlmRequired).toBe(false);
    expect(result.workerRequired).toBe(false);
    expect(result.costTier).toBe("free");
    expect(result.latencyTier).toBe("instant");
  });

  it("H1-21: '当前 artifact' → 不调任何模型", () => {
    const result = evaluateExecutionPolicy("当前 artifact 是什么", undefined);
    expect(result.route).toBe("local_answer_from_meta");
  });
});

describe("evaluateExecutionPolicy: manager_llm_required 兜底", () => {
  it("H1-30: 复杂分析问题 → 必须调 Manager LLM", () => {
    const result = evaluateExecutionPolicy("请分析一下最近的 A股市场趋势和经济影响", undefined);
    expect(result.route).toBe("manager_llm_required");
    expect(result.managerLlmRequired).toBe(true);
    expect(result.costTier).toBe("medium");
  });

  it("H1-31: 有 activeArtifact 但无修订动词 → Manager LLM 判断", () => {
    const artifact = makeActiveArtifact();
    const result = evaluateExecutionPolicy("这个登录页面的功能是什么？", artifact);
    expect(result.route).toBe("manager_llm_required");
  });

  it("H1-32: 有 artifact 但含'再写一个' 且无排除词 → 走新建 bypass", () => {
    const artifact = makeActiveArtifact();
    // "再写一个关于产品介绍的组件" — 匹配 create 模式，无排除词
    const result = evaluateExecutionPolicy("再写一个关于产品介绍的组件", artifact);
    expect(result.route).toBe("direct_create_artifact");
  });
});

// ── CallLedgerEntry Worker 类型测试 ───────────────────────────────────────

describe("CallLedgerEntry: Worker entry structure", () => {
  it("H1-40: Worker entry 必须有 modelRole=worker", () => {
    const entry = makeWorkerEntry({ modelRole: "worker" });
    expect(entry.modelRole).toBe("worker");
    expect(entry.modelRole).not.toBe("manager");
    expect(entry.modelRole).not.toBe("worker_direct_reply");
  });

  it("H1-41: Worker entry 必须包含 archiveId 和 taskId 用于关联", () => {
    const entry = makeWorkerEntry({ archiveId: "archive-002", taskId: "task-002" });
    expect(entry.archiveId).toBe("archive-002");
    expect(entry.taskId).toBe("task-002");
  });

  it("H1-42: Worker entry 必须有正确的 token 和 cost 字段", () => {
    const entry = makeWorkerEntry({
      inputTokens: 800,
      outputTokens: 2000,
      estimatedCost: 0.0048,
      latencyMs: 60000,
    });
    expect(entry.inputTokens).toBe(800);
    expect(entry.outputTokens).toBe(2000);
    expect(entry.estimatedCost).toBeCloseTo(0.0048);
    expect(entry.latencyMs).toBe(60000);
  });

  it("H1-43: Worker entry 的 traceId 用于与 request ledger 关联", () => {
    const entry = makeWorkerEntry({ traceId: "trace-abc-123" });
    expect(entry.traceId).toBe("trace-abc-123");
    // request ledger 和 worker ledger 通过同一个 traceId 关联
  });

  it("H1-44: Worker entry 的 wasCircuitBroken 应为 false", () => {
    const entry = makeWorkerEntry({ wasCircuitBroken: false });
    expect(entry.wasCircuitBroken).toBe(false);
  });
});

// ── Bypass 路径安全字段测试 ────────────────────────────────────────────────

describe("evaluateExecutionPolicy: Security scope 标记", () => {
  it("H1-50: direct_artifact_revision → artifact_source_only", () => {
    const artifact = makeActiveArtifact();
    const result = evaluateExecutionPolicy("把按钮颜色改一下", artifact);
    expect(result.securityScope).toBe("artifact_source_only");
  });

  it("H1-51: direct_create_artifact → minimal_task_contract", () => {
    const result = evaluateExecutionPolicy("写一个登录页面", undefined);
    expect(result.securityScope).toBe("minimal_task_contract");
  });

  it("H1-52: local_answer_from_meta → local_only", () => {
    const result = evaluateExecutionPolicy("当前 artifact", undefined);
    expect(result.securityScope).toBe("local_only");
  });

  it("H1-53: manager_llm_required → redacted_remote", () => {
    const result = evaluateExecutionPolicy("分析 A股市场趋势", undefined);
    expect(result.securityScope).toBe("redacted_remote");
  });
});
