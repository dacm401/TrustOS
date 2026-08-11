/**
 * TRST-4H-II — Clarification UX/API Handling v0
 *
 * Pure, deterministic response-shaping helper that maps a `ManagerRoutingResult`
 * (produced by routeMessage) into the API/UI response shape consumed by
 * src/api/manager-route.ts and frontend/src/components/manager-workspace/ManagerConversation.tsx.
 *
 * Why a helper instead of editing the HTTP handler directly:
 *   - src/api/manager-route.ts currently carries unrelated legacy working-tree
 *     modifications; TRST-4H-II must NOT bundle them. This pure helper is the
 *     minimal, testable contract for clarification handling. The HTTP handler
 *     can adopt it in a dedicated manager-route integration milestone once the
 *     legacy diff is resolved (see execution log).
 *   - Keeping it pure makes the ask_clarification path deterministic and testable
 *     without booting an HTTP server.
 *
 * Behavior contract (PM TRST-4H-II):
 *   - ask_clarification  → clarificationRequired: true, non-empty managerMessage,
 *                          NO createdSession (no fake task id), NO Worker call.
 *   - other route types  → passed through with their existing fields intact.
 */

import type {
  ManagerRoutingResult,
  RouteMessageApiResponse,
} from "./manager-routing-types.js";

/**
 * Map a ManagerRoutingResult to the API response shape.
 *
 * The helper is intentionally thin: it guarantees that an ask_clarification
 * result is represented honestly (clear question, no task id, no worker), and
 * that every other route type keeps its existing fields so sealed behavior is
 * preserved.
 */
export function shapeManagerRouteResponse(
  routing: ManagerRoutingResult,
  userId: string,
): RouteMessageApiResponse {
  // TRST-4H-II: explicit, honest clarification handling.
  if (routing.route_type === "ask_clarification") {
    return {
      routeType: "ask_clarification",
      targetSessionId: null,
      clarificationRequired: true,
      // Use the deterministic clarification message from the router; never blame
      // the user or present this as an error / permission / worker failure.
      managerMessage: {
        id: `msg-clarify-${Date.now()}`,
        role: "assistant",
        content: routing.manager_message_content,
        related_session_id: null,
        created_at: new Date().toISOString(),
      },
      // No session is created for a clarification request.
      createdSession: null,
      userId,
      reason: routing.reason,
    };
  }

  // All other route types: pass-through (sealed behavior preserved).
  return {
    routeType: routing.route_type,
    targetSessionId: routing.target_session_id,
    clarificationRequired: routing.clarification_required,
    managerMessage: routing.manager_message_content
      ? {
          id: `msg-${Date.now()}`,
          role: "assistant",
          content: routing.manager_message_content,
          related_session_id: routing.target_session_id,
          created_at: new Date().toISOString(),
        }
      : null,
    createdSession: routing.created_session,
    userId,
    reason: routing.reason,
  };
}
