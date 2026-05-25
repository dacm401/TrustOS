/**
 * S77P: Human Review Queue V0 — Schema
 *
 * 将 runCycle() 的 human_review 终态转换为持久化审核请求。
 * 不泄漏 raw artifact / history / memory / sensitive criterion fields。
 */

import type { TaskContractV0 } from "../task-contract/task-contract-types.js";

// ── Status ────────────────────────────────────────────────────────────────────

export type HumanReviewStatus =
  | "pending"         // 待处理
  | "approved"        // 人工放行
  | "rejected"       // 人工拒绝
  | "needs_revision"  // 需要修改后重新提交
  | "cancelled";     // 取消

// ── Reason Code ─────────────────────────────────────────────────────────────

export type HumanReviewReasonCode =
  | "required_human_review"  // contract 条款声明需要人工验收
  | "llm_uncertain"          // LLM 判断不确定
  | "high_risk"             // 高风险操作
  | "security_sensitive"    // 安全敏感
  | "manual_escalation";    // 手动升级

// ── Severity ─────────────────────────────────────────────────────────────────

export type HumanReviewSeverity = "low" | "medium" | "high" | "security";

// ── Resolution ────────────────────────────────────────────────────────────────

export interface HumanReviewResolution {
  action: "accept" | "revise" | "rewrite" | "block";
  note?: string;
  resolvedBy?: string;
}

// ── Audit (safe, no raw content) ─────────────────────────────────────────────

export interface HumanReviewAudit {
  taskId: string;
  riskLevel?: string;
  recommendedAction: "human_review";
  criteriaCount: number;
  blockingIssues: number;
  hasSecurityIssue: boolean;
}

// ── Human Review Request ─────────────────────────────────────────────────────

export interface HumanReviewRequest {
  /** 唯一 ID */
  id: string;
  /** 关联任务 ID（task_archive id） */
  taskId: string;
  /** 关联 contract ID（若有） */
  contractId?: string;
  /** 触发该请求的 cycle 序号 */
  cycleIndex: number;
  /** 当前状态 */
  status: HumanReviewStatus;
  /** 原因码 */
  reasonCode: HumanReviewReasonCode;
  /** 严重程度 */
  severity: HumanReviewSeverity;
  /** 创建时间（ISO 8601） */
  createdAt: string;
  /** 处置时间（ISO 8601） */
  resolvedAt?: string;
  /** 处置结果 */
  resolution?: HumanReviewResolution;
  /** 安全审计域（不含 raw content） */
  audit: HumanReviewAudit;
}

// ── Create Params ─────────────────────────────────────────────────────────────

export interface CreateHumanReviewRequestParams {
  taskId: string;
  contractId?: string;
  cycleIndex: number;
  reasonCode: HumanReviewReasonCode;
  severity: HumanReviewSeverity;
  contractVerificationResult: {
    criteriaCount: number;
    blockingIssues: number;
    hasSecurityIssue: boolean;
    riskLevel?: string;
  };
}

// ── Repository Interface ─────────────────────────────────────────────────────

export interface HumanReviewRequestRepo {
  create(req: Omit<HumanReviewRequest, "id" | "status" | "createdAt">): Promise<HumanReviewRequest>;
  getById(id: string): Promise<HumanReviewRequest | null>;
  list(opts?: { status?: HumanReviewStatus; limit?: number }): Promise<HumanReviewRequest[]>;
  resolve(
    id: string,
    resolution: HumanReviewResolution,
    setStatus?: HumanReviewRequest["status"]
  ): Promise<HumanReviewRequest>;
  updateStatus(id: string, status: HumanReviewStatus): Promise<void>;
}

// ── Audit for SSE / Ledger (safe subset) ─────────────────────────────────────

export interface HumanReviewAuditSummary {
  requestId: string;
  status: HumanReviewStatus;
  reasonCode: HumanReviewReasonCode;
  severity: HumanReviewSeverity;
  cycleIndex: number;
  createdAt: string;
}

