/**
 * Sprint 65P: Verifier V0 — 类型定义
 *
 * 本地、确定性、零 LLM 成本的 artifact 质量检查层。
 * 在 Worker 结果写入 archive / 返回给用户之前执行。
 *
 * 原则：
 * - 不调用 LLM
 * - 不做 AST 解析（纯正则/字符串）
 * - 不做浏览器渲染
 * - severity=error → passed=false
 * - severity=warning → passed=true，但 score 降低
 * - V0 默认不阻断输出，只记录 ledger
 */

export type VerificationSeverity = "info" | "warning" | "error";

export interface VerificationIssue {
  /** 问题代码（如 VF-002） */
  code: string;
  /** 严重性 */
  severity: VerificationSeverity;
  /** 人类可读描述 */
  message: string;
  /** 可选路径/上下文 */
  path?: string;
}

export interface VerificationChecks {
  /** artifact 内容非空 */
  nonEmpty: boolean;
  /** artifact 类型已知（非 unknown） */
  artifactTypeKnown: boolean;
  /** React/TSX artifact 存在 export default 或函数组件结构 */
  reactStructurePresent?: boolean;
  /** revision lineage 与预期一致 */
  lineageValid?: boolean;
  /** 安全不变量：artifact 未发送给 Manager */
  securityArtifactNotToManager?: boolean;
  /** 安全不变量：raw history 未发送给 Worker */
  securityHistoryNotToWorker?: boolean;
  /** 安全不变量：raw memory 未发送给 Worker */
  securityMemoryNotToWorker?: boolean;
  /** patch 后内容非空（patchApplied=true 时） */
  patchContentValid?: boolean;
}

export interface VerificationResult {
  /** 关联的 trace ID */
  traceId: string;
  /** Verifier 是否启用 */
  enabled: boolean;
  /** Verifier 版本 */
  verifierVersion: "v0";
  /** 验证目标类型 */
  targetType: "artifact" | "patch" | "response";
  /** 整体是否通过（任何 error → false） */
  passed: boolean;
  /**
   * 质量分（0.0–1.0）
   * 起始 1.0，每个 error -0.3，每个 warning -0.1，下限 0.0
   */
  score: number;
  /** 所有发现的问题 */
  issues: VerificationIssue[];
  /** 各项检查明细 */
  checks: VerificationChecks;
  /** Verifier 执行耗时（毫秒） */
  decisionMs: number;
}

/** SSE done / RequestLedger 嵌入的 Verifier 摘要 */
export interface VerificationLedgerEntry {
  enabled: boolean;
  verifierVersion: "v0";
  targetType: "artifact" | "patch" | "response";
  passed: boolean;
  score: number;
  issueCount: number;
  errorCount: number;
  warningCount: number;
  issues: Array<{
    code: string;
    severity: VerificationSeverity;
    message: string;
  }>;
  decisionMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 66P: ArtifactQualityState — 上一次验证结果，供 Policy 读取
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 某个 artifact 上一次 Verifier 的质量快照。
 *
 * 来源：history 中最近一条带 meta.verification 的 assistant 消息，
 * 或 SSE done 事件里的 verification 字段。
 *
 * Policy-first Router 在决定是否继续 patch-first 时读取此结构。
 */
export interface ArtifactQualityState {
  /** 关联的 artifact ID */
  artifactId: string;
  /** 上次是否通过 */
  lastVerificationPassed: boolean;
  /** 上次质量分（0.0–1.0） */
  lastVerificationScore: number;
  /** 上次 error 数量 */
  lastVerificationErrorCount: number;
  /** 上次 warning 数量 */
  lastVerificationWarningCount: number;
  /** 验证时间（ISO string） */
  lastVerifiedAt: string;
  /** Policy 是否允许 patch-first（由 evaluateQualityRouting 填充） */
  patchEligible: boolean;
  /** patch-first 决策原因 */
  reason: string;
}

/**
 * Quality-aware Routing 决策结果。
 *
 * 嵌入 SSE done ledger.qualityRouting 字段；
 * 也作为 Policy hint 传递给下一轮路由决策。
 */
export interface QualityRoutingDecision {
  /** 是否启用（TRUSTOS_QUALITY_ROUTING_ENABLED 控制） */
  enabled: boolean;
  /** 决策数据来源 */
  source: "last_verification" | "no_prior_verification" | "disabled";
  /** 上次 score（0.0–1.0），无先验数据时为 null */
  lastScore: number | null;
  /** 路由决策 */
  decision: "allow_patch_first" | "prefer_full_rewrite" | "force_full_rewrite" | "block_or_full_rewrite";
  /** 决策原因 */
  reason: string;
  /** 决策耗时（毫秒） */
  decisionMs: number;
}
