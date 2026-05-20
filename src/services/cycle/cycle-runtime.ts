/**
 * Sprint 75P: Cycle Runtime V0 — Cycle Execution Engine
 *
 * 把 S74P 的 Contract-aware Verifier 接入 Worker 执行周期。
 *
 * 设计原则：
 * - recommendedAction 由 verifyAgainstCriteria 产出，不驱动 qualityRouting
 * - revision 注入错误信息给 Worker，rewrite 触发全新 Worker call
 * - maxCycles 从 budgetPolicy 读取，防止无限重试
 * - block / human_review 是终态，不重试
 *
 * Non-goals（S75P）：
 * - 不发 SSE cycle 事件（留 S76P）
 * - 不接人工审核队列（留 S77P）
 * - 不改 qualityRouting.decision（proof pyramid 保护）
 */

import { v4 as uuid } from "uuid";

import type {
  TaskContractV0,
  VerificationCriterion,
  ContractVerificationResult,
  CriterionVerificationResult,
  RecommendedAction,
  BudgetPolicy,
} from "../task-contract/task-contract-types.js";

import type {
  ArtifactVerifierInput,
} from "../verifier/artifact-verifier.js";

import { verifyArtifact } from "../verifier/artifact-verifier.js";
import { verifyAgainstCriteria } from "../verifier/contract-verifier.js";
import { buildContractVerificationAudit } from "../verifier/contract-verifier.js";

// ── Cycle Audit Types ────────────────────────────────────────────────────────

export interface CycleStepAudit {
  /** 本轮序号（从 1 开始） */
  cycleIndex: number;
  /** 本轮验证结果（可 null，表示未到验证阶段就中断了） */
  verificationResult: ContractVerificationResult | null;
  /** 建议的行动 */
  recommendedAction: RecommendedAction;
  /** 本轮实际内容长度（字符） */
  contentLength: number;
  /** 本轮是否触发了 Worker 重调用 */
  workerCalled: boolean;
}

/**
 * Cycle 执行审计记录。
 * 写入 Ledger / SSE done 事件。
 */
export interface CycleAudit {
  /** 任务 ID */
  taskId: string;
  /** 总共运行的 cycle 数 */
  totalCycles: number;
  /** budgetPolicy 规定的最大 cycle 数 */
  maxCycles: number;
  /** 最终交付状态 */
  finalStatus: "accepted" | "revised" | "rewritten" | "blocked" | "human_review" | "max_cycles_exceeded";
  /** 最终 recommendedAction */
  finalRecommendedAction: RecommendedAction;
  /** 每轮审计记录 */
  steps: CycleStepAudit[];
  /** 总耗时（毫秒） */
  totalMs: number;
}

// ── Cycle Input ─────────────────────────────────────────────────────────────

export interface CycleInput {
  /** 关联 trace/task ID */
  taskId: string;
  /** 当前活跃 artifact ID（用于 lineage） */
  activeArtifactId?: string;
  /** 上一轮 artifact revision source */
  revisionOfArtifactId?: string;
  /** TaskContract（用于 criteria） */
  taskContract: TaskContractV0;
  /** 初始 Worker content（第一轮验证用） */
  initialContent: string;
  /** artifact 类型 */
  artifactType?: string;
  /** 是否 patch 模式 */
  patchApplied?: boolean;
  /** security flags（Worker → Manager 方向） */
  security: ArtifactVerifierInput["security"];
  /** 执行 Worker call 的函数（由调用方注入） */
  executeWorker: (params: {
    taskId: string;
    goal: string;
    constraints: string[];
    revisionContext?: string;
    patchApplied?: boolean;
    revisionOfArtifactId?: string;
    activeArtifactId?: string;
  }) => Promise<{ content: string; artifactType?: string; patchApplied?: boolean }>;
  /** 原始 goal（用于 rewrite） */
  originalGoal: string;
  /** 原始 constraints */
  originalConstraints: string[];
}

// ── Revision Prompt Builder ─────────────────────────────────────────────────

/**
 * 根据验证失败构建 revision prompt。
 * 把 criterion-level 失败信息注入 Worker prompt。
 */
