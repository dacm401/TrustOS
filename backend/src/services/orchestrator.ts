/**
 * Orchestrator v0.4 — LLM-Native 路由架构
 *
 * 核心变化（v0.3 → v0.4）：
 * - 删除了 shouldDelegate() 硬编码判断规则
 * - Fast 模型自判断：直接回复 / 调用 web_search / 请求升级慢模型
 * - Fast → Slow = 结构化 JSON command，不再传上下文
 * - Archive 为唯一事实源（Phase 1 引入后生效）
 *
 * 决策流程（Fast 模型自判断）：
 * 1. 用户是否闲聊/打招呼？ → 直接回复，1-2句话
 * 2. 是否需要实时数据？ → 调用 web_search → 返回结果
 * 3. 是否需要慢模型？ → 输出【SLOW_MODEL_REQUEST】JSON command
 * 4. 以上都不是 → 直接回复
 */

import { v4 as uuid } from "uuid";
import type { ChatMessage, ManagerAction, ManagerDecision } from "../types/index.js";
import { callModelFull } from "../models/model-gateway.js";
import { callOpenAIWithOptions } from "../models/providers/openai.js";
import type { ModelResponse } from "../models/providers/base-provider.js";
import { TaskRepo, MemoryEntryRepo, DelegationArchiveRepo, TaskArchiveRepo } from "../db/repositories.js";
import { config } from "../config.js";
import { runRetrievalPipeline, buildCategoryAwareMemoryText } from "./memory-retrieval.js";
import { FAST_MODEL_TOOLS } from "./fast-model-tools.js";
import { toolExecutor } from "../tools/executor.js";

// ── 类型定义 ──────────────────────────────────────────────────────────────────

export interface OrchestratorInput {
  message: string;
  language: "zh" | "en";
  user_id: string;
  session_id: string;
  history?: ChatMessage[];
  reqApiKey?: string;
  hasPendingTask?: boolean;       // O-007: 是否有 pending 慢任务（安抚用）
  pendingTaskMessage?: string;     // O-007: pending 任务原始消息
}

export interface OrchestratorResult {
  fast_reply: string;
  delegation?: {
    task_id: string;
    status: "triggered";
  };
  // Phase 1.5: Clarifying 流程
  clarifying?: ClarifyQuestion;
  // Phase 2: ManagerDecision（结构化决策，供 chat.ts 决定执行路径）
  manager_decision?: ManagerDecision | null;
  routing_info: {
    delegated: boolean;
    tool_used?: string;            // 如 "web_search"
    is_reassuring?: boolean;       // O-007: 是否是安抚回复
    routing_intent?: string;       // 路由意图（供 benchmark 使用）
    clarify_requested?: boolean;   // Phase 1.5: Fast 请求澄清
    execute_requested?: boolean;    // Phase 2: Fast 请求执行模式
  };
}

/** Slow 模型升级命令（从 Fast 模型输出中解析） */
export interface SlowModelCommand {
  action: "research" | "analysis" | "code" | "creative" | "comparison";
  task: string;
  constraints: string[];
  query_keys: string[];
  // Phase 1.5: 任务卡片扩展字段
  relevant_facts?: string[];
  user_preference_summary?: string;
  priority?: "high" | "normal" | "low";
  max_execution_time_ms?: number;
}

/** Phase 1.5: 澄清问题（Fast → 前端） */
export interface ClarifyQuestion {
  question_id: string;
  question_text: string;
  options?: string[];    // 多选时提供选项
  context: string;       // 触发澄清的上下文
}

// ── O-007 安抚 prompt ─────────────────────────────────────────────────────────

function buildReassuringFastPrompt(lang: "zh" | "en"): string {
  if (lang === "zh") {
    return `你是 SmartRouter Pro 的快模型助手。职责：快速回复用户，口语化，自然，1-2句话足够。
当检测到用户询问之前委托任务的进度时（如"出来了吗"、"好了吗"、"还在处理吗"等），
请用人格化的方式安抚用户，告知正在处理中，不要暴露"委托"或"慢模型"等技术细节。
示例回复：
- "还在分析中哦，请稍候～"
- "老板，稍等一下，马上就好啦～"
- "正在为您处理，马上呈现结果～"`;
  }
  return `You are SmartRouter Pro's fast model assistant.
When user asks about task progress (e.g., "done?", "is it ready?", "still processing?"),
reply in a friendly, reassuring way without mentioning technical details like "delegation" or "slow model".`;
}

// ── Fast 模型系统 prompt（LLM-Native 路由版 v0.5 — ManagerDecision）───────────

