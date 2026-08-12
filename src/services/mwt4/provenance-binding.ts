// MWT-4F — Evidence ↔ Approval Provenance Binding v0.
//
// Builds an explicit, deterministic provenance link between a Task Evidence Report
// (MWT-4 Mainline) and a Signed Approval record (MWT-5+), and verifies it honestly.
//
// Reuses (no duplicated verification logic):
//   - MWT-5+ verifySignedApproval / signedApprovalCanonicalBody / toApprovalRecordLike
//   - MWT-4 Mainline stableStringify (deterministic field ordering)
//
// Honest status (no fake trust):
//   report or approval missing           -> unavailable
//   task/session or evidence fingerprint  -> mismatch
//   approval signature not verified       -> unverified
//   everything consistent + verified      -> linked

import { createHash } from "node:crypto";
import { stableStringify } from "./task-evidence-report.js";
import type { TaskEvidenceReport } from "./task-evidence-types.js";
import {
  verifySignedApproval,
  signedApprovalCanonicalBody,
} from "../mwt5/signed-approval.js";
import type {
  SignedApprovalRecord,
  UnsignedApprovalRecord,
  ApprovalVerificationResult,
} from "../mwt5/signed-approval-types.js";
import type {
  ApprovalSignatureStatus,
  EvidenceApprovalProvenanceLink,
  ProvenanceVerificationResult,
} from "./provenance-types.js";

type VerifyFn = Parameters<typeof verifySignedApproval>[2] extends infer T
  ? T extends { verifyFn?: infer V }
    ? V
    : never
  : never;
type HashFn = (input: string) => string;

