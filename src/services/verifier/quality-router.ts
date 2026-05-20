/**
 * Sprint 66P: Quality-aware Routing V0
 * Sprint 67P: patchFirstBefore 快照 + advisory 语义固化
 *
 * 读取上一次 Verifier 结果，决定下一轮是否允许 patch-first。
 *
 * 核心规则：
 *   score >= 0.8            → allow_patch_first
 *   0.7 <= score < 0.8      → prefer_full_rewrite（advisory，soft preference）
 *   score < 0.7             → force_full_rewrite
 *   security error（severity=error 且 code VF-006/007/008）
 *                           → block_or_full_rewrite
 *   无先验数据               → allow_patch_first（保守：不惩罚首次）
 *
 * 原则：
 * - 不调用 LLM
 * - 不改 DB schema
 * - 不改 patch 逻辑本身，只影响 patchFirstEligible hint
 * - V0 不阻断输出，force/block 决策影响 patch-first eligibility
 *
 *
 * ─── 数据源边界声明（Sprint 67P 文档化）──────────────────────────────
 *
 * Module-level Map（_verificationStore）
 * ──────────────────────────────────────
 * 此 Map 是 **运行时 cache**，仅在当前进程生命周期内有效。
 * 用途：SSE done 后写入，下一轮请求读取（生产流程无持久化 history.verification）。
 *
 * 重要约束：
 * - **replay / SSR / 跨进程 场景必须使用 history meta.verification 作为 durable source**
 * - 进程重启或 SSR 调用链中，Map 被清空，fallback 到 history 扫描
 * - 查看 extractLastVerificationFromHistory() 的优先级顺序
 *
 * Durable source: history[role="assistant"][meta.origin="worker"][meta.verification]
 * Runtime cache:  _verificationStore (Map<string, VerificationLedgerEntry>)
 */

import type {
  ArtifactQualityState,
  QualityRoutingDecision,
  VerificationLedgerEntry,
} from "./verifier-types.js";

// ── Per-artifact Verification Store ───────────────────────────────────────────
// 在 SSE done 后写入，quality router 在下一轮读取。
// 解决：history 不持久化 verification 的生产场景。
const _verificationStore = new Map<string, VerificationLedgerEntry>();

export function setArtifactVerification(artifactId: string, entry: VerificationLedgerEntry): void {
  _verificationStore.set(artifactId, entry);
}

export function getArtifactVerification(artifactId: string): VerificationLedgerEntry | undefined {
  return _verificationStore.get(artifactId);
}

// ── Env Gate ──────────────────────────────────────────────────────────────────

export const QUALITY_ROUTING_ENABLED =
  process.env.TRUSTOS_QUALITY_ROUTING_ENABLED !== "false";

// ── Thresholds ────────────────────────────────────────────────────────────────

const SCORE_ALLOW_PATCH_FIRST = 0.8;
const SCORE_PREFER_FULL_REWRITE = 0.7;

// Security violation codes：任何一个触发 → block
const SECURITY_VIOLATION_CODES = new Set(["VF-006", "VF-007", "VF-008"]);

// ── Core Decision ─────────────────────────────────────────────────────────────

/**
 * 根据上一次 VerificationLedgerEntry 做出 quality-aware 路由决策。
 *
 * @param artifactId   当前操作的 artifact ID
 * @param lastEntry    上次 Verifier 结果（无则传 null）
 * @returns QualityRoutingDecision
 */
