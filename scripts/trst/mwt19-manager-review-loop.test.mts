/**
 * MWT-19: Manager Review / Approve Loop v0 — deterministic, zero-DB test.
 *
 * Runs with: npx tsx scripts/trst/mwt19-manager-review-loop.test.mts
 *
 * Verifies the HTTP boundary (managerConversationsRouter review endpoints) wires
 * to the ManagerReviewService correctly, using:
 *   - in-memory fake ConversationStore (ownership)
 *   - in-memory fake DelegationContractStore (contract gate source)
 *   - in-memory fake ExecutionAttemptStore (attempt records)
 *   - in-memory fake ManagerReviewStore (review records)
 *
 * Key invariants confirmed:
 *   - Reviews require auth (401 without X-User-Id).
 *   - Decision vocabulary is enforced by target_type:
 *       contract  -> approve / reject / request_changes
 *       attempt   -> accept_result / reject_result / request_rerun
 *   - Invalid decision for target_type returns 400.
 *   - Reviews are additive/auditable; list returns all records in order.
 *   - Recording a review does NOT mutate contract/attempt state.
 *   - Only safe reason text is stored (length cap), no raw payload expansion.
 *   - Honest labeling: service/UI scope is internal manager review, not live evidence.
 */

import { Hono } from "hono";
import {
  managerConversationsRouter,
  __setConversationStoreForTesting,
  __setDelegationStoreForTesting,
  __setAttemptStoreForTesting,
  __setReviewStoreForTesting,
} from "../../src/api/manager-conversations.ts";
import { identityMiddleware } from "../../src/middleware/identity.ts";
import type { ConversationRecord, ConversationStore } from "../../src/services/manager/conversation-service.ts";
import type {
  DelegationContractStore,
  WorkerDelegationContractRecord,
  ContractStatus,
} from "../../src/services/manager/delegation-contract-service.ts";
import type {
  ExecutionAttemptStore,
  WorkerExecutionAttemptRecord,
  ExecutionMode,
} from "../../src/services/manager/execution-attempt-service.ts";
import { InMemoryManagerReviewStore } from "../../src/services/manager/manager-review-service.ts";

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
    return [...this.conversations.values()].filter((c) => c.user_id === userId).slice(0, limit);
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

// ── In-memory fake execution-attempt store ───────────────────────────────────
class InMemoryAttemptStore implements ExecutionAttemptStore {
  private attempts = new Map<string, WorkerExecutionAttemptRecord>();
  async create(rec: any): Promise<WorkerExecutionAttemptRecord> {
    const now = new Date().toISOString();
    const full: WorkerExecutionAttemptRecord = {
      attempt_id: rec.attempt_id,
      conversation_id: rec.conversation_id,
      contract_id: rec.contract_id,
      user_id: rec.user_id,
      worker_label: rec.worker_label ?? null,
      input_summary: rec.input_summary ?? null,
      constraints: rec.constraints ?? null,
      status: rec.status,
      result_summary: rec.result_summary ?? null,
      error_summary: rec.error_summary ?? null,
      execution_mode: rec.execution_mode,
      created_at: now,
      updated_at: now,
      completed_at: null,
    };
    this.attempts.set(rec.attempt_id, full);
    return full;
  }
  async listByConversation(userId: string, conversationId: string): Promise<WorkerExecutionAttemptRecord[]> {
    return [...this.attempts.values()]
      .filter((a) => a.conversation_id === conversationId && a.user_id === userId)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }
  async listByContract(userId: string, contractId: string): Promise<WorkerExecutionAttemptRecord[]> {
    return [...this.attempts.values()].filter((a) => a.contract_id === contractId && a.user_id === userId);
  }
  async get(userId: string, attemptId: string): Promise<WorkerExecutionAttemptRecord | null> {
    const a = this.attempts.get(attemptId);
    if (!a || a.user_id !== userId) return null;
    return a;
  }
  async update(userId: string, attemptId: string, patch: any): Promise<WorkerExecutionAttemptRecord | null> {
    const a = this.attempts.get(attemptId);
    if (!a || a.user_id !== userId) return null;
    const next = { ...a, ...patch, updated_at: new Date().toISOString() };
    this.attempts.set(attemptId, next);
    return next;
  }
  async remove(userId: string, attemptId: string): Promise<boolean> {
    const a = this.attempts.get(attemptId);
    if (!a || a.user_id !== userId) return false;
    return this.attempts.delete(attemptId);
  }
}

const convStore = new InMemoryConversationStore();
const delegationStore = new InMemoryDelegationStore();
const attemptStore = new InMemoryAttemptStore();
const reviewStore = new InMemoryManagerReviewStore();

__setConversationStoreForTesting(convStore);
__setDelegationStoreForTesting(delegationStore);
__setAttemptStoreForTesting(attemptStore);
__setReviewStoreForTesting(reviewStore);

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

const CONV = (cid: string) => `/v1/manager-conversations/${cid}`;
const headers = (userId: string) => ({ "Content-Type": "application/json", "X-User-Id": userId });

