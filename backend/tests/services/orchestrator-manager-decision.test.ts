/**
 * Orchestrator — ManagerDecision Mode Unit Tests
 *
 * Tests that the orchestrator correctly handles all ManagerDecision actions:
 *   direct_answer / ask_clarification / delegate_to_slow / execute_task
 *
 * All external calls (LLM, DB, tools) are fully mocked.
 * Tests run without DATABASE_URL or any live service.
 */

import type { ChatMessage } from "../../src/types/index.js";

// ── Shared mock references ────────────────────────────────────────────────────

const callModelFull = vi.hoisted(() =>
  vi.fn<any>().mockResolvedValue({ content: "", tool_calls: [] })
);
const callOpenAIWithOptions = vi.hoisted(() =>
  vi.fn<any>().mockResolvedValue({ content: "", tool_calls: [] })
);
const taskArchiveRepoCreate = vi.hoisted(() =>
  vi.fn<any>().mockResolvedValue(undefined)
);
const taskArchiveRepoUpdateStatus = vi.hoisted(() =>
  vi.fn<any>().mockResolvedValue(undefined)
);
const taskArchiveRepoWriteExecution = vi.hoisted(() =>
  vi.fn<any>().mockResolvedValue(undefined)
);
const taskArchiveRepoGetById = vi.hoisted(() =>
  vi.fn<any>().mockResolvedValue({ status: "pending" })
);
const taskArchiveRepoMarkDelivered = vi.hoisted(() =>
  vi.fn<any>().mockResolvedValue(undefined)
);
const delegationArchiveRepoCreate = vi.hoisted(() =>
  vi.fn<any>().mockResolvedValue(undefined)
);
const delegationArchiveRepoFail = vi.hoisted(() =>
  vi.fn<any>().mockResolvedValue(undefined)
);
const delegationArchiveRepoGetRecentByUser = vi.hoisted(() =>
  vi.fn<any>().mockResolvedValue([])
);
const taskRepoCreate = vi.hoisted(() =>
  vi.fn<any>().mockResolvedValue(undefined)
);
const taskRepoSetStatus = vi.hoisted(() =>
  vi.fn<any>().mockResolvedValue(undefined)
);
const taskRepoCreateTrace = vi.hoisted(() =>
  vi.fn<any>().mockResolvedValue(undefined)
);
const memoryEntryRepoGetTopForUser = vi.hoisted(() =>
  vi.fn<any>().mockResolvedValue([])
);
const toolExecutorExecute = vi.hoisted(() =>
  vi.fn<any>().mockResolvedValue({ success: true, result: {} })
);

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("../../src/models/model-gateway.js", () => ({
  callModelFull,
  callOpenAIWithOptions,
  callModel: vi.fn(),
  callModelWithTools: vi.fn(),
  getAvailableModels: vi.fn(() => ["gpt-4o-mini", "claude-3-5-haiku-20241022"]),
}));

vi.mock("../../src/db/repositories.js", () => ({
  TaskRepo: {
    create: taskRepoCreate,
    getById: vi.fn(),
    setStatus: taskRepoSetStatus,
    createTrace: taskRepoCreateTrace,
    getTraces: vi.fn().mockResolvedValue([]),
  },
  TaskArchiveRepo: {
    create: taskArchiveRepoCreate,
    updateStatus: taskArchiveRepoUpdateStatus,
    writeExecution: taskArchiveRepoWriteExecution,
    getById: taskArchiveRepoGetById,
    markDelivered: taskArchiveRepoMarkDelivered,
    getBySessionId: vi.fn().mockResolvedValue([]),
  },
  DelegationArchiveRepo: {
    create: delegationArchiveRepoCreate,
    fail: delegationArchiveRepoFail,
    getRecentByUser: delegationArchiveRepoGetRecentByUser,
  },
  MemoryEntryRepo: {
    getTopForUser: memoryEntryRepoGetTopForUser,
  },
}));

vi.mock("../../src/tools/executor.js", () => ({
  toolExecutor: {
    execute: toolExecutorExecute,
  },
}));

