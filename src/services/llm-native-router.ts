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
import { callModelFull, callOpenAIWithOptionsTraced } from "../models/model-gateway.js";
import { countTokens } from "../models/token-counter.js";
import { calcActualCost, calcActualCostEx } from "../config/pricing.js";
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
import type {
  CallLedgerEntry,
  RequestLedger,
  SecurityScopeFlags,
} from "../types/call-ledger.js";
import { DECISION_TO_LAYER, assertUnreachable } from "../types/index.js";
import { parseAndValidate } from "./decision-validator.js";
import { taskPlanner } from "./task-planner.js";
import { DelegationLogRepo } from "../db/repositories.js";
import { TaskArchiveRepo, TaskCommandRepo, TaskArchiveEventRepo } from "../db/task-archive-repo.js";
import { loadManagerPrompt, getManagerPromptVersion } from "../prompts/loader.js";
import { circuitBreakers, CircuitBreakerError } from "./circuit-breaker.js";

// Phase 4: Permission Layer + Redaction imports (lazy loaded to avoid circular deps)
let phase4Module: typeof import("./phase4/index.js") | null = null;
async function getPhase4() {
  if (!phase4Module) phase4Module = await import("./phase4/index.js");
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
// Sprint 56: Artifact Revision Routing
import { applyArtifactRevisionRoutingGuard } from "./context/artifact-revision-intent.js";
import type { ActiveArtifactContext } from "./context/active-artifact.js";
import { extractActiveArtifactContext } from "./context/active-artifact.js";
// Sprint 60P: Execution Policy Layer
import { evaluateExecutionPolicy } from "./policy/execution-policy.js";
// Sprint 61P: ContextPackage
import { buildContextPackage } from "./context/context-package-builder.js";
import type { ContextPackageV1 } from "./context/context-package.js";
// Sprint 62P: Patch-first Revision
import { isPatchableSmallEdit } from "./patch/patchability.js";
// Sprint 63P: Local Manager Mode
import { runLocalManager, localManagerToLedgerExtract } from "./manager/local-manager-runtime.js";
// Sprint 64P: Budget Manager V0
import { runBudgetPreflight } from "./budget/budget-manager.js";
import type { BudgetDecision } from "./budget/budget-manager.js";
// Sprint 66P: Quality-aware Routing
import { evaluateQualityRouting, extractLastVerificationFromHistory } from "./verifier/quality-router.js";
import type { QualityRoutingDecision } from "./verifier/verifier-types.js";

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
  /** Sprint 56: 当前对话中最近的可修订 Worker 产物摘要（仅 id + brief，不含 artifact 原文） */
  activeArtifact?: ActiveArtifactContext;
  /**
   * Sprint 66P: 原始 history（包含完整的 worker artifact meta）。
   * 用于 quality-aware routing 从 meta.verification 提取上次 verification 结果。
   * 不经过 buildManagerView，保留完整的 verification 字段。
   */
  rawHistory?: Array<{ role: string; content?: string; meta?: Record<string, unknown> }>;
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
  /** Sprint 59P: Call Ledger — 本次请求的所有模型调用记录 */
  callLedger?: CallLedgerEntry[];
  /** Sprint 61P: ContextPackage — 运行时审计合同 */
  contextPackage?: ContextPackageV1;
  /** Sprint 59P: Request Ledger — 本次请求的汇总账本 */
  requestSummary?: RequestLedger;
}

// ── 主入口 ───────────────────────────────────────────────────────────────────

