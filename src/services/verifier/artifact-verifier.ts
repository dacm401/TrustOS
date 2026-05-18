/**
 * Sprint 65P: Artifact Verifier V0
 *
 * 本地确定性质量检查器。零 LLM 调用，零数据库写入，纯函数。
 *
 * V0 检查规则：
 *   VF-001  content 非空
 *   VF-002  artifactType 已知（非 unknown）
 *   VF-003  React/TSX artifact 包含 export default 或函数组件结构
 *   VF-004  revision lineage 与 expectedRevisionOfArtifactId 一致
 *   VF-005  patchApplied=true 时 content 必须非空
 *   VF-006  artifactToManager 必须 false
 *   VF-007  rawHistoryToWorker 必须 false
 *   VF-008  rawMemoryToWorker 必须 false
 */

import type {
  VerificationResult,
  VerificationIssue,
  VerificationChecks,
  VerificationLedgerEntry,
} from "./verifier-types.js";

// ── Env Gate ──────────────────────────────────────────────────────────────────

const VERIFIER_ENABLED = process.env.TRUSTOS_VERIFIER_ENABLED !== "false";

// ── Known Artifact Types ──────────────────────────────────────────────────────

const KNOWN_ARTIFACT_TYPES = new Set([
  "text",
  "markdown",
  "code",
  "html",
  "tsx",
  "json",
]);

// ── React Structure Patterns ──────────────────────────────────────────────────

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

// ── Score Calculator ──────────────────────────────────────────────────────────

function calcScore(issues: VerificationIssue[]): number {
  let score = 1.0;
  for (const issue of issues) {
    if (issue.severity === "error") score -= 0.3;
    else if (issue.severity === "warning") score -= 0.1;
  }
  return Math.max(0, Math.round(score * 100) / 100);
}

// ── Main Verifier ─────────────────────────────────────────────────────────────

export interface ArtifactVerifierInput {
  traceId: string;
  /** Detected content type from WorkerResultEnvelope */
  artifactType?: string;
  /** Artifact content */
  content?: string;
  /** revision of artifact (actual, from lineage) */
  revisionOfArtifactId?: string | null;
  /** expected revision source (from Policy decision) */
  expectedRevisionOfArtifactId?: string | null;
  /** Whether patch was applied in this revision */
  patchApplied?: boolean;
  /** Security flags from ledger */
  security?: {
    /** artifact 原文发给了 Manager LLM（应为 false） */
    artifactToManager?: boolean;
    /** raw history 发给了 Worker（应为 false） */
    rawHistoryToWorker?: boolean;
    /** raw memory 发给了 Worker（应为 false） */
    rawMemoryToWorker?: boolean;
  };
}

