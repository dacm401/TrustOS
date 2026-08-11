// MWT-4 Mainline — Task Evidence Report v0: types.
//
// Deterministic, additive report surface. This module only declares the shapes
// consumed/produced by the report builder (task-evidence-report.ts). It reuses
// MWT-4E's ApprovalRecord/ApprovalSignatureEnvelope via approval-record.ts.
//
// Trust boundary (same as MWT-4E):
//   - Local, deterministic, dependency-free report generation.
//   - No backend persistence; no external network; no schema/migration.
//   - Identity verification is HONEST: unsigned/legacy data is never marked verified.

/** How confidently we can attribute an actor/approver identity. */
export type IdentityVerificationStatus =
  | "verified" // cryptographically signed + signature checked OK
  | "unverified" // signature present but verification failed (tampered/wrong key)
  | "legacy_unsigned" // approval record exists but carries no signature envelope
  | "unavailable"; // no identity material provided at all

/** Approval disposition for this task, if any. */
export type ApprovalStatus =
  | "approved"
  | "rejected"
  | "noted"
  | "not_required" // task needs no approval (no approval record)
  | "unavailable"; // approval status could not be determined

/** A reference to a piece of evidence backing the task (event / tool call / artifact). */
export interface EvidenceItemRef {
  kind: string; // "event" | "tool_call" | "artifact" | ...
  ref_id: string; // event_id / hash / artifact path
  summary?: string;
  integrity?: string; // hash if available
}

/** Identity reference with honest verification status. */
export interface IdentityRef {
  id?: string;
  fingerprint?: string; // public_key_fingerprint when a signed identity exists
  verification: IdentityVerificationStatus;
  detail?: string;
}

/** Routing / delegation metadata captured from the manager route layer. */
export interface RoutingDelegationMeta {
  route_type: "direct" | "delegated" | "ask_clarification" | string;
  delegated_to?: string; // agent id when delegated
  manager_decision?: string;
  clarification?: {
    question: string;
    requires_input: boolean;
  };
}

/**
 * Minimal structural view of an MWT-5 approval record consumed by the report
 * builder. Declared locally (not imported from frontend) so the backend module
 * stays self-contained under its rootDir. The canonical body mirrors
 * approval-record.ts's canonicalBody for signature compatibility.
 */
export interface ApprovalSignatureLike {
  signer_id: string;
  public_key_fingerprint: string;
  algo: "Ed25519";
  signature: string; // base64url over the record canonical body
}

/**
 * Structural view of an MWT-5 approval record consumed by the report builder.
 * Mirrors approval-record.ts's ApprovalRecord canonical shape so the local
 * approvalCanonicalBody() reproduces the exact body that MWT-4E signed.
 */
export interface ApprovalRecordLike {
  schema_version?: string;
  approver_id: string;
  target_ref?: string;
  decision: "approved" | "rejected" | "noted";
  note?: string;
  evidence_refs?: unknown[];
  ts?: string;
  prev_hash?: string;
  seq?: number;
  record_hash?: string;
  signature?: ApprovalSignatureLike;
}

/** Input to buildTaskEvidenceReport. All identity/approval/routing fields optional. */
export interface BuildTaskEvidenceInput {
  report_id: string;
  task_id?: string;
  session_id?: string;
  generated_at: string; // ISO-8601
  subject: string;
  inputs?: string[];
  outputs?: string[];
  /** Actor / requester identity, if known (may carry fingerprint for a signed actor). */
  requester?: IdentityRef;
  /** MWT-5 approval record, optionally carrying an MWT-4E signature envelope. */
  approval?: ApprovalRecordLike;
  /** Public key (spki base64url) of the approver, needed to cryptographically verify the signature. */
  approver_public_key_pem?: string;
  routing?: RoutingDelegationMeta;
  evidence?: EvidenceItemRef[];
  warnings?: string[];
}

/** The produced deterministic task evidence report. */
export interface TaskEvidenceReport {
  report_id: string;
  task_id?: string;
  session_id?: string;
  generated_at: string;
  subject: string;
  actor: IdentityRef;
  approver: IdentityRef;
  approval_status: ApprovalStatus;
  input_summary: string[];
  output_summary: string[];
  routing?: RoutingDelegationMeta;
  evidence_items: EvidenceItemRef[];
  integrity: {
    fingerprint: string; // SHA-256 over the canonical report body
    algo: "SHA-256";
  };
  warnings: string[];
  human_readable_summary: string;
}
