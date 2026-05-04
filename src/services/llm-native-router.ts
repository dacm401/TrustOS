// Phase 3.0: LLM-Native Router — ManagerDecision 驱动的路由
// backend/src/services/llm-native-router.ts
//
// 职责：
// 1. 调用 Fast 模型生成 ManagerDecision JSON
// 2. 用 parseAndValidate() 校验
// 3. 按 decision_type 路由：direct_answer / ask_clarification / delegate_to_slow / execute_task
//
// Phase 1：轻量接入，不改旧 orchestrator，双轨并行
//
// Phase 4.1 增强：Permission Layer 预留点
// Phase 4.2 增强：Redaction Engine 集成
// - 在数据暴露给云端模型之前，根据 fallbackAction 执行脱敏
// - 使用 config.permission.redaction feature flag 控制

import { v4 as uuid } from "uuid";
import { config } from "../config.js";
import { callModelFull, callOpenAIWithOptions } from "../models/model-gateway.js";
import type { ChatMessage } from "../types/index.js";
import type {
  ManagerDecision,
  ManagerDecisionType,
  RoutingLayer,
  DirectResponse,
  ClarifyQuestion,
  CommandPayload,
  ExecutionPlan,
  WorkerHint,
  DecisionFeatures,
  AmbiguitySignal,
} from "../types/index.js";
import { DECISION_TO_LAYER } from "../types/index.js";
import { parseAndValidate } from "./decision-validator.js";
import { taskPlanner } from "./task-planner.js";
import { DelegationLogRepo } from "../db/repositories.js";

// Phase 4: Permission Layer + Redaction imports (lazy loaded to avoid circular deps)
let phase4Module: typeof import("./phase4/index.js") | null = null;

async function getPhase4() {
  if (!phase4Module) {
    phase4Module = await import("./phase4/index.js");
  }
  return phase4Module;
}

// ── Gating: Gated Delegation v2 ───────────────────────────────────────────────

import { calculateSystemConfidence, getSelectedAction } from "./gating/system-confidence.js";
import { calibrateWithPolicy } from "./gating/policy-calibrator.js";
import { shouldRerank, ruleBasedRerank } from "./gating/delegation-reranker.js";
import { DEFAULT_GATING_CONFIG } from "./gating/gating-config.js";
import type { CalibratedDecision } from "./gating/policy-calibrator.js";
import type { RerankResult } from "./gating/delegation-reranker.js";
// KB-1: Knowledge Boundary Signals
import { detectKnowledgeBoundarySignals } from "./gating/knowledge-boundary-signals.js";
import type { KnowledgeBoundarySignal } from "../types/index.js";
// Sensitive Data Guard: 信息分发红线
import { detectSensitiveData } from "./gating/sensitive-data-rule.js";
// P4: Learning Layer — 用户记忆检索
import { retrieveMemoriesHybrid, buildCategoryAwareMemoryText } from "./memory-retrieval.js";

export interface GatedDelegationContext {
  llmScores: Record<ManagerDecisionType, number>;
  llmConfidenceHint: number;
  features: DecisionFeatures;
  systemConfidence: number;
  /** G2: Policy 校准后的各动作分数 */
  calibratedScores: Record<ManagerDecisionType, number>;
  finalAction: ManagerDecisionType;
  policyOverrides: import("../types/index.js").PolicyOverride[];
  rerankResult?: RerankResult;
  /** 最终用于路由的 action（可能经过 rerank） */
  routedAction: ManagerDecisionType;
  /** KB-1: 知识边界信号（可选，用于 trace/debug） */
  knowledgeBoundarySignals?: KnowledgeBoundarySignal[];
}

/**
 * Gated Delegation 完整流程：G1 → G2 → G3
 *
 * @param llmScores                 LLM 输出的各动作原始分数
 * @param llmConfidenceHint         LLM 自报置信度
 * @param features                  LLM 输出的结构化特征
 * @param knowledgeBoundarySignals   KB-1: 知识边界信号（可选）
 * @returns GatedDelegationContext（含所有中间结果，供 trace/debug/benchmark 使用）
 */
export function runGatedDelegation(
  llmScores: Record<ManagerDecisionType, number>,
  llmConfidenceHint: number,
  features: DecisionFeatures,
  knowledgeBoundarySignals?: KnowledgeBoundarySignal[]
): GatedDelegationContext {
  // G1: 计算 system_confidence（含 KB 知识边界校准）
  const systemConfidence = calculateSystemConfidence(
    llmScores,
    llmConfidenceHint,
    features,
    DEFAULT_GATING_CONFIG,
    knowledgeBoundarySignals
  );

  // G2: Policy 校准（含 KB 知识边界校准）
  const calibrated: CalibratedDecision = calibrateWithPolicy(
    llmScores,
    features,
    DEFAULT_GATING_CONFIG,
    knowledgeBoundarySignals
  );

  // G3: 判断是否需要 rerank
  let rerankResult: RerankResult | undefined;
  let routedAction = calibrated.finalAction;

  if (shouldRerank(calibrated.adjustedScores, systemConfidence, calibrated.finalAction, DEFAULT_GATING_CONFIG)) {
    rerankResult = ruleBasedRerank(
      calibrated.adjustedScores,
      features,
      calibrated.finalAction
    );
    routedAction = rerankResult.finalAction;
  }

  return {
    llmScores,
    llmConfidenceHint,
    features,
    systemConfidence,
    calibratedScores: calibrated.adjustedScores,
    finalAction: calibrated.finalAction,
    policyOverrides: calibrated.policyOverrides,
    rerankResult,
    routedAction,
    // KB-1: 保留知识边界信号供 trace/debug 使用
    knowledgeBoundarySignals,
  };
}

// ── Manager Prompt ────────────────────────────────────────────────────────────

