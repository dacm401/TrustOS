// MWT-5+ — Signed Approval Dry-run v0 types.
//
// Optional local-signature envelope for MWT-5 advisory approval records.
// This makes an approval record "signed, verifiable, reportable" without
// introducing enforcement, backend persistence, or external network.
//
// The shape mirrors MWT-4E's signed-approval input ({ record, signature })
// so the canonical body is byte-compatible with approval-record.canonicalBody
// (frontend) and MWT-4 Mainline's approvalCanonicalBody (backend). Backend
// module is self-contained (no frontend cross-import — rootDir constraint).
//
// Status vocabulary matches MWT-4 Mainline / MWT-4E:
//   verified | unverified | legacy_unsigned | unavailable

export type ApprovalDecision = "approved" | "rejected" | "noted";

/** Unsigned advisory approval record (MWT-5 baseline; legacy-compatible). */
export interface UnsignedApprovalRecord {
  schema_version?: string;
  approver_id: string;
  /** task_id or session_id reference the approval binds to. */
  target_ref?: string;
  decision: ApprovalDecision;
  note?: string;
  evidence_refs?: unknown[];
  created_at?: string;
}

/** Local-signature envelope (MWT-4E compatible). */
export interface ApprovalSignatureEnvelope {
  algorithm: "Ed25519";
  signer_id: string;
  /** SPKI public key PEM used to verify. */
  public_key: string;
  /** hex-encoded signature over the canonical body. */
  signature: string;
  signed_at: string;
  /** Identifies the canonical body contract this signature was produced under. */
  canonical_body_version: string;
}

/** A signed approval record = advisory record + optional signature envelope. */
export interface SignedApprovalRecord extends UnsignedApprovalRecord {
  signature?: ApprovalSignatureEnvelope;
}

/** Result of verifying a signed approval (NOT a boolean — honest structured status). */
export interface ApprovalVerificationResult {
  status: "verified" | "unverified" | "legacy_unsigned" | "unavailable";
  algorithm?: "Ed25519";
  signer_id?: string;
  approver_id?: string;
  /** True when signer_id === approver_id; false/undefined otherwise. */
  signer_matches_approver?: boolean;
  reason?: string;
  warnings: string[];
}

/** MWT-4E / MWT-4 Mainline compatible verification status. */
export type IdentityVerificationStatus =
  | "verified"
  | "unverified"
  | "legacy_unsigned"
  | "unavailable";