vi.mock("../../src/services/memory-retrieval.js", () => ({
  runRetrievalPipeline: vi.fn().mockReturnValue([]),
  buildCategoryAwareMemoryText: vi.fn().mockReturnValue({ combined: "" }),
}));

// ── Import module under test ──────────────────────────────────────────────────

const orchestratorModule = await import("../../src/services/orchestrator.js");
const { orchestrator, callFastModelWithTools } = orchestratorModule;

// ── Helper factories ──────────────────────────────────────────────────────────

function makeModelResponse(
  content: string,
  toolCalls: any[] = []
): any {
  return { content, tool_calls: toolCalls };
}

// ── Test Suite ───────────────────────────────────────────────────────────────

describe("orchestrator — ManagerDecision actions", () => {

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore base mockResolvedValue implementations after clearing (vi.clearAllMocks wipes the mock queue)
    callModelFull.mockResolvedValue({ content: "", tool_calls: [] });
    callOpenAIWithOptions.mockResolvedValue({ content: "", tool_calls: [] });
    taskArchiveRepoCreate.mockResolvedValue(undefined);
    taskArchiveRepoUpdateStatus.mockResolvedValue(undefined);
    taskArchiveRepoWriteExecution.mockResolvedValue(undefined);
    taskArchiveRepoGetById.mockResolvedValue({ status: "pending" });
    taskArchiveRepoMarkDelivered.mockResolvedValue(undefined);
    delegationArchiveRepoCreate.mockResolvedValue(undefined);
    delegationArchiveRepoFail.mockResolvedValue(undefined);
    delegationArchiveRepoGetRecentByUser.mockResolvedValue([]);
    taskRepoCreate.mockResolvedValue(undefined);
    taskRepoSetStatus.mockResolvedValue(undefined);
    taskRepoCreateTrace.mockResolvedValue(undefined);
    memoryEntryRepoGetTopForUser.mockResolvedValue([]);
    toolExecutorExecute.mockResolvedValue({ success: true, result: {} });
    // Default: memory disabled (avoids async repo calls)
    vi.stubEnv("MEMORY_ENABLED", "false");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ── 1. action = direct_answer → fast_reply directly returned ─────────────

  it("1. action=direct_answer → returns fast_reply without delegation", async () => {
    callModelFull.mockResolvedValueOnce(
      makeModelResponse("Paris is the capital of France.")
    );

    const result = await orchestrator({
      message: "What is the capital of France?",
      language: "en",
      user_id: "test-user",
      session_id: "test-session",
    });

    expect(result.fast_reply).toBe("Paris is the capital of France.");
    expect(result.delegation).toBeUndefined();
    expect(result.clarifying).toBeUndefined();
    expect(result.routing_info.delegated).toBe(false);
  });

  it("2. direct_answer with Chinese message → returns Chinese fast_reply", async () => {
    callModelFull.mockResolvedValueOnce(
      makeModelResponse("法国的首都是巴黎。")
    );

    const result = await orchestrator({
      message: "法国的首都是什么？",
      language: "zh",
      user_id: "test-user",
      session_id: "test-session",
    });

    expect(result.fast_reply).toBe("法国的首都是巴黎。");
    expect(result.routing_info.delegated).toBe(false);
  });

  // ── 2. action = ask_clarification → returns clarifying object ─────────────

  it("3. action=ask_clarification → returns clarifying object with options", async () => {
    const clarifyResponse = JSON.stringify({
      action: "ask_clarification",
      confidence: 0.92,
      clarifying: {
        question_text: "你想要哪种格式的报告？",
        options: ["表格", "Markdown", "JSON"],
      },
    });
    callModelFull.mockResolvedValueOnce(makeModelResponse(clarifyResponse));

    const result = await orchestrator({
      message: "给我做个报告",
      language: "zh",
      user_id: "test-user",
      session_id: "test-session",
    });

    expect(result.clarifying).toBeDefined();
    expect(result.clarifying!.question_text).toBe("你想要哪种格式的报告？");
    expect(result.clarifying!.options).toEqual(["表格", "Markdown", "JSON"]);
    expect(result.routing_info.delegated).toBe(false);
    expect(result.routing_info.clarify_requested).toBe(true);
  });

  it("4. action=ask_clarification without options → clarifying.question_text set", async () => {
    const clarifyResponse = JSON.stringify({
      action: "ask_clarification",
      confidence: 0.88,
      clarifying: {
        question_text: "Can you provide more context?",
      },
    });
    callModelFull.mockResolvedValueOnce(makeModelResponse(clarifyResponse));

    const result = await orchestrator({
      message: "Tell me about the project",
      language: "en",
      user_id: "test-user",
      session_id: "test-session",
    });

    expect(result.clarifying).toBeDefined();
    expect(result.clarifying!.question_text).toBe("Can you provide more context?");
    expect(result.clarifying!.options).toBeUndefined();
  });

  // ── 3. action = delegate_to_slow → delegation.task_id is set ─────────────

  it("5. action=delegate_to_slow → delegation.task_id is set", async () => {
    const slowResponse = JSON.stringify({
      version: "v1",
      action: "delegate_to_slow",
      confidence: 0.96,
      reasoning: "Requires deep research",
      delegation: {
        action: "research",
        task: "Compare Python vs Rust for web development",
        constraints: ["输出对比表格"],
        query_keys: ["Python", "Rust"],
      },
    });
    callModelFull.mockResolvedValueOnce(makeModelResponse(slowResponse));
    taskArchiveRepoGetById.mockResolvedValue({ status: "pending" });

    const result = await orchestrator({
      message: "Compare Python vs Rust for web development",
      language: "en",
      user_id: "test-user",
      session_id: "test-session",
    });

    expect(result.delegation).toBeDefined();
    expect(result.delegation!.task_id).toBeDefined();
    expect(typeof result.delegation!.task_id).toBe("string");
    expect(result.delegation!.task_id.length).toBeGreaterThan(0);
    expect(result.delegation!.status).toBe("triggered");
    expect(result.routing_info.delegated).toBe(true);
  });

  it("6. delegate_to_slow → TaskArchiveRepo.create is called", async () => {
    const slowResponse = JSON.stringify({
      version: "v1",
      action: "delegate_to_slow",
      confidence: 0.9,
      reasoning: "Complex analysis",
      delegation: {
        action: "analysis",
        task: "Analyze market trends for 2024",
        constraints: ["提供数据支撑"],
        query_keys: ["market", "2024"],
      },
    });
    callModelFull.mockResolvedValueOnce(makeModelResponse(slowResponse));

    await orchestrator({
      message: "Analyze market trends for 2024",
      language: "en",
      user_id: "test-user",
      session_id: "test-session",
    });

    expect(taskArchiveRepoCreate).toHaveBeenCalledOnce();
  });

  // ── 4. action = execute_task → returns execution path marker ─────────────

  it("7. action=execute_task → routing_info indicates task execution", async () => {
    const execResponse = JSON.stringify({
      action: "execute_task",
      confidence: 0.85,
      content: "I'll execute a multi-step plan for this.",
    });
    callModelFull.mockResolvedValueOnce(makeModelResponse(execResponse));

    const result = await orchestrator({
      message: "Create a report and email it to the team",
      language: "en",
      user_id: "test-user",
      session_id: "test-session",
    });

    // execute_task falls through to fast_reply path in current orchestrator v0.4
    // The key is that it does NOT delegate and does NOT clarify.
    expect(result.routing_info.delegated).toBe(false);
    expect(result.clarifying).toBeUndefined();
  });

  // ── 5. Validation failure fallback → does not crash, returns direct_answer ──

  it("8. invalid ManagerDecision JSON → fallback to direct_answer without crash", async () => {
    // Not valid JSON at all
    callModelFull.mockResolvedValueOnce(
      makeModelResponse("I don't know how to respond to that.")
    );

    const result = await orchestrator({
      message: " gibberish ",
      language: "en",
      user_id: "test-user",
      session_id: "test-session",
    });

    // Should not throw — fallback to fast_reply
    expect(result.fast_reply).toBeDefined();
    expect(typeof result.fast_reply).toBe("string");
    expect(result.routing_info.delegated).toBe(false);
  });

  it("9. valid JSON but missing action field → fallback without crash", async () => {
    // No action field — invalid ManagerDecision
    callModelFull.mockResolvedValueOnce(
      makeModelResponse(JSON.stringify({ confidence: 0.5, content: "hello" }))
    );

    const result = await orchestrator({
      message: "hello",
      language: "en",
      user_id: "test-user",
      session_id: "test-session",
    });

    // Should fall back gracefully
    expect(result.fast_reply).toBeDefined();
    expect(result.routing_info.delegated).toBe(false);
  });

  it("10. confidence out of range → clamped, no crash", async () => {
    // confidence 999 should be clamped to 1.0 internally, no crash
    const outOfRange = JSON.stringify({
      version: "v1",
      action: "direct_answer",
      confidence: 999,
      reasoning: "Simple question.",
      content: "The answer is 42.",
    });
    callModelFull.mockResolvedValueOnce(makeModelResponse(outOfRange));

    const result = await orchestrator({
      message: "What is the meaning of life?",
      language: "en",
      user_id: "test-user",
      session_id: "test-session",
    });

    // version valid + clamped confidence → ManagerDecision parsed, no crash
    expect(result.fast_reply).toBeDefined();
    expect(typeof result.fast_reply).toBe("string");
    expect(result.routing_info.delegated).toBe(false);
  });

  // ── 6. Tool call roundtrips ────────────────────────────────────────────────

  it("11. fast model calls web_search tool → toolExecutor.execute is called", async () => {
    const toolCall = {
      id: "call-1",
      function: { name: "web_search", arguments: JSON.stringify({ query: "weather Beijing" }) },
    };
    callModelFull.mockResolvedValueOnce(
      makeModelResponse("", [toolCall])
    );
    callModelFull.mockResolvedValueOnce(
      makeModelResponse("The weather in Beijing is sunny.")
    );

    toolExecutorExecute.mockResolvedValueOnce({
      success: true,
      result: { answer: "sunny, 22°C" },
    });

    const result = await orchestrator({
      message: "What's the weather in Beijing?",
      language: "en",
      user_id: "test-user",
      session_id: "test-session",
    });

    expect(toolExecutorExecute).toHaveBeenCalledOnce();
    expect(result.routing_info.tool_used).toBe("web_search");
  });

  // ── 7. Memory integration ──────────────────────────────────────────────────

  it("12. memory entries retrieved and used in context", async () => {
    memoryEntryRepoGetTopForUser.mockResolvedValueOnce([
      { id: "m1", content: "user prefers Markdown format", importance: 4 },
    ]);
    callModelFull.mockResolvedValueOnce(makeModelResponse("Based on your preference, here's the report."));

    await orchestrator({
      message: "Generate the weekly report",
      language: "en",
      user_id: "test-user",
      session_id: "test-session",
    });

    expect(memoryEntryRepoGetTopForUser).toHaveBeenCalledWith("test-user", expect.any(Number));
  });

  // ── 8. O-007: Pending task安抚 ─────────────────────────────────────────────

  it("13. hasPendingTask=true → returns reassuring fast_reply", async () => {
    callModelFull.mockResolvedValueOnce(makeModelResponse("Still processing, please hold on."));

    const result = await orchestrator({
      message: "Is it done yet?",
      language: "en",
      user_id: "test-user",
      session_id: "test-session",
      hasPendingTask: true,
      pendingTaskMessage: "Research on market trends",
    });

    expect(result.fast_reply).toBeDefined();
    expect(result.routing_info.is_reassuring).toBe(true);
    expect(result.routing_info.delegated).toBe(false);
  });
});