function defaultHash(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Derive a stable approval_id from the canonical body when not supplied. */
function deriveApprovalId(
  approval: UnsignedApprovalRecord | SignedApprovalRecord,
  hashFn: HashFn,
): string {
  return "apv_" + hashFn(signedApprovalCanonicalBody(approval)).slice(0, 24);
}

/**
 * Build a deterministic provenance link binding a report to a signed approval.
 * linked_at is anchored to report.generated_at (no clock) so the link is stable.
 */
export async function buildEvidenceApprovalProvenanceLink(
  report: TaskEvidenceReport,
  approval: UnsignedApprovalRecord | SignedApprovalRecord,
  opts: {
    publicKeyPem?: string;
    approvalId?: string;
    verifyFn?: VerifyFn;
    hashFn?: HashFn;
  } = {},
): Promise<EvidenceApprovalProvenanceLink> {
  const hashFn = opts.hashFn ?? defaultHash;
  const sigResult: ApprovalVerificationResult = opts.verifyFn
    ? ((await verifySignedApproval(approval, opts.publicKeyPem, { verifyFn: opts.verifyFn })) as ApprovalVerificationResult)
    : ((await verifySignedApproval(approval, opts.publicKeyPem)) as ApprovalVerificationResult);
  const approval_signature_status = sigResult.status as ApprovalSignatureStatus;

  const warnings = [...sigResult.warnings];
  if (approval_signature_status !== "verified") {
    warnings.push(
      `approval signature status is '${approval_signature_status}'; binding is NOT cryptographically verified`,
    );
  }

  const approvalId = opts.approvalId ?? deriveApprovalId(approval, hashFn);

  const bindingInput = {
    approval_id: approvalId,
    approver_id: approval.approver_id,
    task_id: report.task_id ?? null,
    session_id: report.session_id ?? null,
    evidence_report_id: report.report_id,
    evidence_fingerprint: report.integrity?.fingerprint ?? null,
    approval_signature_status,
  };
  const binding_fingerprint = hashFn(stableStringify(bindingInput));

  return {
    link_id: "eal_" + binding_fingerprint.slice(0, 20),
    task_id: report.task_id,
    session_id: report.session_id,
    evidence_report_id: report.report_id,
    evidence_fingerprint: report.integrity?.fingerprint ?? "",
    approval_id: approvalId,
    approver_id: approval.approver_id,
    approval_signature_status,
    linked_at: report.generated_at,
    binding_fingerprint,
    warnings,
  };
}

/**
 * Verify a report + approval against a previously-built provenance link.
 * Recomputes the binding fingerprint and compares it (and the evidence fingerprint)
 * to the stored link. Returns structured status — never a bare boolean.
 */
export async function verifyEvidenceApprovalBinding(
  link: EvidenceApprovalProvenanceLink,
  report: TaskEvidenceReport,
  approval: UnsignedApprovalRecord | SignedApprovalRecord,
  opts: { publicKeyPem?: string; verifyFn?: VerifyFn; hashFn?: HashFn } = {},
): Promise<ProvenanceVerificationResult> {
  const hashFn = opts.hashFn ?? defaultHash;
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (!link || !report) {
    return { status: "unavailable", reasons: ["report missing"], warnings };
  }
  if (!approval) {
    return { status: "unavailable", reasons: ["approval missing"], warnings };
  }

  // 1. Evidence fingerprint must line up with the stored link.
  const currentFingerprint = report.integrity?.fingerprint ?? "";
  if (!currentFingerprint) {
    return {
      status: "mismatch",
      reasons: ["current report has no evidence fingerprint"],
      warnings: ["missing evidence fingerprint — cannot confirm binding"],
    };
  }
  if (link.evidence_fingerprint !== currentFingerprint) {
    reasons.push("evidence fingerprint changed since binding (report tampered or mismatched)");
    return {
      status: "mismatch",
      reasons,
      warnings,
      binding_fingerprint: link.binding_fingerprint,
    };
  }

  // 2. Recompute the approval's current signature status (honest, no reuse of stale verdict).
  const currentSig: ApprovalVerificationResult = opts.verifyFn
    ? await verifySignedApproval(approval, opts.publicKeyPem, { verifyFn: opts.verifyFn })
    : await verifySignedApproval(approval, opts.publicKeyPem);
  const currentStatus = currentSig.status as ApprovalSignatureStatus;

  // 3. Approval signature status must match what the link recorded.
  if (currentStatus !== link.approval_signature_status) {
    reasons.push(
      `approval signature status changed since binding: '${link.approval_signature_status}' -> '${currentStatus}'`,
    );
    warnings.push(...currentSig.warnings);
    return {
      status: "unverified",
      reasons,
      warnings,
      binding_fingerprint: link.binding_fingerprint,
    };
  }
  if (currentStatus !== "verified") {
    reasons.push(`approval signature status is '${currentStatus}'; binding not cryptographically verified`);
    warnings.push(...currentSig.warnings);
    return {
      status: "unverified",
      reasons,
      warnings,
      binding_fingerprint: link.binding_fingerprint,
    };
  }

  // 4. Recompute binding fingerprint from current report + approval; must equal stored.
  const approvalId =
    link.approval_id ?? deriveApprovalId(approval, hashFn);
  const expectedInput = {
    approval_id: approvalId,
    approver_id: link.approver_id,
    task_id: report.task_id ?? null,
    session_id: report.session_id ?? null,
    evidence_report_id: report.report_id,
    evidence_fingerprint: currentFingerprint,
    approval_signature_status: currentStatus,
  };
  const expectedFingerprint = hashFn(stableStringify(expectedInput));
  if (expectedFingerprint !== link.binding_fingerprint) {
    reasons.push("binding fingerprint mismatch (task/session/approval/report fields changed)");
    return { status: "mismatch", reasons, warnings, binding_fingerprint: link.binding_fingerprint };
  }

  // 5. All consistent and cryptographically verified.
  return {
    status: "linked",
    reasons: ["report fingerprint matches", "approval verified", "binding fingerprint matches"],
    warnings,
    binding_fingerprint: link.binding_fingerprint,
  };
}