export function toAuditSummary(req: HumanReviewRequest): HumanReviewAuditSummary {
  return {
    requestId: req.id,
    status: req.status,
    reasonCode: req.reasonCode,
    severity: req.severity,
    cycleIndex: req.cycleIndex,
    createdAt: req.createdAt,
  };
}

// ── S78P: Resolution Event ────────────────────────────────────────────────────

/**
 * Human Review 处置事件。
 * 用于 SSE stream 和 Ledger audit extract。
 * resolution.note 是人工填写字段，事件中保留；
 * audit 相关字段（reasonCode/severity）不泄漏 raw content。
 */
export interface HumanReviewResolutionEvent {
  type: "human_review.resolved";
  requestId: string;
  taskId: string;
  cycleIndex: number;
  /** resolve 前必须是 pending */
  previousStatus: "pending";
  newStatus: HumanReviewStatus;  // "approved" | "rejected" | "needs_revision" | "cancelled"
  action: HumanReviewResolution["action"];
  resolvedBy?: string;
  resolvedAt: string;
  reasonCode: HumanReviewReasonCode;
  severity: HumanReviewSeverity;
}

/**
 * SSE done event 中携带的 resolution 摘要。
 * 不含 raw content。
 */
export interface HumanReviewResolutionSSEPayload {
  requestId: string;
  newStatus: HumanReviewStatus;
  action: HumanReviewResolution["action"];
  resolvedAt: string;
  reasonCode: HumanReviewReasonCode;
  severity: HumanReviewSeverity;
}

// ── S79P: Resume Decision ──────────────────────────────────────────────────

/**
 * S79P:处置后的下一步行动。
 * V0 只做 decision，不自动执行 Cycle resume。
 */
export type NextAction =
  | "accept_final"          // approved → 交付终态
  | "resume_with_revision"  // needs_revision + revise → 继续 Cycle
  | "resume_with_rewrite"   // needs_revision + rewrite → 继续 Cycle
  | "block_final"           // rejected → 阻断终态
  | "cancel_task"           // cancelled → 取消终态
  | "no_action";            // 未知/未匹配状态

export type ExecutionMode = "manual" | "queued" | "blocked";

/**
 * S79P: Human Review Resume Decision。
 * 将已处置的 HumanReviewRequest 转换为可审计的下一步决策。
 * audit 域不含 raw artifact / history / memory / criterion 文本。
 */
export interface HumanReviewResumeDecision {
  /** 唯一 ID */
  id: string;
  /** 关联的 HumanReviewRequest ID */
  reviewRequestId: string;
  /** 关联任务 ID */
  taskId: string;
  /** 决策生成时间（ISO 8601） */
  createdAt: string;

  /** 决策来源 */
  source: {
    reviewStatus: HumanReviewStatus;
    resolutionAction: HumanReviewResolution["action"] | null;
  };

  /** 下一步行动 */
  nextAction: NextAction;
  /** 执行模式 */
  executionMode: ExecutionMode;

  /** 安全审计域（不含 raw content） */
  audit: {
    cycleIndex: number;
    reasonCode: HumanReviewReasonCode;
    severity: HumanReviewSeverity;
    hasSecurityIssue: boolean;
    requiresOperatorConfirmation: boolean;
  };
}

// ── S80P: Resume Decision Repository Interface ─────────────────────────────

export interface HumanReviewResumeDecisionRepo {
  create(decision: Omit<HumanReviewResumeDecision, "id">): Promise<HumanReviewResumeDecision>;
  getById(id: string): Promise<HumanReviewResumeDecision | null>;
  getByReviewRequestId(reviewRequestId: string): Promise<HumanReviewResumeDecision | null>;
  list(opts?: {
    nextAction?: NextAction;
    executionMode?: ExecutionMode;
    limit?: number;
  }): Promise<HumanReviewResumeDecision[]>;
}

// ── S81P: Resume Execution Result ────────────────────────────────────────

/**
 * S81P: Resume Execution Status。
 * 表示执行结果的状态。
 */
export type ResumeExecutionStatus =
  | "executed"                 // 已成功执行
  | "blocked"                 // 被阻断（block_final / cancel_task）
  | "requires_confirmation"    // 需要人工确认（manual 模式）
  | "unsupported";            // 不支持的 action（resume_with_revision / resume_with_rewrite）

