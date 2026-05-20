/**
 * Sprint 72P: Task Contract V0 — Schema
 *
 * TaskContractV0 是任务执行的结构化合同骨架。
 *
 * 设计原则：
 * - 从现有 routing/localManager/qualityRouting 决策派生，不引入新判断
 * - acceptanceCriteria 是 human-readable，不作为 Verifier 确定性标准
 * - allowedContext 只记录权限事实，不记录 payload
 * - provenance 明确记录 contract 从哪里构建
 */

import type { LocalManagerDecision } from "../manager/local-manager-runtime.js";
import type { QualityRoutingDecision } from "../verifier/verifier-types.js";

// ── Intent ──────────────────────────────────────────────────────────────────

export type TaskIntent =
  | "create_artifact"
  | "revise_artifact"
  | "answer"
  | "inspect_artifact";

// ── Expected Output Kind ────────────────────────────────────────────────────

export type ExpectedOutputKind =
  | "artifact"
  | "patch"
  | "answer"
  | "analysis";

// ── Risk Level ─────────────────────────────────────────────────────────────

/**
 * riskLevel 从现有 qualityRouting / localManager 信号派生。
 *
 * S72P 只派生，S73P-S74P 才参与 verification / cycle policy。
 * 不驱动 QualityRouter.decision，避免循环依赖。
 */
export type RiskLevel = "low" | "medium" | "high" | "security";

// ── Context Scope ────────────────────────────────────────────────────────────

export type MemoryScope = "none" | "brief" | "retrieved";

// ── Verification Policy ─────────────────────────────────────────────────────

export type VerificationMode = "none" | "heuristic" | "llm";

/**
 * criteriaSource 标明 acceptanceCriteria 的性质。
 *
 * - human_acceptance_criteria: 人类可读描述，Verifier 软参考（V0 默认）
 * - structured_criteria: S73P 引入的结构化验证标准，Verifier 硬依据
 * - none: 不验证
 */
export type CriteriaSource = "none" | "human_acceptance_criteria" | "structured_criteria";

export interface VerificationPolicy {
  /** 是否必须验证 */
  required: boolean;
  /** 验证模式 */
  mode: VerificationMode;
  /**
   * acceptanceCriteria 的性质（S72P V0 默认 human_acceptance_criteria）。
   * S73P 引入 structured_criteria 后填 structured_criteria。
   */
  criteriaSource: CriteriaSource;
  /** 遇到 security issue 是否阻断 */
  blockOnSecurity: boolean;
  /** 最低质量分（可选） */
  minScore?: number;
}

// ── Budget Policy ────────────────────────────────────────────────────────────

export interface BudgetPolicy {
  /** 最大 Worker 调用次数 */
  maxWorkerCalls: number;
  /** 最大 Verifier 调用次数 */
  maxVerifierCalls: number;
  /** 最大 Cycle 次数（S74P 使用，S72P 固定 1） */
  maxCycles: number;
}

// ── Provenance ──────────────────────────────────────────────────────────────

/** TaskContract 从哪里构建 */
export type ProvenanceSource =
  | "routeDecision"
  | "localManager"
  | "fallback";

export interface TaskContractProvenance {
  /** 构建来源 */
  builtFrom: ProvenanceSource;
  /** 关联的 quality routing decision（可选） */
  qualityDecision?: string;
  /** patch-first eligibility（在 quality routing 之前） */
  patchFirstEligible?: boolean;
}

// ── TaskContract Target ─────────────────────────────────────────────────────

export interface TaskContractTarget {
  /** 当前 target artifact ID（revision / inspect 时有） */
  artifactId?: string;
  /** 本次修订的 source artifact ID（revision 时有） */
  revisionOfArtifactId?: string;
}

// ── TaskContract Audit Extract（Ledger 用）───────────────────────────────────

/**
 * 记录 context 权限事实，不记录 payload。
 * Ledger / SSE done 只放此 extract，不放完整 contract。
 *
 * 不包含：
 * - artifact raw source
 * - raw history text
 * - memory retrieval text
 * - full acceptanceCriteria / constraints / userVisibleGoal 全文
 */
export interface AllowedContextAudit {
  canReadHistory: boolean;
  canReadArtifactSource: boolean;
  /** 是否在 ledger 里展开了 artifactIds 数组（S72P: false，只记录 count） */
  artifactIdsListed: boolean;
  artifactIdCount: number;
  hasTargetArtifactId: boolean;
  memoryScope: MemoryScope;
}