function buildFastModelSystemPrompt(lang: "zh" | "en"): string {
  if (lang === "zh") {
    return `你是 SmartRouter Pro 的快模型助手。

【决策规则】
收到用户请求后，依次判断：

1. 用户是否只是闲聊/打招呼/情绪表达？
   → action: "direct_answer"，直接回复，1-2句话，有温度

2. 问题是否需要实时数据（天气/新闻/股价/比分/任何你不确定的事）？
   → 调用 web_search 工具获取数据，再回答

3. 用户的请求是否模糊、缺少关键信息（如目标、范围、格式）？
   → action: "ask_clarification"，向用户提问确认

4. 问题是否超出你的知识截止日期，或需要多步复杂推理？
   → action: "delegate_to_slow"，请求升级到更强模型

5. 任务是否需要多步骤执行（搜索+整理+生成等）？
   → action: "execute_task"，触发执行模式

6. 以上都不是？
   → action: "direct_answer"，用内建知识直接回答

【web_search 使用时机】
- 天气查询
- 实时股价、指数、基金净值
- 最新新闻、公告
- 比分、赛果
- 任何你不确定、需要确认的实时信息
- 你的知识截止日期之后发生的事

【ManagerDecision 输出格式】
先用1-2句自然语言告知用户你的判断，然后输出单行JSON（不包裹代码块）：

{"version": "v1", "action": "direct_answer|ask_clarification|delegate_to_slow|execute_task", "confidence": 0.0-1.0, "reasoning": "简短推理1-2句话"}

action=ask_clarification 时附加：
"clarification": {"question_text": "问题内容", "options": ["选项1", "选项2"]}

action=delegate_to_slow 时附加：
"delegation": {"action": "research|analysis|code|creative|comparison", "task": "核心任务描述（<100字）", "constraints": ["约束1", "约束2"], "query_keys": ["关键词1"], "priority": "normal"}

action=execute_task 时附加：
"execution": {"goal": "任务目标", "complexity": "low|medium|high", "max_steps": 数字}

示例（delegate_to_slow）：
这个问题需要深入分析。
{"version": "v1", "action": "delegate_to_slow", "confidence": 0.82, "reasoning": "需要多角度对比，委托慢模型处理。", "delegation": {"action": "comparison", "task": "对比 A/B/C 三种技术方案", "constraints": ["输出对比表格"], "query_keys": ["方案A", "方案B"], "priority": "normal"}}

示例（execute_task）：
好的，我来帮你完成这个任务。
{"version": "v1", "action": "execute_task", "confidence": 0.75, "reasoning": "需要多步搜索和整理，触发执行模式。", "execution": {"goal": "查找最新AI Agent行业报告并整理摘要", "complexity": "high", "max_steps": 8}}

然后停止输出，等待处理。`;
  }
  return `You are SmartRouter Pro's fast model assistant.

【Decision Rules】
After receiving the user's request, judge in order:

1. Is the user just chatting/greeting/emotional expression?
   → action: "direct_answer", reply directly, 1-2 sentences, with warmth

2. Does the question need real-time data (weather/news/stocks/scores)?
   → Call web_search tool to get data, then answer

3. Is the request ambiguous or missing key information?
   → action: "ask_clarification", ask the user to clarify

4. Does the question exceed your knowledge cutoff or require multi-step reasoning?
   → action: "delegate_to_slow", request escalation to stronger model

5. Does the task require multi-step execution (search+organize+generate)?
   → action: "execute_task", trigger execution mode

6. None of the above?
   → action: "direct_answer", answer with your built-in knowledge

【ManagerDecision Output Format】
First say 1-2 natural sentences, then output single-line JSON (no code block):

{"version": "v1", "action": "direct_answer|ask_clarification|delegate_to_slow|execute_task", "confidence": 0.0-1.0, "reasoning": "brief reasoning 1-2 sentences"}

For action=ask_clarification, add:
"clarification": {"question_text": "question", "options": ["option1", "option2"]}

For action=delegate_to_slow, add:
"delegation": {"action": "research|analysis|code|creative|comparison", "task": "core task (<100 chars)", "constraints": ["constraint1"], "query_keys": ["keyword1"], "priority": "normal"}

For action=execute_task, add:
"execution": {"goal": "task goal", "complexity": "low|medium|high", "max_steps": number}

Example (delegate_to_slow):
This needs deeper analysis.
{"version": "v1", "action": "delegate_to_slow", "confidence": 0.82, "reasoning": "Needs multi-perspective comparison, delegating to slow model.", "delegation": {"action": "comparison", "task": "Compare A/B/C technical solutions", "constraints": ["Output comparison table"], "query_keys": ["SolutionA", "SolutionB"], "priority": "normal"}}

Then stop outputting and wait for processing.`;
}

// ── Slow 模型升级命令解析 ─────────────────────────────────────────────────────

/**
 * 从 Fast 模型输出中解析【SLOW_MODEL_REQUEST】命令
 */
function parseSlowModelCommand(text: string): SlowModelCommand | null {
  let jsonStr: string | null = null;

  // 格式 1：代码块内的 JSON
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) { jsonStr = codeBlockMatch[1].trim(); }

  // 格式 2：单独一行的 JSON
  if (!jsonStr) {
    const jsonLineMatch = text.match(/(\{[^{}]*"action"[\s\S]*?\})/);
    if (jsonLineMatch) { jsonStr = jsonLineMatch[1]; }
  }

  // 格式 3：包含在【SLOW_MODEL_REQUEST】标记中
  if (!jsonStr) {
    const tagMatch = text.match(/【SLOW_MODEL_REQUEST】\s*(\{[\s\S]*?\})\s*【\/SLOW_MODEL_REQUEST】/);
    if (tagMatch) { jsonStr = tagMatch[1]; }
  }

  if (!jsonStr) return null;

  try {
    const parsed = JSON.parse(jsonStr);
    if (!parsed.action || !parsed.task) return null;
    return {
      action: parsed.action,
      task: parsed.task,
      constraints: Array.isArray(parsed.constraints) ? parsed.constraints : [],
      query_keys: Array.isArray(parsed.query_keys) ? parsed.query_keys : [],
      // Phase 1.5 扩展字段
      relevant_facts: Array.isArray(parsed.relevant_facts) ? parsed.relevant_facts : undefined,
      user_preference_summary: typeof parsed.user_preference_summary === "string" ? parsed.user_preference_summary : undefined,
      priority: (parsed.priority === "high" || parsed.priority === "normal" || parsed.priority === "low") ? parsed.priority : undefined,
      max_execution_time_ms: typeof parsed.max_execution_time_ms === "number" ? parsed.max_execution_time_ms : undefined,
    };
  } catch {
    return null;
  }
}