export async function routeWithManagerDecision(
  input: LLMNativeRouterInput
): Promise<LLMNativeRouterResult> {
  const { message, user_id, session_id, turn_id, history, language, reqApiKey, reqLlmBaseUrl, fastModel, slowModel, crossSessionContext, activeArtifact } = input;

  // Sprint 66P: 当 activeArtifact 未传入时（E2E 直接调 SSR 的场景），
  // 从 rawHistoryInput 提取，防止 artifactId=undefined 导致 quality routing 失效。
  // chat.ts 的正常流程已传 activeArtifact，此 fallback 只在直接调 SSR 时生效。
  const rawHistoryInput = (input as any).rawHistory;
  const effectiveActiveArtifact = activeArtifact ?? (rawHistoryInput?.length > 0
    ? extractActiveArtifactContext(rawHistoryInput as any)
    : undefined);

  // Sprint 59P: Call Ledger — 本次请求的所有模型调用记录
  const callLedger: CallLedgerEntry[] = [];
  const ledgerRequestStart = Date.now();
  const ledgerTraceId = uuid();

  // 快路径启发式判断
  const fastPathHeuristic = (() => {
    // 简单问候/常见短回复
    const trimmed = message.trim().toLowerCase();
    const greetings = ["hi", "hello", "你好", "早上好", "下午好", "晚上好", "好的", "谢谢", "thanks", "ok", "okay", "yes", "no", "是", "否", "好", "行", "嗯", "好的"];
    if (greetings.includes(trimmed) || trimmed.length <= 2) {
      return { couldHave: true, reason: "short_greeting_or_ack" };
    }
    // 纯确认性回复
    if (["很好", "可以", "不错", "继续"].includes(trimmed)) {
      return { couldHave: true, reason: "simple_acknowledgment" };
    }
    return { couldHave: false, reason: "sufficiently_complex" };
  })();

  // Sprint 60P: Execution Policy Layer — 规则先于 LLM 调用做决策
  const policyDecision = evaluateExecutionPolicy(message, effectiveActiveArtifact);
  console.log(`[execution-policy] route=${policyDecision.route}, managerRequired=${policyDecision.managerLlmRequired}, reason=${policyDecision.reason}`);

  // Sprint 66P: Quality-aware Routing — 从 history 提取上次 verification 结果
  // 优先从 artifact store 读取（chat.ts SSE done 后写入）
  // 回退从 rawHistory（不经过 buildManagerView）提取 meta.verification
  // 注意：history = managerView.messages，artifact 已被替换为 brief，不能用于 verification 查找
  // 注意：extractActiveArtifactContext 须从 rawHistoryInput 提取（managerView 过滤掉了 summaryForManager）
  // rawHistoryInput 已在函数开头声明（line 253）
  console.log(`[qr-router] rawHistory passed: ${rawHistoryInput ? rawHistoryInput.length + ' items' : 'NONE'}`);
  console.log(`[qr-router] activeArtifact: artifactId=${effectiveActiveArtifact?.artifactId}, summary=${effectiveActiveArtifact?.summaryForManager?.substring(0, 30)}`);
  if (rawHistoryInput && rawHistoryInput.length > 0) {
    const last = rawHistoryInput[rawHistoryInput.length - 1];
    console.log(`[qr-router] rawHistory last msg: role=${last.role}, origin=${(last.meta as any)?.origin}, kind=${(last.meta as any)?.contentKind}, hasVerif=${!!(last.meta as any)?.verification}`);
    // 也打印倒数第二条（assistant msg with artifact）
    for (let i = rawHistoryInput.length - 1; i >= 0; i--) {
      const m = rawHistoryInput[i];
      console.log(`[qr-router]   rawHistory[${i}]: role=${m.role}, origin=${(m.meta as any)?.origin}, kind=${(m.meta as any)?.contentKind}, hasVerif=${!!(m.meta as any)?.verification}`);
      if (m.role === 'assistant' && (m.meta as any)?.contentKind === 'artifact') break;
    }
  }
  const qrHistory = rawHistoryInput ?? history;
  const lastVerification = extractLastVerificationFromHistory(
    qrHistory as Array<{ role: string; content?: string; meta?: Record<string, unknown> }>,
    effectiveActiveArtifact?.artifactId,
  );
  const artifactIdForQuality = effectiveActiveArtifact?.artifactId ?? "unknown";
  const qualityRoutingDecision: QualityRoutingDecision = evaluateQualityRouting(artifactIdForQuality, lastVerification);
  console.log(`[quality-routing] decision=${qualityRoutingDecision.decision}, source=${qualityRoutingDecision.source}, lastScore=${qualityRoutingDecision.lastScore}`);

  // Sprint 63P: Local Manager Mode — 记录本地控制平面决策
  const localManagerDecision = runLocalManager({
    traceId: ledgerTraceId,
    userInstruction: message,
    activeArtifact: effectiveActiveArtifact,
    qualityRouting: qualityRoutingDecision,  // Sprint 66P: 传入质量路由决策
  });
  const localManagerExtract = localManagerToLedgerExtract(localManagerDecision);
  console.log(`[local-manager] enabled=true, mode=${localManagerDecision.managerMode}, nextAction=${localManagerDecision.nextAction}, managerLlmRequired=${localManagerDecision.managerLlmRequired}, decisionMs=${localManagerDecision.decisionMs}`);

  // Policy Context：贯穿本次请求，用于 ledger 和安全标记
  const policyCtx = {
    route: policyDecision.route,
    managerLlmBypassed: !policyDecision.managerLlmRequired,
    bypassReason: policyDecision.managerLlmRequired ? "policy_required_manager" : policyDecision.reason,
  };

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

  // ── Sprint 60P: Policy-first Bypass ─────────────────────────────────────────
  // 规则命中的任务绕过 Manager LLM，直接路由到 Worker（或直接返回）
  // 注意：Context Boundary 和 provenance 仍然执行，只是省掉 Manager LLM 思考

  // 路由 1: local_answer_from_meta — 不调任何模型
  if (policyDecision.route === "local_answer_from_meta") {
    const memory = await memoryPromise; // 等 memory，但不发到模型
    const localAnswer = memory
      ? `[本地元数据回答]\n\n${memory}\n\n（以上内容来自你的历史记忆，不是 AI 模型生成的回复）`
      : "我没有足够的历史数据来回答这个问题。请提供更多信息。";
    console.log(`[execution-policy] Bypass: local_answer_from_meta, returning local answer`);
    return withLedger({
      message: localAnswer,
      decision: null,
      routing_layer: "L0",
      decision_type: "direct_answer",
      delegation_log_id: undefined,
    }, {
      callLedger, startTime: ledgerRequestStart, traceId: ledgerTraceId,
      userId: user_id, sessionId: session_id, delegated: false, fastPathHeuristic,
      policyRoute: policyDecision.route, managerLlmBypassed: true, bypassReason: policyDecision.reason,
      localManagerExtract,
    }, {
      // Sprint 60P-H1: 按接收方拆分安全字段（local_answer_from_meta 纯本地）
      sentArtifactContentToManagerRemote: false,
      sentArtifactContentToWorkerRemote: false,
      sentRawHistoryToRemote: false,
      memoryWasRetrieved: memory !== undefined,
      memoryWasSentToManager: false,
      sensitiveMemoryWasSent: false,
      remoteContextBytesToManager: 0,
      remoteContextBytesToWorker: 0,
      artifactContentBytesToWorker: 0,
    });
  }

  // 路由 2 & 3: direct_artifact_revision / direct_create_artifact — 绕过 Manager LLM
  if (policyDecision.route === "direct_artifact_revision" || policyDecision.route === "direct_create_artifact") {
    const memory = await memoryPromise; // 等 memory，但不发到 Manager LLM

    // 构造 bypass 的 GatedDelegationContext（跳过 Manager LLM）
    // 评分：强推 delegate_to_slow，confidence = 1.0（规则确定性）
    const routedAction: ManagerDecisionType = "delegate_to_slow";
    const bypassGated: GatedDelegationContext = {
      llmScores: {
        direct_answer: 0,
        ask_clarification: 0,
        delegate_to_slow: 1.0,
        execute_task: 0,
      },
      llmConfidenceHint: 1.0,
      features: {
        missing_info: false,
        needs_long_reasoning: false,
        needs_external_tool: false,
        high_risk_action: false,
        query_too_vague: false,
        requires_multi_step: false,
        is_continuation: policyDecision.route === "direct_artifact_revision",
      },
      systemConfidence: 1.0,
      calibratedScores: {
        direct_answer: 0,
        ask_clarification: 0,
        delegate_to_slow: 1.0,
        execute_task: 0,
      },
      finalAction: routedAction,
      routedAction,
      policyOverrides: [{
        rule: "policy_bypass",
        action: "force",
        target: routedAction,
        original_score: 1.0,
        adjusted_score: 1.0,
        reason: `Execution Policy bypass: ${policyDecision.route}`,
      }],
      rerankResult: undefined,
      rerankGap: 0,
      grayzone_shortcut: undefined,
      knowledgeBoundarySignals: [],
    };

    // Sprint 56: revision guard 仍然执行（不能跳过安全边界）
    const revisionGuard = applyArtifactRevisionRoutingGuard({
      originalAction: routedAction,
      latestUserMessage: message,
      activeArtifact: effectiveActiveArtifact,
    });

    // Sprint 62P: 判定是否为可 patch 的小修订
    const patchDecision = (effectiveActiveArtifact && revisionGuard.artifactRevisionIntent && policyDecision.route === "direct_artifact_revision")
      ? isPatchableSmallEdit(message)
      : { patchable: false, reason: "not revision", confidence: 1.0 };
    console.log(`[patchability] patchable=${patchDecision.patchable}, reason="${patchDecision.reason}", confidence=${patchDecision.confidence}, patchMode=${patchDecision.patchMode}`);

    // 构造发给 Worker 的修订消息
    const gatedMessage = (effectiveActiveArtifact && revisionGuard.artifactRevisionIntent)
      ? (patchDecision.patchable
        ? `[Artifact Revision Task]\nArtifact ID: ${effectiveActiveArtifact.artifactId || "unknown"}\nTask ID: ${effectiveActiveArtifact.taskId || "unknown"}\nKnown summary: ${effectiveActiveArtifact.summaryForManager}\n\nUser instruction: ${message}\n\nThis is a SMALL EDIT. If possible, output the revised artifact as a JSON patch plan instead of the full content. Format:\n{\n  "patchId": "...",\n  "targetArtifactId": "${effectiveActiveArtifact.artifactId || "unknown"}",\n  "operations": [\n    { "op": "replace", "find": "target string", "replace": "replacement", "reason": "..." }\n  ],\n  "confidence": 0.85,\n  "fallbackToFullRewrite": false\n}\nIf the change is too complex for a patch, just output the full revised artifact as normal.`
        : `[Artifact Revision Task]\nArtifact ID: ${effectiveActiveArtifact.artifactId || "unknown"}\nTask ID: ${effectiveActiveArtifact.taskId || "unknown"}\nKnown summary: ${effectiveActiveArtifact.summaryForManager}\n\nUser instruction: ${message}\n\nImportant: This is a revision of an existing Worker artifact. Use the archived artifact as the source of truth. Return the revised complete artifact.`
      )
      : message;

    console.log(`[execution-policy] Bypass: ${policyDecision.route}, calling routeByGatedDecision directly (manager LLM skipped)`);

    // Sprint 64P: Budget Preflight — worker 调用前执行预算预检
    const workerModel = slowModel || config.slowModel;
    const bypassBudgetDecision = runBudgetPreflight({
      traceId: ledgerTraceId,
      route: policyDecision.route,
      requestedModel: workerModel,
      modelRole: "worker",
      patchFirstEligible: localManagerDecision.patchFirstEligible,
    });
    console.log(`[budget-preflight] action=${bypassBudgetDecision.action}, estimatedCostUsd=${bypassBudgetDecision.estimatedCostUsd}, pricingKnown=${bypassBudgetDecision.pricingKnown}, model=${bypassBudgetDecision.selectedModel}`);

    // 如果 budget 阻断，直接返回 friendly message（不调用 Worker）
    if (bypassBudgetDecision.blocked) {
      const memory = await memoryPromise;
      return withLedger({
        message: language === "zh"
          ? "这次操作预计成本过高，已被预算策略拦截。如需继续，请调整预算配置。"
          : "This operation is estimated to exceed the budget and has been blocked. Please adjust budget settings to continue.",
        decision: null,
        routing_layer: "L0",
        decision_type: "direct_answer",
        budgetDecision: bypassBudgetDecision,
      }, {
        callLedger, startTime: ledgerRequestStart, traceId: ledgerTraceId,
        userId: user_id, sessionId: session_id, delegated: false, fastPathHeuristic,
        policyRoute: policyDecision.route, managerLlmBypassed: true, bypassReason: policyDecision.reason,
        localManagerExtract,
        budgetDecision: bypassBudgetDecision,
      }, {
        sentArtifactContentToManagerRemote: false,
        sentArtifactContentToWorkerRemote: false,
        sentRawHistoryToRemote: false,
        memoryWasRetrieved: memory !== undefined,
        memoryWasSentToManager: false,
        sensitiveMemoryWasSent: false,
        remoteContextBytesToManager: 0,
        remoteContextBytesToWorker: 0,
        artifactContentBytesToWorker: 0,
      });
    }

    // ask_user_confirm: 返回确认请求（V0 不做前端弹窗，返回 friendly message）
    if (bypassBudgetDecision.requiresUserConfirm && !bypassBudgetDecision.blocked) {
      const memory = await memoryPromise;
      return withLedger({
        message: language === "zh"
          ? `这次操作预计会超过当前预算（$${bypassBudgetDecision.requestBudgetUsd.toFixed(4)}），需要确认后继续。如需继续，请重新发送请求。`
          : `This operation is estimated to exceed the current budget ($${bypassBudgetDecision.requestBudgetUsd.toFixed(4)}). Please confirm by re-sending the request.`,
        decision: null,
        routing_layer: "L0",
        decision_type: "direct_answer",
        budgetDecision: bypassBudgetDecision,
      }, {
        callLedger, startTime: ledgerRequestStart, traceId: ledgerTraceId,
        userId: user_id, sessionId: session_id, delegated: false, fastPathHeuristic,
        policyRoute: policyDecision.route, managerLlmBypassed: true, bypassReason: policyDecision.reason,
        localManagerExtract,
        budgetDecision: bypassBudgetDecision,
      }, {
        sentArtifactContentToManagerRemote: false,
        sentArtifactContentToWorkerRemote: false,
        sentRawHistoryToRemote: false,
        memoryWasRetrieved: memory !== undefined,
        memoryWasSentToManager: false,
        sensitiveMemoryWasSent: false,
        remoteContextBytesToManager: 0,
        remoteContextBytesToWorker: 0,
        artifactContentBytesToWorker: 0,
      });
    }

    const gatedRouteResult = await routeByGatedDecision(bypassGated, {
      message: gatedMessage,
      userFacingText: language === "zh" ? "好的，我来修改。" : "Got it, let me modify that.",
      user_id, session_id, turn_id, language, reqApiKey,
      rawOutput: `[Policy Bypass] ${policyDecision.route}: ${message}`,
      v2Decision: null,
      activeArtifact: effectiveActiveArtifact,
      artifactRevisionIntent: revisionGuard.artifactRevisionIntent,
      traceId: ledgerTraceId,
    });
    // 注入 budgetDecision（供 withLedger 使用）
    (gatedRouteResult as any).budgetDecision = bypassBudgetDecision;

    // Sprint 61P: build ContextPackage
    const cp = buildContextPackage({
      traceId: ledgerTraceId,
      policyRoute: policyCtx.route,
      userInstruction: message,
      activeArtifact: effectiveActiveArtifact ? {
        artifactId: effectiveActiveArtifact.artifactId,
        taskId: effectiveActiveArtifact.taskId,
        summaryForManager: effectiveActiveArtifact.summaryForManager,
        revisionOfArtifactId: effectiveActiveArtifact.revisionOfArtifactId,
        revisionOfTaskId: effectiveActiveArtifact.revisionOfTaskId,
      } : undefined,
      taskKind: policyDecision.route === "direct_artifact_revision" ? "revision" : "create",
      artifactContentBytes: effectiveActiveArtifact ? countTokens(gatedMessage) : 0,
      artifactContentMode: policyDecision.route === "direct_artifact_revision" ? "full" : "none",
      preferredOutputMode: patchDecision.patchable ? "patch" : "full",
    });
    gatedRouteResult.contextPackage = cp;

    const delegated = Boolean(gatedRouteResult.delegation && gatedRouteResult.delegation.status === "triggered");
    const sentArtifactContentToWorker = Boolean(effectiveActiveArtifact && revisionGuard.artifactRevisionIntent && delegated);

    return withLedger(gatedRouteResult, {
      callLedger, startTime: ledgerRequestStart, traceId: ledgerTraceId,
      userId: user_id, sessionId: session_id, delegated, fastPathHeuristic,
      policyRoute: policyDecision.route, managerLlmBypassed: true, bypassReason: policyDecision.reason,
      localManagerExtract,
      // Sprint 64P: Budget Manager — bypass 成功路径也传递 budgetDecision
      budgetDecision: bypassBudgetDecision,
      // Sprint 66P: Quality-aware Routing
      qualityRoutingDecision,
    }, {
      // Sprint 60P-H1: 按接收方拆分安全字段
      sentArtifactContentToManagerRemote: false, // bypass 路径不调 Manager
      sentArtifactContentToWorkerRemote: sentArtifactContentToWorker,
      sentRawHistoryToRemote: false,
      memoryWasRetrieved: memory !== undefined,
      memoryWasSentToManager: false, // Policy bypass 确保不发 memory 到 Manager
      sensitiveMemoryWasSent: false,
      remoteContextBytesToManager: 0,
      remoteContextBytesToWorker: sentArtifactContentToWorker ? countTokens(gatedMessage) : 0,
      artifactContentBytesToWorker: sentArtifactContentToWorker ? countTokens(gatedMessage) : 0,
    });
  }

  // Step 1: 调用 Fast 模型（与 Memory 检索并行，节省总延迟）
  // Sprint 64P: Manager LLM Preflight Budget Check
  const managerModel = fastModel || config.fastModel;
  const managerBudgetDecision = runBudgetPreflight({
    traceId: ledgerTraceId,
    route: policyDecision.route,
    requestedModel: managerModel,
    modelRole: "manager",
  });
  console.log(`[budget-preflight] manager: action=${managerBudgetDecision.action}, estimatedCostUsd=${managerBudgetDecision.estimatedCostUsd}, pricingKnown=${managerBudgetDecision.pricingKnown}`);

  // 如果 budget 阻断 manager 调用
  if (managerBudgetDecision.blocked) {
    return withLedger({
      message: language === "zh"
        ? "这次操作预计成本过高，已被预算策略拦截。如需继续，请调整预算配置。"
        : "This operation is estimated to exceed the budget and has been blocked. Please adjust budget settings to continue.",
      decision: null,
      routing_layer: "L0",
      decision_type: "direct_answer",
      budgetDecision: managerBudgetDecision,
    }, {
      callLedger, startTime: ledgerRequestStart, traceId: ledgerTraceId,
      userId: user_id, sessionId: session_id, delegated: false, fastPathHeuristic,
      policyRoute: policyDecision.route, managerLlmBypassed: true,
      bypassReason: "budget_blocked_manager",
      localManagerExtract,
      budgetDecision: managerBudgetDecision,
    }, {
      sentArtifactContentToManagerRemote: false, sentArtifactContentToWorkerRemote: false,
      sentRawHistoryToRemote: false, memoryWasRetrieved: false,
      memoryWasSentToManager: false, sensitiveMemoryWasSent: false,
      remoteContextBytesToManager: 0, remoteContextBytesToWorker: 0, artifactContentBytesToWorker: 0,
    });
  }

  if (managerBudgetDecision.requiresUserConfirm && !managerBudgetDecision.blocked) {
    return withLedger({
      message: language === "zh"
        ? `这次操作预计会超过当前预算（$${managerBudgetDecision.requestBudgetUsd.toFixed(4)}），需要确认后继续。如需继续，请重新发送请求。`
        : `This operation is estimated to exceed the current budget ($${managerBudgetDecision.requestBudgetUsd.toFixed(4)}). Please confirm by re-sending the request.`,
      decision: null,
      routing_layer: "L0",
      decision_type: "direct_answer",
      budgetDecision: managerBudgetDecision,
    }, {
      callLedger, startTime: ledgerRequestStart, traceId: ledgerTraceId,
      userId: user_id, sessionId: session_id, delegated: false, fastPathHeuristic,
      policyRoute: policyDecision.route, managerLlmBypassed: true,
      bypassReason: "budget_ask_user_confirm_manager",
      localManagerExtract,
      budgetDecision: managerBudgetDecision,
    }, {
      sentArtifactContentToManagerRemote: false, sentArtifactContentToWorkerRemote: false,
      sentRawHistoryToRemote: false, memoryWasRetrieved: false,
      memoryWasSentToManager: false, sensitiveMemoryWasSent: false,
      remoteContextBytesToManager: 0, remoteContextBytesToWorker: 0, artifactContentBytesToWorker: 0,
    });
  }

  let managerOutput: string;
  let userMemories: string | undefined;
  let managerCallLatencyMs = 0;
  let managerWasCircuitBroken = false;
  try {
    const managerCallStart = Date.now();
    [managerOutput, userMemories] = await Promise.all([
      callManagerModel({ message, history, language, reqApiKey, reqLlmBaseUrl, fastModel, crossSessionContext, userMemories: undefined }),
      memoryPromise,
    ]);
    managerCallLatencyMs = Date.now() - managerCallStart;

    // Sprint 59P: 记录 Manager 模型调用
    const managerInputTokens = estimateManagerInputTokens(message, history.filter((m) => m.role !== "system").slice(-6), crossSessionContext);
    const managerOutputTokens = countTokens(managerOutput);
    const effectiveModel = fastModel || config.fastModel;
    const managerCostResult = calcActualCostEx(effectiveModel, managerInputTokens, managerOutputTokens);
    callLedger.push({
      traceId: uuid(),
      modelRole: "manager",
      modelName: effectiveModel,
      inputTokens: managerInputTokens,
      outputTokens: managerOutputTokens,
      estimatedCost: managerCostResult.estimatedCostUsd,
      pricingKnown: managerCostResult.pricingKnown,
      pricingSource: managerCostResult.pricingSource,
      latencyMs: managerCallLatencyMs,
      startedAt: managerCallStart,
      completedAt: Date.now(),
      usedAuthOverride: Boolean(reqApiKey || reqLlmBaseUrl),
      wasCircuitBroken: false,
    });
  } catch (e: any) {
    if (e instanceof CircuitBreakerError) {
      managerWasCircuitBroken = true;
      // Sprint 59P: 记录熔断调用（token 为 0，成本为 null — 无实际调用发生）
      callLedger.push({
        traceId: uuid(),
        modelRole: "manager",
        modelName: fastModel || config.fastModel,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: null,
        pricingKnown: false,
        pricingSource: "unknown" as const,
        latencyMs: 0,
        startedAt: Date.now(),
        completedAt: Date.now(),
        usedAuthOverride: Boolean(reqApiKey || reqLlmBaseUrl),
        wasCircuitBroken: true,
      });
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
        callLedger,
        requestSummary: buildRequestLedger(
          ledgerTraceId, user_id, session_id, ledgerRequestStart, callLedger,
          "direct_answer", "L0", false,
          // Sprint 60P: 新安全字段（熔断时 memory 未发出）
          { sentArtifactContentToManagerRemote: false, sentArtifactContentToWorkerRemote: false, sentRawHistoryToRemote: false, memoryWasRetrieved: false, memoryWasSentToManager: false, sensitiveMemoryWasSent: false, remoteContextBytesToManager: 0, remoteContextBytesToWorker: 0, artifactContentBytesToWorker: 0 },
          { couldHave: false, reason: "circuit_broken_no_model_call" },
          // Sprint 60P: Policy Layer
          policyDecision.route,
          true, // managerLlmBypassed（熔断也算 bypass）
          "circuit_breaker_open",
        ),
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

      return withLedger({
        message: language === "zh"
          ? "⚠️ Manager 路由协议错误，请检查模型输出格式。"
          : "⚠️ Manager routing protocol error, please check model output format.",
        decision: null,
        routing_layer: "L0",
        decision_type: "direct_answer",
        raw_manager_output: managerOutput,
        delegation_log_id: undefined,
        archive_id: failedArchiveId,
      }, {
        callLedger, startTime: ledgerRequestStart, traceId: ledgerTraceId,
        userId: user_id, sessionId: session_id, delegated: false, fastPathHeuristic,
        policyRoute: policyDecision.route,
        managerLlmBypassed: false,
        bypassReason: "manager_llm_called_protocol_error",
        localManagerExtract,
        budgetDecision: managerBudgetDecision,
      });
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
      return withLedger(await routeByDecision(decision, { message, user_id, session_id, language, reqApiKey, raw: managerOutput }), {
        callLedger, startTime: ledgerRequestStart, traceId: ledgerTraceId,
        userId: user_id, sessionId: session_id, delegated: false, fastPathHeuristic,
        policyRoute: policyDecision.route,
        managerLlmBypassed: false,
        bypassReason: "manager_llm_called_parse_fallback",
        localManagerExtract,
        // Sprint 64P: Budget Manager（manager fallback 路径）
        budgetDecision: managerBudgetDecision,
      });
    }
    // Sprint 72 fix: LLM 有时返回截断/乱码 JSON，直接吐出 JSON 是错误的
    // 改为：使用 splitManagerOutput 提取人话回复
    console.warn("[llm-native-router] ManagerDecision parse failed, fallback to direct_answer");
    const parsedOutput = splitManagerOutput(managerOutput);
    return withLedger({
      message: parsedOutput.userFacingText || (language === "zh" ? "好的，让我看看。" : "Got it, let me check."),
      decision: null,
      routing_layer: "L0",
      decision_type: "direct_answer",
      raw_manager_output: managerOutput,
      delegation_log_id: undefined,
    }, {
      callLedger, startTime: ledgerRequestStart, traceId: ledgerTraceId,
      userId: user_id, sessionId: session_id, delegated: false, fastPathHeuristic,
      policyRoute: policyDecision.route,
      managerLlmBypassed: false,
      bypassReason: "manager_llm_called_json_parse_failed",
      localManagerExtract,
      // Sprint 64P: Budget Manager（manager fallback 路径）
      budgetDecision: managerBudgetDecision,
    });
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

  // ── Sprint 56: Artifact Revision Routing Guard ─────────────────────────
  // 如果存在 active artifact 且用户要求修改，Manager 不能 direct_answer
  // 因为 Manager 只有 brief 没有 artifact 原文，无法可靠地直接修改
  const revisionGuard = applyArtifactRevisionRoutingGuard({
    originalAction: gatedResult.routedAction,
    latestUserMessage: message,
    activeArtifact: effectiveActiveArtifact,
  });
  if (revisionGuard.overridden) {
    console.log("[artifact-revision-routing]", {
      activeArtifact: Boolean(effectiveActiveArtifact),
      activeArtifactId: effectiveActiveArtifact?.artifactId,
      artifactRevisionIntent: revisionGuard.artifactRevisionIntent,
      originalAction: gatedResult.routedAction,
      finalAction: revisionGuard.finalAction,
    });
    gatedResult.routedAction = revisionGuard.finalAction as ManagerDecisionType;
    gatedResult.finalAction = revisionGuard.finalAction as ManagerDecisionType;
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
        return withLedger({
          message: parsedOutput.userFacingText,
          decision: null,
          routing_layer: "L0",
          decision_type: "direct_answer",
          raw_manager_output: managerOutput,
          delegation_log_id: directAnswerLogId,
        }, {
          callLedger, startTime: ledgerRequestStart, traceId: ledgerTraceId,
          userId: user_id, sessionId: session_id, delegated: false, fastPathHeuristic,
          policyRoute: policyDecision.route,
          managerLlmBypassed: false,
          bypassReason: "manager_llm_called_direct_answer_reuse",
          localManagerExtract,
          // Sprint 64P: Budget Manager（manager route downgrade）
          budgetDecision: managerBudgetDecision,
        });
      }

      // userFacingText 太短（安抚占位语），需要额外生成真实回复
      console.log("[llm-native-router] Route downgrade detected: userFacingText too short, generating real reply via callDirectReplyModel");
      const directReplyStart = Date.now();
      const realReply = await callDirectReplyModel({
        message, history, language, reqApiKey, reqLlmBaseUrl, fastModel, crossSessionContext,
      });
      const directReplyLatencyMs = Date.now() - directReplyStart;
      // Sprint 59P: 记录 DirectReply 模型调用
      if (callLedger.length === 1) {
        const drInputTokens = estimateDirectReplyInputTokens(message, history.filter((m) => m.role !== "system").slice(-6), crossSessionContext);
        const drOutputTokens = countTokens(realReply);
        const effectiveModel = fastModel || config.fastModel;
        const drCostResult = calcActualCostEx(effectiveModel, drInputTokens, drOutputTokens);
        callLedger.push({
          traceId: uuid(),
          modelRole: "worker_direct_reply",
          modelName: effectiveModel,
          inputTokens: drInputTokens,
          outputTokens: drOutputTokens,
          estimatedCost: drCostResult.estimatedCostUsd,
          pricingKnown: drCostResult.pricingKnown,
          pricingSource: drCostResult.pricingSource,
          latencyMs: directReplyLatencyMs,
          startedAt: directReplyStart,
          completedAt: Date.now(),
          usedAuthOverride: Boolean(reqApiKey || reqLlmBaseUrl),
          wasCircuitBroken: false,
        });
      }
      console.log(`[llm-native-router] Fallback reply generated, length: ${realReply.length}`);
      return withLedger({
        message: realReply,
        decision: null,
        routing_layer: "L0",
        decision_type: "direct_answer",
        raw_manager_output: managerOutput,
        delegation_log_id: directAnswerLogId,
      }, {
        callLedger, startTime: ledgerRequestStart, traceId: ledgerTraceId,
        userId: user_id, sessionId: session_id, delegated: false, fastPathHeuristic,
        policyRoute: policyDecision.route,
        managerLlmBypassed: false,
        bypassReason: "manager_llm_called_direct_reply_fallback",
        localManagerExtract,
        // Sprint 64P: Budget Manager（manager route downgrade）
        budgetDecision: managerBudgetDecision,
      });
    }

    console.log("[llm-native-router] Direct answer, using Manager's single-call reply");
    return withLedger({
      message: parsedOutput.userFacingText || (language === "zh" ? "好的。" : "Got it."),
      decision: null,
      routing_layer: "L0",
      decision_type: "direct_answer",
      raw_manager_output: managerOutput,
      delegation_log_id: directAnswerLogId,
    }, {
      callLedger, startTime: ledgerRequestStart, traceId: ledgerTraceId,
      userId: user_id, sessionId: session_id, delegated: false, fastPathHeuristic,
      policyRoute: policyDecision.route,
      managerLlmBypassed: false,
      bypassReason: "manager_llm_called_direct_answer",
      localManagerExtract,
      // Sprint 64P: Budget Manager（manager route downgrade）
      budgetDecision: managerBudgetDecision,
    });
  }

  // 对于其他路由动作，使用"人话"作为安抚语，或根据 decision_type 构建澄清/任务消息
  // 这里我们将 parsedOutput.userFacingText 传入 routeByGatedDecision
  // Sprint 56: 如果有 active artifact 且检测到修订意图，注入修订指令到 message
  // 不论 LLM 是否自己选了 delegate（guard 可能没触发），都需要带 revision payload
  const gatedMessage = (effectiveActiveArtifact && revisionGuard.artifactRevisionIntent)
    ? `[Artifact Revision Task]\nArtifact ID: ${effectiveActiveArtifact.artifactId || "unknown"}\nTask ID: ${effectiveActiveArtifact.taskId || "unknown"}\nKnown summary: ${effectiveActiveArtifact.summaryForManager}\n\nUser instruction: ${message}\n\nImportant: This is a revision of an existing Worker artifact. Use the archived artifact as the source of truth. Return the revised complete artifact.`
    : (parsedOutput.userFacingText || message);
  const gatedRouteResult = await routeByGatedDecision(gatedResult, { 
      message: gatedMessage, 
      userFacingText: parsedOutput.userFacingText || gatedMessage,
      user_id, session_id, turn_id, language, reqApiKey, 
      rawOutput: managerOutput, v2Decision,
      activeArtifact: effectiveActiveArtifact,
      artifactRevisionIntent: revisionGuard.artifactRevisionIntent,
      traceId: ledgerTraceId,
  });

  // Sprint 59P: 计算安全范围标记
  const delegated = Boolean(gatedRouteResult.delegation && gatedRouteResult.delegation.status === "triggered");
  const sentArtifactContentToWorker = Boolean(effectiveActiveArtifact && revisionGuard.artifactRevisionIntent && delegated);

    // Sprint 61P: build ContextPackage
    const cp = buildContextPackage({
      traceId: ledgerTraceId,
      policyRoute: policyCtx.route,
      userInstruction: message,
      activeArtifact: effectiveActiveArtifact ? {
        artifactId: effectiveActiveArtifact.artifactId,
        taskId: effectiveActiveArtifact.taskId,
        summaryForManager: effectiveActiveArtifact.summaryForManager,
        revisionOfArtifactId: effectiveActiveArtifact.revisionOfArtifactId,
        revisionOfTaskId: effectiveActiveArtifact.revisionOfTaskId,
      } : undefined,
      taskKind: "manager_delegation",
      artifactContentBytes: sentArtifactContentToWorker ? countTokens(gatedMessage) : 0,
      artifactContentMode: sentArtifactContentToWorker ? "full" : "none",
    });
    gatedRouteResult.contextPackage = cp;

  return withLedger(gatedRouteResult, {
    callLedger, startTime: ledgerRequestStart, traceId: ledgerTraceId,
    userId: user_id, sessionId: session_id, delegated, fastPathHeuristic,
    // Sprint 60P: Policy Layer
    policyRoute: policyDecision.route,
    managerLlmBypassed: false, // Manager LLM 实际被调用了
    bypassReason: "policy_required_manager",
    localManagerExtract,
    // Sprint 64P: Budget Manager（manager fallback 路径）
    budgetDecision: managerBudgetDecision,
    // Sprint 66P: Quality-aware Routing
    qualityRoutingDecision,
  }, {
    // Sprint 60P-H1: 按接收方拆分安全字段
    sentArtifactContentToManagerRemote: false, // Context Boundary 确保 Manager 不收 artifact
    sentArtifactContentToWorkerRemote: sentArtifactContentToWorker,
    sentRawHistoryToRemote: false, // Context Boundary 确保 Manager 只有 filtered view
    memoryWasRetrieved: userMemories !== undefined,
    memoryWasSentToManager: false, // callManagerModel 传入 undefined
    sensitiveMemoryWasSent: false,
    remoteContextBytesToManager: countTokens(gatedMessage),
    remoteContextBytesToWorker: sentArtifactContentToWorker ? countTokens(gatedMessage) : 0,
    artifactContentBytesToWorker: 0, // Manager 路径不直接传 artifact
  });
}

