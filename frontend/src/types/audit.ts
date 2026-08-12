// MWT-5R-UI — Frontend mirror of the backend ApprovalReviewReplay artifact.
//
// Deliberately a local copy (no cross-import into backend src/services) to keep
// the Next.js build rootDir clean. Field names match
// src/services/mwt5/approval-review-types.ts exactly so artifacts serialize 1:1.

export type ApprovalReviewConclusion =
  | "approved_verified"
  | "approved_unverified"
  | "rejected_verified"
  | "rejected_unverified"
  | "legacy_unsigned"
  | "mismatch"
  | "unavailable";

export type ApprovalReviewVerificationStatus =
  | "verified"
  | "unverified"
  | "legacy_unsigned"
  | "unavailable";

export type ApprovalReviewProvenanceStatus = "linked" | "mismatch" | "unverified" | "unavailable";

export type ApprovalReviewDecision = "approved" | "rejected" | "noted";

export interface ApprovalReviewReplay {
  review_id: string;
  generated_at: string;
  task_id?: string;
  session_id?: string;
  target_ref?: string;
  approval_id?: string;
  approver_id?: string;
  signer_id?: string;
  approval_verification_status: ApprovalReviewVerificationStatus;
  decision?: ApprovalReviewDecision;
  evidence_report_id?: string;
  evidence_fingerprint?: string;
  provenance_status: ApprovalReviewProvenanceStatus;
  binding_fingerprint?: string;
  conclusion: ApprovalReviewConclusion;
  warnings: string[];
  human_summary: string;
}