function buildManagerSystemPrompt(lang: "zh" | "en", crossSessionContext?: string, userMemories?: string): string {
  // 中文版 prompt
  const zhPrompt = `你是 SmartRouter Pro 的 Manager（快模型，如 Qwen2.5-72B）。

你的核心职责：判断用户请求应该**由你直接回答**，还是**委托给慢模型**（如 DeepSeek-V3）处理。

理解用户请求后，你需要完成两个任务：
1. **回复用户（人话）**：如果你判断自己直接回答（direct_answer）就够了，请直接给出高质量的自然语言回复。如果你判断需要委托给慢模型（delegate_to_slow），请给出简短的安抚语（例如："好的，正在为您深入分析..."）。
2. **系统决策（机器语）**：在回复之后，对四个动作分别打分（0.0~1.0），然后输出完整决策 JSON。

【四种动作的真实含义】
- direct_answer: **我自己（快模型）直接回答就够好了**。适用于：闲聊/简单问答/打招呼/不需要深度推理的任务。我回答已经足够准确和详细，不需要慢模型。
- ask_clarification: **用户问题描述不清，我（或慢模型）都无法回答**。需要用户补充关键信息（如目标/范围/格式/偏好）。
- delegate_to_slow: **我自己能回答，但委托给慢模型会更好**。适用于：深度分析/多步推理/代码生成/数学计算/需要详细解释的任务。慢模型在这些任务上比我更准确、更详细。
- execute_task: **需要调用工具或执行代码**。适用于：联网搜索/文件操作/代码执行/API 调用。

【评分核心原则：不是"能不能"，而是"谁更好"】
- 如果快模型回答已经"足够好"：direct_answer 打高分（> 0.7），delegate_to_slow 打低分（< 0.3）
- 如果慢模型回答会"明显更好"：delegate_to_slow 打高分（> 0.7），direct_answer 打低分（< 0.3）
- 重点：这是"快模型 vs 慢模型，谁更适合这个任务？"，不是"我能不能回答？"

【强制规则（违反将被视为模型错误）】
- **代码生成/数学计算/复杂分析/深度推理**：慢模型显著优于快模型，delegate_to_slow 必须 >= 0.8，direct_answer 必须 <= 0.2
- **简单问答/闲聊/打招呼**：快模型已经足够好，direct_answer 必须 >= 0.7
- **需要工具调用（搜索/执行代码）**：execute_task 必须 >= 0.8

【输出格式示例】
如果用户问："帮我写一篇关于人工智能发展的 1000 字文章"
正确打分应该是：
{
  "schema_version": "manager_decision_v3",
  "scores": {
    "direct_answer": 0.2,
    "ask_clarification": 0.1,
    "delegate_to_slow": 0.9,
    "execute_task": 0.1
  },
  "confidence_hint": 0.85,
  "features": {
    "missing_info": false,
    "needs_long_reasoning": true,
    "needs_external_tool": false,
    "high_risk_action": false,
    "query_too_vague": false,
    "requires_multi_step": false,
    "is_continuation": false
  },
  "rationale": "深度分析任务，慢模型（如 DeepSeek-V3）在长文写作上显著优于快模型",
  "decision_type": "delegate_to_slow",
  "command": { "task_brief": "写一篇关于人工智能发展的 1000 字文章", "constraints": ["约 1000 字", "涵盖主要发展阶段"] }
}

【决策框架与评分规则】
- 成本思维：每个动作都有 token/latency/风险成本。分数反映"相对最优"而非"是否可能"
- 澄清不是零成本：ask_clarification 会打断用户、增加对话轮次。当 direct_answer 分数接近 ask_clarification 时，倾向于直接回答
- 尺度校准：confidence_hint ≥ 0.8 时相信自己；0.5~0.8 时倾向现有判断；< 0.5 时说明模型有较大不确定性，可适当提高 ask_clarification
- 动作权衡：direct_answer 和 ask_clarification 成本低，较低阈值即可通过；delegate_to_slow 和 execute_task 成本高，需要更高分数

【歧义情况处理】
- 若最高两个动作分数差 < 0.15，或 confidence_hint < 0.5：主动降低 confidence_hint，在 rationale 中说明不确定性来源

【决策特征】
- missing_info: 请求是否缺少关键信息（目标/范围/格式不明确）
- needs_long_reasoning: 是否需要长链推理或多步分析
- needs_external_tool: 是否需要外部工具（web_search/http_request/代码执行）
- high_risk_action: 是否涉及高风险操作（金融决策/医疗建议/安全相关）
- query_too_vague: 请求是否过于模糊，无法直接处理
- requires_multi_step: 是否需要多步骤操作或跨文件处理
- is_continuation: 请求是否引用了之前的对话或任务

【输出格式】（必须严格使用此 JSON Schema，放在回复的最后）

\`\`\`json
{
  "schema_version": "manager_decision_v3",
  "scores": {
    "direct_answer": 0.0~1.0,
    "ask_clarification": 0.0~1.0,
    "delegate_to_slow": 0.0~1.0,
    "execute_task": 0.0~1.0
  },
  "confidence_hint": 0.0~1.0,
  "features": {
    "missing_info": boolean,
    "needs_long_reasoning": boolean,
    "needs_external_tool": boolean,
    "high_risk_action": boolean,
    "query_too_vague": boolean,
    "requires_multi_step": boolean,
    "is_continuation": boolean
  },
  "rationale": "一句话决策理由",
  "decision_type": "四个动作之一",
  "command": { "task_brief": "当 decision_type=delegate/execute 时的任务摘要", "constraints": ["约束1"] }
}
\`\`\`

【输出规则】
- **先说人话，后给 JSON**。JSON 必须用代码块包裹。
- JSON 中**不要**包含 direct_response 或 clarification 内容，直接用你前面的自然语言回复即可。
- 必须包含所有字段`;

  // 英文版 prompt
  const enPrompt = `You are SmartRouter Pro's Manager model.

After understanding the user's request, you need to complete two tasks:
1. **Reply to user (Human)**: If you can answer directly, give a high-quality natural language response. If not (needs tools/deep reasoning), give a brief reassurance (e.g., "OK, analyzing for you...").
2. **System Decision (Machine)**: After your reply, score each of the four actions (0.0~1.0), then output the complete decision JSON.

【Four Actions】
- direct_answer: Direct reply (lowest cost, for chat/simple Q&A/greetings)
- ask_clarification: Request clarification (needs user to provide key info)
- delegate_to_slow: Delegate to slow model (deep analysis/multi-step reasoning/knowledge cutoff)
- execute_task: Execute task (needs tool calling/code execution/multi-step operations)

【Decision Framework】
- Cost thinking: every action has token/latency/risk cost. Score reflects "relative optimal" not "is this possible"
- Clarification is not zero-cost: ask_clarification interrupts the user and adds turns. When direct_answer is close to ask_clarification, prefer direct answer
- Confidence calibration: confidence_hint ≥ 0.8 = trust yourself; 0.5~0.8 = lean toward existing judgment; < 0.5 = model is uncertain, may raise ask_clarification appropriately
- Action trade-offs: direct_answer and ask_clarification are low-cost, lower thresholds acceptable; delegate_to_slow and execute_task are high-cost, need higher scores

【Ambiguity Handling】
- If top-2 action scores differ by < 0.15, or confidence_hint < 0.5: lower confidence_hint and explain the source of uncertainty in rationale

【Decision Features】
- missing_info: Is key information missing (goal/scope/format unclear)
- needs_long_reasoning: Does it need long-chain reasoning or multi-step analysis
- needs_external_tool: Does it need external tools (web_search/http_request/code execution)
- high_risk_action: Does it involve high-risk operations (financial/medical/security)
- query_too_vague: Is the request too vague to handle directly
- requires_multi_step: Does it need multi-step operations or cross-file handling
- is_continuation: Does the request reference a previous conversation or task

【Output Format】（must use this exact JSON Schema, placed at the very end of your response）

\`\`\`json
{
  "schema_version": "manager_decision_v3",
  "scores": {
    "direct_answer": 0.0~1.0,
    "ask_clarification": 0.0~1.0,
    "delegate_to_slow": 0.0~1.0,
    "execute_task": 0.0~1.0
  },
  "confidence_hint": 0.0~1.0,
  "features": {
    "missing_info": boolean,
    "needs_long_reasoning": boolean,
    "needs_external_tool": boolean,
    "high_risk_action": boolean,
    "query_too_vague": boolean,
    "requires_multi_step": boolean,
    "is_continuation": boolean
  },
  "rationale": "One-line rationale",
  "decision_type": "one of the four actions",
  "command": { "task_brief": "Task summary when decision_type=delegate/execute", "constraints": ["constraint1"] }
}
\`\`\`

【Output Rules】
- **Speak human first, then give JSON**. JSON must be in a code block.
- JSON must **NOT** contain direct_response or clarification content; use your preceding natural language reply instead.
- Must include all fields`;

  const systemPrompt = lang === "zh" ? zhPrompt : enPrompt;
  
  if (userMemories) {
    return systemPrompt + `\n\n【用户记忆】\n${userMemories}`;
  }
  if (crossSessionContext) {
    return systemPrompt + `\n\n【跨会话上下文】\n${crossSessionContext}`;
  }

  return systemPrompt;
}

