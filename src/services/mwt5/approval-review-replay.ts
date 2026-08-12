// MWT-5R — Approval Review Replay / Audit View v0: builder.
//
// Deterministic, pure-function replay artifact that re-derives a review from:
//   - the approval record (MWT-5+ signed/unsigned)
//   - the evidence report (MWT-4 mainline)
//   - the evidence↔approval provenance binding (MWT-4F)
//
// Reuses MWT-5+ verifySignedApproval() and MWT-4F
// buildEvidenceApprovalProvenanceLink()/verifyEvidenceApprovalBinding() as the
// single source of truth for signature and provenance judgment. No second
// signature/provenance logic is duplicated here.

import crypto from "node:crypto";
import { verifySignedApproval, signedApprovalCanonicalBody } from "./signed-approval.js";
import type {
  SignedApprovalRecord,
  UnsignedApprovalRecord,
  ApprovalVerificationResult,
} from "./signed-approval-types.js";
import {
  buildEvidenceApprovalProvenanceLink,
  verifyEvidenceApprovalBinding,
} from "../mwt4/provenance-binding.js";
import type {
  EvidenceApprovalProvenanceLink,
  ProvenanceVerificationResult,
} from "../mwt4/provenance-types.js";
import type { TaskEvidenceReport } from "../mwt4/task-evidence-types.js";
import type {
  ApprovalReviewReplay,
  ApprovalReviewInput,
  ApprovalReviewOptions,
} from "./approval-review-types.js";

const DEFAULT_HASH = (input: string): string =>
  crypto.createHash("sha256").update(input).digest("hex");

const DECISION_LABEL: Record<string, string> = {
  approved: "approved",
  rejected: "rejected",
  noted: "noted",
};

/** Stable JSON stringify (deterministic field order). */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.keys(v)
          .sort()
          .reduce<Record<string, unknown>>((acc, k) => {
            acc[k] = (v as Record<string, unknown>)[k];
            return acc;
          }, {})
      : v,
  );
}

/** Derive a deterministic canonical body of the approval (for review_id + verify). */
export function approvalReviewCanonicalBody(
  approval: UnsignedApprovalRecord | SignedApprovalRecord,
): string {
  return signedApprovalCanonicalBody(approval);
}

/**
 * Build a deterministic approval review replay artifact.
 *
 * Side-effect free except injected crypto. Same input → same review_id,
 * conclusion, and warning ordering. Never touches network or backend DB.
 */
export async function buildApprovalReviewReplay(
  input: ApprovalReviewInput,
  opts: ApprovalReviewOptions = {},
): Promise<ApprovalReviewReplay> {
  const hashFn = opts.hashFn ?? DEFAULT_HASH;
  const warnings: string[] = [];
  const pushWarning = (w: string): void => {
    if (!warnings.includes(w)) warnings.push(w);
  };

  const approval = input.approval;
  const report = input.report;
  const publicKeyPem = input.publicKeyPem;

  // --- Determine verification status via MWT-5+ (single source of truth) ---
  let verification: ApprovalVerificationResult | null = null;
  let approvalVerificationStatus: ApprovalReviewReplay["approval_verification_status"] = "unavailable";
  let approvalId: string | undefined;
  let approverId: string | undefined;
  let signerId: string | undefined;
  let decision: ApprovalReviewReplay["decision"];

  if (!approval) {
    approvalVerificationStatus = "unavailable";
    pushWarning("approval_missing: no approval record provided — review cannot be formed");
  } else {
    verification = await verifySignedApproval(approval, publicKeyPem);
    approvalVerificationStatus = verification.status;
    approvalId = verification.approver_id ?? approval.approver_id;
    approverId = verification.approver_id ?? approval.approver_id;
    signerId = verification.signer_id ?? (approval as SignedApprovalRecord).signature?.signer_id;
    decision = (approval as UnsignedApprovalRecord).decision;

    if (verification.status === "unverified") {
      pushWarning(
        "signature_unverified: signature present but did not cryptographically verify (tampered or wrong key)",
      );
    } else if (verification.status === "legacy_unsigned") {
      pushWarning(
        "legacy_unsigned: approval has no signature — historical record only, not cryptographically trusted",
      );
    } else if (verification.status === "unavailable") {
      pushWarning("signature_unavailable: signature evaluation unavailable");
    }
    if (verification.warnings) {
      for (const w of verification.warnings) pushWarning(w);
    }
  }

  // --- Evidence report integrity context ---
  const evidenceReportId = report?.report_id;
  const evidenceFingerprint = report?.integrity?.fingerprint;
  if (!report) {
    pushWarning("evidence_report_missing: no evidence report provided — review cannot be formed");
  }

  // --- Provenance binding via MWT-4F (single source of truth) ---
  let provenanceStatus: ApprovalReviewReplay["provenance_status"] = "unavailable";
  let bindingFingerprint: string | undefined;
  let provenance: ProvenanceVerificationResult | null = null;
  // Independent honest check: the approval's declared target_ref must match the
  // report's task_id. Divergence means the approval was made for a different task.
  let taskDivergence = false;
  if (approval && report && report.task_id && approval.target_ref && approval.target_ref !== report.task_id) {
    taskDivergence = true;
    pushWarning(
      `task_divergence: approval target_ref '${approval.target_ref}' does not match report task_id '${report.task_id}'`,
    );
  }

  if (approval && report) {
    if (input.provenanceLink) {
      // Verify the supplied report+approval against a pre-built (persisted) link.
      provenance = await verifyEvidenceApprovalBinding(
        input.provenanceLink,
        report,
        approval as SignedApprovalRecord,
        { publicKeyPem },
      );
      bindingFingerprint = input.provenanceLink.binding_fingerprint;
    } else {
      const link: EvidenceApprovalProvenanceLink = await buildEvidenceApprovalProvenanceLink(
        report,
        approval as SignedApprovalRecord,
        { publicKeyPem },
      );
      provenance = await verifyEvidenceApprovalBinding(link, report, approval as SignedApprovalRecord, {
        publicKeyPem,
      });
      bindingFingerprint = link.binding_fingerprint;
    }
    provenanceStatus = provenance.status;
    if (provenance.warnings) {
      for (const w of provenance.warnings) pushWarning(w);
    }
    if (taskDivergence) {
      provenanceStatus = "mismatch";
    }
  }

  // --- Determine review conclusion (structured, not boolean) ---
  const conclusion = deriveConclusion({
    approvalPresent: !!approval,
    reportPresent: !!report,
    verificationStatus: approvalVerificationStatus,
    decision,
    provenanceStatus,
  });

  // Additional honest warnings about conclusion semantics.
  if (conclusion === "mismatch") {
    pushWarning("provenance_mismatch: task/session or evidence fingerprint does not line up");
  } else if (
    (conclusion === "approved_unverified" || conclusion === "rejected_unverified") &&
    approvalVerificationStatus === "unverified"
  ) {
    pushWarning("unverified_decision: decision recorded but signature not cryptographically verified");
  }

  // --- Deterministic review_id (no clock dependency) ---
  const reviewIdInput = stableStringify({
    approval_id: approvalId,
    report_id: evidenceReportId,
    verification_status: approvalVerificationStatus,
    decision,
    provenance_status: provenanceStatus,
    binding_fingerprint: bindingFingerprint,
  });
  const reviewId = hashFn(reviewIdInput);

  const generatedAt = report?.generated_at ?? new Date(0).toISOString();

  // Task/session binding anchor: the report is the canonical binding source
  // (provenance link derives task_id/session_id from the report). The approval's
  // target_ref is surfaced alongside as the approver's declared reference.
  const taskId = report?.task_id ?? approval?.target_ref;
  const sessionId = report?.session_id;
  const targetRef = approval?.target_ref;

  const humanSummary = buildHumanSummary({
    conclusion,
    approverId,
    signerId,
    decision,
    evidenceReportId,
    evidenceFingerprint,
    approvalVerificationStatus,
    provenanceStatus,
    warnings,
  });

  return {
    review_id: reviewId,
    generated_at: generatedAt,
    task_id: taskId,
    session_id: sessionId,
    target_ref: targetRef,
    approval_id: approvalId,
    approver_id: approverId,
    signer_id: signerId,
    approval_verification_status: approvalVerificationStatus,
    decision,
    evidence_report_id: evidenceReportId,
    evidence_fingerprint: evidenceFingerprint,
    provenance_status: provenanceStatus,
    binding_fingerprint: bindingFingerprint,
    conclusion,
    warnings,
    human_summary: humanSummary,
  };
}