function buildRevisionPrompt(
  originalGoal: string,
  constraints: string[],
  result: ContractVerificationResult
): string {
  const lines: string[] = [
    `[Revision Request — based on verification feedback]`,
    ``,
    `Original goal: ${originalGoal}`,
    ``,
    `Please revise your previous output to address the following issues:`,
  ];

  for (const cr of result.results) {
    if (cr.passed === false) {
      const severity = cr.severity.toUpperCase();
      const reasonCode = cr.reasonCode;
      lines.push(`[${severity}] Criterion ${cr.criterionId}: ${reasonCode}`);
    }
  }

  if (result.hasSecurityFailure) {
    lines.push(`[CRITICAL] Security violations detected — must be fixed before delivery.`);
  }

  lines.push(``);
  lines.push(`Constraints: ${constraints.length > 0 ? constraints.join("; ") : "(none)"}`);
  lines.push(``);
  lines.push(`Please produce a revised version that addresses all HIGH and SECURITY severity issues.`);

  return lines.join("\n");
}

// ── Cycle Core ─────────────────────────────────────────────────────────────

/**
 * Cycle Runtime V0 — 执行验证-修订循环。
 *
 * 行为：
 * - accept → 直接返回最终 content（立即终态）
 * - revise → 构建 revision prompt，第 2 轮 Worker，第 2 次验证
 * - rewrite → 触发全新 Worker call
 * - block → 记录阻断原因，退出
 * - human_review → 记录终态，退出
 *
 * 不改变：
 * - qualityRouting.decision（proof pyramid 保护）
 */