/**
 * S81P: 已执行的 Resume Action。
 * S81P V0 只支持 terminal actions。
 */
export type ExecutedResumeAction =
  | "accept_final"   // 接受并交付
  | "block_final"    // 阻断
  | "cancel_task"    // 取消任务
  | "none";          // 未执行任何 action

/**
 * S81P: Human Review Resume Execution Result。
 * 执行结果记录，绑定 decisionId 以保持审计链。
 * audit 域不含 raw artifact / history / memory / criterion 文本 / resolution.note。
 */
export interface HumanReviewResumeExecutionResult {
  /** 唯一 ID */
  id: string;
  /** 关联的 Resume Decision ID（审计链关键） */
  decisionId: string;
  /** 关联的 HumanReviewRequest ID */
  reviewRequestId: string;
  /** 关联任务 ID */
  taskId: string;

  /** 执行状态 */
  status: ResumeExecutionStatus;
  /** 已执行的 action */
  executedAction: ExecutedResumeAction;

  /** 创建时间（ISO 8601） */
  createdAt: string;
  /** 执行时间（ISO 8601，仅 executed/blocked） */
  executedAt?: string;

  /** 安全审计域（不含 raw content） */
  audit: {
    nextAction: NextAction;
    executionMode: ExecutionMode;
    requiresOperatorConfirmation: boolean;
    reasonCode: HumanReviewReasonCode;
    severity: HumanReviewSeverity;
  };
}

// ── S81P: Resume Execution Repository Interface ───────────────────────────

export interface HumanReviewResumeExecutionRepo {
  create(result: Omit<HumanReviewResumeExecutionResult, "id">): Promise<HumanReviewResumeExecutionResult>;
  getById(id: string): Promise<HumanReviewResumeExecutionResult | null>;
  getByDecisionId(decisionId: string): Promise<HumanReviewResumeExecutionResult | null>;
  list(opts?: {
    status?: ResumeExecutionStatus;
    executedAction?: ExecutedResumeAction;
    limit?: number;
  }): Promise<HumanReviewResumeExecutionResult[]>;
}

// ── S82P: Resume Execution Event ─────────────────────────────────────────

/**
 * S82P: Human Review Resume Execution 审计事件。
 * 用于 API 响应和 Ledger/SSE done payload。
 *
 * 不含 raw artifact/history/memory/criterion 文本。
 * 不含 resolution.note（人工输入，不属于 safe audit metadata）。
 *
 * Event id 格式：`human_review_resume_execution_event_${execution.id}`（deterministic）。
 */
export interface HumanReviewResumeExecutionEvent {
  type: "human_review.resume_execution";
  /** Deterministic event id：`human_review_resume_execution_event_${execution.id}` */
  id: string;
  /** 关联的 execution ID */
  executionId: string;
  /** 关联的 decision ID（审计链） */
  decisionId: string;
  /** 关联的 HumanReviewRequest ID（审计链） */
  reviewRequestId: string;
  /** 关联任务 ID */
  taskId: string;
  /** 执行状态 */
  status: ResumeExecutionStatus;
  /** 已执行的 action */
  executedAction: ExecutedResumeAction;
  /** 执行时间（ISO 8601） */
  createdAt: string;
  /** 审计元数据（安全子集） */
  audit: {
    nextAction: NextAction;
    executionMode: ExecutionMode;
    requiresOperatorConfirmation: boolean;
    reasonCode: HumanReviewReasonCode;
    severity: HumanReviewSeverity;
  };
}

/**
 * S82P: Ledger / SSE done payload 中的 execution 摘要。
 * 比 Event 更精简，用于快速解析。
 */
export interface HumanReviewResumeExecutionLedgerExtract {
  executionId: string;
  decisionId: string;
  reviewRequestId: string;
  taskId: string;
  status: string;
  executedAction: string;
  nextAction: string;
  executionMode: string;
  requiresOperatorConfirmation: boolean;
}
