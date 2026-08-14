/**
 * MWT-16: Manager ↔ Trust Evidence Bridge v0
 *
 * ManagerConversationTrustRefService — read-only bridge between a manager
 * conversation and EXISTING Trust evidence / trace / event / task references.
 *
 * Responsibility (v0):
 *   - attach a trust reference (by kind + id) to a conversation
 *   - list trust references for a conversation
 *   - detach a trust reference from a conversation
 *
 * Design constraints (PM MWT-16 hard boundaries):
 *   - REFERENCES ONLY. Stores (ref_kind, ref_id) + safe metadata. Never copies raw
 *     event payloads, raw evidence content, or trace JSON. Prefers IDs, timestamps,
 *     event types, hashes, status labels, and safe metadata.
 *   - READ-ONLY BRIDGE. NEVER mutates the referenced evidence record, Trust Spine
 *     event envelope, event_hash logic, or validation gates. Following existing
 *     dashboard/event-chain redaction conventions by surfacing metadata only.
 *   - Evidence existence/belonging is verified read-only via EvidenceRepo.getById
 *     (only for kind='evidence'). trace/event/task/run refs are user-supplied
 *     correlation links and are stored as-is (no cross-user JSONL read). This keeps
 *     the bridge safe and does not weaken privacy boundaries.
 *   - Deterministic + testable: injectable store + injectable evidence-lookup.
 *   - Does NOT change Trust Spine semantics, readiness taxonomy, or claim global READY.
 *
 * What this milestone is NOT:
 *   - Not a new Trust Spine implementation.
 *   - Not a proof engine / policy enforcement / worker execution.
 */

import { query } from "../../db/connection.js";
import {
  ManagerConversationService,
  PostgresConversationStore,
  type ConversationStore,
} from "./conversation-service.js";
import { EvidenceRepo } from "../../db/repositories/execution.js";

export type TrustRefKind = "evidence" | "trace" | "event" | "task" | "run";

export const TRUST_REF_KINDS: TrustRefKind[] = ["evidence", "trace", "event", "task", "run"];

/** Lightweight reference DTO returned to the API/UI (metadata only, no raw payload). */
export interface TrustRefRecord {
  conversation_id: string;
  ref_kind: TrustRefKind;
  ref_id: string;
  user_id: string;
  created_at: string;
  /** Safe metadata for evidence refs only; undefined for trace/event/task/run. */
  source?: string | null;
  relevance_score?: number | null;
  related_task_id?: string | null;
}

/** Injectable data-access boundary so the service can be tested with fakes. */
export interface TrustRefStore {
  attachRef(
    conversationId: string,
    refKind: TrustRefKind,
    refId: string,
    userId: string
  ): Promise<void>;
  listRefs(conversationId: string, userId: string): Promise<TrustRefRecord[]>;
  detachRef(
    conversationId: string,
    refKind: TrustRefKind,
    refId: string,
    userId: string
  ): Promise<boolean>;
}

/** Default Postgres-backed store. Additive table (migration 028). */
export const PostgresTrustRefStore: TrustRefStore = {
  async attachRef(conversationId, refKind, refId, userId) {
    await query(
      `INSERT INTO conversation_trust_refs (conversation_id, ref_kind, ref_id, user_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (conversation_id, ref_kind, ref_id) DO NOTHING`,
      [conversationId, refKind, refId, userId]
    );
  },

  async listRefs(conversationId, userId) {
    const result = await query(
      `SELECT * FROM conversation_trust_refs
       WHERE conversation_id = $1 AND user_id = $2
       ORDER BY created_at DESC`,
      [conversationId, userId]
    );
    return result.rows.map((r: any) => ({
      conversation_id: r.conversation_id,
      ref_kind: r.ref_kind as TrustRefKind,
      ref_id: r.ref_id,
      user_id: r.user_id,
      created_at: new Date(r.created_at).toISOString(),
    }));
  },

  async detachRef(conversationId, refKind, refId, userId) {
    const result = await query(
      `DELETE FROM conversation_trust_refs
       WHERE conversation_id = $1 AND ref_kind = $2 AND ref_id = $3 AND user_id = $4`,
      [conversationId, refKind, refId, userId]
    );
    return (result.rowCount ?? 0) > 0;
  },
};

/**
 * Injectable evidence-lookup function (read-only). Default uses EvidenceRepo.getById.
 * Tests inject a fake that returns governed-safe records without a DB.
 * Only used for ref_kind === 'evidence'.
 */
export type EvidenceLookupFn = (
  evidenceId: string,
  userId: string
) => Promise<{ evidence_id: string; task_id: string | null; source: string; relevance_score: number | null } | null>;

