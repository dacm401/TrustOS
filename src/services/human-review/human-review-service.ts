/**
 * S77P: Human Review Queue V0 — Service Layer
 *
 * 核心逻辑：
 * - 从 Cycle 终态推断 reasonCode 和 severity
 * - 构建不含 raw content 的 audit 记录
 * - 调用 repo.create()
 */

import type { ContractVerificationResult } from "../task-contract/task-contract-types.js";
import type { TaskContractV0 } from "../task-contract/task-contract-types.js";
import type {
  HumanReviewReasonCode,
  HumanReviewResolutionEvent,
  HumanReviewSeverity,
  HumanReviewRequest,
  HumanReviewResolution,
  HumanReviewResumeDecision,
  HumanReviewResumeExecutionResult,
  ResumeExecutionStatus,
  ExecutedResumeAction,
  NextAction,
  ExecutionMode,
} from "./human-review-types.js";
import { HumanReviewRequestRepo } from "../../db/human-review-repo.js";
import { HumanReviewResumeDecisionRepo } from "../../db/human-review-decision-repo.js";
import { HumanReviewResumeExecutionRepo } from "../../db/human-review-execution-repo.js";
import type { CycleAudit } from "../cycle/cycle-runtime.js";

export interface CycleRunResult {
  finalContent: string;
  finalVerification: ContractVerificationResult | null;
  cycleAudit: CycleAudit;
}

// ── Severity Inference ─────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<HumanReviewSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  security: 4,
};

function inferSeverity(
  verification: ContractVerificationResult | null
): HumanReviewSeverity {
  if (!verification?.results?.length) return "medium";
  let maxSev: HumanReviewSeverity = "low";
  let maxRank = 0;
  for (const r of verification.results) {
    if (r.type === "human_review" && SEVERITY_RANK[r.severity] > maxRank) {
      maxSev = r.severity;
      maxRank = SEVERITY_RANK[r.severity];
    }
  }
  return maxSev;
}

// ── Reason Code Inference ─────────────────────────────────────────────────────

function inferReasonCode(
  verification: ContractVerificationResult | null,
  cycleAudit: CycleAudit
): HumanReviewReasonCode {
  if (verification?.hasSecurityFailure) return "security_sensitive";
  if (verification?.hasHumanReviewRequired) return "required_human_review";

  // 推断：从 finalStatus 和 steps 判断
  const hrSteps = cycleAudit.steps.filter(
    (s) => s.recommendedAction === "human_review"
  );
  if (hrSteps.some((s) => s.verificationResult?.hasSecurityFailure)) {
    return "security_sensitive";
  }
  if (hrSteps.some((s) => s.verificationResult?.hasHumanReviewRequired)) {
    return "required_human_review";
  }
  return "manual_escalation";
}

// ── Audit (safe, no raw content) ─────────────────────────────────────────────

function buildAudit(
  taskId: string,
  verification: ContractVerificationResult | null,
  riskLevel?: string
): HumanReviewRequest["audit"] {
  return {
    taskId,
    riskLevel,
    recommendedAction: "human_review",
    criteriaCount: verification?.criteriaEvaluated ?? 0,
    blockingIssues: verification?.blockingIssues ?? 0,
    hasSecurityIssue: verification?.hasSecurityFailure ?? false,
  };
}

// ── Core Function ─────────────────────────────────────────────────────────────

/**
 * 从 Cycle 运行结果构建 HumanReviewRequest 的创建参数。
 * 不创建 DB 记录（由调用方决定是否持久化）。
 */
export function buildHumanReviewRequestFromCycle(
  cycleResult: CycleRunResult,
  taskContract?: TaskContractV0
): Omit<HumanReviewRequest, "id" | "status" | "createdAt"> {
  const { finalVerification, cycleAudit } = cycleResult;

  const reasonCode = inferReasonCode(finalVerification, cycleAudit);
  const severity = inferSeverity(finalVerification);
  const riskLevel = taskContract?.riskLevel;

  return {
    taskId: cycleAudit.taskId,
    contractId: taskContract?.id,
    cycleIndex: cycleAudit.totalCycles,
    reasonCode,
    severity,
    audit: buildAudit(cycleAudit.taskId, finalVerification, riskLevel),
  };
}

