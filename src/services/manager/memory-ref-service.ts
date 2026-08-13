/**
 * MWT-15: Manager ↔ Memory Context Bridge v0
 *
 * ManagerConversationMemoryRefService — read-only bridge between a manager
 * conversation and EXISTING memory entries.
 *
 * Responsibility (v0):
 *   - attach a memory entry reference to a conversation (by memory_id only)
 *   - list memory references for a conversation
 *   - detach a memory reference from a conversation
 *
 * Design constraints (PM MWT-15 hard boundaries):
 *   - REFERENCES ONLY. This stores the memory_id, not the raw memory content.
 *     No copy, no denormalized content, no exposure of sensitive raw content
 *     beyond what the existing safe conventions already permit.
 *   - READ-ONLY BRIDGE. It NEVER mutates the referenced memory entry, never
 *     writes/updates Memory Governance state, never triggers learning/auto-write.
 *   - The referenced memory entry is verified to exist and belong to the user
 *     via MemoryEntryRepo.getById (a read-only lookup) before attaching.
 *   - Deterministic + testable: depends on an injectable store + injectable
 *     memory-lookup function, so tests use in-memory fakes (no live DB).
 *   - Does NOT change Trust Spine semantics, Memory Governance behavior, or
 *     readiness verdict.
 *
 * What this milestone is NOT:
 *   - Not an automatic memory writer / mutator.
 *   - Not a memory policy engine.
 *   - Not a full agent execution path.
 */

import { v4 as uuid } from "uuid";
import { query } from "../../db/connection.js";
import { ManagerConversationService, PostgresConversationStore, type ConversationStore } from "./conversation-service.js";
import { MemoryEntryRepo as RealMemoryEntryRepo } from "../../db/repositories/memory-growth.js";

/**
 * Lightweight reference DTO returned to the API/UI.
 * Only metadata + a safe truncated preview are exposed — never full raw content
 * unless the caller already holds a governed record (out of MWT-15 scope).
 */
export interface MemoryRefRecord {
  conversation_id: string;
  memory_id: string;
  user_id: string;
  created_at: string;
  /** Safe preview: first 40 chars of the referenced entry content. */
  preview: string;
  category: string | null;
  importance: number | null;
  source: string | null;
  tags: string[];
}

/** Injectable data-access boundary so the service can be tested with fakes. */
export interface MemoryRefStore {
  attachRef(
    conversationId: string,
    memoryId: string,
    userId: string
  ): Promise<void>;
  listRefs(conversationId: string, userId: string): Promise<MemoryRefRecord[]>;
  detachRef(conversationId: string, memoryId: string, userId: string): Promise<boolean>;
}

/** Default Postgres-backed store. Additive table (migration 027). */
export const PostgresMemoryRefStore: MemoryRefStore = {
  async attachRef(conversationId, memoryId, userId) {
    await query(
      `INSERT INTO conversation_memory_refs (conversation_id, memory_id, user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (conversation_id, memory_id) DO NOTHING`,
      [conversationId, memoryId, userId]
    );
  },

  async listRefs(conversationId, userId) {
    const result = await query(
      `SELECT * FROM conversation_memory_refs
       WHERE conversation_id = $1 AND user_id = $2
       ORDER BY created_at DESC`,
      [conversationId, userId]
    );
    return result.rows.map((r: any) => ({
      conversation_id: r.conversation_id,
      memory_id: r.memory_id,
      user_id: r.user_id,
      created_at: new Date(r.created_at).toISOString(),
      preview: "", // preview is filled by the service from the memory entry
      category: null,
      importance: null,
      source: null,
      tags: [],
    }));
  },

  async detachRef(conversationId, memoryId, userId) {
    const result = await query(
      `DELETE FROM conversation_memory_refs
       WHERE conversation_id = $1 AND memory_id = $2 AND user_id = $3`,
      [conversationId, memoryId, userId]
    );
    return (result.rowCount ?? 0) > 0;
  },
};

/**
 * Injectable memory-lookup function (read-only). Default uses MemoryEntryRepo.
 * Tests inject a fake that returns governed-safe records without a DB.
 */
