/**
 * Sprint 72P: Task Contract V0 — Contract Builder
 *
 * 从现有 routing/localManager/qualityRouting 信号构建 TaskContractV0。
 *
 * 设计原则：
 * - 不引入新判断，纯粹是现有决策的结构化投影
 * - riskLevel 从 qualityRouting / localManager 信号派生
 * - 不改变 qualityRouting.decision / patchFirstEligible
 */

import { v4 as uuid } from "uuid";
import type {
  TaskContractV0,
  TaskContractBuilderInput,
  TaskContractAuditExtract,
  TaskIntent,
  ExpectedOutputKind,
  RiskLevel,
} from "./task-contract-types.js";

import type { LocalManagerDecision } from "../manager/local-manager-runtime.js";
import type { QualityRoutingDecision } from "../verifier/verifier-types.js";

// ── Intent Derivation ────────────────────────────────────────────────────────

/** 从 LocalManagerDecision.nextAction 派生 TaskIntent */
function deriveIntent(lm: LocalManagerDecision): TaskIntent {
  switch (lm.nextAction) {
    case "direct_create_artifact":
      return "create_artifact";
    case "direct_artifact_revision":
      return "revise_artifact";
    case "direct_answer":
      return "answer";
    case "manager_llm_fallback":
      return "create_artifact"; // delegation → 视为 artifact creation
    case "ask_clarification":
      return "inspect_artifact";
    default:
      return "create_artifact";
  }
}

// ── Expected Output Kind Derivation ─────────────────────────────────────────

/** 从 intent / patchFirstEligible 派生 ExpectedOutputKind */
function deriveExpectedOutputKind(
  intent: TaskIntent,
  lm: LocalManagerDecision
): ExpectedOutputKind {
  switch (intent) {
    case "create_artifact":
      return "artifact";
    case "revise_artifact":
      // revision 但不走 patch-first → full artifact
      if (!lm.patchFirstEligible) return "artifact";
      return "patch";
    case "answer":
      return "answer";
    case "inspect_artifact":
      return "analysis";
    default:
      return "artifact";
  }
}

// ── Risk Level Derivation ────────────────────────────────────────────────────

/**
 * riskLevel 从 qualityRouting signal 派生。
 *
 * 映射：
 * - no qualityRouting / disabled / allow_patch_first → low
 * - prefer_full_rewrite → medium
 * - force_full_rewrite → high
 * - block_or_full_rewrite → security
 */
function deriveRiskLevel(
  qr: QualityRoutingDecision | null | undefined,
  lm: LocalManagerDecision
): RiskLevel {
  if (!qr) return "low";

  switch (qr.decision) {
    case "allow_patch_first":
      return "low";
    case "prefer_full_rewrite":
      return "medium";
    case "force_full_rewrite":
      return "high";
    case "block_or_full_rewrite":
      return "security";
    default:
      return "low";
  }
}

// ── Verification Policy Derivation ──────────────────────────────────────────

function deriveVerificationPolicy(
  riskLevel: RiskLevel,
  qr: QualityRoutingDecision | null | undefined
) {
  // S72P V0: verification policy 从 riskLevel 派生
  // S73P 再引入 structured criteria
  const required = riskLevel !== "low";
  const blockOnSecurity = riskLevel === "security";

  let mode: "none" | "heuristic" | "llm" = "none";
  if (riskLevel === "low") mode = "none";
  else if (riskLevel === "medium") mode = "heuristic";
  else mode = "llm";

  // criteriaSource: V0 = human_acceptance_criteria
  return {
    required,
    mode,
    criteriaSource: "human_acceptance_criteria" as const,
    blockOnSecurity,
    minScore: riskLevel === "high" || riskLevel === "security" ? 0.5 : undefined,
  };
}

// ── Budget Policy Derivation ─────────────────────────────────────────────────

function deriveBudgetPolicy(riskLevel: RiskLevel) {
  // S72P V0: 固定 budget，S74P 再从 contract 读取
  switch (riskLevel) {
    case "low":
      return { maxWorkerCalls: 1, maxVerifierCalls: 0, maxCycles: 1 };
    case "medium":
      return { maxWorkerCalls: 2, maxVerifierCalls: 1, maxCycles: 2 };
    case "high":
      return { maxWorkerCalls: 3, maxVerifierCalls: 2, maxCycles: 2 };
    case "security":
      return { maxWorkerCalls: 1, maxVerifierCalls: 1, maxCycles: 1 };
    default:
      return { maxWorkerCalls: 1, maxVerifierCalls: 0, maxCycles: 1 };
  }
}

// ── Provenance Derivation ────────────────────────────────────────────────────

function deriveProvenance(
  lm: LocalManagerDecision | null | undefined,
  qr: QualityRoutingDecision | null | undefined
) {
  if (!lm) {
    return { builtFrom: "fallback" as const };
  }
  return {
    builtFrom: "localManager" as const,
    qualityDecision: qr?.enabled ? qr.decision : undefined,
    patchFirstEligible: lm.patchFirstBefore,
  };
}

// ── Context Derivation ────────────────────────────────────────────────────────

function deriveAllowedContext(
  lm: LocalManagerDecision | null | undefined,
  targetArtifactId?: string
) {
  const canReadHistory = Boolean(lm?.security?.allowRawHistoryToWorker) === false;
  const canReadArtifactSource = Boolean(lm?.security?.allowArtifactToWorker);
  const artifactIds: string[] = targetArtifactId ? [targetArtifactId] : [];

  return {
    canReadHistory,
    canReadArtifactSource,
    artifactIds,
    memoryScope: lm?.security?.allowRawMemoryToWorker ? "retrieved" : "none" as const,
  };
}

