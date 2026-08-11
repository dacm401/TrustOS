// MWT-5+ — Signed Approval Dry-run v0.
//
// Turns MWT-5 advisory approval records into "optionally signed, verifiable,
// reportable" dry-run approvals. No enforcement, no backend persistence, no
// external network. The canonical body and verification status are reused from
// MWT-4 Mainline (task-evidence-report) and MWT-4E (local-identity) so the result
// is directly consumable by the Task Evidence Report.
//
// Honest verification (no fake trust):
//   signed + valid + signer===approver          -> verified
//   signed but signature mismatch / missing key -> unverified   (+ warning)
//   unsigned legacy approval                    -> legacy_unsigned (+ warning)
//   no approval record at all                   -> unavailable

import {
  verifySignature,
  webCryptoVerify,
  signBody,
  webCryptoSign,
} from "../identity/local-identity.js";
import { approvalCanonicalBody } from "../mwt4/task-evidence-report.js";
import type { ApprovalRecordLike, ApprovalSignatureLike } from "../mwt4/task-evidence-types.js";
import type {
  ApprovalSignatureEnvelope,
  ApprovalVerificationResult,
  SignedApprovalRecord,
  UnsignedApprovalRecord,
} from "./signed-approval-types.js";

export const CANONICAL_BODY_VERSION = "mwt5-v1";

type VerifyFn = Parameters<typeof verifySignature>[3];
type SignFn = Parameters<typeof signBody>[2];

/** Normalize any approval input (signed or unsigned) into the canonical record. */
function toRecord(input: UnsignedApprovalRecord | SignedApprovalRecord): SignedApprovalRecord {
  return { ...input } as SignedApprovalRecord;
}

/**
 * Deterministically serialize the approval record for signing/verification.
 * Maps the MWT-5 `created_at` field onto MWT-4 Mainline's `ts` slot and delegates
 * to approvalCanonicalBody so the body is byte-identical to what the Task Evidence
 * Report verifies (single source of truth). The signature envelope fields are
 * explicitly excluded.
 */
export function signedApprovalCanonicalBody(
  record: UnsignedApprovalRecord | SignedApprovalRecord,
): string {
  return approvalCanonicalBody(toApprovalRecordLike(record));
}

/**
 * Sign an advisory approval record, producing a SignedApprovalRecord with a
 * local Ed25519 signature envelope. Pure/deterministic given the same key + body.
 */
export async function signSignedApproval(
  record: UnsignedApprovalRecord,
  privateKeyPem: string,
  opts: { signFn?: SignFn; publicKeyPem?: string } = {},
): Promise<SignedApprovalRecord> {
  const body = signedApprovalCanonicalBody(record);
  const signFn = opts.signFn ?? webCryptoSign;
  const signatureHex = await signBody(privateKeyPem, body, signFn);
  const envelope: ApprovalSignatureEnvelope = {
    algorithm: "Ed25519",
    signer_id: record.approver_id,
    public_key: opts.publicKeyPem ?? "",
    signature: signatureHex,
    signed_at: record.created_at ?? new Date().toISOString(),
    canonical_body_version: CANONICAL_BODY_VERSION,
  };
  return { ...record, signature: envelope };
}

/**
 * Verify a signed approval record. Returns a structured result — never a bare
 * boolean — so callers (and the Task Evidence Report) can surface honest status.
 */
export async function verifySignedApproval(
  record: SignedApprovalRecord | UnsignedApprovalRecord | undefined | null,
  publicKeyPem?: string,
  opts: { verifyFn?: VerifyFn } = {},
): Promise<ApprovalVerificationResult> {
  const warnings: string[] = [];

  if (!record) {
    return { status: "unavailable", reason: "no approval record provided", warnings };
  }

  const sig = (record as SignedApprovalRecord).signature;

  // Legacy unsigned approval — still readable, but identity not cryptographically bound.
  if (!sig) {
    warnings.push(
      "approval record is legacy (unsigned); approver identity not cryptographically bound",
    );
    return {
      status: "legacy_unsigned",
      approver_id: record.approver_id,
      signer_matches_approver: true,
      reason: "no signature envelope present",
      warnings,
    };
  }

  const verifyFn = opts.verifyFn ?? webCryptoVerify;

  // Signer / approver mismatch must fail or warn.
  const signerMatches = sig.signer_id === record.approver_id;
  if (!signerMatches) {
    warnings.push(
      `signature signer_id (${sig.signer_id}) does not match approver_id (${record.approver_id}); approval identity NOT trusted`,
    );
    return {
      status: "unverified",
      algorithm: sig.algorithm,
      signer_id: sig.signer_id,
      approver_id: record.approver_id,
      signer_matches_approver: false,
      reason: "signer_id does not match approver_id",
      warnings,
    };
  }

  // Without the public key we cannot confirm the signature. Do NOT mark verified.
  if (!publicKeyPem) {
    warnings.push(
      "signed approval but no approver public key provided — cannot cryptographically verify; marked unverified",
    );
    return {
      status: "unverified",
      algorithm: sig.algorithm,
      signer_id: sig.signer_id,
      approver_id: record.approver_id,
      signer_matches_approver: true,
      reason: "public key unavailable for verification",
      warnings,
    };
  }

  let ok = false;
  try {
    const body = signedApprovalCanonicalBody(record);
    ok = await verifySignature(publicKeyPem, body, sig.signature, verifyFn);
  } catch {
    ok = false;
  }

  if (ok) {
    return {
      status: "verified",
      algorithm: sig.algorithm,
      signer_id: sig.signer_id,
      approver_id: record.approver_id,
      signer_matches_approver: true,
      reason: "signature valid and signer matches approver",
      warnings,
    };
  }

  warnings.push(
    "approval signature verification FAILED — tampered record or wrong key; approver identity NOT trusted",
  );
  return {
    status: "unverified",
    algorithm: sig.algorithm,
    signer_id: sig.signer_id,
    approver_id: record.approver_id,
    signer_matches_approver: true,
    reason: "signature verification failed",
    warnings,
  };
}

/**
 * Convert a signed/unsigned MWT-5 approval record into MWT-4 Mainline's
 * ApprovalRecordLike so it is directly consumable by buildTaskEvidenceReport.
 * The public key PEM is carried as public_key_fingerprint on the envelope (the
 * report only uses it for display; actual verification uses the separate
 * approver_public_key_pem input field, matching MWT-4E reuse).
 */
export function toApprovalRecordLike(
  record: SignedApprovalRecord | UnsignedApprovalRecord,
): ApprovalRecordLike {
  const sig = (record as SignedApprovalRecord).signature;
  const base: ApprovalRecordLike = {
    schema_version: record.schema_version,
    approver_id: record.approver_id,
    target_ref: record.target_ref,
    decision: record.decision,
    note: record.note,
    evidence_refs: record.evidence_refs ?? [],
    ts: record.created_at,
    prev_hash: undefined,
    seq: undefined,
    record_hash: undefined,
  };
  if (!sig) return base;
  const envelope: ApprovalSignatureLike = {
    signer_id: sig.signer_id,
    public_key_fingerprint: sig.public_key || sig.signer_id,
    algo: sig.algorithm,
    signature: sig.signature,
  };
  return { ...base, signature: envelope };
}

/**
 * Map a verification result onto MWT-4 Mainline's IdentityVerificationStatus so
 * it can be fed straight into BuildTaskEvidenceInput.approval + approver identity.
 */
export function toIdentityVerificationStatus(
  res: ApprovalVerificationResult,
): "verified" | "unverified" | "legacy_unsigned" | "unavailable" {
  return res.status;
}
