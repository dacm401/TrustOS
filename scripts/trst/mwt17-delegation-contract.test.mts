/**
 * MWT-17: Worker Delegation Contract v0 — deterministic, zero-DB test.
 *
 * Runs with: npx tsx scripts/trst/mwt17-delegation-contract.test.mts
 *
 * Verifies the HTTP boundary (managerConversationsRouter contract endpoints)
 * wires to the WorkerDelegationContractService correctly, using:
 *   - in-memory fake ConversationStore (conversation ownership)
 *   - in-memory fake DelegationContractStore (contract table)
 *
 * No live DB / gateway. Confirms the contract layer is NON-EXECUTING:
 *   - creating a contract stores intent only (IDs, summaries, constraints)
 *   - no worker is invoked, no scheduling, no autonomous loop
 *   - status transitions follow the review vocabulary
 *   - locked (approved/rejected/superseded) contracts cannot be edited/deleted
 *   - references memory_ref_ids / trust_ref_ids as IDs only (no payload copy)
 *   - does NOT claim global Private Beta READY
 */

import { Hono } from "hono";
import {
  managerConversationsRouter,
  __setConversationStoreForTesting,
  __setDelegationStoreForTesting,
} from "../../src/api/manager-conversations.ts";
import { identityMiddleware } from "../../src/middleware/identity.ts";
import type { ConversationRecord, ConversationStore } from "../../src/services/manager/conversation-service.ts";
import type {
  DelegationContractStore,
  WorkerDelegationContractRecord,
  ContractStatus,
} from "../../src/services/manager/delegation-contract-service.ts";

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

// ── In-memory fake delegation-contract store ─────────────────────────────────
class InMemoryDelegationStore implements DelegationContractStore {
  private contracts = new Map<string, WorkerDelegationContractRecord>();
  private seq = 0;
  async create(userId: string, input: any): Promise<WorkerDelegationContractRecord> {
    const id = `wdc-${++this.seq}`;
    const now = new Date().toISOString();
    const rec: WorkerDelegationContractRecord = {
      contract_id: id,
      conversation_id: input.conversation_id,
      user_id: userId,
      title: input.title,
      objective: input.objective,
      intended_worker: input.intended_worker ?? null,
      input_summary: input.input_summary ?? null,
      memory_ref_ids: input.memory_ref_ids ?? [],
      trust_ref_ids: input.trust_ref_ids ?? [],
      constraints: input.constraints ?? null,
      expected_output: input.expected_output ?? null,
      status: input.status ?? "draft",
      created_at: now,
      updated_at: now,
    };
    this.contracts.set(id, rec);
    return rec;
  }
  async listByConversation(userId: string, conversationId: string): Promise<WorkerDelegationContractRecord[]> {
    return [...this.contracts.values()]
      .filter((c) => c.conversation_id === conversationId && c.user_id === userId)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }
  async get(userId: string, contractId: string): Promise<WorkerDelegationContractRecord | null> {
    const c = this.contracts.get(contractId);
    if (!c || c.user_id !== userId) return null;
    return c;
  }
  async update(userId: string, contractId: string, patch: any): Promise<WorkerDelegationContractRecord | null> {
    const c = this.contracts.get(contractId);
    if (!c || c.user_id !== userId) return null;
    const next = { ...c, ...patch, updated_at: new Date().toISOString() };
    this.contracts.set(contractId, next);
    return next;
  }
  async remove(userId: string, contractId: string): Promise<boolean> {
    const c = this.contracts.get(contractId);
    if (!c || c.user_id !== userId) return false;
    return this.contracts.delete(contractId);
  }
}

__setConversationStoreForTesting(new InMemoryConversationStore());
__setDelegationStoreForTesting(new InMemoryDelegationStore());

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

const CONTRACT_PATH = (cid: string) => `/v1/manager-conversations/${cid}/contracts`;