// ── Fast Manager 调用 ─────────────────────────────────────────────────────────
// Sprint 59P: Call Ledger 辅助函数

/** 估算 Manager 模型调用的输入 token 数 */
function estimateManagerInputTokens(
  message: string,
  recentHistory: ChatMessage[],
  crossSessionContext?: string,
): number {
  let total = 0;
  // 系统 prompt 粗略估算（典型的 Manager Prompt 约 2000-4000 chars → 800-2000 tokens）
  total += 1200;
  // 跨会话上下文
  if (crossSessionContext) total += countTokens(crossSessionContext);
  // 历史消息（6 轮）
  for (const m of recentHistory) {
    total += countTokens(m.content);
  }
  // 当前消息
  total += countTokens(message);
  return total;
}

/** 估算 Direct Reply 模型调用的输入 token 数 */
function estimateDirectReplyInputTokens(
  message: string,
  recentHistory: ChatMessage[],
  crossSessionContext?: string,
): number {
  let total = 0;
  // DirectReply 使用简短系统 prompt
  total += 100;
  // 跨会话上下文
  if (crossSessionContext) total += countTokens(crossSessionContext);
  // 历史消息
  for (const m of recentHistory) {
    total += countTokens(m.content);
  }
  // 当前消息
  total += countTokens(message);
  return total;
}

