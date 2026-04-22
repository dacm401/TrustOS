/**
 * orchestrator.ts 单元测试
 *
 * 正确 mock 模式（参考 tool-guardrail.test.ts）：
 * 1. vi.hoisted() 定义 mock 函数（与 vi.mock() 一起被 hoisted）
 * 2. vi.mock() 工厂引用 hoisted 变量
 * 3. 动态 import() 在 describe 块内执行，此时 mock 已就绪
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ChatMessage } from "../../src/types/index.js";
import type { ModelResponse } from "../../src/models/providers/base-provider.js";

// ── Hoisted mocks (run together with vi.mock at module evaluation time) ────────

const {
  mockFn,
  taskArchiveRepo,
  taskRepo,
  memoryEntryRepo,
  delegationArchiveRepo,
  delegationLogRepo,
  toolExecutorMock,
  weatherMock,
} = vi.hoisted(() => {
  const mockFn = {
    callModelFull: vi.fn(),
    callOpenAIWithOptions: vi.fn(),
  };
  return {
    mockFn,
    taskArchiveRepo: {
      create: vi.fn().mockResolvedValue(undefined),
      updateState: vi.fn().mockResolvedValue(undefined),
      setSlowExecution: vi.fn().mockResolvedValue(undefined),
      markDelivered: vi.fn().mockResolvedValue(undefined),
      getById: vi.fn(),
    },
    taskRepo: {
      create: vi.fn().mockResolvedValue(undefined),
      setStatus: vi.fn().mockResolvedValue(undefined),
      createTrace: vi.fn().mockResolvedValue(undefined),
      getById: vi.fn(),
      getTraces: vi.fn().mockResolvedValue([]),
    },
    memoryEntryRepo: {
      getTopForUser: vi.fn().mockResolvedValue([]),
    },
    delegationArchiveRepo: {
      create: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
      getRecentByUser: vi.fn().mockResolvedValue([]),
    },
    delegationLogRepo: {
      updateExecution: vi.fn().mockResolvedValue(undefined),
    },
    toolExecutorMock: {
      execute: vi.fn(),
    },
    weatherMock: {
      detectWeatherQuery: vi.fn().mockReturnValue(null),
      fetchRealTimeWeather: vi.fn(),
      formatWeatherPrompt: vi.fn(),
    },
  };
});

// ── Register mocks BEFORE any module is loaded ────────────────────────────────

vi.mock("../../src/config.js", () => ({
  config: {
    fastModel: "gpt-4o-mini",
    slowModel: "gpt-4o",
    memory: {
      enabled: false,
      maxEntriesToInject: 10,
      retrieval: { strategy: "v1", categoryPolicy: {} },
    },
    openaiBaseUrl: "",
  },
}));

vi.mock("../../src/models/model-gateway.js", () => ({
  callModelFull: mockFn.callModelFull,
}));

vi.mock("../../src/models/providers/openai.js", () => ({
  callOpenAIWithOptions: mockFn.callOpenAIWithOptions,
}));

vi.mock("../../src/tools/executor.js", () => ({
  toolExecutor: toolExecutorMock,
}));

vi.mock("../../src/services/memory-retrieval.js", () => ({
  runRetrievalPipeline: vi.fn().mockReturnValue([]),
  buildCategoryAwareMemoryText: vi.fn().mockReturnValue({ combined: "" }),
}));

vi.mock("../../src/services/weather-search.js", () => weatherMock);

vi.mock("../../src/db/task-archive-repo.js", () => ({
  TaskArchiveRepo: taskArchiveRepo,
}));

vi.mock("../../src/db/repositories.js", () => ({
  TaskRepo: taskRepo,
  MemoryEntryRepo: memoryEntryRepo,
  DelegationArchiveRepo: delegationArchiveRepo,
  DelegationLogRepo: delegationLogRepo,
}));

vi.mock("uuid", () => ({ v4: () => "test-uuid-1234" }));

// ── Dynamic import (done inside describe so mocks are already registered) ────────

import type {
  SlowModelCommand,
  OrchestratorResult,
  OrchestratorInput,
} from "../../src/services/orchestrator.js";

// Module handles — assigned in beforeAll
let parseSlowModelCommand!: (text: string) => ReturnType<typeof import("../../src/services/orchestrator.js").parseSlowModelCommand>;
let parseClarifyQuestion!: (text: string) => ReturnType<typeof import("../../src/services/orchestrator.js").parseClarifyQuestion>;
let inferRoutingLayer!: (result: OrchestratorResult) => ReturnType<typeof import("../../src/services/orchestrator.js").inferRoutingLayer>;
let orchestrator!: (...args: Parameters<typeof import("../../src/services/orchestrator.js").orchestrator>) => ReturnType<typeof import("../../src/services/orchestrator.js").orchestrator>;
let triggerSlowModelBackground!: (...args: Parameters<typeof import("../../src/services/orchestrator.js").triggerSlowModelBackground>) => ReturnType<typeof import("../../src/services/orchestrator.js").triggerSlowModelBackground>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeModelResponse(content: string, toolCalls?: unknown[]): ModelResponse {
  return {
    id: "mock-id",
    content,
    tool_calls: toolCalls as ModelResponse["tool_calls"],
    model: "gpt-4o-mini",
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    raw: {},
  };
}

function makeOrchestratorInput(overrides: Partial<OrchestratorInput> = {}): OrchestratorInput {
  return {
    message: "测试消息",
    language: "zh",
    user_id: "user-1",
    session_id: "session-1",
    history: [],
    ...overrides,
  };
}

// ── Setup: load module with mocks ──────────────────────────────────────────────

describe("orchestrator (module)", () => {
  beforeAll(async () => {
    const mod = await import("../../src/services/orchestrator.js");
    parseSlowModelCommand = mod.parseSlowModelCommand;
    parseClarifyQuestion = mod.parseClarifyQuestion;
    inferRoutingLayer = mod.inferRoutingLayer;
    orchestrator = mod.orchestrator;
    triggerSlowModelBackground = mod.triggerSlowModelBackground;
  });

  // ── parseSlowModelCommand ─────────────────────────────────────────────────────

  describe("parseSlowModelCommand", () => {
    it("解析代码块格式的 JSON", () => {
      const input = `这个问题很有深度。
\`\`\`json
{
  "action": "research",
  "task": "分析量子计算现状",
  "constraints": ["不超过500字", "引用最新数据"],
  "query_keys": ["量子计算", "IBM", "Google"]
}
\`\`\`
`;
      const result = parseSlowModelCommand(input);
      expect(result).not.toBeNull();
      expect(result!.action).toBe("research");
      expect(result!.task).toBe("分析量子计算现状");
      expect(result!.constraints).toEqual(["不超过500字", "引用最新数据"]);
      expect(result!.query_keys).toEqual(["量子计算", "IBM", "Google"]);
    });

    it("解析单行 JSON 格式", () => {
      const input = `让我想想这个问题。
{"action": "analysis", "task": "对比2024年A股表现", "constraints": ["用表格呈现"], "query_keys": ["A股"]}
`;
      const result = parseSlowModelCommand(input);
      expect(result).not.toBeNull();
      expect(result!.action).toBe("analysis");
      expect(result!.task).toBe("对比2024年A股表现");
    });

    it("解析【SLOW_MODEL_REQUEST】标签包裹格式", () => {
      const input = `好的，让我深入分析。
【SLOW_MODEL_REQUEST】
{"action": "code", "task": "写一个快速排序", "constraints": ["Python实现"], "query_keys": ["quicksort"]}
【/SLOW_MODEL_REQUEST】
`;
      const result = parseSlowModelCommand(input);
      expect(result).not.toBeNull();
      expect(result!.action).toBe("code");
      expect(result!.task).toBe("写一个快速排序");
    });

    it("解析 Phase 1.5 扩展字段", () => {
      const input = '{"action": "research", "task": "分析行业趋势", "constraints": [], "query_keys": [], "priority": "high", "relevant_facts": ["公司A财报"], "user_preference_summary": "偏好表格"}';
      const result = parseSlowModelCommand(input);
      expect(result!.priority).toBe("high");
      expect(result!.relevant_facts).toEqual(["公司A财报"]);
      expect(result!.user_preference_summary).toBe("偏好表格");
    });

    it("所有 action 类型都能解析", () => {
      const actions: SlowModelCommand["action"][] = ["research", "analysis", "code", "creative", "comparison"];
      for (const action of actions) {
        const result = parseSlowModelCommand(`{"action": "${action}", "task": "test", "constraints": [], "query_keys": []}`);
        expect(result).not.toBeNull();
        expect(result!.action).toBe(action);
      }
    });

    it("无效 JSON 返回 null", () => {
      expect(parseSlowModelCommand("不是 JSON 内容")).toBeNull();
    });

    it("缺少 action 字段返回 null", () => {
      expect(parseSlowModelCommand('{"task": "test", "constraints": [], "query_keys": []}')).toBeNull();
    });

    it("缺少 task 字段返回 null", () => {
      expect(parseSlowModelCommand('{"action": "research", "constraints": [], "query_keys": []}')).toBeNull();
    });

    it("空字符串返回 null", () => {
      expect(parseSlowModelCommand("")).toBeNull();
    });

    it("constraints 缺省时默认为空数组", () => {
      const result = parseSlowModelCommand('{"action": "code", "task": "hello"}');
      expect(result!.constraints).toEqual([]);
    });

    it("priority 非法值时为 undefined", () => {
      const result = parseSlowModelCommand('{"action": "code", "task": "hi", "constraints": [], "query_keys": [], "priority": "urgent"}');
      expect(result!.priority).toBeUndefined();
    });

    it("max_execution_time_ms 类型正确", () => {
      const result = parseSlowModelCommand('{"action": "code", "task": "hi", "constraints": [], "query_keys": [], "max_execution_time_ms": 30000}');
      expect(result!.max_execution_time_ms).toBe(30000);
    });
  });

  // ── parseClarifyQuestion ─────────────────────────────────────────────────────

  describe("parseClarifyQuestion", () => {
    it("解析【CLARIFYING_REQUEST】标签包裹格式", () => {
      const input = `我需要确认一下。
【CLARIFYING_REQUEST】
{"question_text": "你想要哪种格式的报告？", "options": ["表格", "Markdown", "JSON"], "context": "用户偏好"}
【/CLARIFYING_REQUEST】
`;
      const result = parseClarifyQuestion(input);
      expect(result).not.toBeNull();
      expect(result!.question_text).toBe("你想要哪种格式的报告？");
      expect(result!.options).toEqual(["表格", "Markdown", "JSON"]);
      expect(result!.context).toBe("用户偏好");
      expect(result!.question_id).toBeTruthy();
    });

    it("解析单行 JSON 格式", () => {
      const input = `请确认一下。{"question_text": "要中文还是英文？", "options": ["中文", "英文"]}`;
      const result = parseClarifyQuestion(input);
      expect(result!.question_text).toBe("要中文还是英文？");
      expect(result!.options).toEqual(["中文", "英文"]);
    });

    it("无 options 字段时为 undefined", () => {
      const result = parseClarifyQuestion('{"question_text": "你叫什么名字？"}');
      expect(result!.options).toBeUndefined();
    });

    it("缺少 question_text 字段返回 null", () => {
      expect(parseClarifyQuestion('{"options": ["A", "B"]}')).toBeNull();
    });

    it("无效 JSON 返回 null", () => {
      expect(parseClarifyQuestion("不是 JSON")).toBeNull();
    });

    it("空字符串返回 null", () => {
      expect(parseClarifyQuestion("")).toBeNull();
    });

    it("context 缺省时为空字符串", () => {
      const result = parseClarifyQuestion('{"question_text": "确认一下？"}');
      expect(result!.context).toBe("");
    });

    it("多行输入中只解析第一个有效 JSON", () => {
      const input = `还有其他内容。
{"question_text": "第一题？", "options": ["A"]}
{"question_text": "第二题？"}
`;
      const result = parseClarifyQuestion(input);
      expect(result!.question_text).toBe("第一题？");
    });
  });

  // ── inferRoutingLayer ───────────────────────────────────────────────────────

  describe("inferRoutingLayer", () => {
    it("有 delegation 时返回 L2", () => {
      const result: OrchestratorResult = {
        fast_reply: "正在处理中",
        delegation: { task_id: "task-1", status: "triggered" },
        routing_info: { delegated: true },
      };
      expect(inferRoutingLayer(result)).toBe("L2");
    });

    it("tool_used=web_search 时返回 L1", () => {
      const result: OrchestratorResult = {
        fast_reply: "查到了...",
        routing_info: { delegated: false, tool_used: "web_search" },
      };
      expect(inferRoutingLayer(result)).toBe("L1");
    });

    it("无工具无委托时返回 L0", () => {
      const result: OrchestratorResult = {
        fast_reply: "你好！",
        routing_info: { delegated: false },
      };
      expect(inferRoutingLayer(result)).toBe("L0");
    });

    it("其他 tool_used 时返回 L0", () => {
      const result: OrchestratorResult = {
        fast_reply: "回复",
        routing_info: { delegated: false, tool_used: "some_tool" },
      };
      expect(inferRoutingLayer(result)).toBe("L0");
    });

    it("clarifying 无工具时返回 L0", () => {
      const result: OrchestratorResult = {
        fast_reply: "需要确认一下",
        clarifying: { question_id: "q1", question_text: "确认？", context: "" },
        routing_info: { delegated: false, clarify_requested: true },
      };
      expect(inferRoutingLayer(result)).toBe("L0");
    });
  });

  // ── orchestrator 主流程 ─────────────────────────────────────────────────────

  describe("orchestrator", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("O-007: hasPendingTask 时返回安抚回复", async () => {
      mockFn.callModelFull.mockResolvedValueOnce(makeModelResponse("正在为您处理中，请稍候～"));

      const result = await orchestrator(makeOrchestratorInput({
        message: "出来了吗？",
        hasPendingTask: true,
        pendingTaskMessage: "分析某公司财报",
      }));

      expect(result.routing_info.is_reassuring).toBe(true);
      expect(result.routing_info.delegated).toBe(false);
      expect(result.fast_reply).toBeTruthy();
      expect(result.routing_info.clarify_requested).toBeUndefined();
      expect(result.delegation).toBeUndefined();
    });

    it("Fast 模型直接回复 → delegated=false, tool_used=undefined", async () => {
      mockFn.callModelFull.mockResolvedValueOnce(makeModelResponse("你好！有什么可以帮你？"));

      const result = await orchestrator(makeOrchestratorInput({ message: "你好" }));

      expect(result.fast_reply).toBe("你好！有什么可以帮你？");
      expect(result.routing_info.delegated).toBe(false);
      expect(result.routing_info.tool_used).toBeUndefined();
      expect(result.delegation).toBeUndefined();
    });

    it("Fast 模型调用 web_search → 执行工具后直接回复（toolUsed 由 callFastModelWithTools 内部状态决定）", async () => {
      mockFn.callModelFull
        .mockResolvedValueOnce(makeModelResponse("", [
          { id: "call-1", type: "function", function: { name: "web_search", arguments: '{"query": "深圳天气"}' } },
        ]))
        .mockResolvedValueOnce(makeModelResponse("深圳今天晴天，25度。"));

      toolExecutorMock.execute.mockResolvedValueOnce({
        success: true,
        result: { results: [{ title: "深圳天气", snippet: "晴天 25度" }] },
      });

      const result = await orchestrator(makeOrchestratorInput({ message: "深圳今天天气怎么样？" }));

      expect(result.routing_info.delegated).toBe(false);
      // toolUsed 仅在慢模型请求/澄清时设置；工具执行后不传递 toolUsed（由 callFastModelWithTools 内部状态决定）
      expect(result.fast_reply).toBe("深圳今天晴天，25度。");
    });

    it("Fast 模型返回澄清请求 → 返回 clarifying 字段", async () => {
      mockFn.callModelFull.mockResolvedValueOnce(
        makeModelResponse(`我需要确认一下。
【CLARIFYING_REQUEST】
{"question_text": "你想要哪种格式？", "options": ["表格", "Markdown"]}
【/CLARIFYING_REQUEST】
`)
      );

      const result = await orchestrator(makeOrchestratorInput({ message: "给我做个分析报告" }));

      expect(result.clarifying).toBeDefined();
      expect(result.clarifying!.question_text).toBe("你想要哪种格式？");
      expect(result.clarifying!.options).toEqual(["表格", "Markdown"]);
      expect(result.routing_info.delegated).toBe(false);
      expect(result.routing_info.clarify_requested).toBe(true);
    });

    it("Fast 模型返回慢模型请求 → 创建 TaskArchive + delegation", async () => {
      mockFn.callModelFull.mockResolvedValueOnce(
        makeModelResponse(`好的，让我深入分析一下。
【SLOW_MODEL_REQUEST】
{"action": "research", "task": "分析半导体行业趋势", "constraints": ["不超过500字"], "query_keys": ["半导体"]}
【/SLOW_MODEL_REQUEST】
`)
      );

      const result = await orchestrator(makeOrchestratorInput({ message: "分析一下半导体行业" }));

      expect(result.routing_info.delegated).toBe(true);
      expect(result.delegation).toBeDefined();
      expect(result.delegation!.status).toBe("triggered");
      expect(taskArchiveRepo.create).toHaveBeenCalledOnce();
    });

    it("reqApiKey 存在时使用 callOpenAIWithOptions", async () => {
      mockFn.callOpenAIWithOptions.mockResolvedValueOnce(makeModelResponse("带 API Key 的回复"));

      const result = await orchestrator(makeOrchestratorInput({
        message: "你好",
        reqApiKey: "sk-test-key",
      }));

      expect(mockFn.callOpenAIWithOptions).toHaveBeenCalledOnce();
      expect(result.fast_reply).toBe("带 API Key 的回复");
    });

    it("ToolExecutor 执行失败 → 回复包含错误信息", async () => {
      mockFn.callModelFull
        .mockResolvedValueOnce(makeModelResponse("", [
          { id: "call-1", type: "function", function: { name: "web_search", arguments: '{"query": "test"}' } },
        ]))
        .mockResolvedValueOnce(makeModelResponse("工具执行出错了"));

      toolExecutorMock.execute.mockResolvedValueOnce({ success: false, error: "网络超时" });

      const result = await orchestrator(makeOrchestratorInput({ message: "帮我查一下" }));

      expect(result.fast_reply).toBe("工具执行出错了");
    });

    it("历史消息被正确过滤（保留最近10条）", async () => {
      mockFn.callModelFull.mockResolvedValueOnce(makeModelResponse("回复"));

      const history: ChatMessage[] = Array.from({ length: 15 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `消息 ${i}`,
      }));

      await orchestrator(makeOrchestratorInput({ history }));

      // orchestrator: history.filter → .slice(-10) → + 1 system + 1 user = 12 total
      const callArgs = mockFn.callModelFull.mock.calls[0];
      const messages = callArgs[1] as ChatMessage[];
      expect(messages.length).toBe(12); // 10 历史消息 + 1 system + 1 user
    });

    it("weather 查询被提前拦截（O-008）", async () => {
      weatherMock.detectWeatherQuery.mockReturnValueOnce("深圳");
      weatherMock.fetchRealTimeWeather.mockResolvedValueOnce({
        location: "深圳", temp: "25", condition: "晴", humidity: "60", wind: "东南风3级",
      });
      weatherMock.formatWeatherPrompt.mockReturnValueOnce("深圳：晴，25°C");
      mockFn.callModelFull.mockResolvedValueOnce(makeModelResponse("深圳今天晴天，25度。"));

      await orchestrator(makeOrchestratorInput({ message: "深圳天气如何？" }));

      expect(weatherMock.detectWeatherQuery).toHaveBeenCalledWith("深圳天气如何？");
      expect(weatherMock.fetchRealTimeWeather).toHaveBeenCalledWith("深圳");
      expect(weatherMock.formatWeatherPrompt).toHaveBeenCalled();
    });

    it("TaskArchive create 失败时继续执行，不阻断慢模型触发", async () => {
      mockFn.callModelFull.mockResolvedValueOnce(
        makeModelResponse(`让我想想。
【SLOW_MODEL_REQUEST】
{"action": "code", "task": "写个排序", "constraints": [], "query_keys": []}
【/SLOW_MODEL_REQUEST】
`)
      );
      taskArchiveRepo.create.mockRejectedValueOnce(new Error("DB error"));

      const result = await orchestrator(makeOrchestratorInput({ message: "帮我写个排序" }));

      expect(result.routing_info.delegated).toBe(true);
      expect(result.delegation).toBeDefined();
    });
  });

  // ── triggerSlowModelBackground ───────────────────────────────────────────────

  describe("triggerSlowModelBackground", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("正常执行：更新状态 → 调用慢模型 → 写入 Archive", async () => {
      mockFn.callModelFull
        .mockResolvedValueOnce(makeModelResponse("任务已完成"))
        .mockResolvedValueOnce(makeModelResponse("done"));

      await triggerSlowModelBackground({
        taskId: "task-bg-1",
        message: "分析半导体",
        command: {
          action: "research",
          task: "分析半导体行业",
          constraints: ["不超过500字"],
          query_keys: ["半导体"],
        },
        user_id: "user-1",
        session_id: "session-1",
      });

      expect(taskArchiveRepo.updateState).toHaveBeenCalledWith("task-bg-1", "running");
      expect(taskArchiveRepo.setSlowExecution).toHaveBeenCalledWith(
        "task-bg-1",
        expect.objectContaining({ status: "done", result: "任务已完成" })
      );
      expect(taskArchiveRepo.updateState).toHaveBeenCalledWith("task-bg-1", "completed");
      expect(delegationArchiveRepo.create).toHaveBeenCalledOnce();
    });

    it("慢模型调用失败 → 写入 failed 状态，不抛异常", async () => {
      // mock reject the slow model call (reqApiKey = undefined → uses callModelFull)
      mockFn.callModelFull.mockRejectedValueOnce(new Error("Model timeout"));

      await expect(
        triggerSlowModelBackground({
          taskId: "task-bg-fail",
          message: "分析",
          command: { action: "analysis", task: "分析", constraints: [], query_keys: [] },
          user_id: "user-1",
          session_id: "session-1",
        })
      ).resolves.toBeUndefined(); // 不抛异常即通过
    });

    it("reqApiKey 存在时使用 callOpenAIWithOptions", async () => {
      mockFn.callModelFull.mockResolvedValueOnce(makeModelResponse("done"));
      mockFn.callOpenAIWithOptions.mockResolvedValueOnce(makeModelResponse("带 Key 的结果"));

      await triggerSlowModelBackground({
        taskId: "task-bg-key",
        message: "分析",
        command: { action: "analysis", task: "分析", constraints: [], query_keys: [] },
        user_id: "user-1",
        session_id: "session-1",
        reqApiKey: "sk-key",
      });

      expect(mockFn.callOpenAIWithOptions).toHaveBeenCalled();
    });
  });
});

// ── Custom matcher ─────────────────────────────────────────────────────────────
expect.extend({
  toHaveBeenCalledOnce(received: unknown) {
    const calls = (received as { mock: { calls: unknown[][] } }).mock.calls;
    const pass = calls.length === 1;
    return {
      pass,
      message: () =>
        `expected ${received} to have been called exactly once, but was called ${calls.length} times`,
    };
  },
});
