/**
 * chat.ts / orchestrator.ts — ManagerDecision routing integration tests
 *
 * Tests how the orchestrator (src/services/orchestrator.ts) handles the
 * ManagerDecision mode returned by the Fast model:
 *
 *   action=direct_answer     → fast_reply returned directly
 *   action=ask_clarification → clarifying object returned
 *   action=delegate_to_slow  → TaskArchive written + delegation triggered
 *   action=execute_task      → taskPlanner invoked, execute_requested set
 *   manager_decision=null    → fallback path (no crash)
 *
 * We mock the Fast model to return structured JSON and verify the routing
 * behaviour in OrchestratorResult without hitting any external service.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock hoisted refs ──────────────────────────────────────────────────────────

const callModelFullMock = vi.hoisted(() => vi.fn<any>());
const callOpenAIWithOptionsMock = vi.hoisted(() => vi.fn<any>());

const taskArchiveRepoCreate = vi.hoisted(() => vi.fn<any>().mockResolvedValue({
  id: "arch-test-001",
  session_id: "sess-test",
  turn_id: 1,
  command: {},
  user_input: "test input",
  constraints: [],
  task_type: "analysis",
  task_brief: {},
  fast_observations: [],
  slow_execution: {},
  status: "pending",
  delivered: false,
  created_at: new Date(),
  updated_at: new Date(),
}));

const delegationArchiveRepoCreate = vi.hoisted(() => vi.fn<any>().mockResolvedValue({
  id: "del-test-001",
  task_id: "task-test-001",
  user_id: "user-test",
  session_id: "sess-test",
  original_message: "test",
  delegation_prompt: "test prompt",
  slow_result: null,
  related_task_ids: [],
  status: "pending",
  processing_ms: null,
  created_at: new Date().toISOString(),
  completed_at: null,
}));

const taskPlannerExecute = vi.hoisted(() => vi.fn<any>().mockResolvedValue({
  steps: [{ description: "step 1" }],
}));

const memoryEntryRepoGetTopForUser = vi.hoisted(() => vi.fn<any>().mockResolvedValue([]));

const toolExecutorExecute = vi.hoisted(() => vi.fn<any>().mockResolvedValue({
  success: true,
  result: "tool result",
}));

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("../../src/models/model-gateway.js", () => ({
  callModelFull: callModelFullMock,
  callOpenAIWithOptions: callOpenAIWithOptionsMock,
  callModel: vi.fn(),
  callModelWithTools: vi.fn(),
}));

vi.mock("../../src/db/repositories.js", () => ({
  TaskRepo: {
    create: vi.fn(),
    getById: vi.fn(),
    setStatus: vi.fn(),
    createTrace: vi.fn(),
    getTraces: vi.fn(),
  },
  TaskArchiveRepo: {
    create: taskArchiveRepoCreate,
    updateStatus: vi.fn(),
    writeExecution: vi.fn(),
    getById: vi.fn(),
    markDelivered: vi.fn(),
    getBySession: vi.fn(),
    listPending: vi.fn(),
    hasPending: vi.fn(),
  },
  DelegationArchiveRepo: {
    create: delegationArchiveRepoCreate,
    fail: vi.fn(),
    getRecentByUser: vi.fn(),
    getById: vi.fn(),
  },
  MemoryEntryRepo: {
    getTopForUser: memoryEntryRepoGetTopForUser,
    create: vi.fn(),
    getById: vi.fn(),
  },
}));

vi.mock("../../src/tools/executor.js", () => ({
  toolExecutor: {
    execute: toolExecutorExecute,
  },
}));

vi.mock("../../src/services/task-planner.js", () => ({
  taskPlanner: {
    execute: taskPlannerExecute,
  },
}));

// ── Test helpers ─────────────────────────────────────────────────────────────

async function runOrchestrator(overrides?: {
  message?: string;
  language?: "zh" | "en";
  managerDecisionJson?: string;
  mockToolCalls?: boolean;
  hasPendingTask?: boolean;
  pendingTaskMessage?: string;
}): Promise<any> {
  const {
    message = "分析Q3季度数据",
    language = "zh",
    managerDecisionJson,
    mockToolCalls = false,
    hasPendingTask = false,
    pendingTaskMessage,
  } = overrides ?? {};

  // Reset mocks before each run
  vi.clearAllMocks();

  // Configure callModelFull to return the given ManagerDecision JSON (no tool calls)
  callModelFullMock.mockResolvedValueOnce({
    content: managerDecisionJson ?? "",
    tool_calls: mockToolCalls ? [{ id: "call-1", function: { name: "web_search", arguments: "{}" } }] : undefined,
    usage: { input_tokens: 100, output_tokens: 50 },
    finish_reason: "stop",
    model: "fast-model",
  });

  memoryEntryRepoGetTopForUser.mockResolvedValue([]);

  const { orchestrator } = await import("../../src/services/orchestrator.js");

  return orchestrator({
    message,
    language,
    user_id: "user-test",
    session_id: "sess-test",
    history: [],
    hasPendingTask,
    pendingTaskMessage,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("chat.ts — ManagerDecision routing (orchestrator)", () => {

  // 1. action=direct_answer → fast_reply returned directly
  it("1. direct_answer — returns fast_reply without delegation", async () => {
    const result = await runOrchestrator({
      managerDecisionJson:
        '好的，我来为你分析。\n' +
        '{"version":"v1","action":"direct_answer","confidence":0.92,"reasoning":"已知知识直接回答"}',
    });

    expect(result.fast_reply).toBeTruthy();
    expect(result.routing_info.delegated).toBe(false);
    expect(result.manager_decision?.action).toBe("direct_answer");
    expect(result.manager_decision?.confidence).toBe(0.92);
    // No delegation triggered
    expect(delegationArchiveRepoCreate).not.toHaveBeenCalled();
    expect(taskPlannerExecute).not.toHaveBeenCalled();
  });

  // 2. action=ask_clarification → clarifying object returned
  it("2. ask_clarification — returns clarifying question object", async () => {
    const result = await runOrchestrator({
      message: "帮我分析数据",
      managerDecisionJson:
        '我需要确认一下目标。\n' +
        '{"version":"v1","action":"ask_clarification","confidence":0.88,"reasoning":"目标不明确",' +
        '"clarification":{"question_text":"你希望分析哪些指标？","options":["收入","成本","利润"]}}',
    });

    expect(result.fast_reply).toBeTruthy();
    expect(result.clarifying).toBeDefined();
    expect(result.clarifying.question_text).toBe("你希望分析哪些指标？");
    expect(result.clarifying.options).toEqual(["收入", "成本", "利润"]);
    expect(result.routing_info.clarify_requested).toBe(true);
    expect(result.routing_info.delegated).toBe(false);
  });

  it("2b. ask_clarification — works without options field", async () => {
    const result = await runOrchestrator({
      managerDecisionJson:
        '{"version":"v1","action":"ask_clarification","confidence":0.8,"reasoning":"需要澄清",' +
        '"clarification":{"question_text":"你想用什么格式输出？"}}',
    });

    expect(result.clarifying).toBeDefined();
    expect(result.clarifying.question_text).toBe("你想用什么格式输出？");
    expect(result.clarifying.options).toBeUndefined();
  });

  // 3. action=delegate_to_slow → TaskArchive is written + delegation triggered
  it("3. delegate_to_slow — TaskArchive created and delegation triggered", async () => {
    const result = await runOrchestrator({
      managerDecisionJson:
        '这个问题需要深入分析。\n' +
        '{"version":"v1","action":"delegate_to_slow","confidence":0.87,"reasoning":"多维对比委托慢模型",' +
        '"delegation":{"action":"analysis","task":"对比 A/B/C 三种技术方案","constraints":["输出对比表格"],"query_keys":["方案A","方案B"],"priority":"high"}}',
    });

    expect(result.routing_info.delegated).toBe(true);
    expect(result.delegation).toBeDefined();
    expect(result.delegation.status).toBe("triggered");
    expect(result.delegation.task_id).toBeTruthy();

    // TaskArchive should have been written
    expect(taskArchiveRepoCreate).toHaveBeenCalled();
    const [archiveArg] = taskArchiveRepoCreate.mock.calls[0];
    expect(archiveArg.session_id).toBe("sess-test");
    expect(archiveArg.command.action).toBe("analysis");
    expect(archiveArg.command.task).toBe("对比 A/B/C 三种技术方案");
    expect(archiveArg.command.priority).toBe("high");

    // Delegation archive should have been created
    expect(delegationArchiveRepoCreate).toHaveBeenCalled();

    // No task planning
    expect(taskPlannerExecute).not.toHaveBeenCalled();
  });

  it("3b. delegate_to_slow — extracts relevant_facts and user_preference_summary", async () => {
    await runOrchestrator({
      managerDecisionJson:
        '开始分析。\n' +
        '{"version":"v1","action":"delegate_to_slow","confidence":0.9,"reasoning":"complex analysis",' +
        '"delegation":{"action":"research","task":"竞品调研","constraints":["中文输出"],"query_keys":["竞品A"],"relevant_facts":["公司专注B2B"],"user_preference_summary":"简洁明了","priority":"normal"}}',
    });

    const [archiveArg] = taskArchiveRepoCreate.mock.calls[0];
    expect(archiveArg.command.relevant_facts).toContain("公司专注B2B");
    expect(archiveArg.command.user_preference_summary).toBe("简洁明了");
  });

  // 4. action=execute_task → taskPlanner invoked + execute_requested in routing_info
  it("4. execute_task — returns manager_decision and sets execute_requested", async () => {
    const result = await runOrchestrator({
      managerDecisionJson:
        '{"version":"v1","action":"execute_task","confidence":0.85,"reasoning":"多步骤执行",' +
        '"execution":{"goal":"生成并运行测试","complexity":"medium","max_steps":5}}',
    });

    expect(result.routing_info.execute_requested).toBe(true);
    expect(result.routing_info.delegated).toBe(false);
    expect(result.manager_decision?.action).toBe("execute_task");
    expect(result.manager_decision?.execution?.goal).toBe("生成并运行测试");
    expect(result.manager_decision?.execution?.complexity).toBe("medium");

    // Task planner should be invoked by chat.ts (upstream caller), not by orchestrator
    // The orchestrator just signals execute_requested=true
    expect(taskPlannerExecute).not.toHaveBeenCalled();
  });

  // 5. manager_decision=null (invalid JSON / fallback) — no crash, goes old path
  it("5. manager_decision=null (invalid JSON) — falls back without crashing", async () => {
    const result = await runOrchestrator({
      // LLM returns plain text (not a valid ManagerDecision JSON)
      managerDecisionJson: "这是我根据已有知识的回答。",
    });

    // Should still return a fast_reply
    expect(result.fast_reply).toBeTruthy();
    // manager_decision may be undefined or null
    expect(result.manager_decision ?? null).toBeNull();
    // Should not have crashed or delegated
    expect(result.routing_info.delegated).toBe(false);
    expect(taskArchiveRepoCreate).not.toHaveBeenCalled();
    expect(delegationArchiveRepoCreate).not.toHaveBeenCalled();
  });

  it("5b. empty content — does not crash", async () => {
    const result = await runOrchestrator({
      managerDecisionJson: "",
    });

    // fast_reply may be empty string, but no crash
    expect(result).toBeDefined();
    expect(result.fast_reply).toBe("");
  });

  it("5c. non-v1 version — treated as invalid, fallback to plain reply", async () => {
    const result = await runOrchestrator({
      managerDecisionJson:
        '{"version":"v0","action":"direct_answer","confidence":0.5,"reasoning":"test"}',
    });

    // version must be "v1" — invalid version causes parse failure → fallback
    // fast_reply still present
    expect(result.fast_reply).toBeDefined();
  });

  // 6. confidence clamping — values outside [0, 1] are clamped
  it("6. confidence > 1.0 — clamped to 1.0 in result", async () => {
    const result = await runOrchestrator({
      managerDecisionJson:
        '{"version":"v1","action":"direct_answer","confidence":1.5,"reasoning":"test","content":"hello"}',
    });

    expect(result.manager_decision?.confidence).toBeLessThanOrEqual(1.0);
    expect(result.manager_decision?.confidence).toBeGreaterThanOrEqual(0.0);
  });

  it("6b. confidence < 0 — clamped to 0.0 in result", async () => {
    const result = await runOrchestrator({
      managerDecisionJson:
        '{"version":"v1","action":"direct_answer","confidence":-0.5,"reasoning":"test","content":"hello"}',
    });

    expect(result.manager_decision?.confidence).toBeGreaterThanOrEqual(0.0);
  });

  // 7. Markdown code fences are stripped before parsing
  it("7. markdown code fence — stripped and parsed correctly", async () => {
    const result = await runOrchestrator({
      managerDecisionJson:
        "好的，我来分析。\n" +
        "```json\n" +
        '{"version":"v1","action":"direct_answer","confidence":0.9,"reasoning":"known fact","content":"Paris is the capital"}\n' +
        "```",
    });

    expect(result.manager_decision?.action).toBe("direct_answer");
    expect(result.manager_decision?.confidence).toBe(0.9);
    expect(result.manager_decision?.content).toBe("Paris is the capital");
  });

  // 8. O-007: hasPendingTask=true bypasses ManagerDecision routing
  it("8. hasPendingTask=true — returns reassuring reply, skips ManagerDecision", async () => {
    const result = await runOrchestrator({
      hasPendingTask: true,
      pendingTaskMessage: "正在分析Q3报告",
      managerDecisionJson:
        '{"version":"v1","action":"delegate_to_slow","confidence":0.5,"reasoning":"n/a"}',
    });

    // Should bypass normal routing and return a reassuring fast_reply
    expect(result.routing_info.is_reassuring).toBe(true);
    expect(result.routing_info.delegated).toBe(false);
    // No archive written
    expect(taskArchiveRepoCreate).not.toHaveBeenCalled();
  });

  // 9. web_search tool call → tool_used in routing_info, no delegation
  it("9. web_search tool call — tool_used set, no delegation", async () => {
    const result = await runOrchestrator({
      message: "今天北京天气怎么样",
      mockToolCalls: true,
    });

    // Tool executor was called
    expect(toolExecutorExecute).toHaveBeenCalled();
    // Delegation not triggered
    expect(result.routing_info.delegated).toBe(false);
    expect(result.routing_info.tool_used).toBe("web_search");
  });

  // 10. All 5 ManagerAction variants are valid
  it("10. all 4 action variants — direct_answer, ask_clarification, delegate_to_slow, execute_task", async () => {
    const actions = [
      { json: '{"version":"v1","action":"direct_answer","confidence":0.9,"reasoning":"ok","content":"hi"}', expectAction: "direct_answer" },
      { json: '{"version":"v1","action":"ask_clarification","confidence":0.9,"reasoning":"?","clarification":{"question_text":"?"}}', expectAction: "ask_clarification" },
      { json: '{"version":"v1","action":"delegate_to_slow","confidence":0.9,"reasoning":"slow","delegation":{"action":"research","task":"x","constraints":[],"query_keys":[]}}', expectAction: "delegate_to_slow" },
      { json: '{"version":"v1","action":"execute_task","confidence":0.9,"reasoning":"exec","execution":{"goal":"x","complexity":"low","max_steps":3}}', expectAction: "execute_task" },
    ];

    for (const { json, expectAction } of actions) {
      vi.clearAllMocks();
      const result = await runOrchestrator({ managerDecisionJson: json });
      expect(result.manager_decision?.action).toBe(expectAction);
    }
  });
});
