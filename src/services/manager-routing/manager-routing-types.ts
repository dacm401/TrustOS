/**
 * S100P-009: Manager Routing Types
 *
 * Defines the type system for Manager Loop message routing.
 * The Manager Router determines where a user message should go:
 *   - normal conversation
 *   - new delegated task (creates a Session)
 *   - update to an existing Session
 *   - ambiguous reference (asks for clarification)
 */

// ── Route Types ──────────────────────────────────────────────────────────────

export type RouteType =
  | "normal_conversation"
  | "new_delegated_task"
  | "update_existing_session"
  | "ambiguous_session_reference"
  // TRST-4H-I: explicit clarification route from hybrid routing intelligence
  // (distinct from ambiguous_session_reference which is session-reference specific).
  | "ask_clarification";

// ── Routing Input ────────────────────────────────────────────────────────────

export interface ManagerRoutingInput {
  user_id: string;
  conversation_id: string;
  message: string;
  /** Optional explicit target session ID (user selected a session) */
  target_session_id?: string | null;
  /** Active sessions for the user (for reference matching) */
  active_sessions: ActiveSessionSummary[];
}

export interface ActiveSessionSummary {
  id: string;
  title: string;
  goal: string | null;
  status: string;
}

// ── Routing Output ───────────────────────────────────────────────────────────

/**
 * API/UI response shape for /v1/manager/route-message.
 * Produced by the TRST-4H-II response-shaping helper so the HTTP handler and
 * frontend share one contract for clarification + other routes.
 */
export interface RouteMessageApiResponse {
  routeType: RouteType;
  targetSessionId: string | null;
  clarificationRequired: boolean;
  managerMessage: {
    id: string;
    role: "assistant" | "system";
    content: string;
    related_session_id: string | null;
    created_at: string;
  } | null;
  createdSession: NewSessionSuggestion | null;
  userId: string;
  reason: string;
}

export interface ManagerRoutingResult {
  route_type: RouteType;
  /** Set when route targets a specific session */
  target_session_id: string | null;
  /** True when Manager should ask user to clarify */
  clarification_required: boolean;
  /** Suggested manager message content (to be stored in manager_messages) */
  manager_message_content: string;
  /** Suggested session event to create (null for normal_conversation) */
  session_event: SessionEventSuggestion | null;
  /** Suggested new session to create (null unless new_delegated_task) */
  created_session: NewSessionSuggestion | null;
  /** Human-readable reason for the routing decision */
  reason: string;
}

export interface SessionEventSuggestion {
  type: string;
  summary: string;
  visibility: string;
  severity: string;
}

export interface NewSessionSuggestion {
  title: string;
  goal: string;
  status: "planning" | "delegated";
  risk_level: "low" | "medium";
  delegation_contract: Record<string, unknown>;
}
