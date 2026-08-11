// MWT-5 — Advisory approval dry-run record (v0).
//
// Per MWT-5-decision-record.md (D1–D5, SIGNED):
//   D2 O1: append-only JSONL sidecar (approvals.jsonl); no SQLite migration; no new table
//   D3 O1: opaque `approver_id` string (NOT cryptographically bound to a person)
//   D4 O2+O3: sidecar record only; NO new TrstEventType (R10 standing schema-gate rule)
//   D5 O1: advisory only — recording an approval NEVER blocks any downstream action
//
// Trust boundary:
//   - This is a client-side advisory log. It is NOT a system-of-record attestation.
//   - Records are tamper-evident via a hash chain (prev_hash links each record to the
//     prior one), so post-hoc tampering of the sidecar file is detectable.
//   - No signature / PKI / MWT-4E identity integration.
//
// Determinism: a record's canonical body is stableStringify'd; its record_hash binds
// (canonical body + prev_hash). Verify replays the chain and confirms every hash.

// Local structural type to keep this module Node-importable in test scripts without
// pulling the full frontend api module (mirrors evidence-export.ts design).
export type ApprovalDecision = "approved" | "rejected" | "noted";

/**
 * MWT-4E v0 — signature envelope (ADDITIVE; optional).
 * Absent on legacy MWT-5 records (pre-4E). When present, the approval's
 * approver_id is cryptographically bound to a local identity (Ed25519).
 */
export interface ApprovalSignatureEnvelope {
  signer_id: string;
  public_key_fingerprint: string;
  algo: "Ed25519";
  signature: string; // base64url over canonical body
}

export interface ApprovalRecord {
  schema_version: string;
  seq: number;
  approver_id: string; // opaque; free string, not a verified identity
  target_ref: string; // e.g. task_id or export artifact reference
  decision: ApprovalDecision;
  note?: string;
  ts: string; // ISO-8601; pinned in tests for determinism
  prev_hash: string; // "" for the first record (genesis)
  record_hash: string;
  // ── MWT-4E (ADDITIVE, optional) ──
  signature?: ApprovalSignatureEnvelope;
}

export const APPROVAL_SCHEMA_VERSION = "mwt5.approval.v0";
export const GENESIS_PREV_HASH = "";

// Privacy guard: approval records must never carry raw content or secrets.
const FORBIDDEN_KEYS = new Set(["raw_prompt", "raw_output", "api_key", "provider_raw_payload"]);

/** Canonical stable JSON: sorted object keys, stable array order. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${parts.join(",")}}`;
}

async function sha256Hex(input: string): Promise<string> {
  // Web Crypto (global in browsers and Node 18+). No node:crypto import — keeps this
  // module identical for browser and Node test scripts (mirrors evidence-export.ts).
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Canonical body used for hashing — excludes record_hash itself. */
export function canonicalBody(r: Omit<ApprovalRecord, "record_hash">): string {
  return stableStringify({
    schema_version: r.schema_version,
    seq: r.seq,
    approver_id: r.approver_id,
    target_ref: r.target_ref,
    decision: r.decision,
    note: r.note ?? null,
    ts: r.ts,
    prev_hash: r.prev_hash,
  });
}

export interface AppendInput {
  approver_id: string;
  target_ref: string;
  decision: ApprovalDecision;
  note?: string;
  ts: string; // caller-supplied; tests pin it for determinism
  prev_hash: string; // hash of the current last record, or GENESIS_PREV_HASH
  seq: number; // next sequence number (1-based)
}

/**
 * Synchronous core: builds the record (with record_hash) WITHOUT async crypto.
 * Used by Node test scripts for fully deterministic, crypto-free assertions.
 * The hash is computed by the caller-supplied `hashFn` (injected for testability),
 * or via the real sha256 when running in a crypto-capable environment.
 */
export function buildApprovalRecordSync(
  input: AppendInput,
  hashFn: (body: string) => string,
): ApprovalRecord {
  const body = canonicalBody({
    schema_version: APPROVAL_SCHEMA_VERSION,
    seq: input.seq,
    approver_id: input.approver_id,
    target_ref: input.target_ref,
    decision: input.decision,
    note: input.note,
    ts: input.ts,
    prev_hash: input.prev_hash,
  });
  return {
    schema_version: APPROVAL_SCHEMA_VERSION,
    seq: input.seq,
    approver_id: input.approver_id,
    target_ref: input.target_ref,
    decision: input.decision,
    ...(input.note !== undefined ? { note: input.note } : {}),
    ts: input.ts,
    prev_hash: input.prev_hash,
    record_hash: hashFn(body),
  };
}

async function nodeSha256(body: string): Promise<string> {
  return sha256Hex(body);
}

/**
 * Async builder that awaits the Web Crypto digest — the real runtime path used by the
 * browser / frontend advisory approval action.
 */
export async function buildApprovalRecordAsync(input: AppendInput): Promise<ApprovalRecord> {
  const body = canonicalBody({
    schema_version: APPROVAL_SCHEMA_VERSION,
    seq: input.seq,
    approver_id: input.approver_id,
    target_ref: input.target_ref,
    decision: input.decision,
    note: input.note,
    ts: input.ts,
    prev_hash: input.prev_hash,
  });
  const record_hash = await nodeSha256(body);
  return {
    schema_version: APPROVAL_SCHEMA_VERSION,
    seq: input.seq,
    approver_id: input.approver_id,
    target_ref: input.target_ref,
    decision: input.decision,
    ...(input.note !== undefined ? { note: input.note } : {}),
    ts: input.ts,
    prev_hash: input.prev_hash,
    record_hash,
  };
}

