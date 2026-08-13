/**
 * MWT-14: ManagerConversation Controller + UI Surface v0
 *
 * Mounted at /v1/manager-conversations via src/index.ts
 *
 * Endpoints:
 *   POST /v1/manager-conversations        — create a manager conversation
 *   GET  /v1/manager-conversations        — list user's conversations (newest first)
 *   GET  /v1/manager-conversations/:id    — get a single conversation (ownership-scoped)
 *
 * Wires the MWT-13 ManagerConversationService into the HTTP boundary, reusing the
 * existing identity convention (getContextUserId) and ownership scoping. No new
 * auth/RBAC logic, no Trust Spine / Memory changes, no schema change (table added in 026).
 */

import { Hono } from "hono";
import { getContextUserId } from "../middleware/identity.js";
import { ManagerConversationService, PostgresConversationStore, type ConversationStore } from "../services/manager/conversation-service.js";

// Test seam: allow injecting an in-memory fake store for deterministic tests.
let activeStore: ConversationStore = PostgresConversationStore;
export function __setConversationStoreForTesting(store: ConversationStore | null) {
  activeStore = store ?? PostgresConversationStore;
}

function getService() {
  return new ManagerConversationService(activeStore);
}

export const managerConversationsRouter = new Hono();

// POST /v1/manager-conversations — create
managerConversationsRouter.post("/", async (c) => {
  const userId = getContextUserId(c);
  if (!userId) return c.json({ error: "Authentication required" }, 401);

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  const title = typeof body.title === "string" ? body.title : undefined;

  try {
    const conversation = await getService().createConversation(userId, title);
    return c.json({ conversation }, 201);
  } catch (error: any) {
    console.error("[MWT-14] create conversation error:", error.message);
    return c.json({ error: error.message }, 400);
  }
});

// GET /v1/manager-conversations — list
managerConversationsRouter.get("/", async (c) => {
  const userId = getContextUserId(c);
  if (!userId) return c.json({ error: "Authentication required" }, 401);

  const limit = Math.min(parseInt(c.req.query("limit") || "50"), 200);

  try {
    const conversations = await getService().listConversations(userId, limit);
    return c.json({ conversations, total: conversations.length });
  } catch (error: any) {
    console.error("[MWT-14] list conversations error:", error.message);
    return c.json({ error: error.message }, 500);
  }
});

// GET /v1/manager-conversations/:id — get one (ownership-scoped)
managerConversationsRouter.get("/:id", async (c) => {
  const userId = getContextUserId(c);
  if (!userId) return c.json({ error: "Authentication required" }, 401);

  const id = c.req.param("id");
  try {
    const conversation = await getService().getConversation(userId, id);
    if (!conversation) {
      return c.json({ error: `Conversation not found or not owned: ${id}` }, 404);
    }
    return c.json({ conversation });
  } catch (error: any) {
    console.error("[MWT-14] get conversation error:", error.message);
    return c.json({ error: error.message }, 500);
  }
});