export async function runCycle(input: CycleInput): Promise<{
  finalContent: string;
  finalArtifactType?: string;
  finalPatchApplied?: boolean;
  cycleAudit: CycleAudit;
  finalVerification: ContractVerificationResult | null;
}> {
  const startMs = Date.now();
  const {
    taskId,
    taskContract,
    initialContent,
    artifactType,
    patchApplied,
    security,
    executeWorker,
    originalGoal,
    originalConstraints,
  } = input;

  const maxCycles = taskContract.budgetPolicy.maxCycles;
  const criteria = taskContract.verificationCriteria ?? [];

  const steps: CycleStepAudit[] = [];
  let currentContent = initialContent;
  let currentArtifactType = artifactType;
  let currentPatchApplied = patchApplied;
  let finalVerification: ContractVerificationResult | null = null;
  let finalStatus: CycleAudit["finalStatus"] = "accepted";
  let finalRecommendedAction: RecommendedAction = "accept";

  // ── Cycle 1: initial verification ─────────────────────────────────────────
  {
    const cvr = criteria.length > 0
      ? verifyAgainstCriteria(
          {
            traceId: taskId,
            artifactType: currentArtifactType,
            content: currentContent,
            patchApplied: currentPatchApplied,
            security,
          },
          criteria
        )
      : null;

    // Fallback: base verification if no criteria
    const baseResult = verifyArtifact({
      traceId: taskId,
      artifactType: currentArtifactType,
      content: currentContent,
      patchApplied: currentPatchApplied,
      security,
    });

    const activeCvr = cvr ?? (baseResult && criteria.length === 0 ? {
      traceId: taskId,
      base: { passed: baseResult.passed, score: baseResult.score, issues: baseResult.issues },
      passed: baseResult.passed,
      score: baseResult.score,
      criteriaEvaluated: 0,
      criteriaPassed: 0,
      criteriaFailed: 0,
      blockingIssues: 0,
      results: [] as CriterionVerificationResult[],
      recommendedAction: baseResult.passed ? "accept" as const : "rewrite" as const,
      hasHumanReviewRequired: false,
      hasSecurityFailure: baseResult.issues.some(i => i.severity === "error" && ["VF-006","VF-007","VF-008"].includes(i.code)),
      decisionMs: baseResult.decisionMs,
    } : null);

    if (!activeCvr) {
      throw new Error("[cycle] Unexpected: both cvr and fallback null");
    }

    finalVerification = activeCvr;
    finalRecommendedAction = activeCvr.recommendedAction;

    steps.push({
      cycleIndex: 1,
      verificationResult: activeCvr,
      recommendedAction: activeCvr.recommendedAction,
      contentLength: currentContent.length,
      workerCalled: false,
    });

    // ──终态检查 ─────────────────────────────────────────────────────────────
    if (activeCvr.recommendedAction === "accept") {
      finalStatus = "accepted";
      return {
        finalContent: currentContent,
        finalArtifactType: currentArtifactType,
        finalPatchApplied: currentPatchApplied,
        cycleAudit: {
          taskId,
          totalCycles: 1,
          maxCycles,
          finalStatus,
          finalRecommendedAction,
          steps,
          totalMs: Date.now() - startMs,
        },
        finalVerification,
      };
    }

    if (activeCvr.recommendedAction === "block") {
      finalStatus = "blocked";
      return {
        finalContent: currentContent,
        finalArtifactType: currentArtifactType,
        finalPatchApplied: currentPatchApplied,
        cycleAudit: {
          taskId,
          totalCycles: 1,
          maxCycles,
          finalStatus,
          finalRecommendedAction,
          steps,
          totalMs: Date.now() - startMs,
        },
        finalVerification,
      };
    }

    if (activeCvr.recommendedAction === "human_review") {
      finalStatus = "human_review";
      return {
        finalContent: currentContent,
        finalArtifactType: currentArtifactType,
        finalPatchApplied: currentPatchApplied,
        cycleAudit: {
          taskId,
          totalCycles: 1,
          maxCycles,
          finalStatus,
          finalRecommendedAction,
          steps,
          totalMs: Date.now() - startMs,
        },
        finalVerification,
      };
    }

    // revise / rewrite → 继续到 cycle 2
  }

  // ── Cycle 2+: revision or rewrite ─────────────────────────────────────────
  let anyRevise = false; // track if any cycle used revise path
  for (let cycleIndex = 2; cycleIndex <= maxCycles; cycleIndex++) {
    const prevAction = finalRecommendedAction;

    // ── Determine Worker call type ─────────────────────────────────────────
    let workerCalled = false;
    if (prevAction === "revise") anyRevise = true;

    if (prevAction === "revise") {
      // revise: 注入错误信息 + 当前内容供 Worker 理解上下文
      const revisionPrompt = buildRevisionPrompt(originalGoal, originalConstraints, finalVerification!);
      const workerResult = await executeWorker({
        taskId,
        goal: revisionPrompt,
        constraints: originalConstraints,
        revisionContext: currentContent,
        patchApplied: currentPatchApplied,
        revisionOfArtifactId: input.revisionOfArtifactId,
        activeArtifactId: input.activeArtifactId,
      });
      currentContent = workerResult.content;
      currentArtifactType = workerResult.artifactType ?? currentArtifactType;
      currentPatchApplied = workerResult.patchApplied ?? currentPatchApplied;
      workerCalled = true;
    } else if (prevAction === "rewrite") {
      // rewrite: 全新 Worker call
      const workerResult = await executeWorker({
        taskId,
        goal: originalGoal,
        constraints: originalConstraints,
        patchApplied: false, // rewrite always full
        revisionOfArtifactId: undefined, // no lineage
        activeArtifactId: input.activeArtifactId,
      });
      currentContent = workerResult.content;
      currentArtifactType = workerResult.artifactType ?? undefined;
      currentPatchApplied = workerResult.patchApplied ?? false;
      workerCalled = true;
    } else {
      // 理论上不会到这里（block/human_review 在 cycle 1 就退出了）
      break;
    }

    // ── 验证本轮结果 ──────────────────────────────────────────────────────────
    const cvr = criteria.length > 0
      ? verifyAgainstCriteria(
          {
            traceId: taskId,
            artifactType: currentArtifactType,
            content: currentContent,
            patchApplied: currentPatchApplied,
            security,
          },
          criteria
        )
      : null;

    const baseResult = verifyArtifact({
      traceId: taskId,
      artifactType: currentArtifactType,
      content: currentContent,
      patchApplied: currentPatchApplied,
      security,
    });

    const activeCvr = cvr ?? (baseResult && criteria.length === 0 ? {
      traceId: taskId,
      base: { passed: baseResult.passed, score: baseResult.score, issues: baseResult.issues },
      passed: baseResult.passed,
      score: baseResult.score,
      criteriaEvaluated: 0,
      criteriaPassed: 0,
      criteriaFailed: 0,
      blockingIssues: 0,
      results: [] as CriterionVerificationResult[],
      recommendedAction: baseResult.passed ? "accept" as const : "rewrite" as const,
      hasHumanReviewRequired: false,
      hasSecurityFailure: baseResult.issues.some(i => i.severity === "error" && ["VF-006","VF-007","VF-008"].includes(i.code)),
      decisionMs: baseResult.decisionMs,
    } : null);

    if (!activeCvr) {
      throw new Error("[cycle] Unexpected: both cvr and fallback null in loop");
    }

    finalVerification = activeCvr;
    finalRecommendedAction = activeCvr.recommendedAction;

    steps.push({
      cycleIndex,
      verificationResult: activeCvr,
      recommendedAction: activeCvr.recommendedAction,
      contentLength: currentContent.length,
      workerCalled,
    });

    // ── 终态检查 ─────────────────────────────────────────────────────────────
    if (activeCvr.recommendedAction === "accept") {
      finalStatus = anyRevise ? "revised" : "rewritten";
      return {
        finalContent: currentContent,
        finalArtifactType: currentArtifactType,
        finalPatchApplied: currentPatchApplied,
        cycleAudit: {
          taskId,
          totalCycles: cycleIndex,
          maxCycles,
          finalStatus,
          finalRecommendedAction,
          steps,
          totalMs: Date.now() - startMs,
        },
        finalVerification,
      };
    }

    if (activeCvr.recommendedAction === "block") {
      finalStatus = "blocked";
      return {
        finalContent: currentContent,
        finalArtifactType: currentArtifactType,
        finalPatchApplied: currentPatchApplied,
        cycleAudit: {
          taskId,
          totalCycles: cycleIndex,
          maxCycles,
          finalStatus,
          finalRecommendedAction,
          steps,
          totalMs: Date.now() - startMs,
        },
        finalVerification,
      };
    }

    if (activeCvr.recommendedAction === "human_review") {
      finalStatus = "human_review";
      return {
        finalContent: currentContent,
        finalArtifactType: currentArtifactType,
        finalPatchApplied: currentPatchApplied,
        cycleAudit: {
          taskId,
          totalCycles: cycleIndex,
          maxCycles,
          finalStatus,
          finalRecommendedAction,
          steps,
          totalMs: Date.now() - startMs,
        },
        finalVerification,
      };
    }

    // revise / rewrite → 继续循环（最多到 maxCycles）
  }

  // ── max_cycles_exceeded ────────────────────────────────────────────────────
  finalStatus = "max_cycles_exceeded";
  return {
    finalContent: currentContent,
    finalArtifactType: currentArtifactType,
    finalPatchApplied: currentPatchApplied,
    cycleAudit: {
      taskId,
      totalCycles: maxCycles,
      maxCycles,
      finalStatus,
      finalRecommendedAction,
      steps,
      totalMs: Date.now() - startMs,
    },
    finalVerification,
  };
}

// ── Ledger Audit Extract ────────────────────────────────────────────────────

export interface CycleAuditExtract {
  taskId: string;
  totalCycles: number;
  maxCycles: number;
  finalStatus: string;
  finalRecommendedAction: string;
  cycleAuditMs: number;
  /** 是否有阻断（security/human_review） */
  blocked: boolean;
}

export function buildCycleAuditExtract(audit: CycleAudit): CycleAuditExtract {
  return {
    taskId: audit.taskId,
    totalCycles: audit.totalCycles,
    maxCycles: audit.maxCycles,
    finalStatus: audit.finalStatus,
    finalRecommendedAction: audit.finalRecommendedAction,
    cycleAuditMs: audit.totalMs,
    blocked: audit.finalStatus === "blocked" || audit.finalStatus === "human_review",
  };
}