/** Phase 1.5: 从 Fast 模型输出中解析【CLARIFYING_REQUEST】 */
function parseClarifyQuestion(text: string): ClarifyQuestion | null {
  let jsonStr: string | null = null;

  // 格式1：包含在【CLARIFYING_REQUEST】标记中
  const tagMatch = text.match(/【CLARIFYING_REQUEST】\s*(\{[\s\S]*?\})\s*【\/CLARIFYING_REQUEST】/);
  if (tagMatch) { jsonStr = tagMatch[1]; }

  // 格式2：单行JSON（兼容无标记格式）
  if (!jsonStr) {
    const jsonLineMatch = text.match(/(\{"question_text"[\s\S]*?\})/);
    if (jsonLineMatch) { jsonStr = jsonLineMatch[1]; }
  }

  if (!jsonStr) return null;

  try {
    const parsed = JSON.parse(jsonStr);
    if (!parsed.question_text) return null;
    return {
      question_id: uuid(),
      question_text: parsed.question_text,
      options: Array.isArray(parsed.options) ? parsed.options : undefined,
      context: parsed.context || "",
    };
  } catch {
    return null;
  }
}

// ── ManagerDecision 解析器（Phase 2 — 替代正则匹配）──────────────────────────

const VALID_ACTIONS: ManagerAction[] = ["direct_answer", "ask_clarification", "delegate_to_slow", "execute_task"];
const VALID_DELEGATION_ACTIONS = ["research", "analysis", "code", "creative", "comparison"] as const;
const VALID_PRIORITIES = ["high", "normal", "low"] as const;
const VALID_COMPLEXITIES = ["low", "medium", "high"] as const;

/**
 * 从 Fast 模型文本中解析 ManagerDecision JSON。
 * Phase 2：优先解析新格式，fallback 到旧【SLOW_MODEL_REQUEST】格式。
 *
 * 校验失败时返回 null（由调用方降级为 direct_answer）。
 */
function parseManagerDecision(text: string): ManagerDecision | null {
  let jsonStr: string | null = null;

  // 格式 1：单行 JSON（ManagerDecision 新格式）
  const jsonLineMatch = text.match(/(\{[\s\S]*?\})/);
  if (jsonLineMatch) {
    try {
      const parsed = JSON.parse(jsonLineMatch[1]);
      if (typeof parsed === "object" && parsed !== null) {
        jsonStr = jsonLineMatch[1];
      }
    } catch {
      // 不是合法 JSON，继续尝试其他格式
    }
  }

  // 格式 2：包含在【SLOW_MODEL_REQUEST】标记中（旧格式，兼容）
  if (!jsonStr) {
    const tagMatch = text.match(/【SLOW_MODEL_REQUEST】\s*(\{[\s\S]*?\})\s*【\/SLOW_MODEL_REQUEST】/);
    if (tagMatch) { jsonStr = tagMatch[1]; }
  }

  if (!jsonStr) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return null;
  }

  // ── 必填字段校验 ──────────────────────────────────────────
  if (parsed.version !== "v1") return null;
  if (!VALID_ACTIONS.includes(parsed.action as ManagerAction)) return null;
  if (typeof parsed.confidence !== "number" || parsed.confidence < 0 || parsed.confidence > 1) return null;
  if (typeof parsed.reasoning !== "string") return null;

  const action = parsed.action as ManagerAction;
  const result: ManagerDecision = {
    version: "v1",
    action,
    confidence: parsed.confidence as number,
    reasoning: parsed.reasoning as string,
  };

  // ── action 特定字段校验 ──────────────────────────────────
  if (action === "ask_clarification") {
    const clarification = parsed.clarification as Record<string, unknown> | undefined;
    if (!clarification || typeof clarification.question_text !== "string") return null;
    result.clarification = {
      question_text: clarification.question_text as string,
      options: Array.isArray(clarification.options)
        ? clarification.options.filter((o): o is string => typeof o === "string")
        : undefined,
    };
  }

  if (action === "delegate_to_slow") {
    const delegation = parsed.delegation as Record<string, unknown> | undefined;
    if (!delegation) return null;
    if (!VALID_DELEGATION_ACTIONS.includes(delegation.action as typeof VALID_DELEGATION_ACTIONS[number])) return null;
    if (typeof delegation.task !== "string") return null;
    if (!Array.isArray(delegation.constraints)) return null;
    if (!Array.isArray(delegation.query_keys)) return null;
    result.delegation = {
      action: delegation.action as "research" | "analysis" | "code" | "creative" | "comparison",
      task: delegation.task as string,
      constraints: delegation.constraints.filter((c): c is string => typeof c === "string"),
      query_keys: delegation.query_keys.filter((k): k is string => typeof k === "string"),
      relevant_facts: Array.isArray(delegation.relevant_facts)
        ? delegation.relevant_facts.filter((f): f is string => typeof f === "string")
        : undefined,
      user_preference_summary: typeof delegation.user_preference_summary === "string"
        ? (delegation.user_preference_summary as string)
        : undefined,
      priority: VALID_PRIORITIES.includes(delegation.priority as typeof VALID_PRIORITIES[number])
        ? (delegation.priority as "high" | "normal" | "low")
        : undefined,
    };
  }

  if (action === "execute_task") {
    const execution = parsed.execution as Record<string, unknown> | undefined;
    if (!execution) return null;
    if (typeof execution.goal !== "string") return null;
    if (!VALID_COMPLEXITIES.includes(execution.complexity as typeof VALID_COMPLEXITIES[number])) return null;
    if (typeof execution.max_steps !== "number" || execution.max_steps < 1) return null;
    result.execution = {
      goal: execution.goal as string,
      complexity: execution.complexity as "low" | "medium" | "high",
      max_steps: execution.max_steps as number,
    };
  }

  return result;
}

