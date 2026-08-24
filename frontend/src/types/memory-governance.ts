// MWT-6-UI — Frontend type surface for Memory Governance.
//
// The MWT-6 core types are inlined here (instead of imported from
// `../../../src/services/mwt6/...`) to keep the client bundle inside the
// frontend rootDir. The UI shares the SAME type definitions as the governance
// evaluator; it only renders records produced by the backend builder and never
// re-implements governance logic client-side.
//
// IMPORTANT (MWT-7B): node:crypto must stay OUT of the client bundle. The
// backend owns evaluation; the frontend only renders typed records.

/** Where the memory belongs. Must be explicit; unknown is not defaulted to safe. */
export type MemoryScope =
  | "user"
  | "session"
  | "task"
  | "project"
  | "system"
  | (string & {});

/** How the memory was produced. Legacy / imported must be honestly marked. */
export type MemorySource =
  | "user_input"
  | "assistant_output"
  | "task_result"
  | "evidence_report"
  | "approval_review"
  | "system_policy"
  | "imported_legacy"
  | (string & {});

/**
 * Retention policy. revoked / expired are NOT active memory.
 * `expires_at` / `revoked_at` timestamps can also drive derived status.
 */
export type MemoryRetention =
  | "ephemeral"
  | "session"
  | "project"
  | "long_term"
  | "revoked"
  | "expired"
  | (string & {});

/** Sensitivity classification. unknown is NOT treated as public. */
export type MemorySensitivity =
  | "public"
  | "internal"
  | "sensitive"
  | "restricted"
  | "unknown"
  | (string & {});

/** Structured governance status — never a bare boolean. */
export type MemoryGovernanceStatus =
  | "active" // valid, current, usable
  | "limited" // usable but restricted (sensitive/restricted/unknown sensitivity)
  | "expired" // retention expired or expires_at < now
  | "revoked" // explicitly revoked
  | "unverified" // legacy / unverifiable source
  | "legacy" // imported legacy record
  | "invalid"; // missing required metadata (e.g. scope)

export interface TrustSpineRefs {
  evidence_report_id?: string | null;
  evidence_fingerprint?: string | null;
  approval_id?: string | null;
  binding_fingerprint?: string | null;
  review_id?: string | null;
}

export interface MemoryGovernanceInput {
  memory_id: string;
  /** Stable content digest (hash) or content ref. Not the raw content. */
  content_digest: string;
  scope: MemoryScope;
  source: MemorySource;
  created_at: string; // ISO-8601
  created_by?: string | null;
  retention: MemoryRetention;
  sensitivity: MemorySensitivity;
  /** ISO timestamp; if present and < now → expired. */
  expires_at?: string | null;
  /** ISO timestamp; if present → revoked. */
  revoked_at?: string | null;
  provenance_refs?: string[];
  evidence_refs?: string[];
  approval_refs?: string[];
  review_refs?: string[];
  /** Structured Trust Spine linkage (evidence/approval/review). */
  trust_refs?: TrustSpineRefs;
  /** Optional human note for the record. */
  note?: string | null;
}

export interface MemoryGovernanceRecord {
  memory_id: string;
  content_digest: string;
  scope: MemoryScope;
  source: MemorySource;
  created_at: string;
  created_by: string | null;
  retention: MemoryRetention;
  sensitivity: MemorySensitivity;
  expires_at: string | null;
  revoked_at: string | null;
  provenance_refs: string[];
  evidence_refs: string[];
  approval_refs: string[];
  review_refs: string[];
  trust_refs: TrustSpineRefs;
  note: string | null;
  status: MemoryGovernanceStatus;
  warnings: string[];
  /** Deterministic SHA-256 over the canonical governance body (stable field order). */
  governance_fingerprint: string;
  evaluated_at: string;
}

export interface MemoryGovernanceOptions {
  /** Injectable clock (defaults to Date.now()). Must be injected for determinism. */
  now?: () => number;
  /** Injectable SHA-256 hex hash (defaults to Node crypto). */
  hashFn?: (input: string) => string;
}

// Frontend-safe crypto-free builder (inlined copy of src/services/mwt6/
// memory-governance-core.ts). Re-exported here so existing fixtures/UI that
// import the builder from this types module keep working without crossing the
// backend rootDir. Use a RELATIVE path (not "@/...") so tsx/runtime resolution
// works outside Next's bundler alias.
export {
  buildMemoryGovernanceRecord,
  evaluateMemoryGovernance,
  stableStringify,
  simpleHash,
} from "../lib/memory-governance-core";