// ── 入参 ─────────────────────────────────────────────────────────────────────

export interface LLMNativeRouterInput {
  message: string;
  user_id: string;
  session_id: string;
  /** 当前 session 内请求序号（用于 delegation_logs.turn_id） */
  turn_id: number;
  history: ChatMessage[];
  language: "zh" | "en";
  reqApiKey?: string;
  /** Sprint 63: 跨会话上下文（active task + history facts） */
  crossSessionContext?: string;
}

export interface LLMNativeRouterResult {
  /** Gated Delegation 上下文（含 G1/G2/G3 全部中间结果） */
  gating?: GatedDelegationContext;
  /** 最终返回给用户的文本 */
  message: string;
  /** ManagerDecision（供 SSE 推送） */
  decision: ManagerDecision | null;
  /** 委托信息（有委托时返回 task_id） */
  delegation?: { task_id: string; status: "triggered" | "blocked_by_sensitive_guard" };
  /** 澄清问题（有澄清请求时返回） */
  clarifying?: ClarifyQuestion;
  /** 路由层 */
  routing_layer: RoutingLayer;
  /** 决策类型 */
  decision_type: ManagerDecisionType | null;
  /** Manager JSON 原始文本（调试用） */
  raw_manager_output?: string;
  /** execute_task 的执行计划（Phase 2 新增） */
  execution_plan?: ExecutionPlan;
  /** Phase 3.0: 创建的 archive_id（用于 SSE archive_written 事件） */
  archive_id?: string;
  /** Phase 3.0: 创建的 command_id（用于 SSE worker_started 事件） */
  command_id?: string;
  /** G4: delegation_logs 表的主键 ID（用于异步回写 execution 结果） */
  delegation_log_id?: string;
}

// ── 主入口 ───────────────────────────────────────────────────────────────────

