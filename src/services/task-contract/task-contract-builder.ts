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
  VerificationCriterion,
  CriterionType,
  CriterionTarget,
  CriterionSource,
  VerificationCriteriaAudit,
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

// ── Criteria Builder ──────────────────────────────────────────────────────────

/** ID generator for criteria */
let criteriaCounter = 0;
function nextCriterionId(): string {
  return `crt-${++criteriaCounter}-${Date.now()}`;
}

/**
 * S73P: buildVerificationCriteria — 从 TaskContract 构建 structured criteria。
 *
 * 规则：
 * - security risk → 添加 required security_check
 * - high risk → 添加 required quality_threshold
 * - artifact/patch output → 添加 structure_presence
 * - acceptanceCriteria 自然语言 → 映射为 llm_judged 或 human_review（deterministic=false）
 * - acceptanceCriteria 含技术关键词 → 尝试映射为 text_presence / structure_presence
 *
 * S73P 重点：criteria 存在且可审计。
 * 不改变现有 Verifier 评分行为（S74P 才让 Verifier 消费 criteria）。
 */
export function buildVerificationCriteria(
  taskContract: TaskContractV0,
  acceptanceCriteriaInput?: string[]
): VerificationCriterion[] {
  const criteria: VerificationCriterion[] = [];
  const { riskLevel, intent, expectedOutputKind } = taskContract;

  // ── System Default: VF-001 non-empty ─────────────────────────────────────
  criteria.push({
    id: nextCriterionId(),
    label: "Content must be non-empty",
    description: "Artifact content cannot be empty or whitespace-only.",
    type: "text_presence",
    target: "artifact",
    severity: "high",
    required: true,
    expected: "",
    source: "systemDefault",
    deterministic: true,
  });

  // ── System Default: artifact type known ───────────────────────────────────
  criteria.push({
    id: nextCriterionId(),
    label: "Artifact type must be known",
    description: "artifactType must not be 'unknown'.",
    type: "metadata_match",
    target: "metadata",
    severity: "low",
    required: false,
    source: "systemDefault",
    deterministic: true,
  });

  // ── Risk-driven: security_check ──────────────────────────────────────────
  if (riskLevel === "security") {
    criteria.push({
      id: nextCriterionId(),
      label: "Security check: artifact not sent to Manager LLM",
      description: "artifactToManager must be false (VF-006 equivalent).",
      type: "security_check",
      target: "artifact",
      severity: "security",
      required: true,
      source: "securityPolicy",
      deterministic: true,
    });
    criteria.push({
      id: nextCriterionId(),
      label: "Security check: raw history not sent to Worker",
      description: "rawHistoryToWorker must be false (VF-007 equivalent).",
      type: "security_check",
      target: "artifact",
      severity: "security",
      required: true,
      source: "securityPolicy",
      deterministic: true,
    });
    criteria.push({
      id: nextCriterionId(),
      label: "Security check: raw memory not sent to Worker",
      description: "rawMemoryToWorker must be false (VF-008 equivalent).",
      type: "security_check",
      target: "artifact",
      severity: "security",
      required: true,
      source: "securityPolicy",
      deterministic: true,
    });
  }

  // ── Risk-driven: quality_threshold ──────────────────────────────────────
  if (riskLevel === "high" || riskLevel === "security") {
    criteria.push({
      id: nextCriterionId(),
      label: "Quality score threshold",
      description: `Verifier score must be >= ${taskContract.verificationPolicy.minScore ?? 0.5}.`,
      type: "quality_threshold",
      target: "artifact",
      severity: riskLevel === "security" ? "security" : "high",
      required: true,
      threshold: taskContract.verificationPolicy.minScore ?? 0.5,
      source: "riskPolicy",
      deterministic: true,
    });
  }

  // ── Output-driven: structure_presence ────────────────────────────────────
  if (expectedOutputKind === "artifact" || expectedOutputKind === "patch") {
    criteria.push({
      id: nextCriterionId(),
      label: "Output structure check",
      description:
        expectedOutputKind === "patch"
          ? "Patch must be applicable: patchApplied=true implies non-empty content."
          : "Artifact must have valid structure for the declared artifactType.",
      type: "structure_presence",
      target: expectedOutputKind === "patch" ? "patch" : "artifact",
      severity: "medium",
      required: expectedOutputKind === "patch",
      source: "systemDefault",
      deterministic: true,
    });
  }

  // ── Output-driven: revision lineage for patch ───────────────────────────
  if (intent === "revise_artifact" && taskContract.target.revisionOfArtifactId) {
    criteria.push({
      id: nextCriterionId(),
      label: "Revision lineage must be valid",
      description: "revisionOfArtifactId must match expected source artifact.",
      type: "metadata_match",
      target: "metadata",
      severity: "medium",
      required: false,
      source: "systemDefault",
      deterministic: true,
    });
  }

  // ── Acceptance criteria mapping ───────────────────────────────────────────
  const criteriaInputs = acceptanceCriteriaInput ?? taskContract.acceptanceCriteria ?? [];

  for (const raw of criteriaInputs) {
    const lower = raw.toLowerCase();
    let type: CriterionType = "llm_judged";
    let deterministic = false;
    let required = false;

    // Try to map technical keywords (order matters: specific before generic)
    if (
      lower.includes("包含") || lower.includes("必须包含") ||
      lower.includes("must contain") || lower.includes("include")
    ) {
      type = "text_presence";
      deterministic = true;
      required = true;
    } else if (
      lower.includes("导出") || lower.includes("export") ||
      lower.includes("函数") || lower.includes("function") ||
      lower.includes("组件") || lower.includes("component")
    ) {
      type = "structure_presence";
      deterministic = true;
    } else if (
      lower.includes("人工") || lower.includes("human") ||
      lower.includes("手动") || lower.includes("manual") ||
      lower.includes("请检查")
    ) {
      // human_review: check BEFORE generic "检查" to avoid "请人工检查" being captured by metadata_match
      type = "human_review";
      deterministic = false;
      required = true;
    } else if (
      lower.includes("检查") || lower.includes("verify") ||
      lower.includes("validate")
    ) {
      type = "metadata_match";
      deterministic = true;
    } else if (
      lower.includes("高级") || lower.includes("优雅") ||
      lower.includes("专业") || lower.includes("better") ||
      lower.includes("improved") || lower.includes("更")
    ) {
      // Qualitative — cannot deterministic verify
      type = "llm_judged";
      deterministic = false;
      required = false; // advisory
    } else {
      // General — default to LLM judgment
      type = "llm_judged";
      deterministic = false;
      required = false;
    }

    criteria.push({
      id: nextCriterionId(),
      label: `AC: ${raw.slice(0, 60)}${raw.length > 60 ? "…" : ""}`,
      description: raw,
      type,
      target: expectedOutputKind === "patch" ? "patch" : "artifact",
      severity: required ? "high" : "low",
      required,
      source: "acceptanceCriteria",
      deterministic,
    });
  }

  return criteria;
}