// ── Fast 模型工具调用循环 ────────────────────────────────────────────────────

async function callFastModelWithTools(
  messages: ChatMessage[],
  lang: "zh" | "en",
  reqApiKey?: string
): Promise<{
  reply: string;
  toolUsed?: string;
  /** Phase 2: ManagerDecision（来自 parseManagerDecision） */
  managerDecision?: ManagerDecision | null;
  /** Phase 1.5: 旧格式兼容（来自 parseClarifyQuestion） */
  clarifyQuestion?: ClarifyQuestion;
  /** Phase 2 兼容：旧【SLOW_MODEL_REQUEST】格式（来自 parseSlowModelCommand） */
  command?: SlowModelCommand;
}> {
  const MAX_TOOL_ROUNDS = 5;
  let currentMessages = [...messages];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let response: ModelResponse;

    if (reqApiKey) {
      // 使用 callOpenAIWithOptions（已支持 tools）
      response = await callOpenAIWithOptions(
        config.fastModel, currentMessages, reqApiKey, config.openaiBaseUrl || undefined, FAST_MODEL_TOOLS
      );
    } else {
      // 无 reqApiKey 时，使用 callModelFull（已支持 tools 参数）
      response = await callModelFull(config.fastModel, currentMessages, FAST_MODEL_TOOLS);
    }

    const { content, tool_calls } = response;

    // 情况 1：有 tool_calls → 执行 → 注入结果 → 继续
    if (tool_calls && tool_calls.length > 0) {
      const toolResults: ChatMessage[] = [];

      for (const tc of tool_calls) {
        const toolName = tc.function.name;
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function.arguments); } catch { /* ignore */ }

        const result = await toolExecutor.execute(
          { id: tc.id, tool_name: toolName, arguments: args },
          { userId: "fast-model", sessionId: "fast-session" }
        );

        const resultContent = result.success
          ? JSON.stringify(result.result)
          : `工具执行失败: ${result.error}`;

        toolResults.push({
          role: "tool" as const,
          content: resultContent,
          tool_call_id: tc.id,
        });
      }

      currentMessages.push({ role: "assistant", content });
      currentMessages.push(...toolResults);
      continue;
    }

    // 情况 2：无 tool_calls → 解析 ManagerDecision（Phase 2 主路径）
    if (content) {
      const decision = parseManagerDecision(content);

      if (decision) {
        // 去除 JSON 部分，保留自然语言前缀作为 reply
        const jsonPattern = /\{[\s\S]*?"version"\s*:\s*"v1"[\s\S]*?\}/;
        const replyPrefix = content.replace(jsonPattern, "").trim();

        // action → 对应处理
        if (decision.action === "ask_clarification") {
          const clarifyQ: ClarifyQuestion = {
            question_id: uuid(),
            question_text: decision.clarification?.question_text ?? "需要澄清",
            options: decision.clarification?.options,
            context: "",
          };
          return {
            reply: replyPrefix || (lang === "zh" ? "我需要确认一下..." : "Let me clarify..."),
            managerDecision: decision,
            clarifyQuestion: clarifyQ,
          };
        }

        if (decision.action === "delegate_to_slow") {
          // 转换为旧 SlowModelCommand 格式（复用后续 triggerSlowModelBackground）
          const command: SlowModelCommand = {
            action: decision.delegation!.action,
            task: decision.delegation!.task,
            constraints: decision.delegation!.constraints,
            query_keys: decision.delegation!.query_keys,
            relevant_facts: decision.delegation!.relevant_facts,
            user_preference_summary: decision.delegation!.user_preference_summary,
            priority: decision.delegation!.priority,
          };
          return {
            reply: replyPrefix || (lang === "zh" ? "让我想想..." : "Let me think..."),
            managerDecision: decision,
          };
        }

        if (decision.action === "execute_task") {
          // execute_task 不走 triggerSlowModelBackground，在 chat.ts 中处理
          return {
            reply: replyPrefix || (lang === "zh" ? "好的，我来执行。" : "Sure, I'll execute that."),
            managerDecision: decision,
          };
        }

        // direct_answer
        return {
          reply: replyPrefix || content,
          managerDecision: decision,
        };
      }

      // Phase 2 兼容：旧【CLARIFYING_REQUEST】格式（fallback）
      const clarifyQ = parseClarifyQuestion(content);
      if (clarifyQ) {
        const prefix = content
          .replace(/【CLARIFYING_REQUEST】[\s\S]*?【\/CLARIFYING_REQUEST】/, "")
          .trim();
        return {
          reply: prefix || (lang === "zh" ? "我需要确认一下..." : "Let me clarify..."),
          clarifyQuestion: clarifyQ,
        };
      }

      // Phase 2 兼容：旧【SLOW_MODEL_REQUEST】格式（fallback）
      const command = parseSlowModelCommand(content);
      if (command) {
        const prefix = content
          .replace(/【SLOW_MODEL_REQUEST】[\s\S]*?【\/SLOW_MODEL_REQUEST】/, "")
          .trim();
        return {
          reply: prefix || (lang === "zh" ? "让我想想..." : "Let me think..."),
          command,
        };
      }

      // 情况 3：普通回复（既不是 ManagerDecision 也不是旧格式）
      return { reply: content };
    }

    return { reply: "" };
  }

  // 超过最大轮次
  return { reply: currentMessages[currentMessages.length - 1]?.content || "" };
}