export function evaluateQualityRouting(
  artifactId: string,
  lastEntry: VerificationLedgerEntry | null | undefined,
): QualityRoutingDecision {
  const startMs = Date.now();

  if (!QUALITY_ROUTING_ENABLED) {
    return {
      enabled: false,
      source: "disabled",
      lastScore: null,
      decision: "allow_patch_first",
      reason: "quality routing disabled via TRUSTOS_QUALITY_ROUTING_ENABLED=false",
      decisionMs: Date.now() - startMs,
    };
  }

  // 无先验数据：允许 patch-first（不惩罚首次）
  if (!lastEntry) {
    return {
      enabled: true,
      source: "no_prior_verification",
      lastScore: null,
      decision: "allow_patch_first",
      reason: "no prior verification data; defaulting to allow_patch_first",
      decisionMs: Date.now() - startMs,
    };
  }

  const score = lastEntry.score;

  // 检查安全违规：优先触发，不等分数
  const hasSecurityViolation = lastEntry.issues?.some(
    (i) => SECURITY_VIOLATION_CODES.has(i.code) && i.severity === "error",
  );
  if (hasSecurityViolation) {
    return {
      enabled: true,
      source: "last_verification",
      lastScore: score,
      decision: "block_or_full_rewrite",
      reason: `security violation detected in last verification (score=${score}); blocking patch-first`,
      decisionMs: Date.now() - startMs,
    };
  }

  // score >= 0.8 → allow
  if (score >= SCORE_ALLOW_PATCH_FIRST) {
    return {
      enabled: true,
      source: "last_verification",
      lastScore: score,
      decision: "allow_patch_first",
      reason: `last verification score ${score} >= ${SCORE_ALLOW_PATCH_FIRST}; patch-first allowed`,
      decisionMs: Date.now() - startMs,
    };
  }

  // 0.7 <= score < 0.8 → prefer full rewrite
  if (score >= SCORE_PREFER_FULL_REWRITE) {
    return {
      enabled: true,
      source: "last_verification",
      lastScore: score,
      decision: "prefer_full_rewrite",
      reason: `last verification score ${score} in [${SCORE_PREFER_FULL_REWRITE}, ${SCORE_ALLOW_PATCH_FIRST}); preferring full rewrite`,
      decisionMs: Date.now() - startMs,
    };
  }

  // score < 0.7 → force full rewrite
  return {
    enabled: true,
    source: "last_verification",
    lastScore: score,
    decision: "force_full_rewrite",
    reason: `last verification score ${score} < ${SCORE_PREFER_FULL_REWRITE}; forcing full rewrite`,
    decisionMs: Date.now() - startMs,
  };
}

// ── ArtifactQualityState Builder ──────────────────────────────────────────────

/**
 * 从 VerificationLedgerEntry + QualityRoutingDecision 构建 ArtifactQualityState。
 */
export function buildArtifactQualityState(
  artifactId: string,
  lastEntry: VerificationLedgerEntry,
  routing: QualityRoutingDecision,
): ArtifactQualityState {
  return {
    artifactId,
    lastVerificationPassed: lastEntry.passed,
    lastVerificationScore: lastEntry.score,
    lastVerificationErrorCount: lastEntry.errorCount,
    lastVerificationWarningCount: lastEntry.warningCount,
    lastVerifiedAt: new Date().toISOString(),
    patchEligible: routing.decision === "allow_patch_first",
    reason: routing.reason,
  };
}

// ── Helper: extract from history meta ─────────────────────────────────────────

/**
 * 从 assistant history meta 提取上次 verification 快照。
 *
 * 优先级：
 * 1. 优先从 artifact store 读取（chat.ts SSE done 后写入）。
 * 2. 回退：从 history meta.verification 提取（proof 脚本 / 直接嵌入场景）。
 *
 * 期望结构：
 * ```
 * {
 *   role: "assistant",
 *   meta: {
 *     origin: "worker",
 *     contentKind: "artifact",
 *     verification: VerificationLedgerEntry,
 *   }
 * }
 * ```
 */
export function extractLastVerificationFromHistory(
  history: Array<{ role: string; content?: string; meta?: Record<string, unknown> }>,
  activeArtifactId?: string,
): VerificationLedgerEntry | null {
  // 1. 优先从 store 读取（生产流程）
  if (activeArtifactId !== undefined) {
    const stored = _verificationStore.get(activeArtifactId);
    if (stored) return stored;
  }
  // 2. 回退：从 history meta.verification 提取（proof 脚本 / 直接嵌入）
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (
      msg.role === "assistant" &&
      msg.meta?.origin === "worker" &&
      msg.meta?.contentKind === "artifact" &&
      msg.meta?.verification &&
      typeof msg.meta.verification === "object"
    ) {
      return msg.meta.verification as VerificationLedgerEntry;
    }
  }
  return null;
}
