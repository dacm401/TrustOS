/**
 * MWT-14: ManagerConversation controller — deterministic, zero-DB test.
 *
 * Runs with: npx tsx scripts/trst/mwt14-conversation-controller.test.mts
 *
 * Verifies the HTTP boundary (managerConversationsRouter) wires to the
 * ManagerConversationService correctly, using an in-memory fake store and the
 * X-User-Id header convention (no live DB / gateway).
 */

import { Hono } from "hono";
import {
  managerConversationsRouter,
  __setConversationStoreForTesting,
} from "../../src/api/manager-conversations.ts";
import { identityMiddleware } from "../../src/middleware/identity.ts";
import type { ConversationRecord, ConversationStore } from "../../src/services/manager/conversation-service.ts";

// ── In-memory fake store ──────────────────────────────────────────────────────
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

__setConversationStoreForTesting(new InMemoryConversationStore());

const app = new Hono();
app.use(identityMiddleware); // matches real app wiring (src/index.ts)
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

  // 1. create
  const created = await app.request("/v1/manager-conversations", {
    method: "POST",
    headers,
    body: JSON.stringify({ title: "First manager conversation" }),
  });
  check("create returns 201", created.status === 201);
  const createdBody = await created.json();
  check("create returns conversation object", !!createdBody.conversation?.id);
  const cid = createdBody.conversation.id;

  // 2. list
  const listed = await app.request("/v1/manager-conversations", { headers });
  check("list returns 200", listed.status === 200);
  const listBody = await listed.json();
  check("list returns >=1 conversation", (listBody.conversations?.length ?? 0) >= 1);
  check("list total matches", listBody.total === listBody.conversations.length);

  // 3. get by id
  const got = await app.request(`/v1/manager-conversations/${cid}`, { headers });
  check("get by id returns 200", got.status === 200);
  const gotBody = await got.json();
  check("get by id returns same id", gotBody.conversation?.id === cid);

  // 4. ownership: other user cannot get
  const otherGot = await app.request(`/v1/manager-conversations/${cid}`, {
    headers: { "X-User-Id": "other" },
  });
  check("other user cannot get conversation (404)", otherGot.status === 404);

  // 5. auth required (no header)
  const noAuth = await app.request("/v1/manager-conversations", { headers: { "Content-Type": "application/json" } });
  check("no auth header rejected (401)", noAuth.status === 401);

  // 6. empty title allowed
  const createdEmpty = await app.request("/v1/manager-conversations", {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });
  check("create with empty body 201", createdEmpty.status === 201);

  console.log(`\nMWT-14 conversation-controller test: ${passed} passed, ${failed} failed`);
  __setConversationStoreForTesting(null);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FATAL", e);
  __setConversationStoreForTesting(null);
  process.exit(1);
});