// ── Orchestrator 主函数 ───────────────────────────────────────────────────────

export async function orchestrator(input: OrchestratorInput): Promise<OrchestratorResult> {
  const {
    message, language,
    user_id, session_id, history = [], reqApiKey,
    hasPendingTask = false, pendingTaskMessage
  } = input;

  // Step 0: O-007 安抚
  if (hasPendingTask) {
    const reassuringPrompt = buildReassuringFastPrompt(language);
    const historyContext = history.filter((m) => m.role !== "system").slice(-6);
    const pendingContext = pendingTaskMessage ? `\n\n【当前正在处理的任务】${pendingTaskMessage}` : "";

    const messages: ChatMessage[] = [
      { role: "system", content: reassuringPrompt },
      ...historyContext,
      { role: "user", content: `用户问题是："${message}"${pendingContext}` },
    ];

    let fastReply: string;
    try {
      if (reqApiKey) {
        const resp = await callOpenAIWithOptions(config.fastModel, messages, reqApiKey, config.openaiBaseUrl || undefined);
        fastReply = resp.content;
      } else {
        const resp = await callModelFull(config.fastModel, messages);
        fastReply = resp.content;
      }
    } catch (e: any) {
      console.error("[orchestrator] Reassuring call failed:", e.message);
      fastReply = language === "zh" ? "正在为您处理中，请稍候～" : "Still processing, please wait...";
    }

    return { fast_reply: fastReply, routing_info: { delegated: false, is_reassuring: true } };
  }

  // Step 1: 读取用户记忆（Fast 模型内建知识补充）
  const memories = config.memory.enabled
    ? await MemoryEntryRepo.getTopForUser(user_id, config.memory.maxEntriesToInject)
    : [];

  let memoryText = "";
  if (memories.length > 0) {
    const retrievalResults = memories.map((m) => ({ entry: m, score: m.importance, reason: "v1" }));
    if (config.memory.retrieval.strategy === "v2") {
      const candidates = await MemoryEntryRepo.getTopForUser(user_id, Math.ceil(config.memory.maxEntriesToInject * 1.5));
      const scored = runRetrievalPipeline({
        entries: candidates,
        context: { userMessage: message },
        categoryPolicy: config.memory.retrieval.categoryPolicy,
        maxTotalEntries: config.memory.maxEntriesToInject,
      });
      if (scored.length > 0) memoryText = buildCategoryAwareMemoryText(scored as any).combined;
    }
    if (!memoryText) memoryText = buildCategoryAwareMemoryText(retrievalResults as any).combined;
  }
  void memoryText; // 暂时保留，Slow 模型从 Archive 查上下文，不再传 memoryText

  // Step 2: 构造 Fast 模型消息
  const systemPrompt = buildFastModelSystemPrompt(language);
  const historyMessages = history.filter((m) => m.role !== "system").slice(-10);
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...historyMessages,
    { role: "user", content: message },
  ];

  // Step 3: 调用 Fast 模型（带工具）
  const { reply, toolUsed, command, clarifyQuestion, managerDecision } = await callFastModelWithTools(messages, language, reqApiKey);

  // Phase 1.5 / Phase 2: Fast 请求澄清 → 直接返回
  if (clarifyQuestion) {
    return {
      fast_reply: reply,
      clarifying: clarifyQuestion,
      routing_info: { delegated: false, tool_used: toolUsed, clarify_requested: true },
    };
  }

  // Step 4: Fast 请求执行模式（Phase 2）
  // action=execute_task → 返回给 chat.ts，由 chat.ts 触发 TaskPlanner + ExecutionLoop
  if (managerDecision?.action === "execute_task") {
    return {
      fast_reply: reply,
      manager_decision: managerDecision,
      routing_info: { delegated: false, tool_used: toolUsed, execute_requested: true },
    };
  }

  // Step 5: Fast 请求慢模型升级（Phase 1 旧格式，command 来自 parseSlowModelCommand fallback）
  // 注意：Phase 2 delegate_to_slow 也走这里，command 来自 callFastModelWithTools 内部的转换
  if (command || managerDecision?.action === "delegate_to_slow") {
    // managerDecision.delegation 已在 callFastModelWithTools 中转换为 SlowModelCommand
    const effectiveCommand = command ?? (managerDecision!.delegation ? {
      action: managerDecision!.delegation!.action,
      task: managerDecision!.delegation!.task,
      constraints: managerDecision!.delegation!.constraints,
      query_keys: managerDecision!.delegation!.query_keys,
      relevant_facts: managerDecision!.delegation!.relevant_facts,
      user_preference_summary: managerDecision!.delegation!.user_preference_summary,
      priority: managerDecision!.delegation!.priority,
    } : null);

    if (!effectiveCommand) {
      // delegation 结构不完整，降级为直接回复
      return {
        fast_reply: reply,
        routing_info: { delegated: false, tool_used: toolUsed },
      };
    }

    const taskId = uuid();

    // 写入 TaskArchive（Fast → Slow 的结构化命令）
    try {
      await TaskArchiveRepo.create({
        task_id: taskId,
        session_id,
        command: effectiveCommand,
        user_input: message,
        constraints: effectiveCommand!.constraints,
      });
    } catch (e: any) {
      console.warn("[orchestrator] TaskArchive create failed:", e.message);
      // Archive 写失败不阻止慢模型执行，继续
    }

    // 后台触发慢模型
    triggerSlowModelBackground({
      taskId,
      message,
      command: effectiveCommand!,
      user_id,
      session_id,
      reqApiKey,
    }).catch((e) => console.error("[orchestrator] Slow model trigger failed:", e.message));

    return {
      fast_reply: reply,
      delegation: { task_id: taskId, status: "triggered" },
      routing_info: { delegated: true },
    };
  }

  // Step 5: Fast 直接回复
  return {
    fast_reply: reply,
    routing_info: { delegated: false, tool_used: toolUsed },
  };
}

