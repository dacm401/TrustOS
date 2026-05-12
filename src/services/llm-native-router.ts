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
import { DECISION_TO_LAYER, assertUnreachable } from "../types/index.js";
import { parseAndValidate } from "./decision-validator.js";
import { taskPlanner } from "./task-planner.js";
import { DelegationLogRepo } from "../db/repositories.js";
import { TaskArchiveRepo } from "../db/task-archive-repo.js";
import { loadManagerPrompt, getManagerPromptVersion } from "../prompts/loader.js";
import { circuitBreakers, CircuitBreakerError } from "./circuit-breaker.js";

// Phase 4: Permission Layer + Redaction imports (lazy loaded to avoid circular deps)
let phase4Module: typeof import("./phase4/index.js") | null = null;
async function getPhase4() {
  if (!phase4Module) phase4Module = await import("./phase4/index.js");
  return phase4Module;
}

// Task archive: module-level cache to avoid repeated dynamic imports per request
let taskArchiveModule: typeof import("../db/task-archive-repo.js") | null = null;
async function getTaskArchiveRepos() {
  if (!taskArchiveModule) taskArchiveModule = await import("../db/task-archive-repo.js");
  return taskArchiveModule;
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
  /** G2→G3 评分 gap（top1-top2），用于日志分析 */
  rerankGap: number;
  /** 最终用于路由的 action（可能经过 rerank） */
  routedAction: ManagerDecisionType;
  /** KB-1: 知识边界信号（可选，用于 trace/debug） */
  knowledgeBoundarySignals?: KnowledgeBoundarySignal[];
	  grayzone_shortcut?: string;
}

/**
 * Gated Delegation 完整流程：G1 → G2 → G3
 *
 * @param llmScores                 LLM 输出的各动作原始分数
 * @param llmConfidenceHint         LLM 自报置信度
 * @param features                  LLM 输出的结构化特征
 * @param knowledgeBoundarySignals   KB-1: 知识边界信号（可选）
 * @param estimatedTokens           GF-02: 预估 token 数（可选），用于 cost_penalty
 * @returns GatedDelegationContext（含所有中间结果，供 trace/debug/benchmark 使用）
 */
export function runGatedDelegation(
  llmScores: Record<ManagerDecisionType, number>,
  llmConfidenceHint: number,
  features: DecisionFeatures,
  knowledgeBoundarySignals?: KnowledgeBoundarySignal[],
  estimatedTokens?: number
): GatedDelegationContext {
  // G1: 计算 system_confidence（含 KB 知识边界校准）
  const systemConfidence = calculateSystemConfidence(
    llmScores,
    llmConfidenceHint,
    features,
    DEFAULT_GATING_CONFIG,
    knowledgeBoundarySignals
  );

  // G2: Policy 校准（含 KB 知识边界校准 + GF-02 cost_penalty）
  const calibrated: CalibratedDecision = calibrateWithPolicy(
    llmScores,
    features,
    DEFAULT_GATING_CONFIG,
    knowledgeBoundarySignals,
    estimatedTokens
  );

  // G3: 判断是否需要 rerank
  const { should: needsRerank, gap: rerankGap, grayzone_shortcut } = shouldRerank(
    calibrated.adjustedScores,
    systemConfidence,
    calibrated.finalAction,
    DEFAULT_GATING_CONFIG
  );
  let rerankResult: RerankResult | undefined;
  let routedAction = calibrated.finalAction;

  if (needsRerank) {
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
    rerankGap,
    grayzone_shortcut,
    // KB-1: 保留知识边界信号供 trace/debug 使用
    knowledgeBoundarySignals,
  };
}

// ── Manager Prompt ───────────────────────────────────────────────────────────
// Prompt content extracted to src/prompts/ — version controlled by MANAGER_PROMPT_VERSION env var.
export { buildManagerSystemPrompt, MANAGER_PROMPT_VERSION } from "../prompts/loader.js";
export { getManagerPromptVersion } from "../prompts/loader.js";

