/**
 * S100P-004: Session Events API
 *
 * Mounted at /v1/session-events via index.ts
 *
 * Endpoints:
 *   GET    /v1/session-events        — list events (filter by session, type, visibility)
 *   POST   /v1/session-events        — create a new event
 *   GET    /v1/session-events/:id    — get event detail
 */

import { Hono } from "hono";
import { getContextUserId } from "../middleware/identity.js";
import { SessionEventRepo } from "../db/repositories/session-event.js";
import type {
  SessionEventInput,
  SessionEventType,
  SessionEventVisibility,
  SessionEventSeverity,
} from "../db/repositories/session-event.js";

export const sessionEventsRouter = new Hono();

// GET /v1/session-events — list events with filtering
sessionEventsRouter.get("/", async (c) => {
  const userId = getContextUserId(c)!;
  const sessionId = c.req.query("sessionId");
  const type = c.req.query("type") as SessionEventType | undefined;
  const visibility = c.req.query("visibility") as SessionEventVisibility | undefined;
  const severity = c.req.query("severity") as SessionEventSeverity | undefined;
  const limit = Math.min(parseInt(c.req.query("limit") || "100"), 500);
  const offset = parseInt(c.req.query("offset") || "0");

  if (!sessionId) {
    return c.json({ error: "sessionId query parameter is required" }, 400);
  }

  try {
    // First verify the session belongs to the user
    const { AgentSessionRepo } = await import("../db/repositories/agent-session.js");
    const session = await AgentSessionRepo.getById(sessionId);
    if (!session) {
      return c.json({ error: `Session not found: ${sessionId}` }, 404);
    }
    if (session.user_id !== userId) {
      return c.json({ error: "Forbidden: session does not belong to this user" }, 403);
    }

    const events = await SessionEventRepo.listBySession(sessionId, {
      type,
      visibility,
      severity,
      limit,
      offset,
    });
    const total = await SessionEventRepo.countBySession(sessionId, { type, visibility, severity });
    return c.json({ events, total, limit, offset, sessionId });
  } catch (error: any) {
    console.error("[S100P] Session events list error:", error.message);
    return c.json({ error: error.message }, 500);
  }
});

// POST /v1/session-events — create event
sessionEventsRouter.post("/", async (c) => {
  const userId = getContextUserId(c)!;

  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  const sessionId = body.sessionId as string | undefined;
  if (!sessionId || typeof sessionId !== "string" || sessionId.trim().length === 0) {
    return c.json({ error: "body.sessionId is required (non-empty string)" }, 400);
  }

  const type = body.type as SessionEventType | undefined;
  if (!type || typeof type !== "string" || type.trim().length === 0) {
    return c.json({ error: "body.type is required (non-empty string)" }, 400);
  }

  // Validate type is one of known types
  const validTypes: SessionEventType[] = [
    "session_created",
    "session_started",
    "session_completed",
    "session_failed",
    "session_cancelled",
    "session_paused",
    "session_resumed",
    "delegation_created",
    "delegation_accepted",
    "delegation_rejected",
    "delegation_failed",
    "worker_assigned",
    "worker_started",
    "worker_completed",
    "worker_failed",
    "worker_paused",
    "worker_resumed",
    "tool_execution_started",
    "tool_execution_completed",
    "tool_execution_failed",
    "permission_requested",
    "permission_granted",
    "permission_denied",
    "permission_expired",
    "message_received",
    "message_sent",
    "user_input_required",
    "user_input_received",
    "plan_created",
    "plan_updated",
    "plan_executed",
    "plan_failed",
    "decision_made",
    "decision_reviewed",
    "decision_reversed",
    "risk_assessment",
    "risk_mitigated",
    "error_occurred",
    "warning_raised",
    "info_logged",
  ];

  if (!validTypes.includes(type)) {
    return c.json({ error: `Invalid event type '${type}'. Must be one of known types` }, 400);
  }

  const summary = body.summary as string | undefined;
  if (!summary || typeof summary !== "string" || summary.trim().length === 0) {
    return c.json({ error: "body.summary is required (non-empty string)" }, 400);
  }

  const validSeverities: SessionEventSeverity[] = ["debug", "info", "warn", "error", "critical"];
  const severity = body.severity as string | undefined;
  if (severity && !validSeverities.includes(severity as SessionEventSeverity)) {
    return c.json({ error: `Invalid severity '${severity}'. Must be one of: ${validSeverities.join(", ")}` }, 400);
  }

  const validVisibilities: SessionEventVisibility[] = [
    "silent_audit",
    "session_timeline",
    "approval_required",
    "manager_chat_summary",
    "trust_report_only",
    "critical_alert",
  ];
  const visibility = body.visibility as string | undefined;
  if (visibility && !validVisibilities.includes(visibility as SessionEventVisibility)) {
    return c.json({ error: `Invalid visibility '${visibility}'. Must be one of: ${validVisibilities.join(", ")}` }, 400);
  }

  try {
    // Verify session ownership
    const { AgentSessionRepo } = await import("../db/repositories/agent-session.js");
    const session = await AgentSessionRepo.getById(sessionId);
    if (!session) {
      return c.json({ error: `Session not found: ${sessionId}` }, 404);
    }
    if (session.user_id !== userId) {
      return c.json({ error: "Forbidden: session does not belong to this user" }, 403);
    }

    const event = await SessionEventRepo.create({
      session_id: sessionId,
      type,
      summary: summary.trim(),
      severity: (severity as SessionEventSeverity) || "info",
      visibility: (visibility as SessionEventVisibility) || "session_timeline",
      raw_ref: body.rawRef as string | undefined,
    });
    return c.json({ event }, 201);
  } catch (error: any) {
    console.error("[S100P] Session event create error:", error.message);
    return c.json({ error: error.message }, 500);
  }
});

// GET /v1/session-events/:id — get event detail
sessionEventsRouter.get("/:id", async (c) => {
  const userId = getContextUserId(c)!;
  const eventId = c.req.param("id");

  try {
    const event = await SessionEventRepo.getById(eventId);
    if (!event) {
      return c.json({ error: `Event not found: ${eventId}` }, 404);
    }

    // Verify session ownership
    const { AgentSessionRepo } = await import("../db/repositories/agent-session.js");
    const session = await AgentSessionRepo.getById(event.session_id);
    if (!session) {
      return c.json({ error: `Associated session not found: ${event.session_id}` }, 404);
    }
    if (session.user_id !== userId) {
      return c.json({ error: "Forbidden: session does not belong to this user" }, 403);
    }

    return c.json({ event });
  } catch (error: any) {
    console.error("[S100P] Session event get error:", error.message);
    return c.json({ error: error.message }, 500);
  }
});