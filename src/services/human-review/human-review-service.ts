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
} from "./human-review-types.js";
import { HumanReviewRequestRepo } from "../../db/human-review-repo.js";
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
