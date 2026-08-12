// MWT-5R — Approval Review Replay / Audit View v0: types.
//
// A deterministic review artifact that summarizes a signed approval, its signer
// verification, the evidence report it reviewed, and the evidence↔approval
// provenance binding. The artifact answers, in human-readable form:
//   - who approved (approver_id / signer_id)
//   - is the signature valid
//   - which evidence report (id + fingerprint) it reviewed
//   - does the report fingerprint match
//   - was the approval tampered
//   - does task/session line up
//   - is a legacy unsigned approval only a historical record (not trusted)
//   - the final, structured review conclusion
//
// No backend persistence, no external network, no enforcement. Dry-run / advisory.

/** Honest structured conclusion of an approval review (NOT a boolean). */
export type ApprovalReviewConclusion =
  | "approved_verified" // valid signed approval + matching evidence + verified
  | "approved_unverified" // approved decision but signature not cryptographically verified
  | "rejected_verified" // valid signed reject + matching evidence + verified
  | "rejected_unverified" // rejected decision but signature not cryptographically verified
  | "legacy_unsigned" // unsigned approval: historical record only, not cryptographically trusted
  | "mismatch" // task/session or evidence fingerprint does not line up
  | "unavailable"; // approval and/or report missing — cannot form a review

/** A deterministic approval review replay artifact. */
export interface ApprovalReviewReplay {
  /** Deterministic id derived from the stable inputs (no clock). */
  review_id: string;
  /** ISO-8601 timestamp anchor (taken from report.generated_at when present). */
  generated_at: string;
  task_id?: string;
  session_id?: string;
  /** The approval's declared binding reference (MWT-5 target_ref). */
  target_ref?: string;
  approval_id?: string;
  approver_id?: string;
  signer_id?: string;
  /** Honest verification status of the approval (reuses MWT-5+). */
  approval_verification_status: "verified" | "unverified" | "legacy_unsigned" | "unavailable";
  /** Approval decision, if present. */
  decision?: "approved" | "rejected" | "noted";
  evidence_report_id?: string;
  evidence_fingerprint?: string;
  /** Structured provenance binding status (reuses MWT-4F). */
  provenance_status: "linked" | "mismatch" | "unverified" | "unavailable";
  binding_fingerprint?: string;
  /** Structured conclusion — the headline verdict. */
  conclusion: ApprovalReviewConclusion;
  /** Stable-ordered warnings (no duplicates). */
  warnings: string[];
  /** Plain-language audit narrative. */
  human_summary: string;
}

/** Inputs to build an approval review replay. */
export interface ApprovalReviewInput {
  approval?: import("./signed-approval-types.js").UnsignedApprovalRecord
    | import("./signed-approval-types.js").SignedApprovalRecord;
  report?: import("../mwt4/task-evidence-types.js").TaskEvidenceReport;
  /** Optional pre-built provenance link (the persisted tamper anchor). When
   *  provided, the review verifies the supplied report+approval against this
   *  external link — enabling honest evidence-tamper detection even on a fresh
   *  build. When omitted, the link is built fresh from report+approval. */
  provenanceLink?: import("../mwt4/provenance-types.js").EvidenceApprovalProvenanceLink;
  publicKeyPem?: string;
}

/** Injectable options for deterministic review building. */
export interface ApprovalReviewOptions {
  /** Injectable hash for review_id (defaults to Node SHA-256 hex). */
  hashFn?: (input: string) => string;
}