export interface LLMNativeRouterInput {
  message: string;
  user_id: string;
  session_id: string;
  /** 当前 session 内请求序号（用于 delegation_logs.turn_id） */
  turn_id: number;
  history: ChatMessage[];
  language: "zh" | "en";
  reqApiKey?: string;
  /** 前端透传：LLM API 地址，优先于 config.openaiBaseUrl */
  reqLlmBaseUrl?: string;
  /** 前端透传：优先于 config.fastModel */
  fastModel?: string;
  /** 前端透传：优先于 config.slowModel */
  slowModel?: string;
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
  const { message, user_id, session_id, turn_id, history, language, reqApiKey, reqLlmBaseUrl, fastModel, slowModel, crossSessionContext } = input;

  // P4: Learning Layer — 检索用户记忆，与 Manager 调用并行执行（节省 200-500ms）
  const memoryPromise = (async () => {
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
        return formatted.combined;
      }
      return undefined;
    } catch (e: any) {
      console.warn("[llm-native-router] Memory retrieval failed (fail-open):", e.message);
      return undefined;
    }
  })();

  // Step 1: 调用 Fast 模型（与 Memory 检索并行，节省总延迟）
  let managerOutput: string;
  let userMemories: string | undefined;
  try {
    [managerOutput, userMemories] = await Promise.all([
      callManagerModel({ message, history, language, reqApiKey, reqLlmBaseUrl, fastModel, crossSessionContext, userMemories: undefined }),
      memoryPromise,
    ]);
  } catch (e: any) {
    if (e instanceof CircuitBreakerError) {
      // 熔断：模型服务不可用，快速降级为 direct_answer，告知用户稍后重试
      console.warn(`[routeWithManagerDecision] Circuit breaker open, returning degraded direct_answer`);
      const retryMsg = e.retryAfter
        ? (language === "zh" ? `（约 ${e.retryAfter} 秒后自动恢复）` : ` (auto-recover in ~${e.retryAfter}s)`)
        : "";
      return {
        message: language === "zh"
          ? `⚡ 模型服务暂时不可用，请稍后重试。${retryMsg}`
          : `⚡ Model service temporarily unavailable, please retry shortly.${retryMsg}`,
        decision: null,
        routing_layer: "L0",
        decision_type: "direct_answer",
      };
    }
    throw e;
  }

  // Step 1.5 (KB-1): 检测知识边界信号
  // fail-open：检测异常不阻断主流程，只记录 warning
  let kbSignals: KnowledgeBoundarySignal[] | undefined;
  try {
    kbSignals = detectKnowledgeBoundarySignals(message, { locale: language });
  } catch (e: any) {
    console.warn("[llm-native-router] KB signal detection failed (fail-open):", e.message);
  }

  // Step 2: 解析 G1 多动作打分格式（manager_decision_v2）
  // Debug: 打印 Manager 原始输出，排查 parse 失败
  console.log(`[llm-native-router] [DEBUG] Manager output (first 600 chars):\n---\n${managerOutput.slice(0, 600)}\n---`);

  // Phase 3.2: parseGatedDecision 不再返回 null，schema_version 缺失/未知时直接 throw PROTOCOL_VIOLATION
  // GF-02: 估算 token 数（中文按 2chars/token，英文按 4chars/token 粗估；混合取 3chars/token）
  const estimatedTokens = Math.round(message.length / 3);
  let gatedResult: ReturnType<typeof parseGatedDecision>;
  try {
    gatedResult = parseGatedDecision(managerOutput, kbSignals, estimatedTokens);
  } catch (err: any) {
    // PROTOCOL_VIOLATION: 立刻失败，打结构化日志，不走 L0 fallback 拖超时
    if (err.code === "SCHEMA_VERSION_MISSING" || err.code === "SCHEMA_VERSION_UNKNOWN") {
      console.error(
        `[llm-native-router] 🔥 PROTOCOL_VIOLATION detected — code=${err.code}, textSnippet=${err.textSnippet?.slice(0, 200)}, matchedJson=${err.matchedJson?.slice(0, 200)}, jsonMatch=${err.jsonMatch}, bareMatch=${err.bareMatch}, braceMatch=${err.braceMatch}`
      );

      // Phase 3.2 修复：把错误写入 archive → SSE poller 能看到 failed 状态 → diagnose 脚本可诊断
      let failedArchiveId: string | undefined;
      try {
        const mockDecision = {
          schema_version: "manager_decision_v1" as const,
          decision_type: "direct_answer" as const,
          routing_layer: "L0" as const,
          reason: `PROTOCOL_VIOLATION: ${err.code} — ${err.message}`,
          confidence: 0,
          needs_archive: false,
          raw_output: managerOutput.slice(0, 500),
        };
        const archive = await TaskArchiveRepo.create({
          session_id: session_id ?? "unknown",
          user_id: user_id ?? "unknown",
          decision: mockDecision,
          user_input: message.slice(0, 200),
        });
        failedArchiveId = archive.id;
        await TaskArchiveRepo.updateState(archive.id, "failed");
        await TaskArchiveRepo.setSlowExecution(archive.id, {
          errors: [`${err.code}: ${err.message}`],
          protocol_violation: true,
          matched_json_len: err.braceMatch ?? 0,
        });
        console.log(`[llm-native-router] PROTOCOL_VIOLATION archive created: ${archive.id}, state=failed`);
      } catch (archiveErr: any) {
        console.error("[llm-native-router] Failed to create protocol violation archive:", archiveErr.message);
      }

      return {
        message: language === "zh"
          ? "⚠️ Manager 路由协议错误，请检查模型输出格式。"
          : "⚠️ Manager routing protocol error, please check model output format.",
        decision: null,
        routing_layer: "L0",
        decision_type: "direct_answer",
        raw_manager_output: managerOutput,
        delegation_log_id: undefined,
        archive_id: failedArchiveId,
      };
    }
    // 其他未知异常重新抛出
    throw err;
  }

  // Step 3: 不合法 → fallback，返回 L0 direct_answer
  if (!gatedResult) {
    console.warn("[llm-native-router] parseGatedDecision returned null, fallback to direct_answer");
    // 尝试旧 v1 格式作为 backward compatibility fallback
    const decision = parseAndValidate(managerOutput);
    if (decision) {
      return routeByDecision(decision, { message, user_id, session_id, language, reqApiKey, raw: managerOutput });
    }
    // Sprint 72 fix: LLM 有时返回截断/乱码 JSON，直接吐出 JSON 是错误的
    // 改为：使用 splitManagerOutput 提取人话回复
    console.warn("[llm-native-router] ManagerDecision parse failed, fallback to direct_answer");
    const parsedOutput = splitManagerOutput(managerOutput);
    return {
      message: parsedOutput.userFacingText || (language === "zh" ? "好的，让我看看。" : "Got it, let me check."),
      decision: null,
      routing_layer: "L0",
      decision_type: "direct_answer",
      raw_manager_output: managerOutput,
      delegation_log_id: undefined,
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

  // 检测模型意图与系统路由是否冲突：如果模型原本打算委派，但被降级了（且分数不够高，没触发上面的强制逻辑）
  // 此时必须调用 callDirectReplyModel 生成真实回复，不能只展示安抚语
  if (gatedResult.routedAction === "direct_answer") {
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
      rerank_gap: gatedResult.rerankGap ?? null,
      rerank_rules: gatedResult.rerankResult ? [gatedResult.rerankResult.reason ?? "reranked"] : [],
      g3_final_action: gatedResult.rerankResult ? gatedResult.routedAction : undefined,
      grayzone_shortcut: gatedResult.grayzone_shortcut ?? undefined,
      routed_action: "direct_answer",
      routing_reason: `Gated: direct_answer (sys_conf=${gatedResult.systemConfidence.toFixed(3)})`,
      routing_layer: "L0",
      selected_role: "fast",

    }).catch((e: Error) => console.error("[llm-native-router] delegation_log write FAILED (normal direct_answer):", e.message, e.stack));

    // R-08: 降级检测 — 模型原本打算委派，但被系统降为 direct_answer
    // 优先复用 parsedOutput.userFacingText（Text+JSON 模式下模型已生成人话回复）
    // 只有文本太短（可能是安抚占位语）时才发额外的 callDirectReplyModel
    const modelIntent = modelJson?.decision_type || "";
    const isDelegateIntent = modelIntent === "execute_task" || modelIntent === "delegate_to_slow";

    if (isDelegateIntent) {
      const SUBSTANTIVE_MIN_LEN = 30; // 短于此长度视为安抚占位语
      const hasSubstantiveText = parsedOutput.userFacingText.trim().length >= SUBSTANTIVE_MIN_LEN;

      if (hasSubstantiveText) {
        // 模型已经给出实质性回复，直接用，省一次 LLM 调用
        console.log(`[llm-native-router] Route downgrade detected: reusing Manager userFacingText (len=${parsedOutput.userFacingText.length})`);
        return {
          message: parsedOutput.userFacingText,
          decision: null,
          routing_layer: "L0",
          decision_type: "direct_answer",
          raw_manager_output: managerOutput,
          delegation_log_id: directAnswerLogId,
        };
      }

      // userFacingText 太短（安抚占位语），需要额外生成真实回复
      console.log("[llm-native-router] Route downgrade detected: userFacingText too short, generating real reply via callDirectReplyModel");
      const realReply = await callDirectReplyModel({
        message, history, language, reqApiKey, reqLlmBaseUrl, fastModel, crossSessionContext,
      });
      console.log(`[llm-native-router] Fallback reply generated, length: ${realReply.length}`);
      return {
        message: realReply,
        decision: null,
        routing_layer: "L0",
        decision_type: "direct_answer",
        raw_manager_output: managerOutput,
        delegation_log_id: directAnswerLogId,
      };
    }

    console.log("[llm-native-router] Direct answer, using Manager's single-call reply");
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
  /** 前端透传：LLM API 地址，优先于 config.openaiBaseUrl */
  reqLlmBaseUrl?: string;
  /** 前端透传：优先于 config.fastModel */
  fastModel?: string;
  /** Sprint 63: cross-session context */
  crossSessionContext?: string;
  /** P4: 用户记忆层 — 来自历史交互学习的行为偏好 */
  userMemories?: string;
}): Promise<string> {
  const { message, history, language, reqApiKey, reqLlmBaseUrl, fastModel, crossSessionContext, userMemories } = input;

  // 前端透传优先于环境变量
  const effectiveFastModel = fastModel || config.fastModel;
  const effectiveBaseUrl = reqLlmBaseUrl || config.openaiBaseUrl || undefined;

  const { prompt: systemPrompt } = await loadManagerPrompt(language, crossSessionContext, userMemories);
  // 保留最近 6 轮对话作为上下文，不传全量 history（Manager 只读当前任务）
  const recentHistory = history.filter((m) => m.role !== "system").slice(-6);

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...recentHistory,
    { role: "user", content: message },
  ];

  try {
    return await circuitBreakers.llm.execute(async () =>
      _callFastModel(effectiveFastModel, messages, effectiveBaseUrl, reqApiKey)
    );
  } catch (e: any) {
    if (e instanceof CircuitBreakerError) {
      const retryMsg = e.retryAfter ? ` (retry in ${e.retryAfter}s)` : "";
      console.warn(`[llm-native-router] Circuit breaker ${e.state}${retryMsg}, fast-failing Manager call`);
    } else {
      console.error("[llm-native-router] Manager model call failed:", e.message);
    }
    throw e;
  }
}