// ── User-visible Goal ────────────────────────────────────────────────────────

function deriveUserVisibleGoal(userInstruction: string, intent: TaskIntent): string {
  // S72P V0: 简单截取 user instruction 前 200 字符作为 goal
  // S74P 以后可以用 intent-classifier 增强
  if (userInstruction.length <= 200) return userInstruction;
  return userInstruction.slice(0, 197) + "...";
}

// ── Main Builder ─────────────────────────────────────────────────────────────

/**
 * 从现有信号构建 TaskContractV0。
 *
 * S72P 不改变：
 * - qualityRouting.decision
 * - localManager.patchFirstEligible / effectivePatchFirstEligible
 * - 任何 routing threshold
 *
 * 只从现有决策中提取结构化表达。
 */
export function buildTaskContract(input: TaskContractBuilderInput): TaskContractV0 {
  const {
    traceId,
    userInstruction,
    localManager,
    qualityRouting,
    targetArtifactId,
    acceptanceCriteria = [],
    constraints = [],
  } = input;

  const lm = localManager ?? null;
  const qr = qualityRouting ?? null;

  // 1. Intent
  const intent: TaskIntent = lm ? deriveIntent(lm) : "create_artifact";

  // 2. Expected Output Kind
  const expectedOutputKind = lm
    ? deriveExpectedOutputKind(intent, lm)
    : "artifact";

  // 3. Target
  const target = {
    artifactId: targetArtifactId,
    revisionOfArtifactId:
      intent === "revise_artifact" ? targetArtifactId : undefined,
  };

  // 4. Human-readable
  const userVisibleGoal = deriveUserVisibleGoal(userInstruction, intent);

  // 5. Acceptance Criteria（S72P V0: 简单传入或空）
  // 不从 userInstruction 推导，避免暴露指令全文到 contract

  // 6. Constraints（S72P V0: 空）
  // S75P 以后可从 policy/constraints 传入

  // 7. Context
  const allowedContext = deriveAllowedContext(lm, targetArtifactId);

  // 8. Risk Level
  const riskLevel = deriveRiskLevel(qr, lm);

  // 9. Verification Policy
  const verificationPolicy = deriveVerificationPolicy(riskLevel, qr);

  // 10. Budget Policy
  const budgetPolicy = deriveBudgetPolicy(riskLevel);

  // 11. Provenance
  const provenance = deriveProvenance(lm, qr);

  return {
    id: uuid(),
    taskId: traceId, // S72P 用 traceId 作为 taskId（S76P 引入独立 taskId 后可替换）
    intent,
    expectedOutputKind,
    target,
    userVisibleGoal,
    acceptanceCriteria,
    constraints,
    allowedContext,
    riskLevel,
    budgetPolicy,
    verificationPolicy,
    provenance,
  };
}

// ── Audit Extract Builder ────────────────────────────────────────────────────

/**
 * 从 TaskContractV0 构建 audit extract。
 *
 * 只记录权限事实，不记录：
 * - acceptanceCriteria full text
 * - constraints full text
 * - userVisibleGoal full text
 * - artifactIds 完整数组（只记录 count）
 * - artifact raw source
 * - raw history text
 * - memory retrieval text
 */
export function buildTaskContractAuditExtract(
  contract: TaskContractV0
): TaskContractAuditExtract {
  const { allowedContext } = contract;

  return {
    id: contract.id,
    taskId: contract.taskId,
    intent: contract.intent,
    expectedOutputKind: contract.expectedOutputKind,
    riskLevel: contract.riskLevel,
    verificationPolicy: {
      required: contract.verificationPolicy.required,
      mode: contract.verificationPolicy.mode,
      criteriaSource: contract.verificationPolicy.criteriaSource,
      blockOnSecurity: contract.verificationPolicy.blockOnSecurity,
      minScore: contract.verificationPolicy.minScore,
    },
    budgetPolicy: { ...contract.budgetPolicy },
    allowedContextAudit: {
      canReadHistory: allowedContext.canReadHistory,
      canReadArtifactSource: allowedContext.canReadArtifactSource,
      artifactIdsListed: false, // S72P: 不在 ledger 里展开
      artifactIdCount: allowedContext.artifactIds.length,
      hasTargetArtifactId: Boolean(contract.target.artifactId),
      memoryScope: allowedContext.memoryScope,
    },
    provenance: { ...contract.provenance },
  };
}

// ── Sentinel Constants for D5 Negative Tests ─────────────────────────────────

/**
 * D5 Context Boundary guards 使用的 sentinel 字符串。
 * 如果在 serialized contract / ledger / SSE done 中搜到这些 sentinel，测试应 fail。
 */
export const SENTINELS = {
  RAW_ARTIFACT_SECRET: "RAW_ARTIFACT_SECRET_DO_NOT_LEAK",
  RAW_HISTORY_SECRET: "RAW_HISTORY_SECRET_DO_NOT_LEAK",
  RAW_MEMORY_SECRET: "RAW_MEMORY_SECRET_DO_NOT_LEAK",
} as const;

/** 检查一个对象中是否包含任何 sentinel 字符串 */
export function containsSentinel(obj: unknown, sentinel: string): boolean {
  const str = JSON.stringify(obj);
  return str.includes(sentinel);
}

/** 检查对象中是否包含任何已知 sentinel */
export function containsAnySentinel(obj: unknown): string[] {
  const found: string[] = [];
  for (const [, value] of Object.entries(SENTINELS)) {
    if (containsSentinel(obj, value)) {
      found.push(value);
    }
  }
  return found;
}