/**
 * 在 DB 中创建 human_review 请求。
 * 幂等：若已存在则返回现有记录。
 */
export async function createHumanReviewRequestFromCycle(
  cycleResult: CycleRunResult,
  taskContract?: TaskContractV0
): Promise<HumanReviewRequest> {
  const params = buildHumanReviewRequestFromCycle(cycleResult, taskContract);
  return HumanReviewRequestRepo.create(params);
}

// ── S78P: Resolution ───────────────────────────────────────────────────────────

const ACTION_TO_STATUS: Record<HumanReviewResolution["action"], HumanReviewRequest["status"]> = {
  accept: "approved",
  revise: "needs_revision",
  rewrite: "needs_revision",
  block: "rejected",
};

/**
 * S78P: 处置一个 pending human review 请求。
 * V0：只做状态写入，不自动 resume Cycle（S79P 处理）。
 *
 * 语义：
 * - action=accept  → approved
 * - action=revise  → needs_revision
 * - action=rewrite → needs_revision
 * - action=block   → rejected
 *
 * throws: Error if request not found or not in pending state
 */
export async function resolveHumanReviewRequest(
  id: string,
  resolution: HumanReviewResolution
): Promise<HumanReviewRequest> {
  const existing = await HumanReviewRequestRepo.getById(id);
  if (!existing) {
    throw new Error(`HumanReviewRequest ${id} not found`);
  }
  if (existing.status !== "pending") {
    throw new Error(`HumanReviewRequest ${id} is not pending (current: ${existing.status})`);
  }

  const newStatus = ACTION_TO_STATUS[resolution.action];
  if (!newStatus) {
    throw new Error(`Invalid resolution action: ${resolution.action}`);
  }

  // repo.resolve() 支持 setStatus 参数，覆盖 action→status 映射
  return HumanReviewRequestRepo.resolve(id, resolution, newStatus);
}

/**
 * S78P: 构建 HumanReviewResolutionEvent。
 * 用于 SSE stream 和 Ledger audit extract。
 * 不泄漏 raw artifact/history/memory/criterion 文本。
 */
export function buildHumanReviewResolutionEvent(
  resolved: HumanReviewRequest,
  previousStatus: "pending"
): HumanReviewResolutionEvent {
  return {
    type: "human_review.resolved",
    requestId: resolved.id,
    taskId: resolved.audit.taskId,
    cycleIndex: resolved.cycleIndex,
    previousStatus,
    newStatus: resolved.status,
    action: resolved.resolution?.action ?? "accept",
    resolvedBy: resolved.resolution?.resolvedBy,
    resolvedAt: resolved.resolvedAt ?? new Date().toISOString(),
    reasonCode: resolved.reasonCode,
    severity: resolved.severity,
  };
}

// ── S79P: Resume Decision ────────────────────────────────────────────────────

/**
 * S79P: action+status → nextAction 映射。
 * V0 只做 decision，不自动执行 Cycle resume（后续 Sprint 处理）。
 */
const RESUME_ACTION_MAP: Record<string, { nextAction: NextAction; mode: ExecutionMode }> = {
  "approved|accept": { nextAction: "accept_final", mode: "queued" },
  "needs_revision|revise": { nextAction: "resume_with_revision", mode: "queued" },
  "needs_revision|rewrite": { nextAction: "resume_with_rewrite", mode: "queued" },
  "rejected|block": { nextAction: "block_final", mode: "blocked" },
};

/**
 * S79P: 将已处置的 HumanReviewRequest 转换为 Resume Decision。
 *
 * 语义：
 * - approved + accept → accept_final (交付)
 * - needs_revision + revise → resume_with_revision (继续 Cycle)
 * - needs_revision + rewrite → resume_with_rewrite (继续 Cycle)
 * - rejected + block → block_final (阻断)
 * - cancelled → cancel_task (取消)
 * - 未匹配 → no_action
 *
 * Security override:
 * - severity=security 或 hasSecurityIssue=true → executionMode=manual
 * - requiresOperatorConfirmation=true
 *
 * 不调用 runCycle()，不触发 Worker / Verifier。
 */
