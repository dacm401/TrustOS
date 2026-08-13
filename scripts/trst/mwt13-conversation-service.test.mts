/**
 * MWT-13: ManagerConversationService — deterministic, zero-DB test.
 *
 * Runs with: npx tsx scripts/trst/mwt13-conversation-service.test.mts
 *
 * Design:
 *   - Uses an in-memory fake ConversationStore; never touches Postgres / live env.
 *   - Proves the v0 capability: create conversation -> append message ->
 *     list conversation -> list messages.
 *   - Exits non-zero on any assertion failure (CI-friendly).
 */

import {
  ManagerConversationService,
  type ConversationRecord,
  type ConversationStore,
  type ManagerMessageOutput,
} from "../../src/services/manager/conversation-service.ts";

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

// In-memory fake of ManagerMessageRepo (mirrors repo shape used by the service).
const messages: ManagerMessageOutput[] = [];
const FakeMessageRepo = {
  create(input: {
    user_id: string;
    conversation_id: string;
    role: "user" | "manager" | "system";
    content: string;
    related_session_id?: string | null;
  }) {
    const rec: ManagerMessageOutput = {
      id: `msg-${messages.length + 1}`,
      user_id: input.user_id,
      conversation_id: input.conversation_id,
      role: input.role,
      content: input.content,
      related_session_id: input.related_session_id ?? null,
      created_at: new Date().toISOString(),
    };
    messages.push(rec);
    return Promise.resolve(rec);
  },
  listByConversation(conversationId: string, opts?: { userId?: string; limit?: number }) {
    const out = messages
      .filter((m) => m.conversation_id === conversationId)
      .filter((m) => !opts?.userId || m.user_id === opts.userId);
    return Promise.resolve(out.slice(0, opts?.limit ?? 100));
  },
};

// Inject fakes by constructing the service with the in-memory store and
// shadowing ManagerMessageRepo.create / listByConversation.
const service = new ManagerConversationService(new InMemoryConversationStore());
// @ts-expect-error test-only injection of fake message repo
import("../../src/services/manager/conversation-service.ts").then(() => {});

// ── Tiny assert harness ─────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.error(`  FAIL  ${name}`);
  }
}

async function main() {
  // Patch ManagerMessageRepo methods on the imported module for this test run.
  const mod = await import("../../src/services/manager/conversation-service.ts");
  // The service imports ManagerMessageRepo internally; we swap its two used fns.
  const repo = (await import("../../src/db/repositories/manager-message.ts")) as any;
  repo.ManagerMessageRepo.create = FakeMessageRepo.create;
  repo.ManagerMessageRepo.listByConversation = FakeMessageRepo.listByConversation;

  const userId = "test-user";

  // 1. create conversation
  const conv = await service.createConversation(userId, "Login page fix");
  check("createConversation returns id", typeof conv.id === "string" && conv.id.length > 0);
  check("createConversation stores title", conv.title === "Login page fix");
  check("createConversation stamps created_at", !!conv.created_at);

  // 2. list conversations
  const list = await service.listConversations(userId);
  check("listConversations returns >=1", list.length >= 1);
  check("listConversations newest first", list[0].id === conv.id);

  // 3. append user message
  const m1 = await service.appendMessage(userId, {
    conversationId: conv.id,
    role: "user",
    content: "帮我修登录页 UI",
  });
  check("appendMessage user role", m1.role === "user");
  check("appendMessage links conversation", m1.conversation_id === conv.id);

  // 4. append manager message with related session
  const m2 = await service.appendMessage(userId, {
    conversationId: conv.id,
    role: "manager",
    content: "已创建委托任务",
    relatedSessionId: "sess-abc",
  });
  check("appendMessage manager role", m2.role === "manager");
  check("appendMessage related_session_id", m2.related_session_id === "sess-abc");

  // 5. list messages in order
  const msgs = await service.listMessages(userId, conv.id);
  check("listMessages returns 2", msgs.length === 2);
  check("listMessages preserves order", msgs[0].id === m1.id && msgs[1].id === m2.id);

  // 6. ownership: other user cannot read
  const otherList = await service.listConversations("other-user");
  check("other user sees no conversations", otherList.length === 0);

  // 7. append to non-owned conversation throws
  let threw = false;
  try {
    await service.appendMessage("other-user", {
      conversationId: conv.id,
      role: "user",
      content: "hijack",
    });
  } catch {
    threw = true;
  }
  check("append to non-owned conversation rejected", threw);

  // 8. invalid role rejected
  let roleThrew = false;
  try {
    await service.appendMessage(userId, {
      conversationId: conv.id,
      role: "admin" as any,
      content: "x",
    });
  } catch {
    roleThrew = true;
  }
  check("invalid role rejected", roleThrew);

  console.log(`\nMWT-13 conversation-service test: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  void mod;
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
