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
  HumanReviewSeverity,
  HumanReviewRequest,
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