export async function routeWithManagerDecision(
  input: LLMNativeRouterInput
): Promise<LLMNativeRouterResult> {
  const { message, user_id, session_id, turn_id, history, language, reqApiKey, crossSessionContext } = input;

  // P4: Learning Layer — 检索用户记忆，在调用 Manager 之前注入
  let userMemories: string | undefined;
  try {
    const memories = await retrieveMemoriesHybrid({
      userId: user_id,
      context: { userMessage: message },
      categoryPolicy: {
        instruction: { minImportance: 1, maxCount: 2, alwaysInject: false },
        preference: { minImportance: 1, maxCount: 3, alwaysInject: false },
        fact: { minImportance: 2, maxCount: 2, alwaysInject: false },
        context: { minImportance: 1, maxCount: 2, alwaysInject: false },
      },
      maxTotalEntries: 5,
    });
    if (memories.length > 0) {
      const formatted = buildCategoryAwareMemoryText(memories);
      userMemories = formatted.combined;
    }
  } catch (e: any) {
    // Learning Layer fail-open：检索失败不阻断路由流程
    console.warn("[llm-native-router] Memory retrieval failed (fail-open):", e.message);
  }

  // Step 1: 调用 Fast 模型，传递 Manager Prompt（含 cross-session 上下文 + 用户记忆）
  const managerOutput = await callManagerModel({ message, history, language, reqApiKey, crossSessionContext, userMemories });

  // Step 1.5 (KB-1): 检测知识边界信号
  // fail-open：检测异常不阻断主流程，只记录 warning
  let kbSignals: KnowledgeBoundarySignal[] | undefined;
  try {
    kbSignals = detectKnowledgeBoundarySignals(message, { locale: language });
  } catch (e: any) {
    console.warn("[llm-native-router] KB signal detection failed (fail-open):", e.message);
  }

  // Step 2: 解析 G1 多动作打分格式（manager_decision_v2）
  const gatedResult = parseGatedDecision(managerOutput, kbSignals);

  // Step 3: 不合法 → fallback，返回 L0 direct_answer
  if (!gatedResult) {
    // 尝试旧 v1 格式作为 backward compatibility fallback
    const decision = parseAndValidate(managerOutput);
    if (decision) {
      return routeByDecision(decision, { message, user_id, session_id, language, reqApiKey, raw: managerOutput });
    }
    // Sprint 72 fix: LLM 有时返回截断/乱码 JSON（如 scores 字段不完整），直接吐出 JSON 是错误的
    // 改为：使用 splitManagerOutput 提取人话回复
    console.warn("[llm-native-router] ManagerDecision parse failed, fallback to direct_answer");
    const parsedOutput = splitManagerOutput(managerOutput);

    // Dashboard fix: parse failed 时仍写一条 delegation_log，确保今日数据可见
    let fallbackLogId: string | undefined;
    try {
      const zeroScores = { direct_answer: 0, ask_clarification: 0, delegate_to_slow: 0, execute_task: 0 };
      const fallbackLog = await DelegationLogRepo.save({
        user_id,
        session_id,
        turn_id,
        routing_version: "fallback-v0",
        llm_scores: { ...zeroScores, direct_answer: 1 },
        llm_confidence: 0.5,
        system_confidence: 0.5,
        calibrated_scores: { ...zeroScores, direct_answer: 1 },
        policy_overrides: [],
        g2_final_action: "direct_answer",
        did_rerank: false,
        rerank_rules: [],
        routed_action: "direct_answer",
        routing_reason: "manager_parse_failed",
        routing_layer: "L0",
      });
      fallbackLogId = fallbackLog.id;
    } catch (e: any) {
      console.warn("[llm-native-router] Fallback delegation_log write failed (non-critical):", e.message);
    }

    return {
      message: parsedOutput.userFacingText || (language === "zh" ? "好的，让我看看。" : "Got it, let me check."),
      decision: null,
      routing_layer: "L0",
      decision_type: "direct_answer",
      raw_manager_output: managerOutput,
      delegation_log_id: fallbackLogId,
    };
  }

  // Step 4: 按 Gated Delegation 最终结果路由（KB signals 已在 gatedResult.knowledgeBoundarySignals 中）
  const v2Decision = tryParseV2Decision(managerOutput);

  // Sprint 74: 使用新的 Text + JSON 模式
  // Manager 输出包含 "人话回复" + "JSON 决策"
  const parsedOutput = splitManagerOutput(managerOutput);

  // 强制委派逻辑：如果模型强烈建议委派，无视系统的"省钱"策略
  // 这是一个关键的路由覆盖点，用于确保复杂任务不被错误降级
  const modelJson = parsedOutput.jsonPart ? JSON.parse(parsedOutput.jsonPart) : {};
  const modelScores = modelJson?.scores || {};
  const execScore = modelScores.execute_task || 0;
  const delegateScore = modelScores.delegate_to_slow || 0;

  // Debug: 打印模型原始输出分数，排查委托为什么不发生
  console.log(`[llm-native-router] [DEBUG] Model raw scores: DA=${modelScores.direct_answer}, AC=${modelScores.ask_clarification}, DEL=${delegateScore}, EXEC=${execScore}; confidence_hint=${modelJson?.confidence_hint}`);
  console.log(`[llm-native-router] [DEBUG] Gating result: system_conf=${gatedResult.systemConfidence.toFixed(3)}, finalAction=${gatedResult.finalAction}, routedAction=${gatedResult.routedAction}`);
  console.log(`[llm-native-router] [DEBUG] Calibrated scores:`, gatedResult.calibratedScores);

  // Sprint 75: 降低阈值从 0.85 到 0.75，与 Gating 阈值一致，让更多合理委托被放行
  if ((execScore > 0.75 || delegateScore > 0.75) && gatedResult.routedAction === "direct_answer") {
    console.log(`[llm-native-router] 🚀 Forcing delegation: Model strongly suggests it (exec=${execScore}, del=${delegateScore})`);
    gatedResult.routedAction = execScore > delegateScore ? "execute_task" : "delegate_to_slow";
    gatedResult.finalAction = gatedResult.routedAction;
    // 同步更新 context 中的 message，确保下游逻辑能拿到安抚语
    // 注意：此时 parsedOutput.userFacingText 应该是模型的安抚语
  }

  // direct_answer：直接使用 Manager 一次调用产生的自然语言回复，不再调第二个模型
  if (gatedResult.routedAction === "direct_answer") {
    console.log("[llm-native-router] Direct answer, using Manager's single-call reply");

    // Sprint 75: 正常 direct_answer 路径也要写 delegation_logs（Dashboard 今日统计依赖此数据）
    const directAnswerLogId = uuid();
    console.log(`[llm-native-router] [DEBUG] Writing delegation_log (normal direct_answer), id=${directAnswerLogId}, user_id=${user_id}`);
    DelegationLogRepo.save({
      id: directAnswerLogId,
      user_id,
      session_id,
      turn_id: turn_id ?? 0,
      task_id: undefined,
      routing_version: "v2",
      llm_scores: gatedResult.llmScores,
      llm_confidence: gatedResult.llmConfidenceHint,
      system_confidence: gatedResult.systemConfidence,
      calibrated_scores: gatedResult.calibratedScores,
      policy_overrides: gatedResult.policyOverrides,
      g2_final_action: gatedResult.finalAction,
      did_rerank: Boolean(gatedResult.rerankResult),
      rerank_gap: null,
      rerank_rules: gatedResult.rerankResult ? [gatedResult.rerankResult.reason ?? "reranked"] : [],
      g3_final_action: gatedResult.rerankResult ? gatedResult.routedAction : undefined,
      routed_action: "direct_answer",
      routing_reason: `Gated: direct_answer (sys_conf=${gatedResult.systemConfidence.toFixed(3)})`,
      routing_layer: "L0",
    }).catch((e: Error) => console.error("[llm-native-router] delegation_log write FAILED (normal direct_answer):", e.message, e.stack));

    return {
      message: parsedOutput.userFacingText || (language === "zh" ? "好的。" : "Got it."),
      decision: null,
      routing_layer: "L0",
      decision_type: "direct_answer",
      raw_manager_output: managerOutput,
      delegation_log_id: directAnswerLogId,
    };
  }

  // 对于其他路由动作，使用"人话"作为安抚语，或根据 decision_type 构建澄清/任务消息
  // 这里我们将 parsedOutput.userFacingText 传入 routeByGatedDecision
  return routeByGatedDecision(gatedResult, { 
      message: parsedOutput.userFacingText || message, 
      userFacingText: parsedOutput.userFacingText,
      user_id, session_id, turn_id, language, reqApiKey, 
      rawOutput: managerOutput, v2Decision 
  });
}

// ── Fast Manager 调用 ─────────────────────────────────────────────────────────

async function callManagerModel(input: {
  message: string;
  history: ChatMessage[];
  language: "zh" | "en";
  reqApiKey?: string;
  /** Sprint 63: cross-session context */
  crossSessionContext?: string;
  /** P4: 用户记忆层 — 来自历史交互学习的行为偏好 */
  userMemories?: string;
}): Promise<string> {
  const { message, history, language, reqApiKey, crossSessionContext, userMemories } = input;

  const systemPrompt = buildManagerSystemPrompt(language, crossSessionContext, userMemories);
  // 保留最近 6 轮对话作为上下文，不传全量 history（Manager 只读当前任务）
  const recentHistory = history.filter((m) => m.role !== "system").slice(-6);

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...recentHistory,
    { role: "user", content: message },
  ];

  try {
    if (reqApiKey) {
      const resp = await callOpenAIWithOptions(
        config.fastModel,
        messages,
        reqApiKey,
        config.openaiBaseUrl || undefined
      );
      return resp.content;
    }
    const resp = await callModelFull(config.fastModel, messages);
    return resp.content;
  } catch (e: any) {
    console.error("[llm-native-router] Manager model call failed:", e.message);
    throw e;
  }
}

// ── Gated Delegation: 解析 v2/v3 格式 ───────────────────────────────────────────