// ── Direct Reply 缓存（进程级）── R-08 修复
// 降级场景下同 message 不重复调用 LLM（模块级 Map，进程重启自动清空）
const _directReplyCache = new Map<string, Promise<string>>();
function _getDirectReplyCacheKey(message: string): string {
  // 用 message 前 200 字做 key
  return message.slice(0, 200);
}

// ── 共用 Fast Model 调用逻辑 ───────────────────────────────────────────────
/** 抽取 callManagerModel 与 callDirectReplyModel 的共用调用逻辑 */
async function _callFastModel(
  effectiveFastModel: string,
  messages: ChatMessage[],
  effectiveBaseUrl: string | undefined,
  reqApiKey: string | undefined
): Promise<string> {
  const hasAuthOverride = reqApiKey || effectiveBaseUrl;
  if (hasAuthOverride) {
    const resp = await callOpenAIWithOptions(
      effectiveFastModel,
      messages,
      reqApiKey || config.openaiApiKey || undefined,
      effectiveBaseUrl
    );
    return resp.content;
  }
  const resp = await callModelFull(effectiveFastModel, messages);
  return resp.content;
}

// ── 直接回答模型调用 (Direct Reply Model) ─────────────────────────────────
/**
 * Sprint 74: 专门用于生成直接回答（Direct Answer）的内容。
 * 当 Manager 决定委派但系统降级为直接回答时，调用此函数生成高质量回复。
 * 不使用 Manager Prompt（避免逻辑干扰），只使用通用的 System Prompt。
 */
