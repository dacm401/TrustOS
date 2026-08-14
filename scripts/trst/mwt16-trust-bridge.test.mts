/**
 * MWT-16: Manager ↔ Trust Evidence Bridge — deterministic, zero-DB test.
 *
 * Runs with: npx tsx scripts/trst/mwt16-trust-bridge.test.mts
 *
 * Verifies the HTTP boundary (managerConversationsRouter trust-refs endpoints)
 * wires to the ManagerConversationTrustRefService correctly, using:
 *   - in-memory fake ConversationStore (conversation ownership)
 *   - in-memory fake TrustRefStore (reference table)
 *   - fake evidence lookup (read-only; only for kind='evidence')
 *
 * No live DB / gateway. Confirms the bridge is REFERENCE-ONLY: it records
 * (ref_kind, ref_id) + safe metadata, never copies raw payloads, never mutates
 * Trust Spine / evidence records, and does NOT claim global READY.
 */

import { Hono } from "hono";
import {
  managerConversationsRouter,
  __setConversationStoreForTesting,
  __setTrustRefStoreForTesting,
} from "../../src/api/manager-conversations.ts";
import { identityMiddleware } from "../../src/middleware/identity.ts";
import type { ConversationRecord, ConversationStore } from "../../src/services/manager/conversation-service.ts";
import type { TrustRefStore, TrustRefKind, EvidenceLookupFn, TrustRefRecord } from "../../src/services/manager/trust-ref-service.ts";

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

// ── In-memory fake trust-ref store ────────────────────────────────────────────
class InMemoryTrustRefStore implements TrustRefStore {
  private refs = new Map<string, TrustRefRecord>(); // key: `${conv}:${kind}:${ref}`
  async attachRef(conversationId: string, refKind: TrustRefKind, refId: string, userId: string): Promise<void> {
    this.refs.set(`${conversationId}:${refKind}:${refId}`, {
      conversation_id: conversationId,
      ref_kind: refKind,
      ref_id: refId,
      user_id: userId,
      created_at: new Date().toISOString(),
    });
  }
  async listRefs(conversationId: string, userId: string): Promise<TrustRefRecord[]> {
    return [...this.refs.values()].filter(
      (r) => r.conversation_id === conversationId && r.user_id === userId
    );
  }
  async detachRef(conversationId: string, refKind: TrustRefKind, refId: string, userId: string): Promise<boolean> {
    const key = `${conversationId}:${refKind}:${refId}`;
    if (this.refs.has(key) && this.refs.get(key)!.user_id === userId) {
      this.refs.delete(key);
      return true;
    }
    return false;
  }
}

// ── Read-only fake evidence lookup (only kind='evidence' uses it) ─────────────
const fakeEvidence: Record<string, { task_id: string | null; source: string; relevance_score: number | null }> = {
  "ev-1": { task_id: "task-1", source: "web_search", relevance_score: 0.9 },
};
const fakeEvidenceLookup: EvidenceLookupFn = async (evidenceId, userId) => {
  // read-only: no mutation; returns null for unknown/other-user
  const e = fakeEvidence[evidenceId];
  if (!e) return null;
  return { evidence_id: evidenceId, ...e };
};

__setConversationStoreForTesting(new InMemoryConversationStore());
__setTrustRefStoreForTesting(new InMemoryTrustRefStore(), fakeEvidenceLookup);

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
    body: JSON.stringify({ title: "Trust bridge test" }),
  });
  check("MWT-16 setup: create conversation 201", created.status === 201);
  const cid = (await created.json()).conversation.id;

  // 2. attach an evidence ref (read-only lookup validates ownership)
  const evAttached = await app.request(`/v1/manager-conversations/${cid}/trust-refs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ref_kind: "evidence", ref_id: "ev-1" }),
  });
  check("attach evidence ref 201", evAttached.status === 201);
  const evBody = await evAttached.json();
  check("evidence ref returns ref_kind", evBody.trust_ref?.ref_kind === "evidence");
  check("evidence ref enriched with source metadata", evBody.trust_ref?.source === "web_search");
  check("evidence ref enriched with related_task_id", evBody.trust_ref?.related_task_id === "task-1");

  // 3. attach a trace ref (user-supplied link, no live lookup)
  const traceAttached = await app.request(`/v1/manager-conversations/${cid}/trust-refs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ref_kind: "trace", ref_id: "trace-abc123" }),
  });
  check("attach trace ref 201", traceAttached.status === 201);

  // 4. attach an event ref
  const eventAttached = await app.request(`/v1/manager-conversations/${cid}/trust-refs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ref_kind: "event", ref_id: "evt_xyz" }),
  });
  check("attach event ref 201", eventAttached.status === 201);

  // 5. list refs (read-only)
  const listed = await app.request(`/v1/manager-conversations/${cid}/trust-refs`, { headers });
  check("list trust refs 200", listed.status === 200);
  check("list returns 3 refs", (await listed.json()).total === 3);

  // 6. invalid ref_kind → 400
  const badKind = await app.request(`/v1/manager-conversations/${cid}/trust-refs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ref_kind: "bogus", ref_id: "x" }),
  });
  check("invalid ref_kind 400", badKind.status === 400);

  // 7. attach non-existent evidence → 404 (read-only lookup rejects)
  const ghostEv = await app.request(`/v1/manager-conversations/${cid}/trust-refs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ref_kind: "evidence", ref_id: "ev-ghost" }),
  });
  check("attach non-existent evidence 404", ghostEv.status === 404);

  // 8. detach a ref
  const detached = await app.request(
    `/v1/manager-conversations/${cid}/trust-refs/evidence/ev-1`,
    { method: "DELETE", headers }
  );
  check("detach evidence ref 200", detached.status === 200);
  const listed2Resp = await app.request(`/v1/manager-conversations/${cid}/trust-refs`, { headers });
  const listed2Body = await listed2Resp.json();
  check("after detach list returns 2 refs", listed2Body.total === 2);

  // 9. ownership: other user cannot attach to my conversation
  const otherAttach = await app.request(`/v1/manager-conversations/${cid}/trust-refs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Id": "other" },
    body: JSON.stringify({ ref_kind: "trace", ref_id: "trace-other" }),
  });
  check("other user cannot attach to owned conversation (404)", otherAttach.status === 404);

  // 10. auth required
  const noAuth = await app.request(`/v1/manager-conversations/${cid}/trust-refs`, {
    headers: { "Content-Type": "application/json" },
  });
  check("no auth header rejected (401)", noAuth.status === 401);

  // 11. no raw payload exposed: list response has no content field
  const finalList = listed2Body.trust_refs as TrustRefRecord[];
  const noRawContent = finalList.every(
    (r) => !("content" in (r as any)) && !("event_hash" in (r as any)) && !("payload" in (r as any))
  );
  check("no raw event/evidence payload exposed in refs", noRawContent);

  console.log(`\nMWT-16 trust-bridge test: ${passed} passed, ${failed} failed`);
  __setConversationStoreForTesting(null);
  __setTrustRefStoreForTesting(null);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FATAL", e);
  __setConversationStoreForTesting(null);
  __setTrustRefStoreForTesting(null);
  process.exit(1);
});
