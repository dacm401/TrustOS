/**
 * MWT-14 + MWT-15 + MWT-16: ManagerConversation Controller + UI Surface v0
 *                            Manager ↔ Memory Context Bridge v0
 *                            Manager ↔ Trust Evidence Bridge v0
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
 * Trust evidence bridge endpoints (MWT-16):
 *   GET    /v1/manager-conversations/:id/trust-refs                — list trust references (read-only)
 *   POST   /v1/manager-conversations/:id/trust-refs                — attach evidence/trace/event/task/run ref
 *   DELETE /v1/manager-conversations/:id/trust-refs/:kind/:refId   — detach a trust reference
 *
 * Worker delegation contract endpoints (MWT-17):
 *   GET    /v1/manager-conversations/:id/contracts                       — list worker delegation contracts
 *   POST   /v1/manager-conversations/:id/contracts                       — create a worker delegation contract
 *   GET    /v1/manager-conversations/:id/contracts/:cId                  — get a single contract
 *   PATCH  /v1/manager-conversations/:id/contracts/:cId                  — update draft/ready_for_review contract
 *   POST   /v1/manager-conversations/:id/contracts/:cId/status           — set contract status
 *   DELETE /v1/manager-conversations/:id/contracts/:cId                  — delete a draft contract
 *
 * Controlled worker execution harness endpoints (MWT-18):
 *   GET    /v1/manager-conversations/:id/attempts                       — list execution attempts for conversation
 *   POST   /v1/manager-conversations/:id/contracts/:cId/attempts        — create controlled attempt from approved contract
 *   GET    /v1/manager-conversations/:id/attempts/:aId                  — get a single attempt
 *   POST   /v1/manager-conversations/:id/attempts/:aId/cancel           — cancel a queued/running attempt
 *
 * Wires the MWT-13/MWT-15/MWT-16/MWT-17/MWT-18 services into the HTTP boundary, reusing the existing
 * identity convention (getContextUserId) and ownership scoping. No new auth/RBAC
 * logic, no Trust Spine / Memory semantic change. Both bridges are REFERENCE-ONLY:
 * they never mutate the referenced memory entry, evidence record, or Trust Spine
 * event envelope. Global Private Beta readiness remains READY_WITH_ENV_BLOCKERS.
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
import {
  ManagerConversationTrustRefService,
  PostgresTrustRefStore,
  type TrustRefStore,
  type TrustRefKind,
  type EvidenceLookupFn,
  TRUST_REF_KINDS,
} from "../services/manager/trust-ref-service.js";
import {
  WorkerDelegationContractService,
  PostgresDelegationContractStore,
  type DelegationContractStore,
  type ContractStatus,
} from "../services/manager/delegation-contract-service.js";
import {
  WorkerExecutionHarnessService,
  PostgresExecutionAttemptStore,
  type ExecutionAttemptStore,
  type ExecutionMode,
} from "../services/manager/execution-attempt-service.js";

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

// Test seam: allow injecting a fake trust-ref store + evidence lookup (no live DB).
let activeTrustRefStore: TrustRefStore = PostgresTrustRefStore;
let activeEvidenceLookup: EvidenceLookupFn | undefined;
export function __setTrustRefStoreForTesting(
  store: TrustRefStore | null,
  lookup: EvidenceLookupFn | null = null
) {
  activeTrustRefStore = store ?? PostgresTrustRefStore;
  activeEvidenceLookup = lookup ?? undefined;
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
function getTrustRefService() {
  return new ManagerConversationTrustRefService(
    activeTrustRefStore,
    activeStore,
    activeEvidenceLookup
  );
}

// Test seam: allow injecting a fake delegation-contract store (no live DB).
let activeDelegationStore: DelegationContractStore = PostgresDelegationContractStore;
export function __setDelegationStoreForTesting(store: DelegationContractStore | null) {
  activeDelegationStore = store ?? PostgresDelegationContractStore;
}
function getDelegationService() {
  return new WorkerDelegationContractService(activeDelegationStore);
}

// Test seam: allow injecting a fake execution-attempt store (no live DB).
let activeAttemptStore: ExecutionAttemptStore = PostgresExecutionAttemptStore;
export function __setAttemptStoreForTesting(store: ExecutionAttemptStore | null) {
  activeAttemptStore = store ?? PostgresExecutionAttemptStore;
}
function getHarnessService() {
  // Contract gate uses the delegation service (respects __setDelegationStoreForTesting seam).
  return new WorkerExecutionHarnessService(
    activeAttemptStore,
    (userId, contractId) => getDelegationService().getContract(userId, contractId)
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

// ─────────────────────────────────────────────────────────────────────────────
// MWT-16: Manager ↔ Trust Evidence Bridge (read-only references)
// ─────────────────────────────────────────────────────────────────────────────

// GET /v1/manager-conversations/:id/trust-refs — list trust references
managerConversationsRouter.get("/:id/trust-refs", async (c) => {
  const userId = getContextUserId(c);
  if (!userId) return c.json({ error: "Authentication required" }, 401);

  const id = c.req.param("id");
  try {
    const refs = await getTrustRefService().listTrustRefs(userId, id);
    return c.json({ trust_refs: refs, total: refs.length });
  } catch (error: any) {
    console.error("[MWT-16] list trust refs error:", error.message);
    return c.json({ error: error.message }, error.message.includes("not found") ? 404 : 500);
  }
});

// POST /v1/manager-conversations/:id/trust-refs — attach a trust reference
managerConversationsRouter.post("/:id/trust-refs", async (c) => {
  const userId = getContextUserId(c);
  if (!userId) return c.json({ error: "Authentication required" }, 401);

  const id = c.req.param("id");
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  const refKind = body.ref_kind as TrustRefKind;
  const refId = typeof body.ref_id === "string" ? body.ref_id : "";
  if (!TRUST_REF_KINDS.includes(refKind)) {
    return c.json({ error: `ref_kind must be one of: ${TRUST_REF_KINDS.join(", ")}` }, 400);
  }
  if (!refId) return c.json({ error: "ref_id is required" }, 400);

  try {
    const ref = await getTrustRefService().attachTrustRef(userId, id, refKind, refId);
    return c.json({ trust_ref: ref }, 201);
  } catch (error: any) {
    console.error("[MWT-16] attach trust ref error:", error.message);
    return c.json({ error: error.message }, error.message.includes("not found") ? 404 : 400);
  }
});

// DELETE /v1/manager-conversations/:id/trust-refs/:kind/:refId — detach a trust reference
managerConversationsRouter.delete("/:id/trust-refs/:kind/:refId", async (c) => {
  const userId = getContextUserId(c);
  if (!userId) return c.json({ error: "Authentication required" }, 401);

  const id = c.req.param("id");
  const rawKind = c.req.param("kind") as TrustRefKind;
  const refId = c.req.param("refId");
  if (!TRUST_REF_KINDS.includes(rawKind)) {
    return c.json({ error: `ref_kind must be one of: ${TRUST_REF_KINDS.join(", ")}` }, 400);
  }
  try {
    const ok = await getTrustRefService().detachTrustRef(userId, id, rawKind, refId);
    if (!ok) return c.json({ error: "trust reference not found" }, 404);
    return c.json({ detached: true });
  } catch (error: any) {
    console.error("[MWT-16] detach trust ref error:", error.message);
    return c.json({ error: error.message }, error.message.includes("not found") ? 404 : 500);
  }
});

// ── MWT-17: Worker Delegation Contract endpoints ───────────────────────────────
// Contract layer only. No worker execution, no scheduling, no Trust Spine / Memory
// mutation. References memory_ref_ids / trust_ref_ids as IDs only.

// GET /v1/manager-conversations/:id/contracts — list
managerConversationsRouter.get("/:id/contracts", async (c) => {
  const userId = getContextUserId(c);
  if (!userId) return c.json({ error: "Authentication required" }, 401);
  const conversationId = c.req.param("id");
  try {
    const contracts = await getDelegationService().listContracts(userId, conversationId);
    return c.json({ contracts, total: contracts.length });
  } catch (error: any) {
    console.error("[MWT-17] list contracts error:", error.message);
    return c.json({ error: error.message }, 400);
  }
});

// POST /v1/manager-conversations/:id/contracts — create
managerConversationsRouter.post("/:id/contracts", async (c) => {
  const userId = getContextUserId(c);
  if (!userId) return c.json({ error: "Authentication required" }, 401);
  const conversationId = c.req.param("id");
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  try {
    const contract = await getDelegationService().createContract(userId, {
      conversation_id: conversationId,
      title: typeof body.title === "string" ? body.title : "",
      objective: typeof body.objective === "string" ? body.objective : "",
      intended_worker: typeof body.intended_worker === "string" ? body.intended_worker : null,
      input_summary: typeof body.input_summary === "string" ? body.input_summary : null,
      memory_ref_ids: Array.isArray(body.memory_ref_ids) ? body.memory_ref_ids.map(String) : [],
      trust_ref_ids: Array.isArray(body.trust_ref_ids) ? body.trust_ref_ids.map(String) : [],
      constraints: typeof body.constraints === "string" ? body.constraints : null,
      expected_output: typeof body.expected_output === "string" ? body.expected_output : null,
      status: (body.status as ContractStatus) ?? "draft",
    });
    return c.json({ contract }, 201);
  } catch (error: any) {
    console.error("[MWT-17] create contract error:", error.message);
    return c.json({ error: error.message }, error.message.includes("required") ? 400 : 500);
  }
});

// GET /v1/manager-conversations/:id/contracts/:cId — get one
managerConversationsRouter.get("/:id/contracts/:cId", async (c) => {
  const userId = getContextUserId(c);
  if (!userId) return c.json({ error: "Authentication required" }, 401);
  const cId = c.req.param("cId");
  try {
    const contract = await getDelegationService().getContract(userId, cId);
    if (!contract) return c.json({ error: "contract not found" }, 404);
    return c.json({ contract });
  } catch (error: any) {
    console.error("[MWT-17] get contract error:", error.message);
    return c.json({ error: error.message }, 400);
  }
});

// PATCH /v1/manager-conversations/:id/contracts/:cId — update draft/ready_for_review
managerConversationsRouter.patch("/:id/contracts/:cId", async (c) => {
  const userId = getContextUserId(c);
  if (!userId) return c.json({ error: "Authentication required" }, 401);
  const cId = c.req.param("cId");
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  try {
    const contract = await getDelegationService().updateContract(userId, cId, {
      title: typeof body.title === "string" ? body.title : undefined,
      objective: typeof body.objective === "string" ? body.objective : undefined,
      intended_worker: typeof body.intended_worker === "string" ? body.intended_worker : undefined,
      input_summary: typeof body.input_summary === "string" ? body.input_summary : undefined,
      memory_ref_ids: Array.isArray(body.memory_ref_ids) ? body.memory_ref_ids.map(String) : undefined,
      trust_ref_ids: Array.isArray(body.trust_ref_ids) ? body.trust_ref_ids.map(String) : undefined,
      constraints: typeof body.constraints === "string" ? body.constraints : undefined,
      expected_output: typeof body.expected_output === "string" ? body.expected_output : undefined,
      status: (body.status as ContractStatus) ?? undefined,
    });
    return c.json({ contract });
  } catch (error: any) {
    console.error("[MWT-17] update contract error:", error.message);
    const msg = error.message;
    if (msg.includes("not found")) return c.json({ error: msg }, 404);
    if (msg.includes("locked") || msg.includes("status")) return c.json({ error: msg }, 409);
    return c.json({ error: msg }, 400);
  }
});

// POST /v1/manager-conversations/:id/contracts/:cId/status — set status
managerConversationsRouter.post("/:id/contracts/:cId/status", async (c) => {
  const userId = getContextUserId(c);
  if (!userId) return c.json({ error: "Authentication required" }, 401);
  const cId = c.req.param("cId");
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  const status = body.status as ContractStatus;
  if (!status) return c.json({ error: "status is required" }, 400);
  try {
    const contract = await getDelegationService().setStatus(userId, cId, status);
    return c.json({ contract });
  } catch (error: any) {
    console.error("[MWT-17] set status error:", error.message);
    const msg = error.message;
    if (msg.includes("not found")) return c.json({ error: msg }, 404);
    if (msg.includes("Invalid status") || msg.includes("superseded")) return c.json({ error: msg }, 409);
    return c.json({ error: msg }, 400);
  }
});

// DELETE /v1/manager-conversations/:id/contracts/:cId — delete a draft contract
managerConversationsRouter.delete("/:id/contracts/:cId", async (c) => {
  const userId = getContextUserId(c);
  if (!userId) return c.json({ error: "Authentication required" }, 401);
  const cId = c.req.param("cId");
  try {
    const ok = await getDelegationService().deleteContract(userId, cId);
    if (!ok) return c.json({ error: "contract not found" }, 404);
    return c.json({ deleted: true });
  } catch (error: any) {
    console.error("[MWT-17] delete contract error:", error.message);
    const msg = error.message;
    if (msg.includes("Only draft")) return c.json({ error: msg }, 409);
    return c.json({ error: msg }, 400);
  }
});

// ── MWT-18: Controlled Worker Execution Harness endpoints ──────────────────────
// Creates a CONTROLLED attempt ONLY from an APPROVED contract. The harness runs a
// LOCAL deterministic executor with NO external calls, NO live gateway, NO network,
// NO scheduling, NO autonomous loop. Output is explicitly local harness output,
// NOT live evidence and NOT proof of real-world completion.

// GET /v1/manager-conversations/:id/attempts — list attempts for conversation
managerConversationsRouter.get("/:id/attempts", async (c) => {
  const userId = getContextUserId(c);
  if (!userId) return c.json({ error: "Authentication required" }, 401);
  const conversationId = c.req.param("id");
  try {
    const attempts = await getHarnessService().listAttempts(userId, conversationId);
    return c.json({ attempts, total: attempts.length });
  } catch (error: any) {
    console.error("[MWT-18] list attempts error:", error.message);
    return c.json({ error: error.message }, 400);
  }
});

// POST /v1/manager-conversations/:id/contracts/:cId/attempts — create controlled attempt
managerConversationsRouter.post("/:id/contracts/:cId/attempts", async (c) => {
  const userId = getContextUserId(c);
  if (!userId) return c.json({ error: "Authentication required" }, 401);
  const cId = c.req.param("cId");
  let body: Record<string, unknown> = {};
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    /* default empty body allowed */
  }
  const mode = (body.execution_mode as ExecutionMode) ?? "deterministic_local";
  try {
    const attempt = await getHarnessService().createAttemptFromContract(userId, cId, {
      execution_mode: mode,
    });
    return c.json({ attempt }, 201);
  } catch (error: any) {
    console.error("[MWT-18] create attempt error:", error.message);
    const msg = error.message;
    if (msg.includes("Contract gate")) return c.json({ error: msg }, 409);
    if (msg.includes("not found")) return c.json({ error: msg }, 404);
    if (msg.includes("execution_mode") || msg.includes("Invalid")) return c.json({ error: msg }, 400);
    return c.json({ error: msg }, 500);
  }
});