/** 为任意 LLMNativeRouterResult 附加 callLedger + requestSummary */
function withLedger<T extends Partial<LLMNativeRouterResult & { callLedger?: CallLedgerEntry[]; requestSummary?: RequestLedger }>>(
  result: T,
  ctx: {
    callLedger: CallLedgerEntry[];
    startTime: number;
    traceId: string;
    userId: string;
    sessionId: string;
    delegated: boolean;
    fastPathHeuristic: { couldHave: boolean; reason: string };
    // Sprint 60P: Policy Layer
    policyRoute: import("../types/call-ledger.js").ExecutionPolicyRoute;
    managerLlmBypassed: boolean;
    bypassReason: string;
    // Sprint 63P: Local Manager
    localManagerExtract?: Record<string, unknown>;
    // Sprint 64P: Budget Manager
    budgetDecision?: BudgetDecision;
    // Sprint 66P: Quality-aware Routing
    qualityRoutingDecision?: QualityRoutingDecision;
  },
  securityFlags?: Partial<SecurityScopeFlags>,
): T & { callLedger: CallLedgerEntry[]; requestSummary: RequestLedger } {
  const resolvedFlags: SecurityScopeFlags = {
    // Sprint 60P-H1: 按接收方拆分安全字段
    sentArtifactContentToManagerRemote: securityFlags?.sentArtifactContentToManagerRemote ?? false,
    sentArtifactContentToWorkerRemote: securityFlags?.sentArtifactContentToWorkerRemote ?? false,
    sentRawHistoryToRemote: securityFlags?.sentRawHistoryToRemote ?? false,
    memoryWasRetrieved: securityFlags?.memoryWasRetrieved ?? false,
    memoryWasSentToManager: securityFlags?.memoryWasSentToManager ?? false,
    sensitiveMemoryWasSent: securityFlags?.sensitiveMemoryWasSent ?? false,
    remoteContextBytesToManager: securityFlags?.remoteContextBytesToManager ?? 0,
    remoteContextBytesToWorker: securityFlags?.remoteContextBytesToWorker ?? 0,
    artifactContentBytesToWorker: securityFlags?.artifactContentBytesToWorker ?? 0,
  };
  // Sprint 64P: budget 从 result 或 ctx 中提取
  const budgetDecision = ctx.budgetDecision ?? (result as any).budgetDecision;
  // Sprint 66P: quality routing 从 ctx 中提取
  const qualityRoutingDecision = ctx.qualityRoutingDecision;
  return {
    ...result,
    callLedger: ctx.callLedger,
    requestSummary: buildRequestLedger(
      ctx.traceId, ctx.userId, ctx.sessionId, ctx.startTime, ctx.callLedger,
      (result as any).decision_type || "unknown",
      (result as any).routing_layer || "L0",
      ctx.delegated,
      resolvedFlags,
      ctx.fastPathHeuristic,
      ctx.policyRoute,
      ctx.managerLlmBypassed,
      ctx.bypassReason,
      ctx.localManagerExtract,
      budgetDecision,
      qualityRoutingDecision,
    ),
  } as T & { callLedger: CallLedgerEntry[]; requestSummary: RequestLedger };
}

