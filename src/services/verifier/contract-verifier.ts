/**
 * Sprint 74P: Contract-aware Verifier V1
 *
 * 让 artifact verifier 消费 TaskContractV0.verificationCriteria[]，
 * 产出 criterion-level verification results。
 *
 * 设计原则：
 * - 不改变现有 Verifier V0 scoring 行为
 * - deterministic criteria → 确定性 pass/fail
 * - human_review / llm_judged → passed=null，不自动判定
 * - security required 失败 → recommendedAction=block
 * - recommendedAction 由 criteria 评估结果决定，不驱动 QualityRouter（S74P 只产出，映射由调用方处理）
 */

import type {
  VerificationCriterion,
  ContractVerificationResult,
  CriterionVerificationResult,
  TaskContractV0,
} from "../task-contract/task-contract-types.js";

import type {
  ArtifactVerifierInput,
  VerificationResult,
} from "./artifact-verifier.js";

import { verifyArtifact } from "./artifact-verifier.js";

// ── React Structure Patterns（复用自 artifact-verifier.ts）──────────────────

const REACT_STRUCTURE_PATTERNS = [
  /export\s+default\s+(function|class|const)\s+/,
  /export\s+default\s+\w+/,
  /function\s+\w+\s*\([^)]*\)\s*\{/,
  /const\s+\w+\s*[:=]\s*(\([^)]*\)|React\.FC)/,
  /return\s*\(\s*</,
];

function hasReactStructure(content: string): boolean {
  return REACT_STRUCTURE_PATTERNS.some((p) => p.test(content));
}

// ── Criterion Evaluator ───────────────────────────────────────────────────

/**
 * 对单个 criterion 进行评估。
 *
 * V1 支持的 criterion 类型：
 * - text_presence: 确定性文本检查
 * - structure_presence: 确定性结构检查（React/TSX）
 * - metadata_match: 元数据匹配（artifactType 已知）
 * - security_check: 安全不变量（VF-006/007/008 等价）
 * - quality_threshold: 质量分阈值
 * - llm_judged: 返回 null，不声称确定性
 * - human_review: 返回 null，要求人工验收
 *
 * 不支持的类型 → not_applicable
 */
function evaluateCriterion(
  criterion: VerificationCriterion,
  verifierResult: VerificationResult,
  artifactInput: ArtifactVerifierInput
): CriterionVerificationResult {
  const { type, id, deterministic, severity } = criterion;
  const content = artifactInput.content ?? "";
  const artifactType = artifactInput.artifactType ?? "unknown";

  // Confidence: deterministic=1.0, non-deterministic=0.5
  const confidence = deterministic ? 1.0 : 0.5;

  // Base result fields (always present)
  const baseResult = (passed: boolean | null, reasonCode: CriterionVerificationResult["reasonCode"]) => ({
    criterionId: id,
    type,
    passed,
    required: criterion.required,
    confidence,
    severity,
    deterministic,
    reasonCode,
  });

  // ── text_presence ──────────────────────────────────────────────────────
  if (type === "text_presence") {
    const expected = criterion.expected;
    if (expected === undefined || expected === "") {
      // VF-001 等价：内容非空
      const passed = content.trim().length > 0;
      return baseResult(passed, passed ? "passed" : "missing_text");
    }
    // 指定了期望文本
    const expectedStr = Array.isArray(expected) ? expected.join(" ") : String(expected);
    const passed = content.includes(expectedStr);
    return baseResult(passed, passed ? "passed" : "missing_text");
  }

  // ── structure_presence ─────────────────────────────────────────────────
  if (type === "structure_presence") {
    if (criterion.target === "patch") {
      // Patch 必须 non-empty（VF-005 等价）
      const passed = (content.trim().length > 0) && artifactInput.patchApplied === true;
      return baseResult(passed, passed ? "passed" : "missing_structure");
    }
    // Artifact 结构检查
    if (artifactType === "tsx" || (artifactType === "code" && content.includes("React"))) {
      const passed = hasReactStructure(content);
      return baseResult(passed, passed ? "passed" : "missing_structure");
    }
    // 非 React artifact：默认通过（VF-002 warning 已经记录）
    return baseResult(true, "passed");
  }

  // ── metadata_match ─────────────────────────────────────────────────────
  if (type === "metadata_match") {
    if (criterion.target === "metadata" || criterion.target === "ledger") {
      if (artifactType === "unknown") {
        return baseResult(false, "metadata_mismatch");
      }
      // Lineage check：VF-004 等价
      if (criterion.label.includes("Revision lineage") || criterion.label.includes("Lineage")) {
        const actual = artifactInput.revisionOfArtifactId ?? null;
        const expected = artifactInput.expectedRevisionOfArtifactId ?? null;
        if (expected !== null && actual !== null) {
          const passed = actual === expected;
          return baseResult(passed, passed ? "passed" : "metadata_mismatch");
        }
        if (expected !== null && actual === null) {
          return baseResult(false, "metadata_mismatch");
        }
      }
      return baseResult(true, "passed");
    }
    return baseResult(true, "not_applicable");
  }

  // ── security_check ─────────────────────────────────────────────────────
  if (type === "security_check") {
    const sec = artifactInput.security;
    let passed = true;
    if (criterion.label.includes("artifact not sent to Manager")) {
      passed = sec?.artifactToManager !== true;
    } else if (criterion.label.includes("raw history")) {
      passed = sec?.rawHistoryToWorker !== true;
    } else if (criterion.label.includes("raw memory")) {
      passed = sec?.rawMemoryToWorker !== true;
    } else {
      // Generic security check — map from VF-006/007/008
      const hasSecIssue = (sec?.artifactToManager === true)
        || (sec?.rawHistoryToWorker === true)
        || (sec?.rawMemoryToWorker === true);
      passed = !hasSecIssue;
    }
    return { ...baseResult(passed, passed ? "passed" : "security_issue"), severity: "security" };
  }

  // ── quality_threshold ──────────────────────────────────────────────────
  if (type === "quality_threshold") {
    const threshold = criterion.threshold ?? 0.5;
    const passed = verifierResult.score >= threshold;
    return baseResult(passed, passed ? "passed" : "below_threshold");
  }

  // ── llm_judged ─────────────────────────────────────────────────────────
  if (type === "llm_judged") {
    return {
      ...baseResult(null, "llm_judged_uncertain"),
      deterministic: false,
      confidence: 0.5,
    };
  }

  // ── human_review ───────────────────────────────────────────────────────
  if (type === "human_review") {
    return {
      ...baseResult(null, "requires_human_review"),
      deterministic: false,
      confidence: 0.5,
    };
  }

  // ── Fallback: unsupported type → not_applicable ────────────────────────
  return {
    ...baseResult(null, "not_applicable"),
    deterministic: false,
    confidence: 0.5,
  };
}

