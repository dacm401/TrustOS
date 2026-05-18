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