// ── 后台慢模型触发 ───────────────────────────────────────────────────────────

interface SlowModelBackgroundInput {
  taskId: string;
  message: string;
  command: SlowModelCommand;
  user_id: string;
  session_id: string;
  reqApiKey?: string;
}

async function triggerSlowModelBackground(input: SlowModelBackgroundInput): Promise<void> {
  const { taskId, message, command, user_id, session_id, reqApiKey } = input;
  const startTime = Date.now();

  try {
    // Step 1: 更新 Archive 状态为 running
    await TaskArchiveRepo.updateStatus(taskId, "running");

    // Step 2: 查历史档案获取相关上下文
    const recentArchives = await DelegationArchiveRepo.getRecentByUser(user_id, 3);
    let archiveContext = "";
    if (recentArchives.length > 0) {
      const lines = recentArchives.map(
        (a) => `[历史任务] ${a.original_message}\n[结果摘要] ${a.slow_result?.substring(0, 200) ?? "(无结果)"}`
      );
      archiveContext = `\n【相关历史背景】\n${lines.join("\n\n")}`;
    }

    // Step 3: 构造 Phase 1.5 Task Brief（只读，不含历史对话）
    const taskBrief = {
      task_type: command.action,
      instruction: command.task,
      constraints: command.constraints,
      output_format: "markdown",
      relevant_facts: command.relevant_facts || [],
      user_preference_summary: command.user_preference_summary || "",
      priority: command.priority || "normal",
      max_execution_time_ms: command.max_execution_time_ms || 60000,
    };
    const taskCard = "【任务卡片 — Phase 1.5 只读模式】\n" +
      "你是执行者。任务信息在上面的任务卡片中。\n" +
      "【重要】不要读取任何外部历史对话，只使用任务卡片中的信息。\n" +
      "如果需要了解用户偏好，使用 user_preference_summary 字段。\n" +
      "如果需要相关事实，使用 relevant_facts 字段。\n\n" +
      "【任务卡片】\n" + JSON.stringify(taskBrief, null, 2) + "\n\n" +
      "【输出约束】\n" + command.constraints.map((c) => "- " + c).join("\n") +
      (archiveContext ? "\n\n【相关历史背景】（仅作参考，不要复制）\n" + archiveContext : "");

    // Step 4: 慢模型执行（独立对话，无历史累积）
    const slowModel = config.slowModel;
    const slowMessages: ChatMessage[] = [
      { role: "system", content: taskCard },
      { role: "user", content: message },
    ];

    let slowResult: string;
    if (reqApiKey) {
      const resp = await callOpenAIWithOptions(slowModel, slowMessages, reqApiKey, config.openaiBaseUrl || undefined);
      slowResult = resp.content;
    } else {
      const resp = await callModelFull(slowModel, slowMessages);
      slowResult = resp.content;
    }

    const totalMs = Date.now() - startTime;

    // Step 5: 写入 Archive 执行结果
    await TaskArchiveRepo.writeExecution({
      id: taskId,
      status: "done",
      result: slowResult,
      started_at: new Date(startTime).toISOString(),
      deviations: [],
    });

    // Step 6: 写入 delegation_archive（兼容旧接口，供 hasPending 查询使用）
    await DelegationArchiveRepo.create({
      task_id: taskId,
      user_id,
      session_id,
      original_message: message,
      delegation_prompt: taskCard,
      slow_result: slowResult,
      processing_ms: totalMs,
    });

    // Step 7: 任务记录
    await TaskRepo.create({
      id: taskId, user_id, session_id,
      title: message.substring(0, 100),
      mode: "llm_native_delegated",
      complexity: "high",
      risk: "low",
      goal: message,
      status: "responding",
    }).catch(() => {});
    await TaskRepo.setStatus(taskId, "completed").catch(() => {});

    // Step 8: 写 trace
    await TaskRepo.createTrace({
      id: uuid(), task_id: taskId, type: "llm_native_delegated",
      detail: { original_message: message, command, slow_result: slowResult, processing_ms: totalMs, archived: true },
    }).catch(() => {});

  } catch (e: any) {
    console.error(`[orchestrator] Slow model failed for task ${taskId}:`, e.message);
    await TaskArchiveRepo.writeExecution({
      id: taskId,
      status: "failed",
      errors: [e.message],
    }).catch(() => {});
    await DelegationArchiveRepo.fail(taskId, e.message).catch(() => {});
    await TaskRepo.setStatus(taskId, "failed").catch(() => {});
    await TaskRepo.createTrace({
      id: uuid(), task_id: taskId, type: "llm_native_delegation_failed",
      detail: { error: e.message, failed_at: Date.now() },
    }).catch(() => {});
  }
}

