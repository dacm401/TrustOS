/**
 * Sovereign Archive Bundle — Phase 2 (RFC-001).
 *
 * The physical form of data sovereignty: a portable, passphrase-encrypted
 * bundle of the retained conversation history that the user owns outright.
 *
 * ── How this differs from backup (src/services/sovereign/backup.ts) ──────────
 *   backup  = disaster recovery. Plaintext by default, takes everything,
 *             leaves the hot layer untouched.
 *   archive = generational retention + portability. ALWAYS encrypted,
 *             moves raw turns out of the hot layer, never deletes them.
 *
 * ── Non-negotiable rules ────────────────────────────────────────────────────
 *   1. Archiving NEVER deletes. Rows are marked with an `archive_id` so the
 *      hot layer shrinks, but the sovereign record persists forever.
 *      (RFC-001: sovereign data is an accumulating asset, not a disposable log.)
 *   2. Only `conversation_turns` are archived. `memory_entries` (distillates)
 *      NEVER age out — they are small, high-density, and are what makes the
 *      Manager progressively understand the user.
 *   3. A passphrase is mandatory. An archive is meant to leave the machine;
 *      an unencrypted one would be pointless. Losing the passphrase means the
 *      bundle is unrecoverable — by design, no back door.
 *
 * Reuses backup.ts for checksum + encryption so the two can never drift.
 */

import { randomBytes } from "node:crypto";
import { query } from "../../db/connection.js";
import { ConversationTurnRepo } from "../../db/repositories.js";
import {
  computeChecksum,
  decryptSnapshotPayload,
  encryptSnapshotPayload,
  type SnapshotPayloadShape,
} from "./backup.js";

export const ARCHIVE_SCHEMA = "trustos-sovereign-archive/v1";

export interface ArchiveBundle {
  schema: string;
  archive_id: string;
  created_at: string;
  user_id: string;
  /** Turn count included in this bundle. */
  turn_count: number;
  /** Time range covered, for human-readable bundle naming. */
  range: { from: string | null; to: string | null };
  /** SHA-256 over the plaintext payload (verified after decryption). */
  checksum: string;
  /** Always true — archiving without a passphrase is rejected. */
  encrypted: boolean;
  /** base64: salt|iv|tag|ciphertext (see backup.ts). */
  payload: string;
}

/** Rows waiting in the hot layer — drives the "time to archive" hint. */
export async function countArchiveable(userId: string, before?: Date): Promise<number> {
  const result = before
    ? await query(
        `SELECT COUNT(*)::int AS c FROM conversation_turns
          WHERE user_id=$1 AND archive_id IS NULL AND created_at < $2`,
        [userId, before],
      )
    : await query(
        `SELECT COUNT(*)::int AS c FROM conversation_turns
          WHERE user_id=$1 AND archive_id IS NULL`,
        [userId],
      );
  return Number(result.rows[0].c);
}

/**
 * Create an encrypted archive bundle for the user's hot-layer turns.
 *
 * Steps: select → checksum → encrypt → mark archived (NOT deleted).
 * If any step after selection fails, nothing is marked — so a failed archive
 * can never leave data labelled archived when it was not written.
 */