async function callDirectReplyModel(input: {
  message: string;
  history: ChatMessage[];
  language: "zh" | "en";
  reqApiKey?: string;
  /** 前端透传：LLM API 地址，优先于 config.openaiBaseUrl */
  reqLlmBaseUrl?: string;
  /** 前端透传：优先于 config.fastModel */
  fastModel?: string;
  crossSessionContext?: string;
}): Promise<string> {
  const { message, history, language, reqApiKey, reqLlmBaseUrl, fastModel, crossSessionContext } = input;

  // R-08 修复：进程级缓存，避免同 message 重复调用
  const cacheKey = _getDirectReplyCacheKey(message);
  if (_directReplyCache.has(cacheKey)) {
    console.log(`[llm-native-router] [R-08] Direct reply cache hit for key=${cacheKey.slice(0, 80)}...`);
    return _directReplyCache.get(cacheKey)!;
  }

  // 前端透传优先于环境变量
  const effectiveFastModel = fastModel || config.fastModel;
  const effectiveBaseUrl = reqLlmBaseUrl || config.openaiBaseUrl || undefined;

  const systemPrompt = language === "zh"
    ? "你是一个智能助手。请直接、详细地回答用户的问题。"
    : "You are a smart assistant. Please answer the user's question directly and in detail.";

  const recentHistory = history.filter((m) => m.role !== "system").slice(-6);
  const userContent = crossSessionContext ? `${crossSessionContext}\n\n${message}` : message;

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...recentHistory,
    { role: "user", content: userContent },
  ];

  // R-08 修复：先缓存 Promise，再执行，避免并发重复调用
  const callPromise = _callFastModel(effectiveFastModel, messages, effectiveBaseUrl, reqApiKey)
    .catch((e: any) => {
      console.error("[llm-native-router] Direct reply model call failed:", e.message);
      throw e;
    });
  _directReplyCache.set(cacheKey, callPromise);
  return callPromise;
}

