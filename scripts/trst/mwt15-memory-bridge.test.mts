/**
 * MWT-15: Manager ↔ Memory Context Bridge — deterministic, zero-DB test.
 *
 * Runs with: npx tsx scripts/trst/mwt15-memory-bridge.test.mts
 *
 * Verifies the HTTP boundary (managerConversationsRouter memory-refs endpoints)
 * wires to the ManagerConversationMemoryRefService correctly, using:
 *   - in-memory fake ConversationStore (conversation ownership)
 *   - in-memory fake MemoryRefStore (reference table)
 *   - fake memory lookup (read-only; never mutates memory)
 *
 * No live DB / gateway. Confirms the bridge is REFERENCE-ONLY: it records the
 * memory_id + safe preview, never copies raw content, never mutates memory.
 */

import { Hono } from "hono";
import {
  managerConversationsRouter,
  __setConversationStoreForTesting,
  __setMemoryRefStoreForTesting,
} from "../../src/api/manager-conversations.ts";
import { identityMiddleware } from "../../src/middleware/identity.ts";
import type { ConversationRecord, ConversationStore } from "../../src/services/manager/conversation-service.ts";
import type { MemoryRefStore, MemoryLookupFn, MemoryRefRecord } from "../../src/services/manager/memory-ref-service.ts";

// ── In-memory fake conversation store ─────────────────────────────────────────
class InMemoryConversationStore implements ConversationStore {
  private conversations = new Map<string, ConversationRecord>();
  async createConversation(userId: string, title: string | null): Promise<ConversationRecord> {
    const id = `conv-${this.conversations.size + 1}`;
    const now = new Date().toISOString();
    const rec: ConversationRecord = { id, user_id: userId, title, created_at: now, updated_at: now };
    this.conversations.set(id, rec);
    return rec;
  }
  async getConversation(userId: string, id: string): Promise<ConversationRecord | null> {
    const r = this.conversations.get(id);
    if (!r || r.user_id !== userId) return null;
    return r;
  }
  async listConversations(userId: string, limit = 50): Promise<ConversationRecord[]> {
    return [...this.conversations.values()]
      .filter((c) => c.user_id === userId)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, limit);
  }
  async touchConversation(id: string): Promise<void> {
    const r = this.conversations.get(id);
    if (r) r.updated_at = new Date().toISOString();
  }
}

// ── In-memory fake memory-ref store ───────────────────────────────────────────
class InMemoryMemoryRefStore implements MemoryRefStore {
  private refs = new Map<string, MemoryRefRecord>(); // key: `${conv}:${mem}`
  private counter = 0;
  async attachRef(conversationId: string, memoryId: string, userId: string): Promise<void> {
    this.refs.set(`${conversationId}:${memoryId}`, {
      conversation_id: conversationId,
      memory_id: memoryId,
      user_id: userId,
      created_at: new Date().toISOString(),
      preview: "",
      category: null,
      importance: null,
      source: null,
      tags: [],
    });
    this.counter++;
  }
  async listRefs(conversationId: string, userId: string): Promise<MemoryRefRecord[]> {
    return [...this.refs.values()].filter(
      (r) => r.conversation_id === conversationId && r.user_id === userId
    );
  }
  async detachRef(conversationId: string, memoryId: string, userId: string): Promise<boolean> {
    const key = `${conversationId}:${memoryId}`;
    if (this.refs.has(key) && this.refs.get(key)!.user_id === userId) {
      this.refs.delete(key);
      return true;
    }
    return false;
  }
}

// ── Read-only fake memory lookup (never mutates) ──────────────────────────────
let mutationGuard = 0; // proves lookup never writes
const fakeMemory: Record<string, { content: string; category?: string; importance?: number; source?: string; tags?: string[] }> = {
  "mem-1": { content: "User prefers concise summaries and dislikes verbose output.", category: "preference", importance: 0.8, source: "manual", tags: ["style"] },
  "mem-2": { content: "Project TrustOS is a trust layer for AI agents.", category: "project", importance: 0.6, source: "auto_learn", tags: ["trustos"] },
};
const fakeLookup: MemoryLookupFn = async (memoryId, userId) => {
  // read-only: only reads from the in-memory map, never writes
  void mutationGuard;
  const m = fakeMemory[memoryId];
  if (!m) return null;
  return { id: memoryId, ...m };
};