export async function createArchiveBundle(
  userId: string,
  opts: { passphrase: string; before?: Date; limit?: number },
): Promise<ArchiveBundle> {
  if (!opts?.passphrase) {
    throw new Error("Archive requires a passphrase (bundles are meant to leave the machine).");
  }

  const limit = opts.limit ?? 10_000;
  const result = opts.before
    ? await query(
        `SELECT id, session_id, turn_index, role, content, content_hash,
                sensitivity, created_at
           FROM conversation_turns
          WHERE user_id=$1 AND archive_id IS NULL AND created_at < $2
          ORDER BY created_at ASC
          LIMIT $3`,
        [userId, opts.before, limit],
      )
    : await query(
        `SELECT id, session_id, turn_index, role, content, content_hash,
                sensitivity, created_at
           FROM conversation_turns
          WHERE user_id=$1 AND archive_id IS NULL
          ORDER BY created_at ASC
          LIMIT $2`,
        [userId, limit],
      );

  const rows = result.rows as Array<Record<string, unknown>>;
  const archiveId = `arch_${new Date().toISOString().slice(0, 10)}_${randomBytes(4).toString("hex")}`;

  // Checksum over the JSON-normalised payload — same discipline as backup,
  // so a Date column cannot make the hash differ from what lands on disk.
  const payload: SnapshotPayloadShape = {
    conversation_turns: rows,
    memory_entries: [],
  };
  const checksum = computeChecksum(payload);
  const encrypted = encryptSnapshotPayload(payload, opts.passphrase);

  const timestamps = rows
    .map((r) => String(r.created_at ?? ""))
    .filter(Boolean)
    .sort();

  const bundle: ArchiveBundle = {
    schema: ARCHIVE_SCHEMA,
    archive_id: archiveId,
    created_at: new Date().toISOString(),
    user_id: userId,
    turn_count: rows.length,
    range: {
      from: timestamps[0] ?? null,
      to: timestamps[timestamps.length - 1] ?? null,
    },
    checksum,
    encrypted: true,
    payload: encrypted,
  };

  // Only mark AFTER the bundle is fully built.
  if (rows.length > 0) {
    await ConversationTurnRepo.markArchived(
      rows.map((r) => String(r.id)),
      archiveId,
    );
  }

  return bundle;
}

/**
 * Import an archive bundle back.
 *
 * Verify → decrypt → upsert. Rows are re-inserted with archive_id cleared so
 * they return to the hot layer and become searchable again.
 */
export async function importArchiveBundle(
  bundle: ArchiveBundle,
  opts: { passphrase: string; dryRun?: boolean },
): Promise<{ restored: number; skipped: number; dryRun: boolean }> {
  if (!bundle || bundle.schema !== ARCHIVE_SCHEMA) {
    throw new Error(
      `Unsupported archive schema: ${bundle?.schema ?? "unknown"} (expected ${ARCHIVE_SCHEMA})`,
    );
  }
  if (!opts?.passphrase) {
    throw new Error("Archive is encrypted — a passphrase is required");
  }

  const payload = decryptSnapshotPayload(bundle.payload, opts.passphrase) as {
    conversation_turns?: Array<Record<string, unknown>>;
  };

  // Integrity check BEFORE any write.
  const actual = computeChecksum({
    conversation_turns: payload.conversation_turns ?? [],
    memory_entries: [],
  });
  if (actual !== bundle.checksum) {
    throw new Error(
      `Checksum mismatch — archive is corrupted or tampered with (expected ${bundle.checksum}, got ${actual})`,
    );
  }

  const turns = payload.conversation_turns ?? [];
  if (opts.dryRun) {
    return { restored: turns.length, skipped: 0, dryRun: true };
  }

  let restored = 0;
  let skipped = 0;
  for (const t of turns) {
    try {
      await query(
        `INSERT INTO conversation_turns
           (id, session_id, turn_index, role, content, content_hash,
            sensitivity, archive_id, archived_at, created_at, user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,NULL,$8,$9)
         ON CONFLICT (id) DO UPDATE SET
           content = EXCLUDED.content,
           content_hash = EXCLUDED.content_hash,
           sensitivity = EXCLUDED.sensitivity,
           turn_index = EXCLUDED.turn_index,
           archive_id = NULL,
           archived_at = NULL`,
        [
          t.id, t.session_id, t.turn_index, t.role, t.content, t.content_hash,
          t.sensitivity ?? "normal", t.created_at, bundle.user_id,
        ],
      );
      restored++;
    } catch {
      skipped++;
    }
  }

  return { restored, skipped, dryRun: false };
}
