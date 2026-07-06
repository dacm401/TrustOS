/**
 * S100P-003: Manager Messages API
 *
 * Mounted at /v1/manager-messages via index.ts
 *
 * Endpoints:
 *   GET    /v1/manager-messages        — list conversation messages
 *   POST   /v1/manager-messages        — create a new message
 *   GET    /v1/manager-messages/:id    — get message detail
 *   GET    /v1/manager-messages/conversation/:conversationId — list by conversation
 */

import { Hono } from "hono";
import { getContextUserId } from "../middleware/identity.js";
import { ManagerMessageRepo } from "../db/repositories/manager-message.js";
import type { ManagerMessageInput, ManagerMessageRole } from "../db/repositories/manager-message.js";

export const managerMessagesRouter = new Hono();

// GET /v1/manager-messages — list messages (supports filtering)
managerMessagesRouter.get("/", async (c) => {
  const userId = getContextUserId(c)!;
  const conversationId = c.req.query("conversationId");
  const relatedSessionId = c.req.query("relatedSessionId");
  const role = c.req.query("role") as ManagerMessageRole | undefined;
  const limit = Math.min(parseInt(c.req.query("limit") || "100"), 500);
  const offset = parseInt(c.req.query("offset") || "0");

  try {
    const messages = await ManagerMessageRepo.list(userId, {
      conversationId,
      relatedSessionId,
      role,
      limit,
      offset,
    });
    const total = await ManagerMessageRepo.count(userId, {
      conversationId,
      relatedSessionId,
      role,
    });
    return c.json({ messages, total, limit, offset });
  } catch (error: any) {
    console.error("[S100P] Manager messages list error:", error.message);
    return c.json({ error: error.message }, 500);
  }
});

// POST /v1/manager-messages — create message
managerMessagesRouter.post("/", async (c) => {
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

  const content = body.content as string | undefined;
  if (!content || typeof content !== "string" || content.trim().length === 0) {
    return c.json({ error: "body.content is required (non-empty string)" }, 400);
  }

  const validRoles: ManagerMessageRole[] = ["user", "manager", "system"];
  const role = body.role as string | undefined;
  if (role && !validRoles.includes(role as ManagerMessageRole)) {
    return c.json({ error: `Invalid role '${role}'. Must be one of: ${validRoles.join(", ")}` }, 400);
  }

  try {
    const message = await ManagerMessageRepo.create({
      user_id: userId,
      conversation_id: conversationId.trim(),
      role: (role as ManagerMessageRole) || "manager",
      content: content.trim(),
      related_session_id: body.relatedSessionId as string | undefined,
    });
    return c.json({ message }, 201);
  } catch (error: any) {
    console.error("[S100P] Manager message create error:", error.message);
    return c.json({ error: error.message }, 500);
  }
});

// GET /v1/manager-messages/:id — get message detail (ownership-scoped)
managerMessagesRouter.get("/:id", async (c) => {
  const userId = getContextUserId(c)!;
  const messageId = c.req.param("id");

  try {
    const message = await ManagerMessageRepo.getById(messageId);
    if (!message) {
      return c.json({ error: `Message not found: ${messageId}` }, 404);
    }
    // Ownership check: message must belong to the requesting user
    if (message.user_id !== userId) {
      return c.json({ error: "Forbidden: message does not belong to this user" }, 403);
    }
    return c.json({ message });
  } catch (error: any) {
    console.error("[S100P] Manager message get error:", error.message);
    return c.json({ error: error.message }, 500);
  }
});

// GET /v1/manager-messages/conversation/:conversationId — list by conversation (ownership-scoped)
managerMessagesRouter.get("/conversation/:conversationId", async (c) => {
  const userId = getContextUserId(c)!;
  const conversationId = c.req.param("conversationId");
  const limit = Math.min(parseInt(c.req.query("limit") || "100"), 500);
  const offset = parseInt(c.req.query("offset") || "0");

  try {
    const messages = await ManagerMessageRepo.listByConversation(conversationId, { userId, limit });
    const total = await ManagerMessageRepo.countByConversation(conversationId, userId);
    return c.json({ messages, total, limit, offset, conversationId });
  } catch (error: any) {
    console.error("[S100P] Conversation messages list error:", error.message);
    return c.json({ error: error.message }, 500);
  }
});