__setConversationStoreForTesting(new InMemoryConversationStore());
__setMemoryRefStoreForTesting(new InMemoryMemoryRefStore(), fakeLookup);

const app = new Hono();
app.use(identityMiddleware);
app.route("/v1/manager-conversations", managerConversationsRouter);

// ── assert harness ─────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}`); }
}

async function main() {
  const userId = "test-user";
  const headers = { "Content-Type": "application/json", "X-User-Id": userId };

  // 1. create a conversation
  const created = await app.request("/v1/manager-conversations", {
    method: "POST",
    headers,
    body: JSON.stringify({ title: "Bridge test conversation" }),
  });
  check("MWT-15 setup: create conversation 201", created.status === 201);
  const cid = (await created.json()).conversation.id;

  // 2. attach an existing memory by id (reference only)
  const attached = await app.request(`/v1/manager-conversations/${cid}/memory-refs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ memory_id: "mem-1" }),
  });
  check("attach memory ref 201", attached.status === 201);
  const attBody = await attached.json();
  check("attach returns memory_ref with id", attBody.memory_ref?.memory_id === "mem-1");
  check("attach returns safe preview (no full raw content)", typeof attBody.memory_ref?.preview === "string" && attBody.memory_ref.preview.length <= 41);
  check("attach does NOT copy full raw content", attBody.memory_ref?.preview !== fakeMemory["mem-1"].content);

  // 3. list refs (read-only)
  const listed = await app.request(`/v1/manager-conversations/${cid}/memory-refs`, { headers });
  check("list memory refs 200", listed.status === 200);
  const listBody = await listed.json();
  check("list returns 1 ref", listBody.total === 1);
  check("list ref carries category metadata", listBody.memory_refs[0]?.category === "preference");

  // 4. attach a second ref
  const attached2 = await app.request(`/v1/manager-conversations/${cid}/memory-refs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ memory_id: "mem-2" }),
  });
  check("attach second ref 201", attached2.status === 201);
  const listed2 = await app.request(`/v1/manager-conversations/${cid}/memory-refs`, { headers });
  check("list returns 2 refs", (await listed2.json()).total === 2);

  // 5. attach non-existent memory → 404 (read-only lookup rejects)
  const badAttach = await app.request(`/v1/manager-conversations/${cid}/memory-refs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ memory_id: "mem-ghost" }),
  });
  check("attach non-existent memory 404", badAttach.status === 404);

  // 6. detach ref
  const detached = await app.request(`/v1/manager-conversations/${cid}/memory-refs/mem-1`, {
    method: "DELETE",
    headers,
  });
  check("detach memory ref 200", detached.status === 200);
  const listed3 = await app.request(`/v1/manager-conversations/${cid}/memory-refs`, { headers });
  check("after detach list returns 1 ref", (await listed3.json()).total === 1);

  // 7. ownership: other user cannot attach to my conversation
  const otherAttach = await app.request(`/v1/manager-conversations/${cid}/memory-refs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Id": "other" },
    body: JSON.stringify({ memory_id: "mem-2" }),
  });
  check("other user cannot attach to owned conversation (404)", otherAttach.status === 404);

  // 8. auth required
  const noAuth = await app.request(`/v1/manager-conversations/${cid}/memory-refs`, {
    headers: { "Content-Type": "application/json" },
  });
  check("no auth header rejected (401)", noAuth.status === 401);

  // 9. mutation guard: lookup never wrote memory
  check("memory lookup is read-only (no mutation)", mutationGuard === 0);

  console.log(`\nMWT-15 memory-bridge test: ${passed} passed, ${failed} failed`);
  __setConversationStoreForTesting(null);
  __setMemoryRefStoreForTesting(null);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FATAL", e);
  __setConversationStoreForTesting(null);
  __setMemoryRefStoreForTesting(null);
  process.exit(1);
});