export interface TaskContractAuditExtract {
  id: string;
  taskId: string;
  intent: string;
  expectedOutputKind: string;
  riskLevel: string;
  verificationPolicy: {
    required: boolean;
    mode: string;
    criteriaSource: string;
    blockOnSecurity: boolean;
    minScore?: number;
  };
  budgetPolicy: {
    maxWorkerCalls: number;
    maxVerifierCalls: number;
    maxCycles: number;
  };
  allowedContextAudit: AllowedContextAudit;
  provenance: TaskContractProvenance;
}

// ── TaskContract V0（完整合同）────────────────────────────────────────────────

/**
 * TaskContract V0 — 任务执行合同骨架。
 *
 * 从 LocalManagerDecision / QualityRoutingDecision 派生。
 * 不改变现有 routing decision / quality routing decision。
 *
 * V0 定位：
 * - acceptanceCriteria = human-readable 任务描述
 * - criteriaSource = "human_acceptance_criteria"（不是 Verifier 确定性标准）
 * - riskLevel 派生自 quality routing signal
 * - 不驱动 QualityRouter（避免循环依赖）
 */
export interface TaskContractV0 {
  /** 合同唯一 ID */
  id: string;
  /** 关联的 task ID */
  taskId: string;

  // ── Task Intent ───────────────────────────────────────────────────────────

  /** 任务意图 */
  intent: TaskIntent;
  /** 预期输出类型 */
  expectedOutputKind: ExpectedOutputKind;

  // ── Target ────────────────────────────────────────────────────────────────

  /** target 信息 */
  target: TaskContractTarget;

  // ── Human-readable Task Description ──────────────────────────────────────

  /**
   * 用户可见的目标描述（human-readable）。
   * 不是 Verifier 确定性标准。
   * 不写入 Ledger audit extract。
   */
  userVisibleGoal: string;

  /**
   * 验收标准列表（human-readable）。
   * 不是 Verifier 确定性标准。
   * S73P 引入 structured criteria 后，Verifier 按 structured_criteria 检查。
   * 不写入 Ledger audit extract。
   */
  acceptanceCriteria: string[];

  /**
   * 约束列表（human-readable）。
   * 不写入 Ledger audit extract。
   */
  constraints: string[];

  // ── Context Control ───────────────────────────────────────────────────────

  /**
   * 允许的上下文范围（权限控制，不含 payload）。
   *
   * 注意：allowedContext.artifactIds 本身不含 artifact 内容，
   * 但 artifactIds 数组整体不应出现在 Ledger audit extract 中（改为 artifactIdCount）。
   */
  allowedContext: {
    canReadHistory: boolean;
    canReadArtifactSource: boolean;
    artifactIds: string[];
    memoryScope: MemoryScope;
  };

  // ── Risk & Policy ─────────────────────────────────────────────────────────

  /** 风险等级（从 qualityRouting / localManager 信号派生） */
  riskLevel: RiskLevel;

  /** 预算策略 */
  budgetPolicy: BudgetPolicy;

  /** 验证策略 */
  verificationPolicy: VerificationPolicy;

  // ── Provenance ────────────────────────────────────────────────────────────

  /** 合同构建来源 */
  provenance: TaskContractProvenance;
}

// ── Builder Input ────────────────────────────────────────────────────────────

export interface TaskContractBuilderInput {
  /** traceId / taskId */
  traceId: string;
  /** 用户指令（用于构造 userVisibleGoal） */
  userInstruction: string;
  /** LocalManager 决策结果（可选） */
  localManager?: LocalManagerDecision | null;
  /** Quality Routing 决策（可选） */
  qualityRouting?: QualityRoutingDecision | null;
  /** active artifact ID（revision 时） */
  targetArtifactId?: string;
  /** 上次验证分数（可选，用于 riskLevel 派生） */
  lastVerificationScore?: number | null;
  /** 本次 Worker 调用是否走 patch-first（从 artifact envelope 传入） */
  patchFirstAttempted?: boolean;
  /** acceptanceCriteria 描述（S72P V0: 简单从 userInstruction 截取） */
  acceptanceCriteria?: string[];
  /** constraints（S72P V0: 简单为空） */
  constraints?: string[];
}
