/**
 * Sovereign data backup / restore (PLAN-P0 Task 2).
 *
 * WHY THIS IS P0
 * --------------
 * We just made "data sovereignty" the core product promise. Data that lives
 * only on one disk, with no way to snapshot or restore it, is not sovereign —
 * it is one hardware failure away from gone. Backup is the precondition of
 * sovereignty, not an optional extra.
 *
 * SCOPE
 * -----
 * Exports the sovereign data set: `conversation_turns` (L1 raw intent, now
 * including assistant replies) and `memory_entries` (distilled knowledge).
 *
 * DESIGN
 * ------
 * - Self-describing JSON with a schema version → future-proof imports.
 * - SHA-256 checksum over canonical JSON → tamper/corruption detection.
 * - Optional encryption: scrypt KDF + AES-256-GCM. Used for archived bundles
 *   (Phase 2); everyday backups may stay plaintext for convenience.
 * - Restore is UPSERT by primary key → re-importing is idempotent.
 * - `dryRun` reports what would happen without writing anything.
 * - `embedding` is EXCLUDED from snapshots: it is derived data that the write
 *   path regenerates asynchronously, and including it would drag a large
 *   vector column through JSON serialisation.
 *
 * HONEST LIMITATION
 * -----------------
 * A lost passphrase means an encrypted snapshot is unrecoverable. That is by
 * design (no back door) and mirrors the archive-bundle policy in RFC-001.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { query } from "../../db/connection.js";

export const SNAPSHOT_SCHEMA = "trustos-sovereign-snapshot/v1";

const KDF_PARAMS = { N: 16384, r: 8, p: 1, keylen: 32 } as const;

export interface SnapshotCounts {
  conversation_turns: number;
  memory_entries: number;
}

export interface Snapshot {
  schema: string;
  created_at: string;
  user_id: string;
  counts: SnapshotCounts;
  /** SHA-256 over canonical JSON of `data` (computed before encryption). */
  checksum: string;
  encrypted: boolean;
  /** Plain object when unencrypted; base64 payload string when encrypted. */
  data: unknown;
}

export interface RestoreResult {
  restored: SnapshotCounts;
  skipped: number;
  dryRun: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Stable key ordering so the checksum is reproducible. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonicalize(v)]),
    );
  }
  return value;
}

/**
 * SHA-256 over canonical JSON.
 *
 * Normalises through a JSON round-trip FIRST. Without this, a Date (which pg
 * returns for timestamp columns) is seen by `canonicalize` as a plain object
 * whose entries are empty → it hashes as {} — while the same data read back
 * from disk is an ISO string. The two shapes hash differently, so an exported
 * snapshot could never be restored.
 *
 * Doing it here (rather than requiring callers to pre-normalise) means every
 * caller gets consistent behaviour and nobody can forget.
 */
export function computeChecksum(data: unknown): string {
  const jsonSafe = JSON.parse(JSON.stringify(data));
  return createHash("sha256").update(JSON.stringify(canonicalize(jsonSafe))).digest("hex");
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KDF_PARAMS.keylen, {
    N: KDF_PARAMS.N,
    r: KDF_PARAMS.r,
    p: KDF_PARAMS.p,
  });
}

// ── Export ──────────────────────────────────────────────────────────────────

