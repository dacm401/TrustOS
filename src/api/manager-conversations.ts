/**
 * MWT-14 + MWT-15: ManagerConversation Controller + UI Surface v0
 *                         Manager ↔ Memory Context Bridge v0
 *
 * Mounted at /v1/manager-conversations via src/index.ts
 *
 * Conversation endpoints:
 *   POST /v1/manager-conversations        — create a manager conversation
 *   GET  /v1/manager-conversations        — list user's conversations (newest first)
 *   GET  /v1/manager-conversations/:id    — get a single conversation (ownership-scoped)
 *
 * Memory context bridge endpoints (MWT-15):
 *   GET    /v1/manager-conversations/:id/memory-refs       — list memory references (read-only)
 *   POST   /v1/manager-conversations/:id/memory-refs       — attach an existing memory by id
 *   DELETE /v1/manager-conversations/:id/memory-refs/:mId  — detach a memory reference
 *
 * Wires the MWT-13/MWT-15 services into the HTTP boundary, reusing the existing
 * identity convention (getContextUserId) and ownership scoping. No new auth/RBAC
 * logic, no Trust Spine / Memory semantic change. Memory bridge is REFERENCE-ONLY:
 * it never mutates the referenced memory entry or Memory Governance state.
 */

import { Hono } from "hono";
import { getContextUserId } from "../middleware/identity.js";
import {
  ManagerConversationService,
  PostgresConversationStore,
  type ConversationStore,
} from "../services/manager/conversation-service.js";
import {
  ManagerConversationMemoryRefService,
  PostgresMemoryRefStore,
  type MemoryRefStore,
  type MemoryLookupFn,
} from "../services/manager/memory-ref-service.js";

// Test seam: allow injecting an in-memory fake store for deterministic tests.
let activeStore: ConversationStore = PostgresConversationStore;
export function __setConversationStoreForTesting(store: ConversationStore | null) {
  activeStore = store ?? PostgresConversationStore;
}

// Test seam: allow injecting a fake memory-ref store + lookup (no live DB).
let activeMemoryRefStore: MemoryRefStore = PostgresMemoryRefStore;
let activeMemoryLookup: MemoryLookupFn | undefined;
export function __setMemoryRefStoreForTesting(
  store: MemoryRefStore | null,
  lookup: MemoryLookupFn | null = null
) {
  activeMemoryRefStore = store ?? PostgresMemoryRefStore;
  activeMemoryLookup = lookup ?? undefined;
}

function getConversationService() {
  return new ManagerConversationService(activeStore);
}
function getMemoryRefService() {
  return new ManagerConversationMemoryRefService(
    activeMemoryRefStore,
    activeStore,
    activeMemoryLookup
  );
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
    const conversation = await getConversationService().createConversation(userId, title);
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
    const conversations = await getConversationService().listConversations(userId, limit);
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
    const conversation = await getConversationService().getConversation(userId, id);
    if (!conversation) {
      return c.json({ error: `Conversation not found or not owned: ${id}` }, 404);
    }
    return c.json({ conversation });
  } catch (error: any) {
    console.error("[MWT-14] get conversation error:", error.message);
    return c.json({ error: error.message }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// MWT-15: Manager ↔ Memory Context Bridge (read-only references)
// ─────────────────────────────────────────────────────────────────────────────

// GET /v1/manager-conversations/:id/memory-refs — list references
managerConversationsRouter.get("/:id/memory-refs", async (c) => {
  const userId = getContextUserId(c);
  if (!userId) return c.json({ error: "Authentication required" }, 401);

  const id = c.req.param("id");
  try {
    const refs = await getMemoryRefService().listMemoryRefs(userId, id);
    return c.json({ memory_refs: refs, total: refs.length });
  } catch (error: any) {
    console.error("[MWT-15] list memory refs error:", error.message);
    return c.json({ error: error.message }, error.message.includes("not found") ? 404 : 500);
  }
});

// POST /v1/manager-conversations/:id/memory-refs — attach an existing memory by id
managerConversationsRouter.post("/:id/memory-refs", async (c) => {
  const userId = getContextUserId(c);
  if (!userId) return c.json({ error: "Authentication required" }, 401);

  const id = c.req.param("id");
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  const memoryId = typeof body.memory_id === "string" ? body.memory_id : "";
  if (!memoryId) return c.json({ error: "memory_id is required" }, 400);

  try {
    const ref = await getMemoryRefService().attachMemoryRef(userId, id, memoryId);
    return c.json({ memory_ref: ref }, 201);
  } catch (error: any) {
    console.error("[MWT-15] attach memory ref error:", error.message);
    return c.json({ error: error.message }, error.message.includes("not found") ? 404 : 400);
  }
});

// DELETE /v1/manager-conversations/:id/memory-refs/:mId — detach a reference
managerConversationsRouter.delete("/:id/memory-refs/:mId", async (c) => {
  const userId = getContextUserId(c);
  if (!userId) return c.json({ error: "Authentication required" }, 401);

  const id = c.req.param("id");
  const mId = c.req.param("mId");
  try {
    const ok = await getMemoryRefService().detachMemoryRef(userId, id, mId);
    if (!ok) return c.json({ error: "memory reference not found" }, 404);
    return c.json({ detached: true });
  } catch (error: any) {
    console.error("[MWT-15] detach memory ref error:", error.message);
    return c.json({ error: error.message }, error.message.includes("not found") ? 404 : 500);
  }
});
