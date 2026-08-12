// MWT-5R-UI — Deterministic fixtures for the Approval Review Panel.
//
// These mirror the backend ApprovalReviewReplay shape (see @/types/audit).
// They are static, hand-built artifacts (no backend build step) so the UI
// smoke/regression scripts and manual review exercise every honest status
// tone WITHOUT needing the Trust Spine signing pipeline at render time.
//
// Coverage:
//   - approved_verified  : clean signed approval + matching evidence
//   - mismatch           : task/session or fingerprint divergence (danger)
//   - legacy_unsigned    : unsigned historical approval (warning)
//   - unavailable        : missing approval/report (neutral)

import type { ApprovalReviewReplay } from "@/types/audit";

export const approvedVerified: ApprovalReviewReplay = {
  review_id: "rv_approved_verified_01",
  generated_at: "2026-08-12T00:00:00.000Z",
  task_id: "task-1001",
  session_id: "sess-7f3a",
  target_ref: "task-1001",
  approval_id: "apr_9c21",
  approver_id: "mgr.alice@trustos.local",
  signer_id: "mgr.alice@trustos.local",
  approval_verification_status: "verified",
  decision: "approved",
  evidence_report_id: "rpt_4b8e",
  evidence_fingerprint: "sha256:9f2c1a7b3e5d8840aa11bb22cc33dd44ee55ff66aa77bb88cc99dd00ee11ff22",
  provenance_status: "linked",
  binding_fingerprint: "sha256:11aa22bb33cc44dd55ee66ff77aa88bb99cc00dd11ee22ff33aa44bb55cc66dd",
  conclusion: "approved_verified",
  warnings: [],
  human_summary:
    "Signed approval by mgr.alice@trustos.local for task-1001. Signature verified " +
    "against the approver's public key. Evidence report rpt_4b8e fingerprint matches " +
    "the provenance binding. No divergence detected.",
};

export const mismatch: ApprovalReviewReplay = {
  review_id: "rv_mismatch_01",
  generated_at: "2026-08-12T00:00:00.000Z",
  task_id: "task-1002",
  session_id: "sess-2b9c",
  target_ref: "task-9999",
  approval_id: "apr_3d70",
  approver_id: "mgr.bob@trustos.local",
  signer_id: "mgr.bob@trustos.local",
  approval_verification_status: "verified",
  decision: "approved",
  evidence_report_id: "rpt_1a6c",
  evidence_fingerprint: "sha256:aa11bb22cc33dd44ee55ff66aa77bb88cc99dd00ee11ff22aa33bb44cc55dd66",
  provenance_status: "mismatch",
  binding_fingerprint: "sha256:44dd55ee66ff77aa88bb99cc00dd11ee22ff33aa44bb55cc66dd77ee88ff99aa",
  conclusion: "mismatch",
  warnings: [
    "Approval target_ref (task-9999) does not match reviewed task_id (task-1002).",
    "Evidence fingerprint does not match the persisted provenance binding.",
  ],
  human_summary:
    "Signed approval by mgr.bob@trustos.local is cryptographically verified, but the " +
    "approval's declared target (task-9999) diverges from the evidence report's task " +
    "(task-1002). The evidence fingerprint also fails to match the provenance binding. " +
    "Treated as a MISMATCH — do not trust this approval against this evidence.",
};

export const legacyUnsigned: ApprovalReviewReplay = {
  review_id: "rv_legacy_unsigned_01",
  generated_at: "2026-08-12T00:00:00.000Z",
  task_id: "task-1003",
  target_ref: "task-1003",
  approval_id: "apr_legacy_0",
  approver_id: "mgr.carol@trustos.local",
  approval_verification_status: "legacy_unsigned",
  decision: "approved",
  provenance_status: "unavailable",
  conclusion: "legacy_unsigned",
  warnings: [
    "Unsigned historical approval record. No cryptographic signature to verify — treat as a historical note only, not a trusted attestation.",
  ],
  human_summary:
    "Approval record for task-1003 is an unsigned legacy entry by mgr.carol@trustos.local. " +
    "No public-key signature is present, so Trust Spine cannot cryptographically verify it. " +
    "Shown as a historical record only; it must not be relied upon as a verified attestation.",
};

export const unavailable: ApprovalReviewReplay = {
  review_id: "rv_unavailable_01",
  generated_at: "2026-08-12T00:00:00.000Z",
  approval_verification_status: "unavailable",
  provenance_status: "unavailable",
  conclusion: "unavailable",
  warnings: [
    "Neither a signed approval nor an evidence report was supplied. A review cannot be formed.",
  ],
  human_summary:
    "No approval record and no evidence report were available for this task. " +
    "Trust Spine cannot form a review. This is reported honestly rather than assumed safe.",
};

export const allFixtures: ApprovalReviewReplay[] = [
  approvedVerified,
  mismatch,
  legacyUnsigned,
  unavailable,
];

export const fixtureByName: Record<string, ApprovalReviewReplay> = {
  approved_verified: approvedVerified,
  mismatch,
  legacy_unsigned: legacyUnsigned,
  unavailable,
};