/** Decide the structured conclusion from the available evidence. */
function deriveConclusion(args: {
  approvalPresent: boolean;
  reportPresent: boolean;
  verificationStatus: ApprovalReviewReplay["approval_verification_status"];
  decision?: ApprovalReviewReplay["decision"];
  provenanceStatus: ApprovalReviewReplay["provenance_status"];
}): ApprovalReviewReplay["conclusion"] {
  const { approvalPresent, reportPresent, verificationStatus, decision, provenanceStatus } = args;

  if (!approvalPresent || !reportPresent) {
    return "unavailable";
  }
  if (verificationStatus === "legacy_unsigned") {
    return "legacy_unsigned";
  }
  if (provenanceStatus === "mismatch") {
    return "mismatch";
  }

  const verified = verificationStatus === "verified";
  if (decision === "rejected") {
    return verified ? "rejected_verified" : "rejected_unverified";
  }
  // approved / noted (treated as approved for verified semantics)
  return verified ? "approved_verified" : "approved_unverified";
}

/** Compose a plain-language audit narrative. */
function buildHumanSummary(args: {
  conclusion: ApprovalReviewReplay["conclusion"];
  approverId?: string;
  signerId?: string;
  decision?: ApprovalReviewReplay["decision"];
  evidenceReportId?: string;
  evidenceFingerprint?: string;
  approvalVerificationStatus: ApprovalReviewReplay["approval_verification_status"];
  provenanceStatus: ApprovalReviewReplay["provenance_status"];
  warnings: string[];
}): string {
  const {
    conclusion,
    approverId,
    signerId,
    decision,
    evidenceReportId,
    evidenceFingerprint,
    approvalVerificationStatus,
    provenanceStatus,
    warnings,
  } = args;

  const lines: string[] = [];
  lines.push(`Review conclusion: ${conclusion}.`);
  lines.push(
    `Approver: ${approverId ?? "unknown"} (signer: ${signerId ?? "unknown"}, decision: ${
      decision ?? "unknown"
    }).`,
  );
  lines.push(`Approval signature status: ${approvalVerificationStatus}.`);
  lines.push(
    `Evidence report: ${evidenceReportId ?? "none"} (fingerprint: ${evidenceFingerprint ?? "none"}).`,
  );
  lines.push(`Provenance binding: ${provenanceStatus}.`);
  if (warnings.length > 0) {
    lines.push(`Warnings (${warnings.length}):`);
    for (const w of warnings) lines.push(` - ${w}`);
  }
  return lines.join("\n");
}
