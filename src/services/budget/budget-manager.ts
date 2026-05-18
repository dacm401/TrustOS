// Sprint 64P: Budget Manager V0 - Local Preflight Cost Gate
//
// 目标：在每次 Worker/Manager 模型调用前执行预算检查
// - 事前估算成本（不是事后记账）
// - 超预算能拦截、降级或要求确认
// - 未知价格不装知道（不静默当作 0）
// - 所有决定进 ledger

import { calcActualCostEx } from "../../config/pricing.js";
import { findFallbackModel } from "./model-tiers.js";

// ── 预算 Action 类型 ─────────────────────────────────────────────────────────

export type BudgetAction =
  | "allow"
  | "downgrade_model"
  | "prefer_patch"
  | "ask_user_confirm"
  | "block";

// ── BudgetDecision 类型 ──────────────────────────────────────────────────────

export interface BudgetDecision {
  traceId: string;
  enabled: boolean;
  action: BudgetAction;
  reason: string;

  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number | null;
  pricingKnown: boolean;

  requestBudgetUsd: number;
  sessionBudgetUsd?: number;
  sessionSpentUsd?: number;
  remainingSessionBudgetUsd?: number;

  selectedModel: string;
  originalModel: string;
  downgraded: boolean;
  downgradeReason?: string;

  preferPatch: boolean;
  requiresUserConfirm: boolean;
  blocked: boolean;

  decisionMs: number;
}

// ── 输入类型 ─────────────────────────────────────────────────────────────────

export interface BudgetPreflightInput {
  traceId: string;
  route: string;
  contextPackage?: {
    kind: string;
    metrics?: {
      inputBytes?: number;
      artifactContentBytes?: number;
      estimatedInputTokens?: number;
    };
  };
  requestedModel: string;
  modelRole: "manager" | "worker";
  estimatedOutputTokens?: number;
  requestBudgetUsd?: number;
  sessionBudgetUsd?: number;
  sessionSpentUsd?: number;
  patchFirstEligible?: boolean;
}

// ── 默认预算常量（运行时读取，支持测试覆盖） ─────────────────────────────────

/** 单次请求默认预算（运行时读取 env，支持测试覆盖） */
function getDefaultRequestBudget(): number {
  return parseFloat(process.env.TRUSTOS_REQUEST_BUDGET_USD || "0.02");
}

/** 会话总预算（运行时读取 env，支持测试覆盖） */
function getDefaultSessionBudget(): number {
  return parseFloat(process.env.TRUSTOS_SESSION_BUDGET_USD || "0.20");
}

/** 未知定价时是否允许继续（运行时读取） */
function getAllowUnknownPricing(): boolean {
  return process.env.TRUSTOS_ALLOW_UNKNOWN_PRICING === "true";
}

/** Budget Manager 总开关（运行时读取） */
function getBudgetManagerEnabled(): boolean {
  return process.env.TRUSTOS_BUDGET_MANAGER_ENABLED !== "false";
}

// ── 主函数 ───────────────────────────────────────────────────────────────────

/**
 * Budget Preflight - 在 Worker/Manager LLM 调用前执行预算预检。
 *
 * 规则优先级（按顺序判断）：
 * 1. Budget Manager 未启用 -> allow
 * 2. pricingKnown=false -> ask_user_confirm (或 ALLOW_UNKNOWN_PRICING 时 allow)
 * 3. sessionBudget 剩余不足 -> block
 * 4. estimatedCostUsd <= requestBudgetUsd -> allow
 * 5. patchFirstEligible=true -> prefer_patch
 * 6. 有降级 model -> downgrade_model
 * 7. 超预算但 <= 2x -> ask_user_confirm
 * 8. 明显超预算 -> block
 */