/** 构建 RequestLedger 汇总（在请求结束前调用） */
function buildRequestLedger(
  traceId: string,
  userId: string,
  sessionId: string,
  startTime: number,
  callLedger: CallLedgerEntry[],
  decisionType: string,
  routingLayer: string,
  delegated: boolean,
  securityFlags: SecurityScopeFlags,
  fastPathHeuristic: { couldHave: boolean; reason: string },
  // Sprint 60P: Policy Layer 字段
  policyRoute: import("../types/call-ledger.js").ExecutionPolicyRoute,
  managerLlmBypassed: boolean,
  bypassReason: string,
  // Sprint 63P: Local Manager 字段（可选）
  localManagerExtract?: Record<string, unknown>,
  // Sprint 64P: Budget Manager 字段（可选）
  budgetDecision?: BudgetDecision,
  // Sprint 66P: Quality-aware Routing 字段（可选）
  qualityRoutingDecision?: QualityRoutingDecision,
): RequestLedger {
  const totalLatencyMs = Date.now() - startTime;
  const totalInputTokens = callLedger.reduce((s, e) => s + e.inputTokens, 0);
  const totalOutputTokens = callLedger.reduce((s, e) => s + e.outputTokens, 0);
  // estimatedTotalCost：任一 entry 为 null（未知定价）则整体为 null，避免静默显示 0
  const estimatedTotalCost: number | null = callLedger.some((e) => e.estimatedCost === null)
    ? null
    : callLedger.reduce((s, e) => (s as number) + (e.estimatedCost as number), 0 as number);
  const managerModelCalls = callLedger.filter((e) => e.modelRole === "manager").length;
  const slowModelCalls = callLedger.filter((e) => e.modelRole === "worker").length;
  const workerModelCalls = callLedger.filter((e) => e.modelRole === "worker_direct_reply").length;
  const managerLatency = callLedger
    .filter((e) => e.modelRole === "manager")
    .reduce((s, e) => s + e.latencyMs, 0);
  const routerTaxRatio = totalLatencyMs > 0 ? managerLatency / totalLatencyMs : 0;

  return {
    traceId,
    userId,
    sessionId,
    totalLatencyMs,
    totalModelCalls: callLedger.length,
    managerModelCalls,
    slowModelCalls,
    workerModelCalls,
    totalInputTokens,
    totalOutputTokens,
    estimatedTotalCost,
    routerTaxRatio: Math.round(routerTaxRatio * 10000) / 10000,
    delegationAfterManager: delegated,
    securityScope: securityFlags,
    policyRoute, // Sprint 60P
    managerLlmBypassed, // Sprint 60P
    bypassReason, // Sprint 60P
    // Sprint 63P: Local Manager 字段（可选）
    localManager: localManagerExtract ? {
      enabled: localManagerExtract.enabled as boolean,
      mode: localManagerExtract.mode as string,
      policyRoute: localManagerExtract.policyRoute as string,
      managerLlmRequired: localManagerExtract.managerLlmRequired as boolean,
      managerLlmBypassed: localManagerExtract.managerLlmBypassed as boolean,
      nextAction: localManagerExtract.nextAction as string,
      patchFirstEligible: localManagerExtract.patchFirstEligible as boolean | undefined,
      effectivePatchFirstEligible: localManagerExtract.effectivePatchFirstEligible as boolean | undefined,
      patchFirstBefore: localManagerExtract.patchFirstBefore as boolean | undefined,
      patchFirstDegradedByWarning: localManagerExtract.patchFirstDegradedByWarning as boolean | undefined,
      patchFirstWarningAdvisory: localManagerExtract.patchFirstWarningAdvisory as boolean | undefined,
      patchFirstDowngradedByQuality: localManagerExtract.patchFirstDowngradedByQuality as boolean | undefined,
      patchFirstHardDowngrade: localManagerExtract.patchFirstHardDowngrade as boolean | undefined,
      decisionMs: localManagerExtract.decisionMs as number,
    } : undefined,
    // Sprint 64P: Budget Manager 字段（可选）
    budget: budgetDecision ? {
      enabled: budgetDecision.enabled,
      action: budgetDecision.action,
      reason: budgetDecision.reason,
      estimatedInputTokens: budgetDecision.estimatedInputTokens,
      estimatedOutputTokens: budgetDecision.estimatedOutputTokens,
      estimatedCostUsd: budgetDecision.estimatedCostUsd,
      pricingKnown: budgetDecision.pricingKnown,
      requestBudgetUsd: budgetDecision.requestBudgetUsd,
      sessionBudgetUsd: budgetDecision.sessionBudgetUsd,
      sessionSpentUsd: budgetDecision.sessionSpentUsd,
      remainingSessionBudgetUsd: budgetDecision.remainingSessionBudgetUsd,
      originalModel: budgetDecision.originalModel,
      selectedModel: budgetDecision.selectedModel,
      downgraded: budgetDecision.downgraded,
      preferPatch: budgetDecision.preferPatch,
      requiresUserConfirm: budgetDecision.requiresUserConfirm,
      blocked: budgetDecision.blocked,
      decisionMs: budgetDecision.decisionMs,
    } : undefined,
    // Sprint 66P: Quality-aware Routing 字段（可选）
    // S68P: patchQuality 归位到 qualityRouting.patchQuality（质量信号的权威域）
    qualityRouting: qualityRoutingDecision ? {
      enabled: qualityRoutingDecision.enabled,
      source: qualityRoutingDecision.source,
      lastScore: qualityRoutingDecision.lastScore,
      decision: qualityRoutingDecision.decision,
      reason: qualityRoutingDecision.reason,
      decisionMs: qualityRoutingDecision.decisionMs,
      // S68P: patch-first 质量信号归位到 qualityRouting
      patchQuality: localManagerExtract ? {
        before: localManagerExtract.patchFirstBefore as boolean,
        after: localManagerExtract.effectivePatchFirstEligible as boolean,
        warningAdvisory: localManagerExtract.patchFirstWarningAdvisory as boolean | undefined,
        hardDowngrade: localManagerExtract.patchFirstHardDowngrade as boolean | undefined,
        degradeReason: (() => {
          const degraded = localManagerExtract.patchFirstHardDowngrade;
          const warned = localManagerExtract.patchFirstWarningAdvisory;
          if (degraded) return `hard downgrade: ${qualityRoutingDecision.decision}`;
          if (warned) return `advisory warning: ${qualityRoutingDecision.decision}`;
          return undefined;
        })(),
      } : undefined,
    } : undefined,
    decisionType: decisionType || "unknown",
    routingLayer: routingLayer || "L0",
    entries: callLedger,
    fastPathHeuristic: fastPathHeuristic ? {
      couldHaveUsedFastPath: fastPathHeuristic.couldHave,
      reason: fastPathHeuristic.reason,
    } : undefined,
  };
}

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
    const resp = await callOpenAIWithOptionsTraced(
      effectiveFastModel,
      messages,
      reqApiKey || config.openaiApiKey || undefined,
      effectiveBaseUrl,
      undefined,
      "manager"
    );
    return resp.content;
  }
  const resp = await callModelFull(effectiveFastModel, messages, undefined, "manager");
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
    // 已知的协议异常 → 重新抛出，交给外层统一处理
    if (err.code === "SCHEMA_VERSION_MISSING" || err.code === "SCHEMA_VERSION_UNKNOWN") throw e;
    // R-07: JSON 解析失败和其他未知异常都视为协议违规，统一抛出
    const isSyntax = e instanceof SyntaxError;
    console.warn(`[parseGatedDecision] ${isSyntax ? "JSON parse failed" : "unexpected error"}:`, {
      type: isSyntax ? "SyntaxError" : ((e as object)?.constructor?.name ?? "Unknown"),
      message: err.message,
      textSnippet: text.slice(0, 300),
    });
    throw Object.assign(
      new Error(`[parseGatedDecision] PROTOCOL_VIOLATION: ${isSyntax ? "JSON parse failed" : err.message}`),
      {
        code: "PROTOCOL_VIOLATION",
        textSnippet: text.slice(0, 500),
        matchedJson: null,
        jsonMatch: false,
        bareMatch: false,
        braceMatch: false,
      }
    );
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
  /** Sprint 57: artifact revision routing */
  activeArtifact?: ActiveArtifactContext;
  artifactRevisionIntent?: boolean;
  /** Sprint 60P-H1: trace ID，用于关联 request ledger 与 worker ledger */
  traceId?: string;
}