// ── Gated Delegation: 解析 v2 格式 ───────────────────────────────────────────

/**
 * Sprint 74: 将 Manager 的输出拆分为"用户可见文本"和"JSON 决策"
 * 格式: [Natural Language Reply]\n\n```json { ... } ```
 */
function splitManagerOutput(output: string): { userFacingText: string; jsonPart: string } {
  // 匹配 ```json 块
  const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/);

  let jsonPart: string;
  let userFacingText: string;

  if (jsonMatch) {
    jsonPart = jsonMatch[1];
    // 获取 JSON 之前的部分作为用户可见文本
    userFacingText = output.slice(0, jsonMatch.index).trim();
  } else {
    // 如果没有找到 ```json 块，从第一个 { 开始用括号计数找匹配的 }
    const firstBrace = output.indexOf("{");
    if (firstBrace === -1) {
      return { userFacingText: output.trim(), jsonPart: "" };
    }
    let depth = 0;
    let end = -1;
    for (let i = firstBrace; i < output.length; i++) {
      if (output[i] === "{") depth++;
      else if (output[i] === "}") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end > firstBrace) {
      jsonPart = output.slice(firstBrace, end + 1);
      userFacingText = output.slice(0, firstBrace).trim();
    } else {
      return { userFacingText: output.trim(), jsonPart: "" };
    }
  }

  // 如果前面没有自然语言文本，尝试从 JSON 的 direct_response.content 提取
  if (!userFacingText && jsonPart) {
    try {
      const parsed = JSON.parse(jsonPart);
      if (parsed.direct_response?.content) {
        userFacingText = parsed.direct_response.content.trim();
      }
    } catch {
      // ignore JSON parse errors
    }
  }

  return { userFacingText, jsonPart };
}

