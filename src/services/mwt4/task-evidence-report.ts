// MWT-4 Mainline — Task Evidence Report builder (v0).
//
// Pure, deterministic report construction. Given a task/session/work item plus
// optional actor identity, approval record (MWT-5 + MWT-4E signature), routing
// delegation metadata and evidence refs, it produces a TaskEvidenceReport with:
//   - honest identity verification status (verified / unverified / legacy_unsigned / unavailable)
//   - approval status mapping
//   - a deterministic SHA-256 fingerprint over the canonical report body
//   - human-readable summary + warnings (never crashes on missing optional fields)
//
// Reuses MWT-4E (local-identity + approval-record.signature) for verification.
// No backend persistence, no external network, no schema/migration.

import { verifySignature, webCryptoVerify } from "../identity/local-identity.js";
import type {
  ApprovalRecordLike,
  ApprovalStatus,
  BuildTaskEvidenceInput,
  IdentityRef,
  IdentityVerificationStatus,
  TaskEvidenceReport,
} from "./task-evidence-types.js";

// ── Stable canonical JSON (sorted keys, stable array order) ───────────────────

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${parts.join(",")}}`;
}

// ── SHA-256 (Web Crypto; global in browser + Node 18+) ────────────────────────

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Approval canonical body (mirrors approval-record.ts canonicalBody for signature compat) ─

function approvalCanonicalBody(a: ApprovalRecordLike): string {
  return stableStringify({
    schema_version: a.schema_version ?? null,
    approver_id: a.approver_id,
    target_ref: a.target_ref ?? null,
    decision: a.decision,
    note: a.note ?? null,
    evidence_refs: a.evidence_refs ?? [],
    ts: a.ts ?? null,
    prev_hash: a.prev_hash ?? null,
    seq: a.seq ?? null,
    record_hash: a.record_hash ?? null,
  });
}

export { approvalCanonicalBody };

// ── Approval status mapping ───────────────────────────────────────────────────

function mapApprovalStatus(
  approval: ApprovalRecordLike | undefined,
): ApprovalStatus {
  if (!approval) return "not_required";
  // MWT-5 ApprovalDecision = "approved" | "rejected" | "noted"
  if (approval.decision === "approved") return "approved";
  if (approval.decision === "rejected") return "rejected";
  if (approval.decision === "noted") return "noted";
  return "unavailable";
}

// ── Actor identity resolution ─────────────────────────────────────────────────

function resolveActor(req: IdentityRef | undefined): IdentityRef {
  if (!req) return { verification: "unavailable" };
  // If a fingerprint is present but status not stated, keep what caller gave.
  if (req.verification === "verified" && !req.fingerprint) {
    return { ...req, verification: "unverified", detail: "claimed verified but no fingerprint" };
  }
  return req;
}

// ── Approver identity resolution (MWT-4E reuse) ───────────────────────────────

async function resolveApprover(
  approval: ApprovalRecordLike | undefined,
  publicKeyPem: string | undefined,
  verifyFn?: Parameters<typeof verifySignature>[3],
): Promise<{ approver: IdentityRef; warnings: string[] }> {
  const warnings: string[] = [];
  if (!approval) {
    return { approver: { verification: "unavailable" }, warnings };
  }
  const sig = approval.signature;
  if (!sig) {
    return {
      approver: { verification: "legacy_unsigned", id: approval.approver_id },
      warnings: ["approval record is legacy (unsigned); approver identity not cryptographically bound"],
    };
  }
  // Signed: verify against the approver's public key (spki). Without the public key
  // we cannot confirm the signature, so we must NOT mark it verified.
  if (!publicKeyPem) {
    warnings.push(
      "signed approval but no approver public key provided — cannot cryptographically verify; marked unverified",
    );
    return {
      approver: {
        id: sig.signer_id,
        fingerprint: sig.public_key_fingerprint,
        verification: "unverified",
        detail: "public key unavailable for verification",
      },
      warnings,
    };
  }
  let status: IdentityVerificationStatus;
  try {
    const body = approvalCanonicalBody(approval);
    const ok = await verifySignature(publicKeyPem, body, sig.signature, verifyFn ?? webCryptoVerify);
    status = ok ? "verified" : "unverified";
  } catch {
    status = "unverified";
  }
  if (status === "verified") {
    return {
      approver: {
        id: sig.signer_id,
        fingerprint: sig.public_key_fingerprint,
        verification: "verified",
      },
      warnings,
    };
  }
  warnings.push(
    "approval signature verification FAILED — tampered record or wrong key; approver identity NOT trusted",
  );
  return {
    approver: {
      id: sig.signer_id,
      fingerprint: sig.public_key_fingerprint,
      verification: "unverified",
      detail: "signature verification failed",
    },
    warnings,
  };
}

// ── Human-readable summary ────────────────────────────────────────────────────

function buildHumanSummary(
  r: Omit<TaskEvidenceReport, "human_readable_summary" | "integrity">,
): string {
  const lines: string[] = [];
  lines.push(`Task Evidence Report ${r.report_id}`);
  lines.push(`Subject: ${r.subject}`);
  if (r.task_id) lines.push(`Task: ${r.task_id}`);
  if (r.session_id) lines.push(`Session: ${r.session_id}`);
  lines.push(`Generated: ${r.generated_at}`);
  lines.push(`Actor: ${r.actor.verification}${r.actor.id ? ` (${r.actor.id})` : ""}`);
  lines.push(`Approver: ${r.approver.verification}${r.approver.id ? ` (${r.approver.id})` : ""}`);
  lines.push(`Approval: ${r.approval_status}`);
  if (r.routing) {
    if (r.routing.route_type === "delegated") {
      lines.push(`Routing: delegated to ${r.routing.delegated_to ?? "unknown agent"}`);
    } else if (r.routing.route_type === "ask_clarification") {
      lines.push(
        `Routing: clarification required — "${r.routing.clarification?.question ?? ""}"`,
      );
    } else {
      lines.push(`Routing: ${r.routing.route_type}`);
    }
  }
  lines.push(`Evidence items: ${r.evidence_items.length}`);
  if (r.warnings.length) lines.push(`Warnings: ${r.warnings.length}`);
  return lines.join("\n");
}

// ── Main builder ──────────────────────────────────────────────────────────────

export interface BuildOpts {
  /** Inject a verify fn for deterministic tests; defaults to Web Crypto verify. */
  verifyFn?: Parameters<typeof verifySignature>[3];
  /** Inject a hash fn for deterministic tests; defaults to Web Crypto SHA-256. */
  hashFn?: (input: string) => Promise<string> | string;
}

/**
 * Build a deterministic TaskEvidenceReport from a task/session input.
 * Always succeeds (never throws on missing optional fields) — missing data is
 * reflected as "unavailable"/"not_required" status plus warnings.
 */
export async function buildTaskEvidenceReport(
  input: BuildTaskEvidenceInput,
  opts: BuildOpts = {},
): Promise<TaskEvidenceReport> {
  const warnings: string[] = [...(input.warnings ?? [])];

  const actor = resolveActor(input.requester);
  if (actor.verification === "unavailable") {
    warnings.push("no actor/requester identity provided");
  }

  const { approver, warnings: approverWarnings } = await resolveApprover(
    input.approval,
    input.approver_public_key_pem,
    opts.verifyFn,
  );
  warnings.push(...approverWarnings);

  const approval_status = mapApprovalStatus(input.approval);

  const input_summary = input.inputs ?? [];
  const output_summary = input.outputs ?? [];
  if (!input_summary.length) warnings.push("no input summary provided");
  if (!output_summary.length) warnings.push("no output summary provided");

  if (input.routing?.route_type === "ask_clarification" && !input.routing.clarification) {
    warnings.push("clarification route without question text");
  }

  const evidence_items = input.evidence ?? [];

  // Assemble the report WITHOUT the computed integrity/human_summary fields,
  // then fingerprint the stable canonical body.
  const base: Omit<TaskEvidenceReport, "integrity" | "human_readable_summary"> = {
    report_id: input.report_id,
    ...(input.task_id !== undefined ? { task_id: input.task_id } : {}),
    ...(input.session_id !== undefined ? { session_id: input.session_id } : {}),
    generated_at: input.generated_at,
    subject: input.subject,
    actor,
    approver,
    approval_status,
    input_summary,
    output_summary,
    ...(input.routing !== undefined ? { routing: input.routing } : {}),
    evidence_items,
    warnings,
  };

  const hash = opts.hashFn ?? sha256Hex;
  const fingerprint = await hash(stableStringify(base));

  const report: TaskEvidenceReport = {
    ...base,
    integrity: { fingerprint, algo: "SHA-256" },
    human_readable_summary: buildHumanSummary(base),
  };
  return report;
}

export { stableStringify };