export function buildHumanReviewResumeDecision(
  request: HumanReviewRequest
): HumanReviewResumeDecision {
  if (request.status === "pending") {
    throw new Error(`Cannot build resume decision for pending request ${request.id}`);
  }

  const action = request.resolution?.action ?? null;
  const key = `${request.status}|${action ?? ""}`;
  const mapped = RESUME_ACTION_MAP[key] ?? null;

  let nextAction: NextAction;
  let executionMode: ExecutionMode;

  if (mapped) {
    nextAction = mapped.nextAction;
    executionMode = mapped.mode;
  } else if (request.status === "cancelled") {
    nextAction = "cancel_task";
    executionMode = "blocked";
  } else {
    nextAction = "no_action";
    executionMode = "blocked";
  }

  // Security override: 不改变 nextAction，只改变 executionMode
  const isSecuritySensitive =
    request.severity === "security" || request.audit.hasSecurityIssue;

  if (isSecuritySensitive) {
    executionMode = "manual";
  }

  return {
    id: `resume-${request.id}`,
    reviewRequestId: request.id,
    taskId: request.audit.taskId,
    createdAt: new Date().toISOString(),
    source: {
      reviewStatus: request.status,
      resolutionAction: action,
    },
    nextAction,
    executionMode,
    audit: {
      cycleIndex: request.cycleIndex,
      reasonCode: request.reasonCode,
      severity: request.severity,
      hasSecurityIssue: request.audit.hasSecurityIssue,
      requiresOperatorConfirmation: isSecuritySensitive,
    },
  };
}

// ── S80P: Resume Decision Persistence ────────────────────────────────────

/**
 * S80P: 创建或获取已持久化的 resume decision。
 *
 * 流程：
 * 1. 先尝试从 DB 读取已有 decision（幂等）
 * 2. 若不存在，调用 buildHumanReviewResumeDecision() 计算 + 持久化
 *
 * throws: Error if request is pending
 */
export async function createOrGetResumeDecision(
  request: HumanReviewRequest
): Promise<HumanReviewResumeDecision> {
  // 1. 幂等：先查已有
  const existing = await HumanReviewResumeDecisionRepo.getByReviewRequestId(request.id);
  if (existing) return existing;

  // 2. 计算 decision
  const decision = buildHumanReviewResumeDecision(request);

  // 3. 持久化（repo.create 本身也是幂等的）
  return HumanReviewResumeDecisionRepo.create(decision);
}

// ── S81P: Resume Execution ────────────────────────────────────────────────

/**
 * S81P: 根据 Resume Decision 构建执行结果。
 *
 * 执行策略：
 * 1. manual/security → requires_confirmation（不执行）
 * 2. resume_with_revision / resume_with_rewrite → unsupported（不执行）
 * 3. accept_final + queued → executed
 * 4. block_final + blocked → blocked
 * 5. cancel_task + blocked → blocked
 *
 * audit 域不含：
 * - raw artifact / history / memory
 * - criterion text/label/description/expected
 * - resolution.note（人工输入，不暴露到审计记录）
 *
 * 不调用 runCycle()、Worker、Verifier。
 */