// ── SSE 轮询 loop（含用户体验安抚）───────────────────────────────────────────

export interface SSEEvent {
  type: "status" | "result" | "error" | "done" | "chunk" | "fast_reply";
  stream: string;
  /** Phase 1.5: Clarifying 事件可选字段 */
  options?: string[];
  question_id?: string;
}

/**
 * 轮询 TaskArchive，感知状态变化，推送 SSE 事件
 * 嵌入用户体验安抚消息（30s/60s/120s 节点）
 */
export async function* pollArchiveAndYield(
  taskId: string,
  lang: "zh" | "en"
): AsyncGenerator<SSEEvent> {
  // 自适应轮询间隔：任务初期频繁检查，后期降低频率
  // - < 10s：2s（快速感知完成）
  // - 10s ~ 60s：3s（正常等待）
  // - > 60s：5s（减少数据库压力）
  const getPollInterval = (elapsedMs: number): number => {
    if (elapsedMs < 10000) return 2000;
    if (elapsedMs < 60000) return 3000;
    return 5000;
  };

  const MESSAGES = {
    zh: {
      running30s: "🔄 任务比较复杂，正在深度分析...",
      running60s: "⏳ 资料已找到，正在整理对比...",
      running120s: "🔄 仍在执行，请继续等待...",
      done: "慢模型分析完成，结果如下：",
    },
    en: {
      running30s: "🔄 Task is complex, analyzing deeply...",
      running60s: "⏳ Data found, comparing results...",
      running120s: "🔄 Still running, please wait...",
      done: "Slow model analysis complete:",
    },
  };

  const msgs = MESSAGES[lang] ?? MESSAGES.zh;
  const startTime = Date.now();
  let lastStatusTime = startTime;

  while (true) {
    const task = await TaskArchiveRepo.getById(taskId);
    if (!task) break;

    const elapsed = Date.now() - startTime;

    // 安抚消息（用 elapsed < X+1000 而非 >= X，只发一次）
    if (task.status === "running" || task.status === "pending") {
      if (elapsed > 30000 && elapsed < 31000 && lastStatusTime < 30000) {
        yield { type: "status", stream: msgs.running30s };
        lastStatusTime = Date.now();
      } else if (elapsed > 60000 && elapsed < 61000 && lastStatusTime < 60000) {
        yield { type: "status", stream: msgs.running60s };
        lastStatusTime = Date.now();
      } else if (elapsed > 120000 && elapsed < 121000) {
        // 120s 后每 60s 发一次
        const sixtySecondMarker = Math.floor((elapsed - 120000) / 60000);
        if (elapsed < 120000 + 60000 * sixtySecondMarker + 1000 && elapsed >= 120000 + 60000 * sixtySecondMarker) {
          yield { type: "status", stream: msgs.running120s };
          lastStatusTime = Date.now();
        }
      }
    }

    if (task.status === "done") {
      if (!task.delivered) {
        const result = task.slow_execution?.result ?? "";
        yield {
          type: "result",
          stream: `${msgs.done}\n\n${result}`,
        };
        await TaskArchiveRepo.markDelivered(taskId).catch(() => {});
      }
      break;
    }

    if (task.status === "failed") {
      const errors = task.slow_execution?.errors ?? [];
      yield { type: "error", stream: `任务执行失败: ${errors[0] ?? "Unknown error"}` };
      break;
    }

    const interval = getPollInterval(Date.now() - startTime);
    await sleep(interval);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── 查询委托结果（供轮询接口使用）──────────────────────────────────────────────

export interface DelegationResult {
  task_id: string;
  status: "pending" | "completed" | "failed";
  slow_result?: string;
  fast_reply?: string;
  error?: string;
}

export async function getDelegationResult(taskId: string): Promise<DelegationResult | null> {
  try {
    const task = await TaskRepo.getById(taskId);
    if (!task) return null;

    const traces = await TaskRepo.getTraces(taskId);
    const delegatedTrace = traces.find((t) => (t.type as string) === "llm_native_delegated");
    const failedTrace = traces.find((t) => (t.type as string) === "llm_native_delegation_failed");

    if (failedTrace) {
      return { task_id: taskId, status: "failed", error: (failedTrace.detail as any)?.error || "Unknown error" };
    }
    if (delegatedTrace) {
      const detail = delegatedTrace.detail as any;
      return { task_id: taskId, status: "completed", slow_result: detail?.slow_result };
    }
    return { task_id: taskId, status: "pending" };
  } catch (e: any) {
    console.error("[orchestrator] getDelegationResult failed:", e.message);
    return null;
  }
}

// ── Routing Evaluation（供 Benchmark 使用）──────────────────────────────────────

export interface RoutingEvaluation {
  routing_intent: string;    // 路由意图: chat/knowledge/research/analysis/code/creative
  selected_role: "fast" | "slow";
  tool_used?: string;       // 如 "web_search"
  fast_reply: string;       // Fast 模型的直接回复
  confidence: number;       // 0-1 置信度
}

const EVAL_SYSTEM_PROMPT_ZH = `你是一个严格的路由分类器。
给定用户输入，你需要输出一个 JSON 对象（不含 markdown）：

{
  "routing_intent": "chat|knowledge|research|analysis|code|creative|other",
  "selected_role": "fast|slow",
  "tool_used": "web_search|null",
  "fast_reply": "直接回复内容（1-2句话）",
  "confidence": 0.0-1.0
}

分类规则：
- routing_intent:
  * chat: 闲聊、问候、感谢、简单问答
  * knowledge: 需要查实时信息（天气/新闻/股价/比赛结果）
  * research: 需要深度分析、多角度对比、调研报告
  * analysis: 数据分析、因果推理、多步骤计算
  * code: 代码生成、bug修复、技术问题
  * creative: 写作、创意、内容生成
  * other: 不属于以上类别
- selected_role: fast=快模型直接回答, slow=需要慢模型深度处理
- tool_used: 如需查实时数据填 "web_search"，否则 null
- fast_reply: 如果 selected_role=fast，给出简短回复；如果是 slow，给出确认语如"让我深入分析一下这个问题"
- confidence: 你对这个分类的置信度

只输出 JSON，不要解释。`;

const EVAL_SYSTEM_PROMPT_EN = `You are a strict routing classifier.
Given the user input, output a JSON object (no markdown):

{
  "routing_intent": "chat|knowledge|research|analysis|code|creative|other",
  "selected_role": "fast|slow",
  "tool_used": "web_search|null",
  "fast_reply": "direct reply (1-2 sentences)",
  "confidence": 0.0-1.0
}

Classification rules:
- routing_intent:
  * chat: casual talk, greetings, thanks, simple Q&A
  * knowledge: needs real-time info (weather/news/stocks/results)
  * research: deep analysis, multi-perspective comparison, investigation
  * analysis: data analysis, causal reasoning, multi-step computation
  * code: code generation, bug fixes, technical questions
  * creative: writing, creative content
  * other: doesn't fit above
- selected_role: fast=direct answer, slow=deep processing needed
- tool_used: "web_search" if real-time data needed, else null
- fast_reply: short reply if fast, confirmation if slow
- confidence: 0.0-1.0

Output only JSON, no explanation.`;

/**
 * 路由评估函数（供 Benchmark runner 调用）
 * 独立于 orchestrator 主流程，专注返回结构化路由决策
 */
export async function evaluateRouting(
  message: string,
  language: "zh" | "en" = "zh",
  reqApiKey?: string
): Promise<RoutingEvaluation> {
  const systemPrompt = language === "zh" ? EVAL_SYSTEM_PROMPT_ZH : EVAL_SYSTEM_PROMPT_EN;
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: message },
  ];

  let raw = "";
  try {
    if (reqApiKey) {
      const resp = await callOpenAIWithOptions(config.fastModel, messages, reqApiKey, config.openaiBaseUrl || undefined);
      raw = resp.content;
    } else {
      const resp = await callModelFull(config.fastModel, messages);
      raw = resp.content;
    }
  } catch (e: any) {
    console.error("[evaluateRouting] LLM call failed:", e.message);
    return {
      routing_intent: "other",
      selected_role: "fast",
      fast_reply: language === "zh" ? "（路由评估失败，使用默认）" : "(Routing eval failed, using default)",
      confidence: 0,
    };
  }

  // 解析 JSON
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        routing_intent: parsed.routing_intent ?? "other",
        selected_role: parsed.selected_role === "slow" ? "slow" : "fast",
        tool_used: parsed.tool_used === "web_search" ? "web_search" : undefined,
        fast_reply: parsed.fast_reply ?? "",
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      };
    }
  } catch {
    // fall through to default
  }

  // 解析失败，使用默认值
  return {
    routing_intent: "other",
    selected_role: "fast",
    fast_reply: raw.slice(0, 200),
    confidence: 0,
  };
}