function parseGatedDecision(
  text: string,
  kbSignals?: KnowledgeBoundarySignal[],
  estimatedTokens?: number
): GatedDelegationContext | null {
  try {
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    const bareMatch = text.match(/```\s*([\s\S]*?)\s*```/);
    const braceMatch = text.match(/(\{[\s\S]*\})/);

    const match =
      jsonMatch?.[1] ??
      bareMatch?.[1] ??
      braceMatch?.[1];

    if (!match) return null;
    const raw = JSON.parse(match.trim());

    if (!raw.schema_version) {
      // Phase 3.2: 协议缺失 → 立刻失败，不降级拖到超时
      throw Object.assign(
        new Error("[parseGatedDecision] PROTOCOL_VIOLATION: schema_version missing"),
        {
          code: "SCHEMA_VERSION_MISSING",
          textSnippet: text.slice(0, 500),
          matchedJson: match.slice(0, 300),
          jsonMatch: !!jsonMatch,
          bareMatch: !!bareMatch,
          braceMatch: !!braceMatch,
        }
      );
    }

    // Sprint 72 fix: 同时接受 v1、v2、v3 和 v4 (v3/v4 为 Text+JSON 模式，v4 schema_version 必须为第一字段)
    if (!["manager_decision_v4", "manager_decision_v3", "manager_decision_v2", "manager_decision_v1"].includes(raw.schema_version)) {
      // Phase 3.2: 协议版本未知 → 立刻失败，不降级拖到超时
      throw Object.assign(
        new Error(`[parseGatedDecision] PROTOCOL_VIOLATION: unknown schema_version "${raw.schema_version}"`),
        {
          code: "SCHEMA_VERSION_UNKNOWN",
          schema_version: raw.schema_version,
          textSnippet: text.slice(0, 500),
          matchedJson: match.slice(0, 300),
        }
      );
    }

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

    // KB-1: 传入知识边界信号，供 G1/G2 校准使用；GF-02: 传入预估 token 数
    return runGatedDelegation(scores, llmConfidenceHint, features, kbSignals, estimatedTokens);
  } catch (e) {
    const err = e as Error & { code?: string };
    // 已知的协议异常（HIGH_SEVERITY）→ 重新抛出，交给外层处理
    if (err.code === "SCHEMA_VERSION_MISSING" || err.code === "SCHEMA_VERSION_UNKNOWN") throw e;
    // R-07: 结构化诊断日志 — 区分 JSON 解析错误与其他异常
    if (e instanceof SyntaxError) {
      console.warn("[parseGatedDecision] JSON parse failed:", {
        message: err.message,
        textSnippet: text.slice(0, 300),
      });
    } else {
      console.warn("[parseGatedDecision] unexpected error:", {
        type: (e as object)?.constructor?.name ?? "Unknown",
        message: err.message,
        textSnippet: text.slice(0, 300),
      });
    }
    return null;
  }
}

// P2 HITL: 歧义检测阈值（从 gating-config 读取，不再硬编码）
const ambiguityCfg = DEFAULT_GATING_CONFIG.ambiguity;

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

  const lowConfidence = llmConfidenceHint < ambiguityCfg.confidence_threshold;
  const closeScores = scoreGap < ambiguityCfg.score_gap_threshold;

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
          question_text: ((v2Decision?.clarification as { question_text?: string })?.question_text || ctx.userFacingText) ?? (language === "zh" ? "能再具体一点吗？" : "Could you be more specific?"),
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
    rerank_gap: gated.rerankGap ?? null,
    rerank_rules: gated.rerankResult ? [gated.rerankResult.reason ?? "reranked"].filter(Boolean) : [],
    g3_final_action: gated.rerankResult ? gated.routedAction : undefined,
    grayzone_shortcut: gated.grayzone_shortcut ?? undefined,
    routed_action: gated.routedAction,
    routing_reason: `Gated: ${gated.routedAction} (sys_conf=${gated.systemConfidence.toFixed(3)})`,
    // Sprint 68: 显式路由层，用于分层监控和 L2 灰度分析
    routing_layer: DECISION_TO_LAYER[gated.routedAction],
    selected_role: gated.routedAction === "delegate_to_slow" ? "slow" : "fast",
  }).catch((e: Error) => console.error("[delegation-log] write failed:", e.message));

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