export async function createSnapshot(
  userId: string,
  opts?: { passphrase?: string },
): Promise<Snapshot> {
  const turns = await query(
    `SELECT id, session_id, turn_index, role, content, content_hash,
            sensitivity, archive_id, archived_at, created_at
       FROM conversation_turns WHERE user_id=$1
      ORDER BY session_id, turn_index`,
    [userId],
  );
  const memories = await query(
    `SELECT id, user_id, category, content, importance, tags, source,
            relevance_score, created_at, updated_at
       FROM memory_entries WHERE user_id=$1
      ORDER BY created_at`,
    [userId],
  );

  // Normalise through a JSON round-trip BEFORE checksumming.
  //
  // Why: the pg driver returns `created_at` / `archived_at` as Date objects.
  // `canonicalize` treats a Date as a plain object (Object.entries(Date) is
  // empty), so it would serialise to {} — while the file on disk (and thus
  // the data seen at restore time) holds an ISO string. Checksums computed
  // over those two shapes differ, so every plaintext restore failed with
  // "Checksum mismatch" across processes (the in-process test missed this
  // because it never round-tripped through JSON).
  //
  // Fix: checksum what is ACTUALLY written, not the in-memory shape.
  const data = JSON.parse(
    JSON.stringify({ conversation_turns: turns.rows, memory_entries: memories.rows }),
  );

  const base: Omit<Snapshot, "data" | "encrypted"> & { encrypted: boolean } = {
    schema: SNAPSHOT_SCHEMA,
    created_at: new Date().toISOString(),
    user_id: userId,
    counts: {
      conversation_turns: turns.rows.length,
      memory_entries: memories.rows.length,
    },
    checksum: computeChecksum(data),
    encrypted: false,
  };

  if (!opts?.passphrase) {
    return { ...base, data };
  }

  // Encrypted form: salt + iv + tag + ciphertext, all base64 in one string.
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(opts.passphrase, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = JSON.stringify(data);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload = Buffer.concat([salt, iv, tag, enc]).toString("base64");
  return { ...base, encrypted: true, data: payload };
}

// ── Import ──────────────────────────────────────────────────────────────────

function decryptPayload(payload: string, passphrase: string): unknown {
  const buf = Buffer.from(payload, "base64");
  if (buf.length < 16 + 12 + 16) {
    throw new Error("encrypted payload is truncated or malformed");
  }
  const salt = buf.subarray(0, 16);
  const iv = buf.subarray(16, 28);
  const tag = buf.subarray(28, 44);
  const enc = buf.subarray(44);

  const key = deriveKey(passphrase, salt);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return JSON.parse(dec.toString("utf8"));
}

export async function restoreSnapshot(
  snapshot: Snapshot,
  opts?: { passphrase?: string; dryRun?: boolean },
): Promise<RestoreResult> {
  if (!snapshot || snapshot.schema !== SNAPSHOT_SCHEMA) {
    throw new Error(
      `Unsupported snapshot schema: ${snapshot?.schema ?? "unknown"} (expected ${SNAPSHOT_SCHEMA})`,
    );
  }

  let data: { conversation_turns?: unknown[]; memory_entries?: unknown[] };
  if (snapshot.encrypted) {
    if (!opts?.passphrase) {
      throw new Error("Snapshot is encrypted — a passphrase is required");
    }
    data = decryptPayload(String(snapshot.data), opts.passphrase) as typeof data;
  } else {
    data = snapshot.data as typeof data;
  }

  // Integrity check BEFORE any write.
  const actual = computeChecksum(data);
  if (actual !== snapshot.checksum) {
    throw new Error(
      `Checksum mismatch — snapshot is corrupted or tampered with (expected ${snapshot.checksum}, got ${actual})`,
    );
  }

  const turns = data.conversation_turns ?? [];
  const memories = data.memory_entries ?? [];
  const dryRun = Boolean(opts?.dryRun);

  if (dryRun) {
    return {
      restored: { conversation_turns: turns.length, memory_entries: memories.length },
      skipped: 0,
      dryRun: true,
    };
  }

  let skipped = 0;
  let turnCount = 0;

  for (const t of turns as Array<Record<string, unknown>>) {
    try {
      await query(
        `INSERT INTO conversation_turns
           (id, session_id, turn_index, role, content, content_hash,
            sensitivity, archive_id, archived_at, created_at, user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (id) DO UPDATE SET
           content = EXCLUDED.content,
           content_hash = EXCLUDED.content_hash,
           sensitivity = EXCLUDED.sensitivity,
           turn_index = EXCLUDED.turn_index`,
        [
          t.id, t.session_id, t.turn_index, t.role, t.content, t.content_hash,
          t.sensitivity ?? "normal", t.archive_id ?? null, t.archived_at ?? null,
          t.created_at, snapshot.user_id,
        ],
      );
      turnCount++;
    } catch {
      skipped++;
    }
  }

  let memoryCount = 0;
  for (const m of memories as Array<Record<string, unknown>>) {
    try {
      await query(
        `INSERT INTO memory_entries
           (id, user_id, category, content, importance, tags, source,
            relevance_score, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO UPDATE SET
           content = EXCLUDED.content,
           importance = EXCLUDED.importance,
           tags = EXCLUDED.tags`,
        [
          m.id, m.user_id ?? snapshot.user_id, m.category, m.content,
          m.importance ?? 3, m.tags ?? [], m.source ?? "manual",
          m.relevance_score ?? null, m.created_at, m.updated_at,
        ],
      );
      memoryCount++;
    } catch {
      skipped++;
    }
  }

  return {
    restored: { conversation_turns: turnCount, memory_entries: memoryCount },
    skipped,
    dryRun: false,
  };
}