// ── recommendedAction 决策 ─────────────────────────────────────────────────

/**
 * 根据 criterion 评估结果决定 recommendedAction。
 *
 * 优先级（高→低）：
 * 1. security required 失败 → block
 * 2. human_review required=true → human_review
 * 3. required=true 且 passed=false → rewrite
 * 4. advisory（required=false）且 passed=false → revise
 * 5. 全部通过（或全部 null） → accept
 */
function decideRecommendedAction(
  results: CriterionVerificationResult[],
  hasSecurityFailure: boolean
): ContractVerificationResult["recommendedAction"] {
  // 1. Security 阻断
  if (hasSecurityFailure) return "block";

  // 2. Human review required
  const hasHumanReview = results.some(
    (r) => r.type === "human_review" && r.required === true
  );
  if (hasHumanReview) return "human_review";

  // 3. Required + failed
  const hasRequiredFailure = results.some(
    (r) => r.required === true && r.passed === false
  );
  if (hasRequiredFailure) return "rewrite";

  // 4. Advisory failure
  const hasAdvisoryFailure = results.some(
    (r) => r.required === false && r.passed === false
  );
  if (hasAdvisoryFailure) return "revise";

  // 5. Accept
  return "accept";
}

// ── Score 聚合 ───────────────────────────────────────────────────────────

/**
 * 基于 criterion 评估结果计算合约加权分。
 *
 * 规则：
 * - security severity failed → -0.4
 * - high severity failed → -0.2
 * - medium severity failed → -0.1
 * - low severity failed → -0.05
 * - null（不确定）→ 不扣分，但降低最终上限
 */
function computeCriteriaScore(
  results: CriterionVerificationResult[]
): number {
  let adjustment = 0;
  let nullCount = 0;
  let requiredNullCount = 0;

  for (const r of results) {
    if (r.passed === null) {
      nullCount++;
      if (r.required) requiredNullCount++;
      continue;
    }
    if (r.passed) continue;

    // Failed — apply penalty
    switch (r.severity) {
      case "security":
        adjustment -= 0.4;
        break;
      case "high":
        adjustment -= 0.2;
        break;
      case "medium":
        adjustment -= 0.1;
        break;
      case "low":
        adjustment -= 0.05;
        break;
    }
  }

  // 有未决项时降低上限
  const penaltyForUnresolved = nullCount > 0 || requiredNullCount > 0
    ? nullCount * 0.05 + requiredNullCount * 0.1
    : 0;

  return Math.max(0, Math.min(1, 1.0 + adjustment - penaltyForUnresolved));
}

// ── Main Verifier ────────────────────────────────────────────────────────

