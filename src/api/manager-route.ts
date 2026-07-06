/**
 * S100P-009/010: Manager Route Message API
 *
 * POST /v1/manager/route-message
 *
 * Accepts a user message in the Manager Loop, routes it to the correct
 * destination (normal conversation, new delegated task, update existing
 * session, or clarification request), and creates the appropriate records.
 *
 * Phase 2: Backend routing only, no UI.
 */

import { Hono } from "hono";
import { getContextUserId } from "../middleware/identity.js";
import { AgentSessionRepo } from "../db/repositories/agent-session.js";
import { ManagerMessageRepo } from "../db/repositories/manager-message.js";
import { SessionEventRepo } from "../db/repositories/session-event.js";
import { routeMessage } from "../services/manager-routing/manager-router.js";
import { routeVisibility } from "../services/visibility-routing/visibility-router.js";
import type { ActiveSessionSummary } from "../services/manager-routing/manager-routing-types.js";

export const managerRouteRouter = new Hono();

// POST /v1/manager/route-message
managerRouteRouter.post("/route-message", async (c) => {
  const userId = getContextUserId(c)!;

  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  const conversationId = body.conversationId as string | undefined;
  if (!conversationId || typeof conversationId !== "string" || conversationId.trim().length === 0) {
    return c.json({ error: "body.conversationId is required (non-empty string)" }, 400);
  }

  const message = body.message as string | undefined;
  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return c.json({ error: "body.message is required (non-empty string)" }, 400);
  }

  const targetSessionId = (body.targetSessionId as string | undefined) || null;

  try {
    // 1. Fetch active sessions for the user (for reference matching)
    const activeSessionRecords = await AgentSessionRepo.list(userId, {
      limit: 50,
    });
    const activeSessions: ActiveSessionSummary[] = activeSessionRecords
      .filter(s => !["completed", "failed", "cancelled", "rolled_back"].includes(s.status))
      .map(s => ({
        id: s.id,
        title: s.title,
        goal: s.goal,
        status: s.status,
      }));

    // 2. Route the message
    const routing = routeMessage({
      user_id: userId,
      conversation_id: conversationId.trim(),
      message: message.trim(),
      target_session_id: targetSessionId,
      active_sessions: activeSessions,
    });

    // 3. Execute routing result — create appropriate records

    let createdSession = null;
    let sessionEvent = null;

    // 3a. Create new session if new_delegated_task
    if (routing.created_session) {
      createdSession = await AgentSessionRepo.create({
        user_id: userId,
        title: routing.created_session.title,
        goal: routing.created_session.goal,
        status: routing.created_session.status,
        risk_level: routing.created_session.risk_level,
        delegation_contract: routing.created_session.delegation_contract,
      });
    }

    // 3b. Create manager message
    const managerMessage = await ManagerMessageRepo.create({
      user_id: userId,
      conversation_id: conversationId.trim(),
      role: "manager",
      content: routing.manager_message_content,
      related_session_id: routing.target_session_id || createdSession?.id || null,
    });

    // 3c. Create session event if suggested
    if (routing.session_event) {
      const targetSession = routing.target_session_id || createdSession?.id;
      if (targetSession) {
        // Use visibility router to determine the correct visibility
        const visResult = routeVisibility({
          event_type: routing.session_event.type,
          severity: routing.session_event.severity,
        });

        sessionEvent = await SessionEventRepo.create({
          session_id: targetSession,
          type: routing.session_event.type,
          summary: routing.session_event.summary,
          severity: routing.session_event.severity as any,
          visibility: visResult.visibility as any,
        });
      }
    }

    // 4. Return routing result
    return c.json({
      routeType: routing.route_type,
      targetSessionId: routing.target_session_id || createdSession?.id || null,
      clarificationRequired: routing.clarification_required,
      reason: routing.reason,
      managerMessage: {
        id: managerMessage.id,
        content: managerMessage.content,
        role: managerMessage.role,
        relatedSessionId: managerMessage.related_session_id,
        createdAt: managerMessage.created_at,
      },
      createdSession: createdSession ? {
        id: createdSession.id,
        title: createdSession.title,
        status: createdSession.status,
        riskLevel: createdSession.risk_level,
      } : null,
      sessionEvent: sessionEvent ? {
        id: sessionEvent.id,
        type: sessionEvent.type,
        summary: sessionEvent.summary,
        visibility: sessionEvent.visibility,
      } : null,
    }, 200);

  } catch (error: any) {
    console.error("[S100P] Manager route-message error:", error.message);
    return c.json({ error: error.message }, 500);
  }
});
