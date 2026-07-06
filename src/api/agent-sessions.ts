/**
 * S100P-002: Agent Sessions API
 *
 * Mounted at /v1/agent-sessions via index.ts
 *
 * Endpoints:
 *   GET    /v1/agent-sessions        — list user's sessions
 *   POST   /v1/agent-sessions        — create a new session
 *   GET    /v1/agent-sessions/:id    — get session detail
 *   PATCH  /v1/agent-sessions/:id    — update session (status, fields)
 */

import { Hono } from "hono";
import { getContextUserId } from "../middleware/identity.js";
import { AgentSessionRepo } from "../db/repositories/agent-session.js";
import type { SessionStatus } from "../db/repositories/agent-session.js";

export const agentSessionsRouter = new Hono();

// GET /v1/agent-sessions — list sessions
agentSessionsRouter.get("/", async (c) => {
  const userId = getContextUserId(c)!;
  const status = c.req.query("status") as SessionStatus | undefined;
  const limit = Math.min(parseInt(c.req.query("limit") || "50"), 100);
  const offset = parseInt(c.req.query("offset") || "0");

  try {
    const sessions = await AgentSessionRepo.list(userId, { status, limit, offset });
    const total = await AgentSessionRepo.count(userId, status);
    return c.json({ sessions, total, limit, offset });
  } catch (error: any) {
    console.error("[S100P] Agent sessions list error:", error.message);
    return c.json({ error: error.message }, 500);
  }
});

// POST /v1/agent-sessions — create session
agentSessionsRouter.post("/", async (c) => {
  const userId = getContextUserId(c)!;

  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  const title = body.title as string | undefined;
  if (!title || typeof title !== "string" || title.trim().length === 0) {
    return c.json({ error: "body.title is required (non-empty string)" }, 400);
  }

  const validStatuses: SessionStatus[] = [
    "planning", "delegated", "running", "waiting_approval",
    "paused", "completed", "failed", "cancelled", "rolled_back",
  ];
  const status = body.status as string | undefined;
  if (status && !validStatuses.includes(status as SessionStatus)) {
    return c.json({ error: `Invalid status '${status}'. Must be one of: ${validStatuses.join(", ")}` }, 400);
  }

  try {
    const session = await AgentSessionRepo.create({
      user_id: userId,
      title: title.trim(),
      goal: body.goal as string | undefined,
      status: (status as SessionStatus) || "planning",
      worker_id: body.worker_id as string | undefined,
      delegation_contract: (body.delegation_contract as Record<string, unknown>) || {},
      risk_level: (body.risk_level as string) || "low",
    });
    return c.json({ session }, 201);
  } catch (error: any) {
    console.error("[S100P] Agent session create error:", error.message);
    return c.json({ error: error.message }, 500);
  }
});

// GET /v1/agent-sessions/:id — get session detail
agentSessionsRouter.get("/:id", async (c) => {
  const userId = getContextUserId(c)!;
  const sessionId = c.req.param("id");

  try {
    const session = await AgentSessionRepo.getById(sessionId);
    if (!session) {
      return c.json({ error: `Session not found: ${sessionId}` }, 404);
    }
    if (session.user_id !== userId) {
      return c.json({ error: "Forbidden: session does not belong to this user" }, 403);
    }
    return c.json({ session });
  } catch (error: any) {
    console.error("[S100P] Agent session get error:", error.message);
    return c.json({ error: error.message }, 500);
  }
});

// PATCH /v1/agent-sessions/:id — update session
agentSessionsRouter.patch("/:id", async (c) => {
  const userId = getContextUserId(c)!;
  const sessionId = c.req.param("id");

  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  // If only status update
  if (body.status !== undefined && Object.keys(body).length === 1) {
    const status = body.status as string;
    const validStatuses: SessionStatus[] = [
      "planning", "delegated", "running", "waiting_approval",
      "paused", "completed", "failed", "cancelled", "rolled_back",
    ];
    if (!validStatuses.includes(status as SessionStatus)) {
      return c.json({ error: `Invalid status '${status}'` }, 400);
    }

    try {
      // Verify ownership
      const existing = await AgentSessionRepo.getById(sessionId);
      if (!existing) return c.json({ error: `Session not found: ${sessionId}` }, 404);
      if (existing.user_id !== userId) return c.json({ error: "Forbidden" }, 403);

      await AgentSessionRepo.setStatus(sessionId, status as SessionStatus);
      const updated = await AgentSessionRepo.getById(sessionId);
      return c.json({ session: updated });
    } catch (error: any) {
      console.error("[S100P] Agent session PATCH error:", error.message);
      return c.json({ error: error.message }, 500);
    }
  }

  // Partial field update
  try {
    const existing = await AgentSessionRepo.getById(sessionId);
    if (!existing) return c.json({ error: `Session not found: ${sessionId}` }, 404);
    if (existing.user_id !== userId) return c.json({ error: "Forbidden" }, 403);

    const updated = await AgentSessionRepo.update(sessionId, {
      title: body.title as string | undefined,
      goal: body.goal as string | undefined,
      worker_id: body.worker_id as (string | null | undefined),
      delegation_contract: body.delegation_contract as Record<string, unknown> | undefined,
      risk_level: body.risk_level as string | undefined,
    });
    return c.json({ session: updated });
  } catch (error: any) {
    console.error("[S100P] Agent session PATCH error:", error.message);
    return c.json({ error: error.message }, 500);
  }
});