/**
 * Contract-aware artifact verification。
 *
 * S74P 入口：消费 TaskContractV0.verificationCriteria[]，
 * 产出 CriterionVerificationResult[] + ContractVerificationResult。
 *
 * 行为：
 * - 仍然调用 verifyArtifact() 获取 base VerificationResult（向后兼容）
 * - 对每条 criteria 做 criterion-level 评估
 * - 返回 ContractVerificationResult（含 recommendedAction）
 *
 * 不改变：
 * - 现有 Verifier V0 scoring
 * - QualityRouter threshold
 * - qualityRouting.decision
 */
export function verifyAgainstCriteria(
  artifactInput: ArtifactVerifierInput,
  criteria: VerificationCriterion[]
): ContractVerificationResult {
  const startMs = Date.now();

  // 1. Get base VerificationResult（不改变现有行为）
  const verifierResult = verifyArtifact(artifactInput);

  // 2. Evaluate each criterion
  const results: CriterionVerificationResult[] = criteria.map((c) =>
    evaluateCriterion(c, verifierResult, artifactInput)
  );

  // 3. Classify results
  const criteriaPassed = results.filter((r) => r.passed === true).length;
  const criteriaFailed = results.filter((r) => r.passed === false).length;

  // 4. Security failure check（关键：security required 失败即阻断）
  const hasSecurityFailure = results.some(
    (r) => r.severity === "security" && r.required === true && r.passed === false
  );

  // 5. Human review required check
  const hasHumanReviewRequired = results.some(
    (r) => r.type === "human_review" && r.required === true
  );

  // 6. Blocking issues count（security + high severity required failures）
  const blockingIssues = results.filter(
    (r) =>
      (r.severity === "security" || r.severity === "high") &&
      r.required === true &&
      r.passed === false
  ).length;

  // 7. recommendedAction
  const recommendedAction = decideRecommendedAction(results, hasSecurityFailure);

  // 8. Score aggregation
  const score = Math.round(computeCriteriaScore(results) * 100) / 100;

  // 9. Overall passed: no required failures (null is not a failure)
  const requiredFailures = results.filter(
    (r) => r.required === true && r.passed === false
  ).length;
  const passed = requiredFailures === 0;

  return {
    traceId: artifactInput.traceId,
    base: {
      passed: verifierResult.passed,
      score: verifierResult.score,
      issues: verifierResult.issues.map((i) => ({
        code: i.code,
        severity: i.severity,
        message: i.message,
      })),
    },
    passed,
    score,
    criteriaEvaluated: results.length,
    criteriaPassed,
    criteriaFailed,
    blockingIssues,
    results,
    recommendedAction,
    hasHumanReviewRequired,
    hasSecurityFailure,
    decisionMs: Date.now() - startMs,
  };
}

// ── Ledger Audit Extract ─────────────────────────────────────────────────

/**
 * 从 ContractVerificationResult 构建 SSE/ledger-safe audit extract。
 *
 * 不包含：
 * - criterion label / description / expected
 * - raw artifact content
 * - base issues detail（只记 counts）
 */
export interface ContractVerificationAuditExtract {
  /** 关联 trace ID */
  traceId: string;
  /** 原始 Verifier V0 是否通过 */
  basePassed: boolean;
  /** 原始 Verifier V0 score */
  baseScore: number;
  /** 合约评估是否通过 */
  passed: boolean;
  /** 合约加权分 */
  score: number;
  /** 评估的 criteria 数 */
  criteriaEvaluated: number;
  /** 通过的 criteria 数 */
  criteriaPassed: number;
  /** 失败的 criteria 数 */
  criteriaFailed: number;
  /** 阻断性问题数 */
  blockingIssues: number;
  /** 建议行动 */
  recommendedAction: ContractVerificationResult["recommendedAction"];
  /** 是否有必须人工验收的 criterion */
  hasHumanReviewRequired: boolean;
  /** 是否有 security failure */
  hasSecurityFailure: boolean;
  /** 未决（null）criteria 数 */
  unresolvedCount: number;
  /** 评估耗时（毫秒） */
  decisionMs: number;
}

export function buildContractVerificationAudit(
  result: ContractVerificationResult
): ContractVerificationAuditExtract {
  return {
    traceId: result.traceId,
    basePassed: result.base.passed,
    baseScore: result.base.score,
    passed: result.passed,
    score: result.score,
    criteriaEvaluated: result.criteriaEvaluated,
    criteriaPassed: result.criteriaPassed,
    criteriaFailed: result.criteriaFailed,
    blockingIssues: result.blockingIssues,
    recommendedAction: result.recommendedAction,
    hasHumanReviewRequired: result.hasHumanReviewRequired,
    hasSecurityFailure: result.hasSecurityFailure,
    unresolvedCount: result.results.filter((r) => r.passed === null).length,
    decisionMs: result.decisionMs,
  };
}