/**
 * Sprint 74: 将 Manager 的输出拆分为"用户可见文本"和"JSON 决策"
 * 格式: [Natural Language Reply]\n\n```json { ... } ```
 */
function splitManagerOutput(output: string): { userFacingText: string; jsonPart: string } {
  // 匹配 ```json 块
  const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
  
  if (jsonMatch) {
    const jsonPart = jsonMatch[1];
    // 获取 JSON 之前的部分作为用户可见文本
    const userFacingText = output.slice(0, jsonMatch.index).trim();
    return { userFacingText, jsonPart };
  }

  // 如果没有找到 JSON 块，尝试匹配裸 JSON
  const bareJsonMatch = output.match(/(\{[\s\S]*\})/);
  if (bareJsonMatch) {
    const jsonPart = bareJsonMatch[1];
    const userFacingText = output.slice(0, bareJsonMatch.index).trim();
    return { userFacingText, jsonPart };
  }

  // 如果没有 JSON，整个文本都视为用户可见文本
  return { userFacingText: output.trim(), jsonPart: "" };
}

function parseGatedDecision(
  text: string,
  kbSignals?: KnowledgeBoundarySignal[]
): GatedDelegationContext | null {
  try {
    const match =
      text.match(/```json\s*([\s\S]*?)\s*```/)?.[1] ??
      text.match(/```\s*([\s\S]*?)\s*```/)?.[1] ??
      text.match(/(\{[\s\S]*\})/)?.[1];

    if (!match) return null;
    const raw = JSON.parse(match.trim());

    // Sprint 72 fix: 同时接受 v1、v2 和 v3 (v3 为 Text+JSON 模式)
    if (!["manager_decision_v3", "manager_decision_v2", "manager_decision_v1"].includes(raw.schema_version)) return null;

    // v1/v2 共用 scores 字段结构，直接取用
    const scores: Record<ManagerDecisionType, number> = {
      direct_answer: raw.scores?.direct_answer ?? 0,
      ask_clarification: raw.scores?.ask_clarification ?? 0,
      delegate_to_slow: raw.scores?.delegate_to_slow ?? 0,
      execute_task: raw.scores?.execute_task ?? 0,
    };

    // v1 有 confidence_hint；v2 有 confidence_hint（统一用此字段）
    const llmConfidenceHint = typeof raw.confidence_hint === "number"
      ? Math.max(0, Math.min(1, raw.confidence_hint))
      : 0.5;

    const features: DecisionFeatures = {
      missing_info: Boolean(raw.features?.missing_info),
      needs_long_reasoning: Boolean(raw.features?.needs_long_reasoning),
      needs_external_tool: Boolean(raw.features?.needs_external_tool),
      high_risk_action: Boolean(raw.features?.high_risk_action),
      query_too_vague: Boolean(raw.features?.query_too_vague),
      requires_multi_step: Boolean(raw.features?.requires_multi_step),
      is_continuation: Boolean(raw.features?.is_continuation),
    };

    // KB-1: 传入知识边界信号，供 G1/G2 校准使用
    return runGatedDelegation(scores, llmConfidenceHint, features, kbSignals);
  } catch (e) {
    console.warn("[parseGatedDecision] failed:", (e as Error).message);
    return null;
  }
}

// P2 HITL: 歧义检测阈值
const AMBIGUITY_CONFIDENCE_THRESHOLD = 0.5;
const AMBIGUITY_SCORE_GAP_THRESHOLD = 0.15;

/**
 * P2 HITL: 检测决策歧义。
 * 当 confidence_hint < 阈值 或 top-2 分数差 < 阈值时，返回 AmbiguitySignal。
 */
function detectDecisionAmbiguity(
  llmScores: Record<ManagerDecisionType, number>,
  llmConfidenceHint: number
): AmbiguitySignal | undefined {
  const sorted = (Object.entries(llmScores) as [ManagerDecisionType, number][])
    .sort((a, b) => b[1] - a[1]);
  const [topAction, topScore] = sorted[0];
  const [secondAction, secondScore] = sorted[1];
  const scoreGap = topScore - secondScore;

  const lowConfidence = llmConfidenceHint < AMBIGUITY_CONFIDENCE_THRESHOLD;
  const closeScores = scoreGap < AMBIGUITY_SCORE_GAP_THRESHOLD;

  if (!lowConfidence && !closeScores) return undefined;

  const reason: AmbiguitySignal["reason"] =
    lowConfidence && closeScores ? "both" : lowConfidence ? "low_confidence" : "close_scores";

  return {
    reason,
    llmConfidenceHint,
    topScore,
    secondScore,
    secondAction,
    zhNotice:
      lowConfidence && closeScores
        ? `（⚠️ 系统对该决策的置信度较低，且 top-2 候选动作（${topAction}=${topScore.toFixed(2)} vs ${secondAction}=${secondScore.toFixed(2)}）差距很小）`
        : lowConfidence
        ? `（⚠️ 系统对该决策的置信度较低）`
        : `（⚠️ top-2 候选动作（${topAction}=${topScore.toFixed(2)} vs ${secondAction}=${secondScore.toFixed(2)}）差距很小，可能需要用户确认）`,
    enNotice:
      lowConfidence && closeScores
        ? ` (⚠️ Low confidence and top-2 actions (${topAction}=${topScore.toFixed(2)} vs ${secondAction}=${secondScore.toFixed(2)}) are very close)`
        : lowConfidence
        ? ` (⚠️ Low decision confidence)`
        : ` (⚠️ Top-2 actions (${topAction}=${topScore.toFixed(2)} vs ${secondAction}=${secondScore.toFixed(2)}) are very close — user confirmation may help)`,
  };
}

// ── Gated Delegation: 按 Gated 结果路由 ──────────────────────────────────────

interface GatedRouteContext {
  message: string;
  user_id: string;
  session_id: string;
  turn_id: number;
  task_id?: string;
  language: "zh" | "en";
  reqApiKey?: string;
  /** 原始字符串（用于 raw_manager_output） */
  rawOutput: string;
  /** 解析后的 v2 decision（用于路由字段） */
  v2Decision: Record<string, unknown> | null;
  /** Sprint 74: Manager 生成的自然语言回复（用户可见） */
  userFacingText?: string;
}

