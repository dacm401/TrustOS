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
  resolve(id: string, resolution: HumanReviewResolution): Promise<HumanReviewRequest>;
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