export function buildHumanReviewResumeExecutionResult(
  decision: HumanReviewResumeDecision
): Omit<HumanReviewResumeExecutionResult, "id"> {
  const now = new Date().toISOString();

  // 优先级1：manual/security 需要确认
  if (decision.executionMode === "manual") {
    return {
      decisionId: decision.id,
      reviewRequestId: decision.reviewRequestId,
      taskId: decision.taskId,
      status: "requires_confirmation",
      executedAction: "none",
      createdAt: now,
      audit: {
        nextAction: decision.nextAction,
        executionMode: decision.executionMode,
        requiresOperatorConfirmation: decision.audit.requiresOperatorConfirmation,
        reasonCode: decision.audit.reasonCode,
        severity: decision.audit.severity,
      },
    };
  }

  // 优先级2：unsupported actions
  if (decision.nextAction === "resume_with_revision" || decision.nextAction === "resume_with_rewrite") {
    return {
      decisionId: decision.id,
      reviewRequestId: decision.reviewRequestId,
      taskId: decision.taskId,
      status: "unsupported",
      executedAction: "none",
      createdAt: now,
      audit: {
        nextAction: decision.nextAction,
        executionMode: decision.executionMode,
        requiresOperatorConfirmation: decision.audit.requiresOperatorConfirmation,
        reasonCode: decision.audit.reasonCode,
        severity: decision.audit.severity,
      },
    };
  }

  // 优先级3：terminal actions
  let status: ResumeExecutionStatus;
  let executedAction: ExecutedResumeAction;

  switch (decision.nextAction) {
    case "accept_final":
      status = "executed";
      executedAction = "accept_final";
      break;
    case "block_final":
      status = "blocked";
      executedAction = "block_final";
      break;
    case "cancel_task":
      status = "blocked";
      executedAction = "cancel_task";
      break;
    case "no_action":
    default:
      status = "unsupported";
      executedAction = "none";
      break;
  }

  return {
    decisionId: decision.id,
    reviewRequestId: decision.reviewRequestId,
    taskId: decision.taskId,
    status,
    executedAction,
    createdAt: now,
    executedAt: (status === "executed" || status === "blocked") ? now : undefined,
    audit: {
      nextAction: decision.nextAction,
      executionMode: decision.executionMode,
      requiresOperatorConfirmation: decision.audit.requiresOperatorConfirmation,
      reasonCode: decision.audit.reasonCode,
      severity: decision.audit.severity,
    },
  };
}

// ── S81P: Resume Execution Service ────────────────────────────────────────

export interface ExecutionError extends Error {
  code: "NOT_FOUND" | "REVIEW_MISMATCH" | "REQUIRES_CONFIRMATION" | "UNSUPPORTED";
}

/**
 * S81P: 创建或获取已持久化的 resume execution。
 *
 * 流程：
 * 1. 根据 decisionId 获取 persisted decision
 * 2. 如果不存在 → throw NOT_FOUND
 * 3. 校验 decision.reviewRequestId === reviewRequestId（审计链完整性）
 * 4. 先查 executionRepo.getByDecisionId（幂等）
 * 5. 如果存在 → return existing
 * 6. build execution result
 * 7. persist execution result
 * 8. return result
 *
 * 错误语义：
 * - NOT_FOUND: decision 不存在
 * - REVIEW_MISMATCH: review id 与 decision 不匹配
 * - REQUIRES_CONFIRMATION: manual 模式需要确认
 * - UNSUPPORTED: resume_with_revision / resume_with_rewrite
 *
 * 不调用 runCycle()、Worker、Verifier。
 */
export async function createOrGetResumeExecution(
  reviewRequestId: string,
  decisionId: string
): Promise<HumanReviewResumeExecutionResult> {
  // 1. 获取 persisted decision
  const decision = await HumanReviewResumeDecisionRepo.getById(decisionId);
  if (!decision) {
    const err = new Error(`ResumeDecision ${decisionId} not found`) as ExecutionError;
    err.code = "NOT_FOUND";
    throw err;
  }

  // 2. 校验 audit 链完整性
  if (decision.reviewRequestId !== reviewRequestId) {
    const err = new Error(
      `ResumeDecision ${decisionId} does not belong to HumanReviewRequest ${reviewRequestId}`
    ) as ExecutionError;
    err.code = "REVIEW_MISMATCH";
    throw err;
  }

  // 3. 幂等：先查已有 execution
  const existing = await HumanReviewResumeExecutionRepo.getByDecisionId(decisionId);
  if (existing) return existing;

  // 4. build execution result
  const result = buildHumanReviewResumeExecutionResult(decision);

  // 5. persist（repo.create 本身也是幂等的）
  return HumanReviewResumeExecutionRepo.create(result);
}
