/**
 * S85P: Simple Task Classifier Types
 *
 * Conservative eligibility rules for the fast path:
 * - No tool calls
 * - No external side effects
 * - Low risk (no security/compliance keywords)
 * - Short prompt
 * - Limited criteria
 * - No human_review signal
 * - Not a revision task
 */

// ── Classification Result ─────────────────────────────────────────────────

export interface SimpleTaskClassification {
  /** Whether this task is eligible for fast path */
  eligible: boolean;
  /** Reason code for eligibility decision */
  reasonCode: SimpleTaskReasonCode;
  /** Human-readable reason */
  reason: string;
}

export type SimpleTaskReasonCode =
  | "simple_no_tool_low_risk"
  | "has_tool_calls"
  | "has_external_side_effects"
  | "is_revision_task"
  | "prompt_too_long"
  | "has_verification_criteria"
  | "too_many_criteria"
  | "high_risk_keyword"
  | "security_compliance_keyword"
  | "requires_human_review"
  | "unknown";

// ── Classifier Input ──────────────────────────────────────────────────────

export interface SimpleTaskClassifierInput {
  /** Task brief / goal text */
  taskBrief: string;
  /** User goal */
  goal?: string;
  /** Constraints array */
  constraints?: string[];
  /** Required output sections */
  sections?: string[];
  /** Whether this is a revision task */
  isRevisionTask?: boolean;
  /** Whether the task involves tool calls */
  hasToolCalls?: boolean;
  /** Whether the task involves external side effects */
  hasExternalSideEffects?: boolean;
  /** Max prompt length considered "short" (default: 2000 chars) */
  maxPromptLength?: number;
  /** Max number of criteria/sections for simple tasks (default: 3) */
  maxSimpleCriteria?: number;
}

// ── Default thresholds ────────────────────────────────────────────────────

export const S85P_DEFAULTS = {
  /** Prompts longer than this are ineligible for fast path */
  MAX_PROMPT_LENGTH: 2000,
  /**
   * Max simple criteria/sections allowed for fast path.
   * V0: 0 — any verification criteria disqualifies fast path.
   * This is the most conservative setting: only tasks with zero
   * sections/constraints can use the fast path.
   * Future S86P may relax this with simple-criteria classification.
   */
  MAX_SIMPLE_CRITERIA: 0,
} as const;

// ── High-risk keywords (conservative) ─────────────────────────────────────

const HIGH_RISK_KEYWORDS = [
  "security", "vulnerability", "vulnerabilities", "exploit", "injection", "xss", "csrf",
  "authentication bypass", "privilege escalation", "data leak", "data breach",
  "credential", "password", "secret", "token leak",
  "destructive",
] as const;

const SECURITY_COMPLIANCE_KEYWORDS = [
  "gdpr", "hipaa", "pci", "soc2", "iso27001",
  "compliance", "audit", "regulatory", "legal review",
  "medical", "healthcare", "patient", "diagnosis",
  "financial advice", "investment advice", "legal advice",
  "personally identifiable", "pii", "personal data",
  "sensitive", "confidential", "classified",
  "payment",
] as const;

const HUMAN_REVIEW_SIGNALS = [
  "human_review", "human review", "requires approval",
  "manual review", "needs sign-off",
] as const;

export { HIGH_RISK_KEYWORDS, SECURITY_COMPLIANCE_KEYWORDS, HUMAN_REVIEW_SIGNALS };