async function routeByGatedDecision(
  gated: GatedDelegationContext,
  ctx: GatedRouteContext
): Promise<LLMNativeRouterResult> {
  const { message, user_id, session_id, turn_id, task_id, language, reqApiKey, rawOutput, v2Decision } = ctx;

  // P2 HITL: 歧义检测（适用于所有决策类型，不限于 ask_clarification）
  const ambiguity = detectDecisionAmbiguity(gated.llmScores, gated.llmConfidenceHint);

  // 构建向后兼容的 V1 ManagerDecision（用于 SSE/Archive/旧逻辑）
  const decision: ManagerDecision = {
    schema_version: "manager_decision_v1",
    decision_type: gated.routedAction,
    routing_layer: DECISION_TO_LAYER[gated.routedAction],
    reason: `Gated: ${gated.routedAction} (G1 score=${gated.llmScores[gated.routedAction]?.toFixed(2)}, G2 adjusted, system_conf=${gated.systemConfidence.toFixed(2)})`,
    confidence: gated.systemConfidence,
    needs_archive: gated.routedAction !== "direct_answer",
    // Sprint 74: 使用 Manager 的自然语言回复，不再依赖 JSON 内的 direct_response 字段
    direct_response: gated.routedAction === "direct_answer"
      ? { style: "natural" as const, content: ctx.userFacingText || (language === "zh" ? "好的。" : "Got it.") }
      : undefined,
    clarification: gated.routedAction === "ask_clarification"
      ? {
          question_id: "q1",
          question_text: (ctx.userFacingText || (v2Decision?.clarification as { question_text?: string })?.question_text) ?? (language === "zh" ? "能再具体一点吗？" : "Could you be more specific?"),
          clarification_reason: gated.features.query_too_vague ? "请求模糊" : "需要更多信息",
          // P2 HITL: 将歧义信号注入 ClarifyQuestion，供 routeByDecision 使用
          ambiguity,
        }
      : undefined,
    command: (gated.routedAction === "delegate_to_slow" || gated.routedAction === "execute_task")
      ? {
          command_type: gated.routedAction === "execute_task" ? "execute_plan" as const : "delegate_analysis" as const,
          task_type: "analysis",
          task_brief: (v2Decision?.command as { task_brief?: string })?.task_brief ?? message.substring(0, 200),
          goal: (v2Decision?.command as { task_brief?: string })?.task_brief ?? message,
          constraints: v2Decision && Array.isArray((v2Decision.command as { constraints?: unknown[] })?.constraints) ? (v2Decision.command as { constraints: unknown[] }).constraints as string[] : [],
        }
      : undefined,
  };

  // G4: 委托决策日志（fire-and-forget，不阻塞主流程）
  // G1→G2→G3→路由的完整事实写入 delegation_logs，用于离线分析和 benchmark 改进
  // 生成 UUID 用于异步回写 execution 结果（G4-C 的最后一环）
  const delegation_log_id = uuid();
  DelegationLogRepo.save({
    id: delegation_log_id,
    user_id: user_id,
    session_id: session_id,
    turn_id: turn_id,
    task_id: task_id,
    llm_scores: gated.llmScores,
    llm_confidence: gated.llmConfidenceHint,
    system_confidence: gated.systemConfidence,
    calibrated_scores: gated.calibratedScores,
    policy_overrides: gated.policyOverrides,
    g2_final_action: gated.finalAction,
    did_rerank: Boolean(gated.rerankResult),
    rerank_rules: gated.rerankResult ? [gated.rerankResult.reason ?? "reranked"].filter(Boolean) : [],
    g3_final_action: gated.rerankResult ? gated.routedAction : undefined,
    routed_action: gated.routedAction,
    routing_reason: `Gated: ${gated.routedAction} (sys_conf=${gated.systemConfidence.toFixed(3)})`,
    // Sprint 68: 显式路由层，用于分层监控和 L2 灰度分析
    routing_layer: DECISION_TO_LAYER[gated.routedAction],
  }).catch((e) => console.warn("[delegation-log] write failed:", e.message));

  // Gated Delegation 日志（console.debug 级别，不阻塞主流程）
  console.log("[llm-native-router] Gated Delegation:", {
    llmScores: gated.llmScores,
    llmConfidenceHint: gated.llmConfidenceHint,
    systemConfidence: gated.systemConfidence.toFixed(3),
    routedAction: gated.routedAction,
    routingLayer: DECISION_TO_LAYER[gated.routedAction],
    reranked: gated.rerankResult?.reranked ?? false,
    rerankReason: gated.rerankResult?.reason,
    policyOverrides: gated.policyOverrides.length,
    features: gated.features,
    // KB-1: 知识边界信号（如果有）
    kbSignals: gated.knowledgeBoundarySignals?.map((s) => ({
      type: s.type,
      strength: s.strength.toFixed(2),
      reasons: s.reasons,
    })) ?? [],
  });

  // 按最终路由动作分发，携带 delegation_log_id 供 SSE 异步回写使用
  return routeByDecision(decision, { ...ctx, raw: rawOutput, delegation_log_id });
}

// ── 决策路由 ─────────────────────────────────────────────────────────────────

interface RouteContext {
  message: string;
  user_id: string;
  session_id: string;
  language: "zh" | "en";
  reqApiKey?: string;
  raw: string;
  /** G4: delegation_logs 主键 ID（用于异步回写 execution 结果） */
  delegation_log_id?: string;
}