// GET /v1/manager-conversations/:id/attempts/:aId — get a single attempt
managerConversationsRouter.get("/:id/attempts/:aId", async (c) => {
  const userId = getContextUserId(c);
  if (!userId) return c.json({ error: "Authentication required" }, 401);
  const aId = c.req.param("aId");
  try {
    const attempt = await getHarnessService().getAttempt(userId, aId);
    if (!attempt) return c.json({ error: "attempt not found" }, 404);
    return c.json({ attempt });
  } catch (error: any) {
    console.error("[MWT-18] get attempt error:", error.message);
    return c.json({ error: error.message }, 400);
  }
});

// POST /v1/manager-conversations/:id/attempts/:aId/cancel — cancel queued/running
managerConversationsRouter.post("/:id/attempts/:aId/cancel", async (c) => {
  const userId = getContextUserId(c);
  if (!userId) return c.json({ error: "Authentication required" }, 401);
  const aId = c.req.param("aId");
  try {
    const attempt = await getHarnessService().cancelAttempt(userId, aId);
    return c.json({ attempt });
  } catch (error: any) {
    console.error("[MWT-18] cancel attempt error:", error.message);
    const msg = error.message;
    if (msg.includes("not found")) return c.json({ error: msg }, 404);
    if (msg.includes("terminal")) return c.json({ error: msg }, 409);
    return c.json({ error: msg }, 400);
  }
});