async function routeByGatedDecision(
  gated: GatedDelegationContext,
  ctx: GatedRouteContext
): Promise<LLMNativeRouterResult> {
  const { message, user_id, session_id, turn_id, task_id, language, reqApiKey, rawOutput, v2Decision, traceId } = ctx;

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
          // Sprint 57: activeArtifact + revisionIntent 时用结构化消息强制覆盖 task_brief
          task_brief: (ctx.activeArtifact && ctx.artifactRevisionIntent)
            ? message
            : ((v2Decision?.command as { task_brief?: string })?.task_brief ?? message.substring(0, 200)),
          goal: (ctx.activeArtifact && ctx.artifactRevisionIntent)
            ? message
            : ((v2Decision?.command as { task_brief?: string })?.task_brief ?? message),
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

  // 按最终路由动作分发，携带 delegation_log_id 和 traceId 供 SSE 异步回写使用
  return routeByDecision(decision, { ...ctx, raw: rawOutput, delegation_log_id, traceId });
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
  /** Sprint 60P-H1: trace ID，用于关联 request ledger 与 worker ledger */
  traceId?: string;
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
  traceId: string,
): Promise<ArchiveCommandResult> {
  let archiveRecord: { id: string } | null = null;
  let commandRecord: { id: string } | null = null;

  try {
    archiveRecord = await TaskArchiveRepo.create({
      task_id: taskId,
      user_id,
      session_id,
      decision,
      user_input: message,
      task_brief: processedCommand?.task_brief,
      goal: processedCommand?.goal,
      // Sprint 60P-H1: 存入 slow_execution，供 slow-worker-loop 读取 traceId
      slow_execution: { traceId },
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
  const { message, user_id, session_id, language, reqApiKey, raw, delegation_log_id, traceId } = ctx;

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
      // SD-01: 检查点在 routeByDecision（而非 G2）——因为需要原始文本（message + task_brief），
      // 而 G1/G2/G3 只有分数和特征。此处在 archive 写入前拦截，确保敏感数据不落盘不发云端。
      const sensitiveResult = detectSensitiveData([message, command?.task_brief ?? ""].join(" "));
      if (sensitiveResult) {
        console.warn(`[llm-native-router] Sensitive data guard BLOCKED delegation: type=${sensitiveResult.type}, label=${sensitiveResult.label}`);
        return {
          message: language === "zh"
            ? `⚠️ 检测到敏感数据 [${sensitiveResult.label}]，为保护您的信息，此请求不会发给云端模型。`
            : `⚠️ Sensitive data detected [${sensitiveResult.label}]. This request will not be sent to the cloud model.`,
          decision,
          decision_type: "delegate_to_slow",
          routing_layer: "L1",
          raw_manager_output: raw,
          delegation: { task_id: taskId, status: "blocked_by_sensitive_guard" },
          delegation_log_id,
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
        traceId ?? taskId, // 用 traceId 或 taskId 作为 fallback
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

      // SD-01: execute_task 也需要敏感数据检查（工具执行可能暴露数据给外部服务）
      const sensitiveResultExec = detectSensitiveData([message, command?.task_brief ?? ""].join(" "));
      if (sensitiveResultExec) {
        console.warn(`[llm-native-router] Sensitive data guard BLOCKED execute_task: type=${sensitiveResultExec.type}, label=${sensitiveResultExec.label}`);
        return {
          message: language === "zh"
            ? `⚠️ 检测到敏感数据 [${sensitiveResultExec.label}]，为保护您的信息，此任务不会执行。`
            : `⚠️ Sensitive data detected [${sensitiveResultExec.label}]. This task will not be executed.`,
          decision,
          decision_type: "execute_task",
          routing_layer: "L1",
          raw_manager_output: raw,
          delegation: { task_id: taskId, status: "blocked_by_sensitive_guard" },
          delegation_log_id,
        };
      }

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
        traceId ?? taskId, // 用 traceId 或 taskId 作为 fallback
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