// ─────────────────────────────────────────────────────────
// 共享 helper：Phase 4 权限层 + 脱敏
// ─────────────────────────────────────────────────────────
interface Phase4Result {
  processedCommand: CommandPayload | undefined;
  classification: InstanceType<ReturnType<typeof import("../phases/phase4/index.js").getPhase4>["DataClassifier"]>["classify"] extends (s: string, ctx: infer C) => infer R ? R : never;
  permission: InstanceType<ReturnType<typeof import("../phases/phase4/index.js").getPhase4>["PermissionChecker"]>;
}

async function runPhase4Guard(
  command: CommandPayload | undefined,
  session_id: string,
  user_id: string,
): Promise<Phase4Result | null> {
  if (!config.permission.enabled) return { processedCommand: command, classification: null as any, permission: null as any };

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

    // 拒绝 → 返回 null 通知调用方阻止分发
    if (!permission.allowed && permission.fallbackAction !== "redact") {
      return null;
    }

    let processedCommand = command;

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
          briefStats: redactedBrief.stats,
          workerHintStats: redactedWorkerHint.stats,
        });
      }
    }

    return { processedCommand, classification, permission };
  } catch (e: any) {
    console.warn("[llm-native-router] Phase 4 guard failed:", e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────
// 共享 helper：TaskArchive + TaskCommand 写入 + 事件
// ─────────────────────────────────────────────────────────
interface ArchiveCommandResult {
  archiveRecord: { id: string } | null;
  commandRecord: { id: string } | null;
}

async function writeTaskArchiveAndCommand(
  taskId: string,
  decision: ManagerDecision,
  message: string,
  processedCommand: CommandPayload | undefined,
  session_id: string,
  user_id: string,
  eventType: string,
  workerRole: string,
): Promise<ArchiveCommandResult> {
  let archiveRecord: { id: string } | null = null;
  let commandRecord: { id: string } | null = null;

  try {
    const { TaskArchiveRepo, TaskArchiveEventRepo } = await getTaskArchiveRepos();
    archiveRecord = await TaskArchiveRepo.create({
      task_id: taskId,
      user_id,
      session_id,
      decision,
      user_input: message,
      task_brief: processedCommand?.task_brief,
      goal: processedCommand?.goal,
    });
    await TaskArchiveEventRepo.create({
      archive_id: archiveRecord.id,
      task_id: taskId,
      event_type: "archive_created",
      payload: { decision_type: eventType, command_type: processedCommand?.command_type ?? eventType },
      actor: "fast_manager",
      user_id,
    });
  } catch (e: any) {
    console.error("[llm-native-router] TaskArchive create failed:", { error: e.message, taskId });
  }

  try {
    const { TaskCommandRepo, TaskArchiveEventRepo } = await getTaskArchiveRepos();
    if (processedCommand) {
      commandRecord = await TaskCommandRepo.create({
        task_id: taskId,
        archive_id: archiveRecord?.id ?? taskId,
        user_id,
        command_type: processedCommand.command_type,
        worker_hint: processedCommand.worker_hint,
        priority: processedCommand.priority ?? "normal",
        payload: processedCommand,
      });
      await TaskArchiveEventRepo.create({
        archive_id: archiveRecord?.id ?? taskId,
        task_id: taskId,
        event_type: "worker_started",
        payload: { worker_role: workerRole, command_id: commandRecord.id },
        actor: workerRole,
        user_id,
      });
    }
  } catch (e: any) {
    console.error("[llm-native-router] TaskCommand create failed:", { error: e.message, taskId });
  }

  return { archiveRecord, commandRecord };
}

async function routeByDecision(
  decision: ManagerDecision,
  ctx: RouteContext
): Promise<LLMNativeRouterResult> {
  const { message, user_id, session_id, language, reqApiKey, raw, delegation_log_id } = ctx;

  switch (decision.decision_type) {
    case "direct_answer": {
      const dr = decision.direct_response as DirectResponse | undefined;
      // 优先读 direct_response.content（v4），回退到 rationale（v3/v2/v1）
      const reply = dr?.content || (decision as unknown as { rationale?: string }).rationale || (language === "zh" ? "好的。" : "Got it.");
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
        const { TaskArchiveRepo, TaskArchiveEventRepo } = await getTaskArchiveRepos();
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

      // ── Sensitive Data Guard（信息分发红线）────────────────────────────────────
      const sensitiveResult = detectSensitiveData([message, command?.task_brief ?? ""].join(" "));
      if (sensitiveResult) {
        return {
          message: language === "zh"
            ? `⚠️ 检测到敏感数据 [${sensitiveResult.label}]，为保护您的信息，此请求不会发给云端模型。`
            : `⚠️ Sensitive data detected [${sensitiveResult.label}]. This request will not be sent to the cloud model.`,
          decision,
          decision_type: "delegate_to_slow",
          routing_layer: "L1",
          raw_manager_output: raw,
          delegation: { task_id: taskId, status: "blocked_by_sensitive_guard" },
        };
      }

      // Phase 4 权限层 + 脱敏（null = 拒绝暴露）
      const phase4Result = await runPhase4Guard(command, session_id, user_id);
      if (phase4Result === null) {
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

      // 写入 TaskArchive + TaskCommand
      const { archiveRecord, commandRecord } = await writeTaskArchiveAndCommand(
        taskId, decision, message, phase4Result.processedCommand,
        session_id, user_id, "delegate_to_slow", "slow_worker",
      );

      return {
        message: language === "zh"
          ? "这个问题比较深，我正在请更专业的模型帮你分析，稍等一下～"
          : "This is complex. I'm getting a more specialized model to analyze it, please wait...",
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

      // Phase 4 权限层 + 脱敏（execute_task 不拒绝，只脱敏）
      const phase4Result = await runPhase4Guard(command, session_id, user_id);
      if (phase4Result === null) {
        return {
          message: language === "zh" ? "无法处理此任务。" : "Unable to process this task.",
          decision,
          routing_layer: "L0",
          decision_type: "direct_answer",
          raw_manager_output: raw,
          delegation_log_id,
        };
      }

      // 写入 TaskArchive + TaskCommand
      const { archiveRecord, commandRecord } = await writeTaskArchiveAndCommand(
        taskId, decision, message, phase4Result.processedCommand,
        session_id, user_id, "execute_task", "execute_worker",
      );

      // TaskPlanner 生成执行计划
      let execution_plan;
      try {
        execution_plan = await taskPlanner.plan({
          taskId,
          goal: command?.goal ?? message,
          userId: user_id,
          sessionId: session_id,
          model: slowModel || config.slowModel,
        });
        console.log("[llm-native-router] execute_task: ExecutionPlan generated:", {
          taskId,
          steps: execution_plan.steps.length,
        });
      } catch (e: any) {
        console.warn("[llm-native-router] TaskPlanner.plan failed:", e.message);
      }

      return {
        message: language === "zh"
          ? "好的，正在处理这个任务，稍等一下～"
          : "Got it. Processing this task, please wait...",
        decision,
        delegation: { task_id: taskId, status: "triggered" },
        routing_layer: "L3",
        decision_type: "execute_task",
        raw_manager_output: raw,
        archive_id: archiveRecord?.id ?? taskId,
        command_id: commandRecord?.id,
        execution_plan,
        delegation_log_id,
      };
    }

    default: {
      // 编译期穷尽检查：如果 ManagerDecisionType 新增成员，TypeScript 会在这里报错
      return assertUnreachable(decision.decision_type, "routeByDecision");
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