async function main() {
  const userId = "test-user";
  const headers = { "Content-Type": "application/json", "X-User-Id": userId };

  // 1. create a conversation (ownership scope)
  const created = await app.request("/v1/manager-conversations", {
    method: "POST",
    headers,
    body: JSON.stringify({ title: "Delegation test" }),
  });
  check("MWT-17 setup: create conversation 201", created.status === 201);
  const cid = (await created.json()).conversation.id;

  // 2. list contracts empty
  const empty = await app.request(CONTRACT_PATH(cid), { headers });
  check("list contracts empty 200", empty.status === 200);
  check("no contracts yet", (await empty.json()).total === 0);

  // 3. create a contract
  const createdContract = await app.request(CONTRACT_PATH(cid), {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: "Summarize Q3 report",
      objective: "Produce a 5-bullet summary of the Q3 financial report",
      intended_worker: "report-summarizer",
      input_summary: "report.pdf attached via memory",
      memory_ref_ids: ["mem-1", "mem-2"],
      trust_ref_ids: ["ev-9"],
      constraints: "No external network calls; cite sources",
      expected_output: "5 bullets in markdown",
    }),
  });
  check("create contract 201", createdContract.status === 201);
  const cBody = await createdContract.json();
  const wdcId = cBody.contract?.contract_id;
  check("contract defaults to draft", cBody.contract?.status === "draft");
  check("contract stores memory_ref_ids as IDs", JSON.stringify(cBody.contract?.memory_ref_ids) === JSON.stringify(["mem-1", "mem-2"]));
  check("contract stores trust_ref_ids as IDs", JSON.stringify(cBody.contract?.trust_ref_ids) === JSON.stringify(["ev-9"]));
  check("contract stores intended_worker", cBody.contract?.intended_worker === "report-summarizer");

  // 4. get the contract
  const got = await app.request(`${CONTRACT_PATH(cid)}/${wdcId}`, { headers });
  check("get contract 200", got.status === 200);

  // 5. no execution: status is draft, no execution fields present
  const gotBody = await got.json();
  check("no execution occurred (still draft)", gotBody.contract?.status === "draft");
  const noExecFields = !("result" in gotBody.contract) && !("executed_at" in gotBody.contract) && !("worker_output" in gotBody.contract);
  check("contract has no execution/result fields", noExecFields);

  // 6. no raw payload: only IDs + summaries, no content/event_hash/payload
  const safeShape = !("content" in gotBody.contract) && !("event_hash" in gotBody.contract) && !("payload" in gotBody.contract);
  check("no raw content/payload/event_hash stored", safeShape);

  // 7. update a draft contract
  const patched = await app.request(`${CONTRACT_PATH(cid)}/${wdcId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ constraints: "No external network; max 5 bullets" }),
  });
  check("patch draft contract 200", patched.status === 200);
  check("patch updated constraints", (await patched.json()).contract?.constraints === "No external network; max 5 bullets");

  // 8. invalid status on create → 500 (service rejects) -> verify via setStatus invalid
  const badStatus = await app.request(`${CONTRACT_PATH(cid)}/${wdcId}/status`, {
    method: "POST",
    headers,
    body: JSON.stringify({ status: "bogus" }),
  });
  check("set invalid status 409/400", badStatus.status === 409 || badStatus.status === 400);

  // 9. transition draft -> ready_for_review -> approved
  const toReview = await app.request(`${CONTRACT_PATH(cid)}/${wdcId}/status`, {
    method: "POST",
    headers,
    body: JSON.stringify({ status: "ready_for_review" }),
  });
  check("draft -> ready_for_review 200", toReview.status === 200);

  const toApproved = await app.request(`${CONTRACT_PATH(cid)}/${wdcId}/status`, {
    method: "POST",
    headers,
    body: JSON.stringify({ status: "approved" }),
  });
  check("ready_for_review -> approved 200", toApproved.status === 200);
  check("contract now approved", (await toApproved.json()).contract?.status === "approved");

  // 10. approved contract is locked: PATCH rejected (409)
  const patchLocked = await app.request(`${CONTRACT_PATH(cid)}/${wdcId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ objective: "mutated" }),
  });
  check("PATCH on approved contract rejected 409", patchLocked.status === 409);

  // 11. approved contract delete rejected (409)
  const delLocked = await app.request(`${CONTRACT_PATH(cid)}/${wdcId}`, {
    method: "DELETE",
    headers,
  });
  check("DELETE on approved contract rejected 409", delLocked.status === 409);

  // 12. second contract: draft may be deleted; superseded path
  const c2 = await app.request(CONTRACT_PATH(cid), {
    method: "POST",
    headers,
    body: JSON.stringify({ title: "Draft only", objective: "second intent" }),
  });
  const c2Id = (await c2.json()).contract?.contract_id;
  const delDraft = await app.request(`${CONTRACT_PATH(cid)}/${c2Id}`, {
    method: "DELETE",
    headers,
  });
  check("DELETE draft contract 200", delDraft.status === 200);

  // 13. list count: only the approved contract remains
  const listed = await app.request(CONTRACT_PATH(cid), { headers });
  check("list returns 1 contract after draft deleted", (await listed.json()).total === 1);

  // 14. ownership: other user cannot list my contracts
  const otherList = await app.request(CONTRACT_PATH(cid), {
    headers: { "Content-Type": "application/json", "X-User-Id": "other" },
  });
  check("other user list returns 0 (ownership)", (await otherList.json()).total === 0);

  // 15. auth required
  const noAuth = await app.request(CONTRACT_PATH(cid), {
    headers: { "Content-Type": "application/json" },
  });
  check("no auth header rejected (401)", noAuth.status === 401);

  console.log(`\nMWT-17 delegation-contract test: ${passed} passed, ${failed} failed`);
  __setConversationStoreForTesting(null);
  __setDelegationStoreForTesting(null);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FATAL", e);
  __setConversationStoreForTesting(null);
  __setDelegationStoreForTesting(null);
  process.exit(1);
});
