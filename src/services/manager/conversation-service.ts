/**
 * MWT-13: ManagerConversation Backend Wiring v0
 *
 * ManagerConversationService — minimal Manager Loop conversation boundary.
 *
 * Responsibility (v0):
 *   - create a manager conversation/session
 *   - append a user/manager/system message to a conversation
 *   - retrieve/list conversations and their messages
 *
 * Design constraints (PM MWT-13 hard boundaries):
 *   - Deterministic and testable: depends on an injectable repo, so tests can
 *     use an in-memory fake instead of a live DB.
 *   - Does NOT require live DB/gateway to exist.
 *   - Does NOT change Trust Spine semantics, Memory Governance, or readiness.
 *   - Does NOT implement Worker orchestration or policy enforcement.
 *   - The conversation is the Manager Loop management/coordination surface;
 *     it links to Worker sessions only via related_session_id (no coupling).
 *
 * Sealed behavior preserved:
 *   - manager_messages role CHECK (user/manager/system) is unchanged.
 *   - existing ManagerMessageRepo / router are reused, not forked.
 */

import { v4 as uuid } from "uuid";
import { ManagerMessageRepo } from "../../db/repositories/manager-message.js";
import { query } from "../../db/connection.js";

export type ManagerMessageRole = "user" | "manager" | "system";

export interface ConversationRecord {
  id: string;
  user_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface ManagerMessageInput {
  conversationId: string;
  role: ManagerMessageRole;
  content: string;
  relatedSessionId?: string | null;
}

export interface ManagerMessageOutput {
  id: string;
  user_id: string;
  conversation_id: string;
  role: ManagerMessageRole;
  content: string;
  related_session_id: string | null;
  created_at: string;
}

/**
 * Minimal data-access boundary so the service can be tested with an in-memory
 * fake. The default implementation talks to Postgres; tests inject a fake.
 */
export interface ConversationStore {
  createConversation(userId: string, title: string | null): Promise<ConversationRecord>;
  getConversation(userId: string, id: string): Promise<ConversationRecord | null>;
  listConversations(userId: string, limit?: number): Promise<ConversationRecord[]>;
  touchConversation(id: string): Promise<void>;
}

/** Default Postgres-backed store. Additive `conversations` table (migration 026). */
export const PostgresConversationStore: ConversationStore = {
  async createConversation(userId, title) {
    const id = uuid();
    const result = await query(
      `INSERT INTO conversations (id, user_id, title)
       VALUES ($1,$2,$3) RETURNING *`,
      [id, userId, title ?? null]
    );
    const r = result.rows[0];
    return {
      id: r.id,
      user_id: r.user_id,
      title: r.title ?? null,
      created_at: new Date(r.created_at).toISOString(),
      updated_at: new Date(r.updated_at).toISOString(),
    };
  },

  async getConversation(userId, id) {
    const result = await query(
      `SELECT * FROM conversations WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    if (result.rows.length === 0) return null;
    const r = result.rows[0];
    return {
      id: r.id,
      user_id: r.user_id,
      title: r.title ?? null,
      created_at: new Date(r.created_at).toISOString(),
      updated_at: new Date(r.updated_at).toISOString(),
    };
  },

  async listConversations(userId, limit = 50) {
    const result = await query(
      `SELECT * FROM conversations WHERE user_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [userId, Math.min(limit, 200)]
    );
    return result.rows.map((r: any) => ({
      id: r.id,
      user_id: r.user_id,
      title: r.title ?? null,
      created_at: new Date(r.created_at).toISOString(),
      updated_at: new Date(r.updated_at).toISOString(),
    }));
  },

  async touchConversation(id) {
    await query(
      `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
      [id]
    );
  },
};

export class ManagerConversationService {
  constructor(private store: ConversationStore = PostgresConversationStore) {}

  /** Create a new manager conversation. */
  async createConversation(userId: string, title?: string): Promise<ConversationRecord> {
    if (!userId || typeof userId !== "string") {
      throw new Error("userId is required (non-empty string)");
    }
    const cleanTitle = title && typeof title === "string" && title.trim().length > 0
      ? title.trim().slice(0, 255)
      : null;
    return this.store.createConversation(userId, cleanTitle);
  }

  /** Append a message to a conversation (ownership-checked via userId). */
  async appendMessage(
    userId: string,
    input: ManagerMessageInput
  ): Promise<ManagerMessageOutput> {
    if (!userId || typeof userId !== "string") {
      throw new Error("userId is required (non-empty string)");
    }
    const conversationId = input.conversationId?.trim();
    if (!conversationId) {
      throw new Error("conversationId is required (non-empty string)");
    }
    const content = input.content?.trim();
    if (!content) {
      throw new Error("content is required (non-empty string)");
    }
    const validRoles: ManagerMessageRole[] = ["user", "manager", "system"];
    if (!validRoles.includes(input.role)) {
      throw new Error(`Invalid role '${input.role}'. Must be one of: ${validRoles.join(", ")}`);
    }

    // Ensure the conversation exists and belongs to the user.
    const conv = await this.store.getConversation(userId, conversationId);
    if (!conv) {
      throw new Error(`Conversation not found or not owned: ${conversationId}`);
    }

    const record = await ManagerMessageRepo.create({
      user_id: userId,
      conversation_id: conversationId,
      role: input.role,
      content,
      related_session_id: input.relatedSessionId ?? null,
    });

    await this.store.touchConversation(conversationId);

    return {
      id: record.id,
      user_id: record.user_id,
      conversation_id: record.conversation_id,
      role: record.role,
      content: record.content,
      related_session_id: record.related_session_id,
      created_at: record.created_at,
    };
  }

  /** Retrieve a single conversation (ownership-scoped). */
  async getConversation(userId: string, id: string): Promise<ConversationRecord | null> {
    return this.store.getConversation(userId, id);
  }

  /** List conversations for a user, newest first. */
  async listConversations(userId: string, limit = 50): Promise<ConversationRecord[]> {
    return this.store.listConversations(userId, limit);
  }

  /** List messages in a conversation (ownership-scoped). */
  async listMessages(
    userId: string,
    conversationId: string,
    limit = 100
  ): Promise<ManagerMessageOutput[]> {
    const conv = await this.store.getConversation(userId, conversationId);
    if (!conv) {
      throw new Error(`Conversation not found or not owned: ${conversationId}`);
    }
    const records = await ManagerMessageRepo.listByConversation(conversationId, { userId, limit });
    return records.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      conversation_id: r.conversation_id,
      role: r.role,
      content: r.content,
      related_session_id: r.related_session_id,
      created_at: r.created_at,
    }));
  }
}

/** Singleton default instance (Postgres-backed). */
export const managerConversationService = new ManagerConversationService();
