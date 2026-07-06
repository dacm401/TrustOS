/**
 * S100P-010: Visibility Routing Types
 *
 * Defines the type system for event visibility routing.
 * Maps event type + severity + context → visibility level.
 */

// ── Visibility Levels (must match session_events.visibility CHECK constraint) ──

export type VisibilityLevel =
  | "silent_audit"
  | "session_timeline"
  | "approval_required"
  | "manager_chat_summary"
  | "trust_report_only"
  | "critical_alert";

// ── Input ────────────────────────────────────────────────────────────────────

export interface VisibilityRoutingInput {
  event_type: string;
  severity: string;
  risk_level?: string | null;
  action_type?: string | null;
  decision?: string | null;
}

// ── Output ───────────────────────────────────────────────────────────────────

export interface VisibilityRoutingResult {
  visibility: VisibilityLevel;
  reason: string;
}
