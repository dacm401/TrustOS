// MWT-4F — Evidence ↔ Approval Provenance Binding v0: types.
//
// Explicit provenance link between a Task Evidence Report and a Signed Approval
// record (MWT-5+). Turns the implicit "we ran the report with this approval" into
// a deterministic, tamper-evident binding that answers:
//   - which approval reviewed which task/session?
//   - which evidence report (by id + fingerprint)?
//   - was the approval signature bound to the evidence fingerprint?
//   - has either the report or the approval been altered since binding?
//
// No backend persistence, no external network, no enforcement. Dry-run / advisory.

/** Honest signature status of the bound approval (mirrors MWT-5+ / MWT-4E). */
export type ApprovalSignatureStatus =
  | "verified"
  | "unverified"
  | "legacy_unsigned"
  | "unavailable";

/** Structured result of verifying a provenance binding (NOT a boolean). */
export type ProvenanceStatus =
  | "linked" // report + approval consistent, approval cryptographically verified
  | "mismatch" // task/session or evidence fingerprint does not line up
  | "unverified" // approval signature not verified (tampered / missing key / legacy-unsigned)
  | "unavailable"; // report or approval missing

/** An explicit provenance link between an evidence report and a signed approval. */
export interface EvidenceApprovalProvenanceLink {
  link_id: string;
  /** Task the approval + report both bind to. */
  task_id?: string;
  /** Optional session context. */
  session_id?: string;
  /** The evidence report this approval reviewed. */
  evidence_report_id: string;
  /** SHA-256 fingerprint of the bound evidence report body. */
  evidence_fingerprint: string;
  /** Stable id of the approval record (derived from canonical body if not supplied). */
  approval_id: string;
  /** Who approved. */
  approver_id: string;
  /** Honest signature status of the approval at binding time. */
  approval_signature_status: ApprovalSignatureStatus;
  /** Deterministic timestamp anchor (taken from report.generated_at — no clock). */
  linked_at: string;
  /** Deterministic SHA-256 over the bound fields (changes if any bound field changes). */
  binding_fingerprint: string;
  warnings: string[];
}

/** Result of verifying a binding against a current report + approval. */
export interface ProvenanceVerificationResult {
  status: ProvenanceStatus;
  binding_fingerprint?: string;
  reasons: string[];
  warnings: string[];
}