/**
 * Verify the integrity of an entire approval chain.
 * Async: replays the chain and confirms every record_hash (recomputed via Web Crypto)
 * matches and every prev_hash links to the prior record.
 * Returns { ok, brokenAt } — ok=false with the first offending seq on mismatch.
 */
export async function verifyApprovalChain(records: ApprovalRecord[]): Promise<{
  ok: boolean;
  brokenAt: number | null;
}> {
  let expectedPrev = GENESIS_PREV_HASH;
  for (const r of records) {
    if (r.prev_hash !== expectedPrev) {
      return { ok: false, brokenAt: r.seq };
    }
    const body = canonicalBody({
      schema_version: r.schema_version,
      seq: r.seq,
      approver_id: r.approver_id,
      target_ref: r.target_ref,
      decision: r.decision,
      note: r.note,
      ts: r.ts,
      prev_hash: r.prev_hash,
    });
    if ((await nodeSha256(body)) !== r.record_hash) {
      return { ok: false, brokenAt: r.seq };
    }
    expectedPrev = r.record_hash;
  }
  return { ok: true, brokenAt: null };
}

/** Sync chain verification — used by Node test scripts with an injected hash fn. */
export function verifyApprovalChainSync(
  records: ApprovalRecord[],
  hashFn: (body: string) => string,
): { ok: boolean; brokenAt: number | null } {
  let expectedPrev = GENESIS_PREV_HASH;
  for (const r of records) {
    if (r.prev_hash !== expectedPrev) {
      return { ok: false, brokenAt: r.seq };
    }
    const body = canonicalBody({
      schema_version: r.schema_version,
      seq: r.seq,
      approver_id: r.approver_id,
      target_ref: r.target_ref,
      decision: r.decision,
      note: r.note,
      ts: r.ts,
      prev_hash: r.prev_hash,
    });
    if (hashFn(body) !== r.record_hash) {
      return { ok: false, brokenAt: r.seq };
    }
    expectedPrev = r.record_hash;
  }
  return { ok: true, brokenAt: null };
}

/** Serialize a record to a single JSONL line (no raw content, no secrets). */
export function toJsonlLine(r: ApprovalRecord): string {
  // Defensive: strip any forbidden key if a caller accidentally attached one.
  const safe: Record<string, unknown> = { ...r };
  for (const k of Object.keys(safe)) {
    if (FORBIDDEN_KEYS.has(k)) delete safe[k];
  }
  return stableStringify(safe);
}

/** Parse a JSONL sidecar into records (tolerant of blank lines). */
export function parseJsonl(text: string): ApprovalRecord[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as ApprovalRecord);
}

// ── MWT-4E — Signature verification hook (ADDITIVE) ──────────────────────────

/**
 * Verification result for a single approval record's signature envelope.
 * - "unsigned": legacy MWT-5 record, no envelope. Readable, NOT an error.
 * - "verified": envelope present and signature matches the canonical body.
 * - "invalid": envelope present but signature mismatch / tamper detected.
 */
export type ApprovalSignatureStatus = "unsigned" | "verified" | "invalid";

export interface ApprovalSignatureCheck {
  seq: number;
  status: ApprovalSignatureStatus;
  signer_id: string | null;
}

/**
 * Verify a single record's signature envelope against a canonical body.
 *
 * The canonical body for signing/recovery MUST match ApprovalRecord hashing
 * (canonicalBody above) so a signature binds the exact same bytes that the
 * record_hash binds. We recompute that body here for self-containment.
 *
 * Async: uses an injected verifyFn (real Web Crypto Ed25519 by default) so the
 * same path works in Node test scripts with a deterministic stub.
 */
export async function checkApprovalSignature(
  record: ApprovalRecord,
  publicKeyPem: string | null,
  verifyFn: (
    pubKey: CryptoKey,
    sig: Uint8Array,
    data: Uint8Array,
  ) => Promise<boolean> = defaultVerifyFn,
): Promise<ApprovalSignatureCheck> {
  if (!record.signature) {
    return { seq: record.seq, status: "unsigned", signer_id: null };
  }
  if (!publicKeyPem) {
    // Envelope present but no local public key to verify against → cannot confirm.
    return { seq: record.seq, status: "invalid", signer_id: record.signature.signer_id };
  }
  try {
    const pubKey = await importSpki(publicKeyPem);
    const body = canonicalBody({
      schema_version: record.schema_version,
      seq: record.seq,
      approver_id: record.approver_id,
      target_ref: record.target_ref,
      decision: record.decision,
      note: record.note,
      ts: record.ts,
      prev_hash: record.prev_hash,
    });
    const ok = await verifyFn(
      pubKey,
      b64urlToBytes(record.signature.signature),
      new TextEncoder().encode(body),
    );
    return {
      seq: record.seq,
      status: ok ? "verified" : "invalid",
      signer_id: ok ? record.signature.signer_id : null,
    };
  } catch {
    return { seq: record.seq, status: "invalid", signer_id: record.signature.signer_id };
  }
}

// Local Web Crypto helpers (mirror local-identity.ts; kept inline so this module
// stays self-contained for browser + Node test scripts without cross-imports).
function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importSpki(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    b64urlToBytes(pem) as BufferSource,
    { name: "Ed25519" },
    false,
    ["verify"],
  );
}

async function defaultVerifyFn(
  pubKey: CryptoKey,
  sig: Uint8Array,
  data: Uint8Array,
): Promise<boolean> {
  return crypto.subtle.verify("Ed25519", pubKey, sig as BufferSource, data as BufferSource);
}