export function runBudgetPreflight(
  input: BudgetPreflightInput
): BudgetDecision {
  const start = Date.now();

  const {
    traceId,
    route,
    contextPackage,
    requestedModel,
    modelRole,
    patchFirstEligible = false,
  } = input;

  const requestBudgetUsd =
    input.requestBudgetUsd ?? getDefaultRequestBudget();
  const sessionBudgetUsd =
    input.sessionBudgetUsd ?? getDefaultSessionBudget();
  const sessionSpentUsd = input.sessionSpentUsd ?? 0;
  const remainingSessionBudgetUsd = sessionBudgetUsd - sessionSpentUsd;

  // ── 规则 0: Budget Manager 未启用 ─────────────────────────────────────────
  if (!getBudgetManagerEnabled()) {
    return makeDecision({
      traceId, start, action: "allow", reason: "budget_manager_disabled",
      estimatedInputTokens: 0, estimatedOutputTokens: 0,
      estimatedCostUsd: null, pricingKnown: false,
      requestBudgetUsd, sessionBudgetUsd, sessionSpentUsd, remainingSessionBudgetUsd,
      selectedModel: requestedModel, originalModel: requestedModel,
      downgraded: false, preferPatch: false, requiresUserConfirm: false, blocked: false,
      enabled: false,
    });
  }

  // ── 估算 token ────────────────────────────────────────────────────────────
  // 优先使用 contextPackage 提供的 estimatedInputTokens
  // 否则从 inputBytes 推导（ceil(inputBytes / 4)）
  // 兜底：按 route 给默认值
  let estimatedInputTokens: number;
  if (contextPackage?.metrics?.estimatedInputTokens) {
    estimatedInputTokens = contextPackage.metrics.estimatedInputTokens;
  } else if (contextPackage?.metrics?.inputBytes) {
    estimatedInputTokens = Math.ceil(contextPackage.metrics.inputBytes / 4);
  } else {
    // 按 route 给默认估算
    estimatedInputTokens = defaultInputTokensByRoute(route, modelRole);
  }

  // 估算输出 token（按 route/role 区分）
  const estimatedOutputTokens =
    input.estimatedOutputTokens ?? defaultOutputTokensByRoute(route, modelRole, patchFirstEligible);

  // ── 计算估算成本 ──────────────────────────────────────────────────────────
  const costResult = calcActualCostEx(requestedModel, estimatedInputTokens, estimatedOutputTokens);
  const { estimatedCostUsd, pricingKnown } = costResult;

  // ── 规则 1: pricingKnown=false ────────────────────────────────────────────
  if (!pricingKnown) {
    if (getAllowUnknownPricing()) {
      return makeDecision({
        traceId, start, action: "allow",
        reason: `pricing unknown for model "${requestedModel}" but TRUSTOS_ALLOW_UNKNOWN_PRICING=true`,
        estimatedInputTokens, estimatedOutputTokens,
        estimatedCostUsd: null, pricingKnown: false,
        requestBudgetUsd, sessionBudgetUsd, sessionSpentUsd, remainingSessionBudgetUsd,
        selectedModel: requestedModel, originalModel: requestedModel,
        downgraded: false, preferPatch: false, requiresUserConfirm: false, blocked: false,
        enabled: true,
      });
    }
    return makeDecision({
      traceId, start, action: "ask_user_confirm",
      reason: `pricing unknown for model "${requestedModel}"; cannot estimate cost`,
      estimatedInputTokens, estimatedOutputTokens,
      estimatedCostUsd: null, pricingKnown: false,
      requestBudgetUsd, sessionBudgetUsd, sessionSpentUsd, remainingSessionBudgetUsd,
      selectedModel: requestedModel, originalModel: requestedModel,
      downgraded: false, preferPatch: false, requiresUserConfirm: true, blocked: false,
      enabled: true,
    });
  }

  const cost = estimatedCostUsd as number;

  // ── 规则 2: sessionBudget 剩余不足 ────────────────────────────────────────
  if (cost > remainingSessionBudgetUsd) {
    return makeDecision({
      traceId, start, action: "block",
      reason: `session budget exhausted: remaining $${remainingSessionBudgetUsd.toFixed(6)}, estimated $${cost.toFixed(6)}`,
      estimatedInputTokens, estimatedOutputTokens,
      estimatedCostUsd: cost, pricingKnown: true,
      requestBudgetUsd, sessionBudgetUsd, sessionSpentUsd, remainingSessionBudgetUsd,
      selectedModel: requestedModel, originalModel: requestedModel,
      downgraded: false, preferPatch: false, requiresUserConfirm: false, blocked: true,
      enabled: true,
    });
  }

  // ── 规则 3: 在 requestBudget 内 -> allow ──────────────────────────────────
  if (cost <= requestBudgetUsd) {
    return makeDecision({
      traceId, start, action: "allow",
      reason: `estimated $${cost.toFixed(6)} <= requestBudget $${requestBudgetUsd.toFixed(6)}`,
      estimatedInputTokens, estimatedOutputTokens,
      estimatedCostUsd: cost, pricingKnown: true,
      requestBudgetUsd, sessionBudgetUsd, sessionSpentUsd, remainingSessionBudgetUsd,
      selectedModel: requestedModel, originalModel: requestedModel,
      downgraded: false, preferPatch: false, requiresUserConfirm: false, blocked: false,
      enabled: true,
    });
  }

  // ── 超预算部分 ─────────────────────────────────────────────────────────────
  // 规则 4: patchFirstEligible -> prefer_patch
  if (patchFirstEligible) {
    return makeDecision({
      traceId, start, action: "prefer_patch",
      reason: `estimated $${cost.toFixed(6)} > budget $${requestBudgetUsd.toFixed(6)}, patch-first preferred to reduce cost`,
      estimatedInputTokens, estimatedOutputTokens,
      estimatedCostUsd: cost, pricingKnown: true,
      requestBudgetUsd, sessionBudgetUsd, sessionSpentUsd, remainingSessionBudgetUsd,
      selectedModel: requestedModel, originalModel: requestedModel,
      downgraded: false, preferPatch: true, requiresUserConfirm: false, blocked: false,
      enabled: true,
    });
  }

  // 规则 5: 有降级 model -> downgrade_model
  const fallback = findFallbackModel(requestedModel);
  if (fallback) {
    return makeDecision({
      traceId, start, action: "downgrade_model",
      reason: `estimated $${cost.toFixed(6)} > budget $${requestBudgetUsd.toFixed(6)}, downgrading from "${requestedModel}" to "${fallback}"`,
      estimatedInputTokens, estimatedOutputTokens,
      estimatedCostUsd: cost, pricingKnown: true,
      requestBudgetUsd, sessionBudgetUsd, sessionSpentUsd, remainingSessionBudgetUsd,
      selectedModel: fallback, originalModel: requestedModel,
      downgraded: true,
      downgradeReason: `cost $${cost.toFixed(6)} exceeds requestBudget $${requestBudgetUsd.toFixed(6)}`,
      preferPatch: false, requiresUserConfirm: false, blocked: false,
      enabled: true,
    });
  }

  // 规则 6: 超预算但 <= 2x -> ask_user_confirm
  if (cost <= requestBudgetUsd * 2) {
    return makeDecision({
      traceId, start, action: "ask_user_confirm",
      reason: `estimated $${cost.toFixed(6)} exceeds budget $${requestBudgetUsd.toFixed(6)} but within 2x, awaiting confirmation`,
      estimatedInputTokens, estimatedOutputTokens,
      estimatedCostUsd: cost, pricingKnown: true,
      requestBudgetUsd, sessionBudgetUsd, sessionSpentUsd, remainingSessionBudgetUsd,
      selectedModel: requestedModel, originalModel: requestedModel,
      downgraded: false, preferPatch: false, requiresUserConfirm: true, blocked: false,
      enabled: true,
    });
  }

  // 规则 7: 明显超预算 -> block
  return makeDecision({
    traceId, start, action: "block",
    reason: `estimated $${cost.toFixed(6)} significantly exceeds budget $${requestBudgetUsd.toFixed(6)} (> 2x)`,
    estimatedInputTokens, estimatedOutputTokens,
    estimatedCostUsd: cost, pricingKnown: true,
    requestBudgetUsd, sessionBudgetUsd, sessionSpentUsd, remainingSessionBudgetUsd,
    selectedModel: requestedModel, originalModel: requestedModel,
    downgraded: false, preferPatch: false, requiresUserConfirm: false, blocked: true,
    enabled: true,
  });
}

