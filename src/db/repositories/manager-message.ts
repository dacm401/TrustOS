/**
 * S100P-003: Manager Messages Repository
 *
 * manager_messages table — Manager Loop messages only.
 * Worker progress events must NOT be stored here.
 * related_session_id is nullable for non-delegated conversation messages.
 */

import { v4 as uuid } from "uuid";
import { query } from "../connection.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type ManagerMessageRole = "user" | "manager" | "system";

export interface ManagerMessageRecord {
  id: string;
  user_id: string;
  conversation_id: string;
  role: ManagerMessageRole;
  content: string;
  related_session_id: string | null;
  created_at: string;
}

export interface ManagerMessageInput {
  user_id: string;
  conversation_id: string;
  role: ManagerMessageRole;
  content: string;
  related_session_id?: string | null;
}

function mapRow(r: any): ManagerMessageRecord {
  return {
    id: r.id,
    user_id: r.user_id,
    conversation_id: r.conversation_id,
    role: r.role,
    content: r.content,
    related_session_id: r.related_session_id ?? null,
    created_at: new Date(r.created_at).toISOString(),
  };
}

// ── Repo ─────────────────────────────────────────────────────────────────────

export const ManagerMessageRepo = {
  /** Create a manager message */
  async create(input: ManagerMessageInput): Promise<ManagerMessageRecord> {
    const id = uuid();
    const result = await query(
      `INSERT INTO manager_messages
       (id, user_id, conversation_id, role, content, related_session_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [
        id,
        input.user_id,
        input.conversation_id,
        input.role,
        input.content,
        input.related_session_id ?? null,
      ]
    );
    return mapRow(result.rows[0]);
  },

  /** List messages for a user, with optional conversation/session/role filters */
  async list(
    userId: string,
    options?: {
      conversationId?: string;
      relatedSessionId?: string;
      role?: ManagerMessageRole;
      limit?: number;
      offset?: number;
    }
  ): Promise<ManagerMessageRecord[]> {
    const limit = Math.min(options?.limit ?? 100, 500);
    const offset = options?.offset ?? 0;

    let sql = `SELECT * FROM manager_messages WHERE user_id = $1`;
    const params: any[] = [userId];
    let idx = 2;

    if (options?.conversationId) {
      sql += ` AND conversation_id = $${idx}`;
      params.push(options.conversationId);
      idx++;
    }

    if (options?.relatedSessionId) {
      sql += ` AND related_session_id = $${idx}`;
      params.push(options.relatedSessionId);
      idx++;
    }

    if (options?.role) {
      sql += ` AND role = $${idx}`;
      params.push(options.role);
      idx++;
    }

    sql += ` ORDER BY created_at ASC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);

    const result = await query(sql, params);
    return result.rows.map(mapRow);
  },

  /** Count messages for a user, with optional filters */
  async count(
    userId: string,
    options?: {
      conversationId?: string;
      relatedSessionId?: string;
      role?: ManagerMessageRole;
    }
  ): Promise<number> {
    let sql = `SELECT COUNT(*)::int AS total FROM manager_messages WHERE user_id = $1`;
    const params: any[] = [userId];
    let idx = 2;

    if (options?.conversationId) {
      sql += ` AND conversation_id = $${idx}`;
      params.push(options.conversationId);
      idx++;
    }

    if (options?.relatedSessionId) {
      sql += ` AND related_session_id = $${idx}`;
      params.push(options.relatedSessionId);
      idx++;
    }

    if (options?.role) {
      sql += ` AND role = $${idx}`;
      params.push(options.role);
      idx++;
    }

    const result = await query(sql, params);
    return result.rows[0]?.total ?? 0;
  },

  /** Get messages for a conversation (ownership-scoped) */
  async listByConversation(
    conversationId: string,
    options?: {
      userId?: string;
      related_session_id?: string;
      limit?: number;
      before?: string; // cursor-based pagination: messages before this created_at
    }
  ): Promise<ManagerMessageRecord[]> {
    const limit = Math.min(options?.limit ?? 50, 200);

    let sql = `SELECT * FROM manager_messages WHERE conversation_id = $1`;
    const params: any[] = [conversationId];
    let idx = 2;

    if (options?.userId) {
      sql += ` AND user_id = $${idx}`;
      params.push(options.userId);
      idx++;
    }

    if (options?.related_session_id) {
      sql += ` AND related_session_id = $${idx}`;
      params.push(options.related_session_id);
      idx++;
    }

    if (options?.before) {
      sql += ` AND created_at < $${idx}`;
      params.push(options.before);
      idx++;
    }

    sql += ` ORDER BY created_at ASC LIMIT $${idx}`;
    params.push(limit);

    const result = await query(sql, params);
    return result.rows.map(mapRow);
  },

  /** Get a single message by ID */
  async getById(id: string): Promise<ManagerMessageRecord | null> {
    const result = await query(
      `SELECT * FROM manager_messages WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) return null;
    return mapRow(result.rows[0]);
  },

  /** Count messages in a conversation (ownership-scoped) */
  async countByConversation(
    conversationId: string,
    userId?: string
  ): Promise<number> {
    let sql = `SELECT COUNT(*)::int AS total FROM manager_messages WHERE conversation_id = $1`;
    const params: any[] = [conversationId];

    if (userId) {
      sql += ` AND user_id = $2`;
      params.push(userId);
    }

    const result = await query(sql, params);
    return result.rows[0]?.total ?? 0;
  },

  /** Get latest message in a conversation */
  async getLatest(conversationId: string): Promise<ManagerMessageRecord | null> {
    const result = await query(
      `SELECT * FROM manager_messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [conversationId]
    );
    if (result.rows.length === 0) return null;
    return mapRow(result.rows[0]);
  },
};