export type MemoryLookupFn = (
  memoryId: string,
  userId: string
) => Promise<{ id: string; content: string; category?: string; importance?: number; source?: string; tags?: string[] } | null>;

const defaultMemoryLookup: MemoryLookupFn = async (memoryId, userId) => {
  const entry = await RealMemoryEntryRepo.getById(memoryId, userId);
  if (!entry) return null;
  return {
    id: entry.id,
    content: entry.content,
    category: entry.category,
    importance: entry.importance,
    source: entry.source,
    tags: entry.tags,
  };
};

function truncatePreview(content: string, max = 40): string {
  const trimmed = content.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

export class ManagerConversationMemoryRefService {
  constructor(
    private store: MemoryRefStore = PostgresMemoryRefStore,
    private conversationStore: ConversationStore = PostgresConversationStore,
    private lookup: MemoryLookupFn = defaultMemoryLookup
  ) {}

  /** Attach an existing memory entry (by id) as a context reference to a conversation. */
  async attachMemoryRef(
    userId: string,
    conversationId: string,
    memoryId: string
  ): Promise<MemoryRefRecord> {
    if (!userId || typeof userId !== "string") {
      throw new Error("userId is required (non-empty string)");
    }
    if (!conversationId?.trim() || !memoryId?.trim()) {
      throw new Error("conversationId and memoryId are required (non-empty strings)");
    }

    // Ownership check on the conversation (read-only).
    const conv = await this.conversationStore.getConversation(userId, conversationId);
    if (!conv) {
      throw new Error(`Conversation not found or not owned: ${conversationId}`);
    }

    // Read-only verification that the memory entry exists and belongs to the user.
    // This never mutates the memory entry.
    const memory = await this.lookup(memoryId, userId);
    if (!memory) {
      throw new Error(`Memory entry not found or not owned: ${memoryId}`);
    }

    await this.store.attachRef(conversationId, memoryId, userId);

    return this.toRecord(conversationId, memory, userId);
  }

  /** List memory references for a conversation (ownership-scoped, read-only). */
  async listMemoryRefs(userId: string, conversationId: string): Promise<MemoryRefRecord[]> {
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

    // Enrich each ref with a safe preview from the (read-only) memory lookup.
    // Missing memory entries are skipped (reference dangling → not surfaced).
    const enriched: MemoryRefRecord[] = [];
    for (const ref of refs) {
      const memory = await this.lookup(ref.memory_id, userId);
      if (!memory) continue;
      enriched.push(this.toRecord(conversationId, memory, userId, ref.created_at));
    }
    return enriched;
  }

  /** Detach a memory reference from a conversation (ownership-scoped). */
  async detachMemoryRef(
    userId: string,
    conversationId: string,
    memoryId: string
  ): Promise<boolean> {
    if (!userId || typeof userId !== "string") {
      throw new Error("userId is required (non-empty string)");
    }
    if (!conversationId?.trim() || !memoryId?.trim()) {
      throw new Error("conversationId and memoryId are required (non-empty strings)");
    }

    const conv = await this.conversationStore.getConversation(userId, conversationId);
    if (!conv) {
      throw new Error(`Conversation not found or not owned: ${conversationId}`);
    }

    return this.store.detachRef(conversationId, memoryId, userId);
  }

  private toRecord(
    conversationId: string,
    memory: { id: string; content: string; category?: string; importance?: number; source?: string; tags?: string[] },
    userId: string,
    createdAt?: string
  ): MemoryRefRecord {
    return {
      conversation_id: conversationId,
      memory_id: memory.id,
      user_id: userId,
      created_at: createdAt ?? new Date().toISOString(),
      preview: truncatePreview(memory.content),
      category: memory.category ?? null,
      importance: memory.importance ?? null,
      source: memory.source ?? null,
      tags: Array.isArray(memory.tags) ? memory.tags : [],
    };
  }
}

/** Singleton default instance (Postgres-backed, real memory lookup). */
export const managerConversationMemoryRefService = new ManagerConversationMemoryRefService();

// Re-export uuid so the test seam / unused-import linters stay quiet if needed.
export const __mwt15Uuid = uuid;