async function routeByDecision(
  decision: ManagerDecision,
  ctx: RouteContext
): Promise<LLMNativeRouterResult> {
  const { message, user_id, session_id, language, reqApiKey, raw, delegation_log_id } = ctx;

  switch (decision.decision_type) {
    case "direct_answer": {
      // 直接使用 ctx.message（Manager 一次调用产生的自然语言回复），不再依赖 direct_response.content
      const reply = message || (language === "zh" ? "好的。" : "Got it.");
      return {
        message: reply,
        decision,
        routing_layer: "L0",
        decision_type: "direct_answer",
        raw_manager_output: raw,
        delegation_log_id,
      };
    }

    case "ask_clarification": {
      const cq = decision.clarification as ClarifyQuestion | undefined;
      const questionText = cq?.question_text ?? (language === "zh" ? "能再具体一点吗？" : "Could you be more specific?");
      // P2 HITL: 有歧义时在问题前加入歧义说明
      const ambiguityPrefix = cq?.ambiguity
        ? (language === "zh" ? cq.ambiguity.zhNotice : cq.ambiguity.enNotice) + "\n\n"
        : "";
      const clarifyingMessage = ambiguityPrefix + (
        cq?.options?.length
          ? `${questionText} ${cq.options.map((o) => `"${o.label}"`).join(" / ")}`
          : questionText
      );

      // B39-02 fix: ask_clarification 写 task_archives，便于追踪 ClarifyQuestion 后续状态
      const clarifyingTaskId = uuid();
      try {
        const { TaskArchiveRepo, TaskArchiveEventRepo } = await import("../db/task-archive-repo.js");
        await TaskArchiveRepo.create({
          task_id: clarifyingTaskId,
          user_id,
          session_id,
          decision,
          user_input: message,
        });
        // create 默认 state=delegated，改为 clarifying 以便追踪
        await TaskArchiveRepo.updateState(clarifyingTaskId, "clarifying");
        // Phase 3.0: 写入 archive_written 事件
        await TaskArchiveEventRepo.create({
          archive_id: clarifyingTaskId,
          task_id: clarifyingTaskId,
          event_type: "archive_created",
          payload: { decision_type: "ask_clarification", question_text: cq?.question_text },
          actor: "fast_manager",
          user_id,
        });
      } catch (e: any) {
        console.warn("[llm-native-router] Clarifying archive create failed:", e.message);
      }

      return {
        message: clarifyingMessage,
        decision,
        routing_layer: "L0" as RoutingLayer,
        decision_type: "ask_clarification",
        clarifying: cq,
        archive_id: clarifyingTaskId,
        raw_manager_output: raw,
        delegation_log_id,
      };
    }

    case "delegate_to_slow": {
      const command = decision.command as CommandPayload | undefined;
      const taskId = uuid();
      let processedCommand = command;

      // ── Sensitive Data Guard（信息分发红线）────────────────────────────────────
      // 在发给云端模型之前，先扫描是否包含红线敏感数据
      const scanTargets = [
        message,                           // 用户原始输入
        command?.task_brief ?? "",          // Manager 组装的任务摘要
      ].join(" ");

      const sensitiveResult = detectSensitiveData(scanTargets);
      if (sensitiveResult) {
        const alertText = language === "zh"
          ? `⚠️ 检测到敏感数据 [${sensitiveResult.label}]，为保护您的信息，此请求不会发给云端模型。`
          : `⚠️ Sensitive data detected [${sensitiveResult.label}]. This request will not be sent to the cloud model.`;
        return {
          message: alertText,
          decision,
          decision_type: "delegate_to_slow",
          routing_layer: "L1",
          raw_manager_output: raw,
          delegation: { task_id: taskId, status: "blocked_by_sensitive_guard" },
        };
      }


      // Phase 4.1 + 4.2: Permission Layer + Redaction Engine
      // 目的：在数据暴露给云端模型之前，检查是否允许暴露，必要时执行脱敏
      if (config.permission.enabled) {
        try {
          const pl = await getPhase4();
          // 构建分类上下文：task_brief 是暴露给云端的核心数据
          const classificationCtx = {
            dataType: "task_archive" as const,
            sensitivity: "internal" as const,
            source: "system" as const,
            hasPII: false,
            ageHours: 0,
          };
          const classification = new pl.DataClassifier().classify(command?.task_brief ?? "", classificationCtx);
          const permissionCtx = {
            sessionId: session_id,
            userId: user_id,
            requestedTier: classification.classification,
            featureFlags: {
              use_permission_layer: config.permission.enabled,
              use_data_classification: config.permission.dataClassification,
              use_redaction: config.permission.redaction,
            },
            userDataPreferences: config.permission.userDataPreferences,
            targetModel: "cloud_72b" as const,
          };
          const permission = pl.PermissionChecker.fromClassification(classification.classification, permissionCtx);

          console.log("[llm-native-router] Phase 4 Permission Check:", {
            taskId,
            dataType: "task_brief",
            classification: classification.classification,
            permissionAllowed: permission.allowed,
            fallbackAction: permission.fallbackAction,
          });

          // Phase 4.2: 根据 fallbackAction 执行脱敏
          if (permission.fallbackAction === "redact" && config.permission.redaction) {
            const redactionEngine = pl.getRedactionEngine();
            const redactionCtx = {
              sessionId: session_id,
              userId: user_id,
              dataType: "task_archive" as const,
              targetClassification: classification.classification,
              enableAudit: true,
            };

            if (command) {
              const redactedBrief = redactionEngine.redact(command.task_brief ?? "", redactionCtx);
              const redactedWorkerHint = redactionEngine.redact(command.worker_hint ?? "", redactionCtx);

              processedCommand = {
                ...command,
                task_brief: redactedBrief.content as string,
                worker_hint: redactedWorkerHint.content as WorkerHint,
              };

              console.log("[llm-native-router] Phase 4.2 Redaction Applied:", {
                taskId,
                briefStats: redactedBrief.stats,
                workerHintStats: redactedWorkerHint.stats,
              });
            }
          } else if (permission.fallbackAction === "reject" || !permission.allowed) {
            // 拒绝暴露，回退到 direct_answer
            return {
              message: language === "zh"
                ? "抱歉，这个问题涉及敏感信息，无法交给更专业的模型处理。"
                : "Sorry, this request involves sensitive information and cannot be processed by the cloud model.",
              decision,
              routing_layer: "L0",
              decision_type: "direct_answer",
              raw_manager_output: raw,
              delegation_log_id,
            };
          }
        } catch (e: any) {
          console.warn("[llm-native-router] Permission layer check failed:", e.message);
        }
      }

      // Phase 3.0: 写入 TaskArchive + archive_written 事件
      let archiveRecord: { id: string } | null = null;
      try {
        const { TaskArchiveRepo, TaskArchiveEventRepo } = await import("../db/task-archive-repo.js");
        archiveRecord = await TaskArchiveRepo.create({
          task_id: taskId,
          user_id,
          session_id,
          decision,
          user_input: message,
        });
        await TaskArchiveEventRepo.create({
          archive_id: archiveRecord.id,
          task_id: taskId,
          event_type: "archive_created",
          payload: { decision_type: "delegate_to_slow", command_type: command?.command_type ?? "research" },
          actor: "fast_manager",
          user_id,
        });
      } catch (e: any) {
        console.warn("[llm-native-router] TaskArchive create failed:", e.message);
      }

      // Phase 3.0: 写入 task_commands + worker_started 事件
      let commandRecord: { id: string } | null = null;
      try {
        const { TaskCommandRepo, TaskArchiveEventRepo } = await import("../db/task-archive-repo.js");
        if (processedCommand) {
          commandRecord = await TaskCommandRepo.create({
            task_id: taskId,
            archive_id: taskId,
            user_id,
            command_type: processedCommand.command_type,
            worker_hint: processedCommand.worker_hint,
            priority: processedCommand.priority ?? "normal",
            payload: processedCommand,
          });
          // Phase 3.0: worker_started 事件
          await TaskArchiveEventRepo.create({
            archive_id: taskId,
            task_id: taskId,
            event_type: "worker_started",
            payload: { worker_role: processedCommand.worker_hint ?? "slow_worker", command_id: commandRecord.id },
            actor: "slow_worker",
            user_id,
          });
        }
      } catch (e: any) {
        console.warn("[llm-native-router] TaskCommand create failed:", e.message);
      }

      const fastReply = language === "zh"
        ? "这个问题比较深，我正在请更专业的模型帮你分析，稍等一下～"
        : "This is complex. I'm getting a more specialized model to analyze it, please wait...";

      return {
        message: fastReply,
        decision,
        delegation: { task_id: taskId, status: "triggered" },
        routing_layer: "L2",
        decision_type: "delegate_to_slow",
        raw_manager_output: raw,
        archive_id: archiveRecord?.id ?? taskId,
        command_id: commandRecord?.id,
        delegation_log_id,
      };
    }

    case "execute_task": {
      const command = decision.command as CommandPayload | undefined;
      const taskId = uuid();
      let processedCommand = command;

      // Phase 4.1 + 4.2: Permission Layer + Redaction Engine
      if (config.permission.enabled) {
        try {
          const pl = await getPhase4();
          const classificationCtx = {
            dataType: "task_archive" as const,
            sensitivity: "internal" as const,
            source: "system" as const,
            hasPII: false,
            ageHours: 0,
          };
          const classification = new pl.DataClassifier().classify(command?.task_brief ?? "", classificationCtx);
          const permissionCtx = {
            sessionId: session_id,
            userId: user_id,
            requestedTier: classification.classification,
            featureFlags: {
              use_permission_layer: config.permission.enabled,
              use_data_classification: config.permission.dataClassification,
              use_redaction: config.permission.redaction,
            },
            userDataPreferences: config.permission.userDataPreferences,
            targetModel: "cloud_72b" as const,
          };
          const permission = pl.PermissionChecker.fromClassification(classification.classification, permissionCtx);

          console.log("[llm-native-router] Phase 4 Permission Check (execute_task):", {
            taskId,
            dataType: "task_brief",
            classification: classification.classification,
            permissionAllowed: permission.allowed,
            fallbackAction: permission.fallbackAction,
          });

          // Phase 4.2: 根据 fallbackAction 执行脱敏
          if (permission.fallbackAction === "redact" && config.permission.redaction) {
            const redactionEngine = pl.getRedactionEngine();
            const redactionCtx = {
              sessionId: session_id,
              userId: user_id,
              dataType: "task_archive" as const,
              targetClassification: classification.classification,
              enableAudit: true,
            };

            if (command) {
              const redactedBrief = redactionEngine.redact(command.task_brief ?? "", redactionCtx);
              const redactedWorkerHint = redactionEngine.redact(command.worker_hint ?? "", redactionCtx);

              processedCommand = {
                ...command,
                task_brief: redactedBrief.content as string,
                worker_hint: redactedWorkerHint.content as WorkerHint,
              };

              console.log("[llm-native-router] Phase 4.2 Redaction Applied (execute_task):", {
                taskId,
                briefStats: redactedBrief.stats,
              });
            }
          }
        } catch (e: any) {
          console.warn("[llm-native-router] Permission layer check failed:", e.message);
        }
      }

      // Step 1: 写入 TaskArchive + archive_written 事件
      let archiveRecord2: { id: string } | null = null;
      try {
        const { TaskArchiveRepo, TaskArchiveEventRepo } = await import("../db/task-archive-repo.js");
        archiveRecord2 = await TaskArchiveRepo.create({
          task_id: taskId,
          user_id,
          session_id,
          decision,
          user_input: message,
          task_brief: command?.task_brief,
          goal: command?.goal,
        });
        await TaskArchiveEventRepo.create({
          archive_id: archiveRecord2.id,
          task_id: taskId,
          event_type: "archive_created",
          payload: { decision_type: "execute_task", command_type: processedCommand?.command_type ?? "execute_plan" },
          actor: "fast_manager",
          user_id,
        });
      } catch (e: any) {
        console.warn("[llm-native-router] TaskArchive create failed:", e.message);
      }

      // Step 2: 写入 task_commands + worker_started 事件
      let commandRecord2: { id: string } | null = null;
      try {
        const { TaskCommandRepo, TaskArchiveEventRepo } = await import("../db/task-archive-repo.js");
        if (processedCommand) {
          commandRecord2 = await TaskCommandRepo.create({
            task_id: taskId,
            archive_id: taskId,
            user_id,
            command_type: processedCommand.command_type ?? "execute_plan",
            worker_hint: processedCommand.worker_hint ?? "execute_worker",
            priority: processedCommand.priority ?? "normal",
            payload: processedCommand,
            timeout_sec: processedCommand.timeout_sec,
          });
          await TaskArchiveEventRepo.create({
            archive_id: taskId,
            task_id: taskId,
            event_type: "worker_started",
            payload: { worker_role: processedCommand.worker_hint ?? "execute_worker", command_id: commandRecord2.id },
            actor: "execute_worker",
            user_id,
          });
        }
      } catch (e: any) {
        console.warn("[llm-native-router] TaskCommand create failed:", e.message);
      }

      const fastReply = language === "zh"
        ? "好的，正在处理这个任务，稍等一下～"
        : "Got it. Processing this task, please wait...";

      // Phase 3.0: P0-3 — execute_task 接入 TaskPlanner，生成 ExecutionPlan
      let execution_plan;
      try {
        execution_plan = await taskPlanner.plan({
          taskId,
          goal: command?.goal ?? message,
          userId: user_id,
          sessionId: session_id,
          model: config.slowModel,
        });
        console.log("[llm-native-router] execute_task: ExecutionPlan generated:", {
          taskId,
          steps: execution_plan.steps.length,
        });
      } catch (e: any) {
        console.warn("[llm-native-router] TaskPlanner.plan failed:", e.message);
        // TaskPlanner 失败不影响主流程，继续返回 delegation
      }

      return {
        message: fastReply,
        decision,
        delegation: { task_id: taskId, status: "triggered" },
        routing_layer: "L3",
        decision_type: "execute_task",
        raw_manager_output: raw,
        archive_id: archiveRecord2?.id ?? taskId,
        command_id: commandRecord2?.id,
        execution_plan,
        delegation_log_id,
      };
    }

    default: {
      console.warn("[llm-native-router] Unknown decision_type:", (decision as any).decision_type);
      return {
        message: language === "zh" ? "好的，让我看看。" : "Got it.",
        decision,
        routing_layer: "L0",
        decision_type: null,
        raw_manager_output: raw,
        delegation_log_id,
      };
    }
  }
}

// ── Test-only exports（仅供单元测试访问内部函数） ────────────────────────────────

/** @internal — 仅供测试使用 */
function tryParseV2Decision(text: string): Record<string, unknown> | null {
  try {
    const match =
      text.match(/```json\s*([\s\S]*?)\s*```/)?.[1] ??
      text.match(/```\s*([\s\S]*?)\s*```/)?.[1] ??
      text.match(/(\{[\s\S]*\})/)?.[1];
    if (!match) return null;
    return JSON.parse(match.trim());
  } catch {
    return null;
  }
}

export { tryParseV2Decision, parseGatedDecision };