export function verifyArtifact(input: ArtifactVerifierInput): VerificationResult {
  if (!VERIFIER_ENABLED) {
    return {
      traceId: input.traceId,
      enabled: false,
      verifierVersion: "v0",
      targetType: "artifact",
      passed: true,
      score: 1.0,
      issues: [],
      checks: { nonEmpty: true, artifactTypeKnown: true },
      decisionMs: 0,
    };
  }

  const startMs = Date.now();
  const issues: VerificationIssue[] = [];
  const checks: VerificationChecks = {
    nonEmpty: false,
    artifactTypeKnown: false,
  };

  const content = input.content ?? "";
  const artifactType = input.artifactType ?? "unknown";

  // ── VF-001: content 非空 ────────────────────────────────────────────────────
  if (!content || !content.trim()) {
    issues.push({
      code: "VF-001",
      severity: "error",
      message: "Artifact content is empty.",
    });
    checks.nonEmpty = false;
  } else {
    checks.nonEmpty = true;
  }

  // ── VF-002: artifactType 已知 ────────────────────────────────────────────────
  if (!artifactType || artifactType === "unknown") {
    issues.push({
      code: "VF-002",
      severity: "warning",
      message: `Artifact type is unknown. Expected one of: ${[...KNOWN_ARTIFACT_TYPES].join(", ")}.`,
    });
    checks.artifactTypeKnown = false;
  } else {
    checks.artifactTypeKnown = true;
  }

  // ── VF-003: React 结构检查（仅 tsx/code 类型） ───────────────────────────────
  if (artifactType === "tsx" || (artifactType === "code" && content.includes("React"))) {
    const hasStructure = hasReactStructure(content);
    checks.reactStructurePresent = hasStructure;
    if (!hasStructure) {
      issues.push({
        code: "VF-003",
        severity: "warning",
        message: "React/TSX artifact appears to be missing 'export default' or function component structure.",
      });
    }
  }

  // ── VF-004: Revision Lineage ─────────────────────────────────────────────────
  // 只在两者均非 null/undefined 时才比较
  const actual = input.revisionOfArtifactId ?? null;
  const expected = input.expectedRevisionOfArtifactId ?? null;

  if (expected !== null && actual !== null) {
    const lineageValid = actual === expected;
    checks.lineageValid = lineageValid;
    if (!lineageValid) {
      issues.push({
        code: "VF-004",
        severity: "error",
        message: `Revision lineage mismatch: actual revisionOfArtifactId="${actual}" does not match expected="${expected}".`,
      });
    }
  } else if (expected !== null && actual === null) {
    // 期望有 lineage 但实际没有
    checks.lineageValid = false;
    issues.push({
      code: "VF-004",
      severity: "warning",
      message: `Expected revision of artifact "${expected}", but revisionOfArtifactId was not set.`,
    });
  }

  // ── VF-005: patch 后内容非空 ─────────────────────────────────────────────────
  if (input.patchApplied === true) {
    const patchContentValid = !!(content && content.trim());
    checks.patchContentValid = patchContentValid;
    if (!patchContentValid) {
      issues.push({
        code: "VF-005",
        severity: "error",
        message: "Patch was applied but resulting content is empty.",
      });
    }
  }

  // ── VF-006: artifact 未发给 Manager ──────────────────────────────────────────
  if (input.security?.artifactToManager === true) {
    checks.securityArtifactNotToManager = false;
    issues.push({
      code: "VF-006",
      severity: "error",
      message: "Security violation: artifact content was sent to Manager LLM (sentArtifactContentToManagerRemote=true).",
    });
  } else {
    checks.securityArtifactNotToManager = true;
  }

  // ── VF-007: raw history 未发给 Worker ─────────────────────────────────────────
  if (input.security?.rawHistoryToWorker === true) {
    checks.securityHistoryNotToWorker = false;
    issues.push({
      code: "VF-007",
      severity: "error",
      message: "Security violation: raw conversation history was sent to Worker (sentRawHistoryToRemote=true).",
    });
  } else {
    checks.securityHistoryNotToWorker = true;
  }

  // ── VF-008: raw memory 未发给 Worker ──────────────────────────────────────────
  if (input.security?.rawMemoryToWorker === true) {
    checks.securityMemoryNotToWorker = false;
    issues.push({
      code: "VF-008",
      severity: "error",
      message: "Security violation: raw memory was sent to Worker (sensitiveMemoryWasSent=true).",
    });
  } else {
    checks.securityMemoryNotToWorker = true;
  }

  // ── 汇总 ──────────────────────────────────────────────────────────────────────
  const hasErrors = issues.some((i) => i.severity === "error");
  const score = calcScore(issues);

  return {
    traceId: input.traceId,
    enabled: true,
    verifierVersion: "v0",
    // Sprint 65P: 根据 patchApplied 设置正确的 targetType
    // patch 场景（revision + patch applied）→ "patch"
    // artifact 场景（create 或 revision + full rewrite）→ "artifact"
    targetType: input.patchApplied === true ? "patch" : "artifact",
    passed: !hasErrors,
    score,
    issues,
    checks,
    decisionMs: Date.now() - startMs,
  };
}

// ── Ledger Summary Builder ─────────────────────────────────────────────────────

export function verificationToLedgerEntry(result: VerificationResult): VerificationLedgerEntry {
  const errorCount = result.issues.filter((i) => i.severity === "error").length;
  const warningCount = result.issues.filter((i) => i.severity === "warning").length;
  return {
    enabled: result.enabled,
    verifierVersion: result.verifierVersion,
    targetType: result.targetType,
    passed: result.passed,
    score: result.score,
    issueCount: result.issues.length,
    errorCount,
    warningCount,
    issues: result.issues.map((i) => ({
      code: i.code,
      severity: i.severity,
      message: i.message,
    })),
    decisionMs: result.decisionMs,
  };
}