// ── Criteria Audit Builder ────────────────────────────────────────────────────

/**
 * 从 criteria 列表构建 ledger audit summary。
 * 不含 label/description/expected 等文本内容。
 */
export function buildVerificationCriteriaAudit(
  criteria: VerificationCriterion[]
): VerificationCriteriaAudit {
  const sources = new Set<CriterionSource>();
  let maxSeverity: VerificationCriteriaAudit["maxSeverity"] = "low";

  const SEVERITY_RANK: Record<string, number> = {
    low: 0, medium: 1, high: 2, security: 3,
  };

  for (const c of criteria) {
    sources.add(c.source);
    if (SEVERITY_RANK[c.severity] > SEVERITY_RANK[maxSeverity]) {
      maxSeverity = c.severity;
    }
  }

  return {
    count: criteria.length,
    requiredCount: criteria.filter((c) => c.required).length,
    deterministicCount: criteria.filter((c) => c.deterministic).length,
    hasSecurityCheck: criteria.some((c) => c.type === "security_check"),
    maxSeverity,
    sources: Array.from(sources),
  };
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
  // Reset counter per build to keep IDs deterministic within test scope
  criteriaCounter = 0;

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

  // 12. Verification Criteria（S73P 新增）
  // criteriaSource = structured_criteria 时填充，S73P V0 即填
  const verificationCriteria = buildVerificationCriteria(
    {
      id: "", // 临时，buildVerificationCriteria 不需要 id
      taskId: traceId,
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
      // verificationCriteria 自身循环引用，先用空数组占位，criteria builder 不依赖自身
      verificationCriteria: [],
    },
    acceptanceCriteria
  );

  // 13. Update verificationPolicy.criteriaSource = structured_criteria
  const finalVerificationPolicy = {
    ...verificationPolicy,
    criteriaSource: "structured_criteria" as const,
  };

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
    verificationPolicy: finalVerificationPolicy,
    verificationCriteria,
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

  // Build criteria audit summary
  const verificationCriteriaAudit = buildVerificationCriteriaAudit(
    contract.verificationCriteria ?? []
  );

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
    verificationCriteriaAudit,
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
