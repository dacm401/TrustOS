/**
 * Sovereign Data Layer — conversation turn repository (RFC-001 Phase 1).
 *
 * This is the L1 "raw intent" store: the original prompt / conversation text,
 * retained on the LOCAL machine. It is the substrate that makes the Manager
 * progressively understand the user, and the asset that constitutes data
 * sovereignty.
 *
 * Non-negotiable properties:
 *  1. **Never read by the egress path.** Only `egress-processor.ts` output may
 *     reach a provider. This repo is for local retention/retrieval only.
 *  2. **Secrets are never persisted.** A turn containing a secret is DROPPED
 *     (not stored redacted) — a silently redacted sovereign record would be a
 *     corrupted record.
 *  3. **No retention policy.** Rows accumulate; Phase 2 archiving encrypts
 *     them into bundles but must never delete them.
 *  4. **Writes never block the response path.** Callers should use
 *     `recordTurnAsync` (fire-and-forget) from the chat pipeline.
 */

import { createHash } from "node:crypto";
import { query } from "../connection.js";

export type TurnRole = "user" | "assistant" | "system" | "tool";
export type TurnSensitivity = "normal" | "sensitive";

export interface ConversationTurn {
  id: string;
  session_id: string;
  turn_index: number;
  role: TurnRole;
  content: string;
  user_id: string;
  content_hash: string | null;
  sensitivity: TurnSensitivity;
  archive_id: string | null;
  archived_at: string | null;
  created_at: string;
}

export interface TurnInput {
  sessionId: string;
  turnIndex: number;
  role: TurnRole;
  content: string;
  userId: string;
  sensitivity?: TurnSensitivity;
}

// ── Secret detection (shared semantics with egress processing) ───────────────
//
// Deliberately re-declared rather than imported: the egress processor is about
// what LEAVES the machine, this is about what is STORED. They must agree on
// what counts as a secret (same shapes), but must stay independently testable
// and must not couple storage to the outbound pipeline.

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
  /sk-ant-[A-Za-z0-9_-]{16,}/g,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
];

const NOT_A_SECRET = new Set([
  "string", "number", "boolean", "bool", "any", "unknown", "never", "void",
  "object", "array", "int", "float", "double", "str", "none", "null",
  "undefined", "true", "false", "input", "text", "value", "required",
  "optional", "your", "here", "placeholder", "example", "todo", "fixme",
]);

/**
 * Ambiguous `key: value` assignment shape. Validated per match so ordinary
 * declarations (`apiKey: string`) are not mistaken for credentials.
 */
const ASSIGNED_SECRET_RE =
  /\b(?:api[_-]?key|secret|password|passwd|pwd|access[_-]?token|refresh[_-]?token)\b\s*[:=]\s*["']?([^\s"',;]{4,})/gi;

function looksLikeSecret(value: string): boolean {
  const v = value.trim();
  if (v.length < 8) return false;
  if (/^[$<{]/.test(v)) return false;
  if (NOT_A_SECRET.has(v.toLowerCase())) return false;
  if (/^[A-Za-z]+$/.test(v) && !/[A-Z]/.test(v.slice(1)) && v.length < 12) return false;
  return true;
}

/** True when the content must NOT be persisted. */
export function containsSecret(content: string): boolean {
  if (!content) return false;
  for (const re of SECRET_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(content)) return true;
  }
  ASSIGNED_SECRET_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ASSIGNED_SECRET_RE.exec(content)) !== null) {
    if (looksLikeSecret(m[1] ?? "")) return true;
  }
  return false;
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

// ── Repository ──────────────────────────────────────────────────────────────

export const ConversationTurnRepo = {
  /**
   * Persist a turn. Returns null (and stores nothing) when the content carries
   * a secret, or when content is empty.
   *
   * `skipped` distinguishes "not stored on purpose" from a write failure.
   */
  async record(input: TurnInput): Promise<
    { stored: true; id: string } | { stored: false; skipped: true; reason: string }
  > {
    const content = input.content ?? "";
    if (!content.trim()) {
      return { stored: false, skipped: true, reason: "empty_content" };
    }
    // Guardrail 2: secrets never enter the sovereign store.
    if (containsSecret(content)) {
      return { stored: false, skipped: true, reason: "contains_secret" };
    }

    const result = await query(
      `INSERT INTO conversation_turns
         (session_id, turn_index, role, content, user_id, content_hash, sensitivity)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        input.sessionId,
        input.turnIndex,
        input.role,
        content,
        input.userId,
        hashContent(content),
        input.sensitivity ?? "normal",
      ]
    );
    return { stored: true, id: result.rows[0].id as string };
  },

  /** Non-blocking write. Safe to call from the request path. */
  recordAsync(input: TurnInput): void {
    void ConversationTurnRepo.record(input).catch((err) => {
      // Retention must never break a response. Log the class, not the content.
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[sovereign] turn persist failed: ${message}\n`);
    });
  },

  /** Hot-layer turns for a session, in order. */
  async listBySession(sessionId: string, limit = 200): Promise<ConversationTurn[]> {
    const result = await query(
      `SELECT * FROM conversation_turns
        WHERE session_id = $1
        ORDER BY turn_index ASC
        LIMIT $2`,
      [sessionId, limit]
    );
    return result.rows as ConversationTurn[];
  },

  async getById(id: string): Promise<ConversationTurn | null> {
    const result = await query(`SELECT * FROM conversation_turns WHERE id = $1`, [id]);
    return (result.rows[0] as ConversationTurn) ?? null;
  },

  /** Next turn index for a session (append-only sequence). */
  async nextTurnIndex(sessionId: string): Promise<number> {
    const result = await query(
      `SELECT COALESCE(MAX(turn_index), -1) AS max_idx FROM conversation_turns WHERE session_id = $1`,
      [sessionId]
    );
    return Number(result.rows[0].max_idx) + 1;
  },

  /** Count of hot-layer (not yet archived) turns — drives the archive prompt. */
  async countHot(userId?: string): Promise<number> {
    const result = userId
      ? await query(
          `SELECT COUNT(*)::int AS c FROM conversation_turns WHERE archive_id IS NULL AND user_id = $1`,
          [userId]
        )
      : await query(`SELECT COUNT(*)::int AS c FROM conversation_turns WHERE archive_id IS NULL`);
    return Number(result.rows[0].c);
  },

  /** Oldest un-archived turns — Phase 2 archiving batch source. */
  async listArchivable(limit = 1000): Promise<ConversationTurn[]> {
    const result = await query(
      `SELECT * FROM conversation_turns
        WHERE archive_id IS NULL
        ORDER BY created_at ASC
        LIMIT $1`,
      [limit]
    );
    return result.rows as ConversationTurn[];
  },

  /** Mark turns as archived (Phase 2). Does NOT delete the rows. */
  async markArchived(ids: string[], archiveId: string): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await query(
      `UPDATE conversation_turns
          SET archive_id = $1, archived_at = NOW()
        WHERE id = ANY($2::uuid[])`,
      [archiveId, ids]
    );
    return result.rowCount ?? 0;
  },
};