// ── 工具函数 ─────────────────────────────────────────────────────────────────

/** 按 route/role 推导默认输入 token 估算 */
function defaultInputTokensByRoute(route: string, modelRole: "manager" | "worker"): number {
  // Manager LLM fallback: 包含历史 + system prompt，估算较大
  if (modelRole === "manager") return 2000;
  // revision: artifact + brief + instruction，估算中等
  if (route === "direct_artifact_revision") return 1500;
  // create: 仅 instruction，估算较小
  if (route === "direct_create_artifact") return 800;
  // 兜底
  return 1200;
}

/** 按 route/role 推导默认输出 token 估算 */
function defaultOutputTokensByRoute(
  route: string,
  modelRole: "manager" | "worker",
  patchFirstEligible: boolean
): number {
  // Manager LLM fallback: 决策 JSON，估算较小
  if (modelRole === "manager") return 800;
  // revision patch: 仅 JSON patch，估算很小
  if (route === "direct_artifact_revision" && patchFirstEligible) return 300;
  // revision full rewrite: 完整 artifact，估算较大
  if (route === "direct_artifact_revision") return 1200;
  // create: 完整 artifact，估算大
  if (route === "direct_create_artifact") return 1500;
  // 兜底
  return 1200;
}

/** 构建 BudgetDecision 对象（填充 decisionMs） */
function makeDecision(fields: Omit<BudgetDecision, "decisionMs"> & { start: number }): BudgetDecision {
  const { start, ...rest } = fields;
  return {
    ...rest,
    decisionMs: Date.now() - start,
  };
}