const defaultEvidenceLookup: EvidenceLookupFn = async (evidenceId, userId) => {
  // EvidenceRepo.getById is read-only; we additionally confirm the record belongs to
  // the user by checking user_id before returning metadata (no raw content exposed).
  const ev = await EvidenceRepo.getById(evidenceId);
  if (!ev || ev.user_id !== userId) return null;
  return {
    evidence_id: ev.evidence_id,
    task_id: ev.task_id ?? null,
    source: ev.source,
    relevance_score: ev.relevance_score ?? null,
  };
};

export class ManagerConversationTrustRefService {
  constructor(
    private store: TrustRefStore = PostgresTrustRefStore,
    private conversationStore: ConversationStore = PostgresConversationStore,
    private evidenceLookup: EvidenceLookupFn = defaultEvidenceLookup
  ) {}

  async attachTrustRef(
    userId: string,
    conversationId: string,
    refKind: TrustRefKind,
    refId: string
  ): Promise<TrustRefRecord> {
    if (!userId || typeof userId !== "string") {
      throw new Error("userId is required (non-empty string)");
    }
    if (!TRUST_REF_KINDS.includes(refKind)) {
      throw new Error(`ref_kind must be one of: ${TRUST_REF_KINDS.join(", ")}`);
    }
    if (!refId?.trim()) {
      throw new Error("ref_id is required (non-empty string)");
    }

    // Ownership check on the conversation (read-only).
    const conv = await this.conversationStore.getConversation(userId, conversationId);
    if (!conv) {
      throw new Error(`Conversation not found or not owned: ${conversationId}`);
    }

    // For evidence refs: read-only verification that it exists + belongs to the user.
    // This never mutates the evidence record.
    if (refKind === "evidence") {
      const ev = await this.evidenceLookup(refId, userId);
      if (!ev) {
        throw new Error(`Evidence not found or not owned: ${refId}`);
      }
    }
    // trace/event/task/run refs are user-supplied correlation links; stored as-is.

    await this.store.attachRef(conversationId, refKind, refId, userId);

    const base: TrustRefRecord = {
      conversation_id: conversationId,
      ref_kind: refKind,
      ref_id: refId,
      user_id: userId,
      created_at: new Date().toISOString(),
    };

    if (refKind === "evidence") {
      const ev = await this.evidenceLookup(refId, userId);
      if (ev) {
        base.source = ev.source;
        base.relevance_score = ev.relevance_score;
        base.related_task_id = ev.task_id;
      }
    }

    return base;
  }

  async listTrustRefs(userId: string, conversationId: string): Promise<TrustRefRecord[]> {
    if (!userId || typeof userId !== "string") {
      throw new Error("userId is required (non-empty string)");
    }
    if (!conversationId?.trim()) {
      throw new Error("conversationId is required (non-empty string)");
    }

    const conv = await this.conversationStore.getConversation(userId, conversationId);
    if (!conv) {
      throw new Error(`Conversation not found or not owned: ${conversationId}`);
    }

    const refs = await this.store.listRefs(conversationId, userId);

    // Enrich evidence refs with safe metadata from the read-only lookup.
    const enriched = await Promise.all(
      refs.map(async (ref) => {
        if (ref.ref_kind === "evidence") {
          const ev = await this.evidenceLookup(ref.ref_id, userId);
          if (!ev) return null; // dangling reference → not surfaced
          return {
            ...ref,
            source: ev.source,
            relevance_score: ev.relevance_score,
            related_task_id: ev.task_id,
          } as TrustRefRecord;
        }
        return ref;
      })
    );

    return enriched.filter((r): r is TrustRefRecord => r !== null);
  }

  async detachTrustRef(
    userId: string,
    conversationId: string,
    refKind: TrustRefKind,
    refId: string
  ): Promise<boolean> {
    if (!userId || typeof userId !== "string") {
      throw new Error("userId is required (non-empty string)");
    }
    if (!TRUST_REF_KINDS.includes(refKind)) {
      throw new Error(`ref_kind must be one of: ${TRUST_REF_KINDS.join(", ")}`);
    }
    if (!refId?.trim()) {
      throw new Error("ref_id is required (non-empty string)");
    }

    const conv = await this.conversationStore.getConversation(userId, conversationId);
    if (!conv) {
      throw new Error(`Conversation not found or not owned: ${conversationId}`);
    }

    return this.store.detachRef(conversationId, refKind, refId, userId);
  }
}

/** Singleton default instance (Postgres-backed, real evidence lookup). */
export const managerConversationTrustRefService = new ManagerConversationTrustRefService();