async function main() {
  const userId = "test-user";

  // 1. setup conversation + approved contract + attempt
  const convRes = await app.request("/v1/manager-conversations", {
    method: "POST",
    headers: headers(userId),
    body: JSON.stringify({ title: "Review test" }),
  });
  const cid = (await convRes.json()).conversation.id;

  const approvedC = await app.request(`${CONV(cid)}/contracts`, {
    method: "POST",
    headers: headers(userId),
    body: JSON.stringify({
      title: "Approved contract",
      objective: "summarize report",
      intended_worker: "report-summarizer",
      constraints: "no external network",
    }),
  });
  const approvedId = (await approvedC.json()).contract?.contract_id;
  await app.request(`${CONV(cid)}/contracts/${approvedId}/status`, {
    method: "POST", headers: headers(userId), body: JSON.stringify({ status: "ready_for_review" }),
  });
  await app.request(`${CONV(cid)}/contracts/${approvedId}/status`, {
    method: "POST", headers: headers(userId), body: JSON.stringify({ status: "approved" }),
  });

  const attemptMade = await app.request(`${CONV(cid)}/contracts/${approvedId}/attempts`, {
    method: "POST", headers: headers(userId), body: JSON.stringify({ execution_mode: "deterministic_local" }),
  });
  const aId = (await attemptMade.json()).attempt?.attempt_id;

  // 2. auth required for listing reviews
  const noAuth = await app.request(`${CONV(cid)}/reviews`, { method: "GET" });
  check("list reviews without auth rejected 401", noAuth.status === 401);

  // 3. create contract review (approve) 201
  const approve = await app.request(`${CONV(cid)}/reviews`, {
    method: "POST", headers: headers(userId),
    body: JSON.stringify({ target_type: "delegation_contract", target_id: approvedId, decision: "approve", reason: "scope clear" }),
  });
  check("contract review approve 201", approve.status === 201);
  check("contract review decision recorded", (await approve.json()).review?.decision === "approve");

  // 4. invalid decision for target_type -> 400
  const badDecision = await app.request(`${CONV(cid)}/reviews`, {
    method: "POST", headers: headers(userId),
    body: JSON.stringify({ target_type: "delegation_contract", target_id: approvedId, decision: "accept_result" }),
  });
  check("contract review with attempt-decision rejected 400", badDecision.status === 400);

  // 5. create attempt review (accept_result) 201
  const accept = await app.request(`${CONV(cid)}/reviews`, {
    method: "POST", headers: headers(userId),
    body: JSON.stringify({ target_type: "execution_attempt", target_id: aId, decision: "accept_result", reason: "deterministic + safe" }),
  });
  check("attempt review accept_result 201", accept.status === 201);

  // 6. attempt-decision on contract target rejected 400 (reverse direction, double-check)
  const badAttemptOnContract = await app.request(`${CONV(cid)}/reviews`, {
    method: "POST", headers: headers(userId),
    body: JSON.stringify({ target_type: "execution_attempt", target_id: aId, decision: "request_changes" }),
  });
  check("attempt review with contract-decision rejected 400", badAttemptOnContract.status === 400);

  // 7. reviews are additive/auditable; list returns all
  const listed = await app.request(`${CONV(cid)}/reviews`, { method: "GET", headers: headers(userId) });
  check("list reviews 200", listed.status === 200);
  const listBody = await listed.json();
  check("two reviews listed (additive)", listBody.total === 2);
  check("first review is approve (order preserved)", listBody.reviews[0].decision === "approve");
  check("second review is accept_result (order preserved)", listBody.reviews[1].decision === "accept_result");

  // 8. list by target
  const byTarget = await app.request(`${CONV(cid)}/reviews/target/delegation_contract/${approvedId}`, { method: "GET", headers: headers(userId) });
  check("list by target 200", byTarget.status === 200);
  check("one contract review via target", (await byTarget.json()).total === 1);

  // 9. recording review does NOT mutate contract/attempt state
  const contractAfter = await app.request(`${CONV(cid)}/contracts/${approvedId}`, { method: "GET", headers: headers(userId) });
  check("contract still approved after review", (await contractAfter.json()).contract?.status === "approved");
  const attemptAfter = await app.request(`${CONV(cid)}/attempts/${aId}`, { method: "GET", headers: headers(userId) });
  check("attempt still completed after review", (await attemptAfter.json()).attempt?.status === "completed");

  // 10. safe reason cap (no raw payload expansion)
  const longReason = "x".repeat(5000);
  const longReview = await app.request(`${CONV(cid)}/reviews`, {
    method: "POST", headers: headers(userId),
    body: JSON.stringify({ target_type: "delegation_contract", target_id: approvedId, decision: "reject", reason: longReason }),
  });
  check("reject review with long reason 201", longReview.status === 201);
  const longBody = await longReview.json();
  check("reason stored within safe cap (<=4000)", (longBody.review?.reason ?? "").length <= 4000);

  // 11. honest labeling: review records do not assert external reviewer evidence / READY proof
  check(
    "review records carry internal target_type only (no live evidence claim)",
    listBody.reviews.every((r: any) => r.target_type === "delegation_contract" || r.target_type === "execution_attempt")
  );

  console.log(`\nMWT-19 manager-review-loop test: ${passed} passed, ${failed} failed`);
  __setConversationStoreForTesting(null);
  __setDelegationStoreForTesting(null);
  __setAttemptStoreForTesting(null);
  __setReviewStoreForTesting(null);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FATAL", e);
  __setConversationStoreForTesting(null);
  __setDelegationStoreForTesting(null);
  __setAttemptStoreForTesting(null);
  __setReviewStoreForTesting(null);
  process.exit(1);
});
