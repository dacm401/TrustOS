/**
 * S100P-010: Visibility Router
 *
 * Maps event type + severity + context → visibility level.
 * Phase 2 uses deterministic mapping rules (no LLM).
 *
 * Mapping rules (from PM spec):
 *   session.created         → session_timeline
 *   contract.generated      → session_timeline
 *   worker.progress         → session_timeline
 *   action.requested low-risk → silent_audit
 *   decision.made deny secret-like → session_timeline
 *   approval.requested      → approval_required
 *   worker.completed        → manager_chat_summary
 *   worker.failed           → critical_alert
 *   session.completed       → manager_chat_summary
 *   artifact.updated        → session_timeline
 */

import type {
  VisibilityRoutingInput,
  VisibilityRoutingResult,
  VisibilityLevel,
} from "./visibility-types.js";

// ── Direct event type → visibility mapping ───────────────────────────────────

const DIRECT_MAP: Record<string, VisibilityLevel> = {
  "session.created": "session_timeline",
  "session.updated": "session_timeline",
  "session.started": "session_timeline",
  "session.paused": "session_timeline",
  "session.resumed": "session_timeline",
  "session.cancelled": "session_timeline",
  "session.completed": "manager_chat_summary",
  "session.failed": "critical_alert",

  "contract.generated": "session_timeline",
  "artifact.updated": "session_timeline",

  "worker.assigned": "session_timeline",
  "worker.started": "session_timeline",
  "worker.progress": "session_timeline",
  "worker.completed": "manager_chat_summary",
  "worker.failed": "critical_alert",
  "worker.paused": "session_timeline",
  "worker.resumed": "session_timeline",

  "approval.requested": "approval_required",
  "approval.granted": "manager_chat_summary",
  "approval.denied": "manager_chat_summary",
  "approval.expired": "session_timeline",

  "plan.created": "session_timeline",
  "plan.updated": "session_timeline",
  "plan.executed": "session_timeline",
  "plan.failed": "critical_alert",

  "decision.made": "session_timeline",
  "decision.reviewed": "session_timeline",
  "decision.reversed": "session_timeline",

  "risk.assessed": "trust_report_only",
  "risk.mitigated": "trust_report_only",
};

// ── Special handling for action.requested ────────────────────────────────────

const SECRET_ACTION_KEYWORDS = ["secret", "password", "token", "api_key", "credential", "私钥", "密码", "令牌"];

// ── Main Router ──────────────────────────────────────────────────────────────

export function routeVisibility(input: VisibilityRoutingInput): VisibilityRoutingResult {
  const { event_type, severity, risk_level, action_type, decision } = input;

  // Special case: action.requested depends on risk_level
  if (event_type === "action.requested") {
    if (risk_level === "low") {
      return {
        visibility: "silent_audit",
        reason: "Low-risk action request — silent audit only",
      };
    }
    // Non-low-risk action requests go to session_timeline
    return {
      visibility: "session_timeline",
      reason: `Action request with risk_level=${risk_level || "unknown"} — visible on timeline`,
    };
  }

  // Special case: decision.made with deny of secret-like action
  if (event_type === "decision.made" && decision === "deny") {
    const actionLower = (action_type || "").toLowerCase();
    if (SECRET_ACTION_KEYWORDS.some(kw => actionLower.includes(kw))) {
      return {
        visibility: "session_timeline",
        reason: "Deny of secret-like action — visible on timeline for audit",
      };
    }
  }

  // Direct lookup
  const direct = DIRECT_MAP[event_type];
  if (direct) {
    return {
      visibility: direct,
      reason: `Direct mapping for ${event_type}`,
    };
  }

  // Fallback: severity-based routing
  if (severity === "critical") {
    return {
      visibility: "critical_alert",
      reason: `Unknown event type with critical severity — critical alert`,
    };
  }
  if (severity === "error") {
    return {
      visibility: "session_timeline",
      reason: `Unknown event type with error severity — session timeline`,
    };
  }

  // Default: session_timeline for info/warn/debug
  return {
    visibility: "session_timeline",
    reason: `Unknown event type, defaulting to session_timeline (severity=${severity})`,
  };
}
