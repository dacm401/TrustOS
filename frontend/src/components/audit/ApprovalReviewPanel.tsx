"use client";

// MWT-5R-UI — Approval Review Audit Panel v0.
//
// Renders an ApprovalReviewReplay artifact (produced by the Trust Spine backend
// service buildApprovalReviewReplay) as an honest, human-readable audit view.
// No backend dependency: the artifact is passed in as a prop. No enforcement,
// no persistence. Status tones come from review-status.ts (single source).

import type { ApprovalReviewReplay } from "@/types/audit";
import {
  conclusionDisplay,
  verificationTone,
  provenanceTone,
  truncateFingerprint,
  toneClasses,
} from "./review-status";

function Chip({ tone, children }: { tone: "positive" | "warning" | "danger" | "neutral"; children: React.ReactNode }) {
  return (
    <span className={`inline-block text-xs font-medium px-2.5 py-1 rounded-lg border ${toneClasses(tone)}`}>
      {children}
    </span>
  );
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-400 uppercase tracking-wide shrink-0">{label}</span>
      <span className={`text-sm text-gray-700 text-right ${mono ? "font-mono break-all" : ""}`}>{value}</span>
    </div>
  );
}

export default function ApprovalReviewPanel({ review }: { review: ApprovalReviewReplay }) {
  const conclusion = conclusionDisplay(review.conclusion);

  return (
    <section className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Header + conclusion badge */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-lg">🔍</span>
          <div className="min-w-0">
            <h2 className="font-semibold text-gray-800 text-sm">Approval Review Replay</h2>
            <p className="text-xs text-gray-400">MWT-5R · Trust Spine Audit View</p>
          </div>
        </div>
        <Chip tone={conclusion.tone}>{conclusion.label}</Chip>
      </div>

      {/* Body */}
      <div className="p-5 space-y-4">
        {/* Status row */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-400 mr-1">Signature:</span>
          <Chip tone={verificationTone(review.approval_verification_status)}>
            {review.approval_verification_status}
          </Chip>
          <span className="text-xs text-gray-400 mr-1 ml-2">Provenance:</span>
          <Chip tone={provenanceTone(review.provenance_status)}>{review.provenance_status}</Chip>
        </div>

        {/* Key facts */}
        <div className="rounded-lg border border-gray-100 bg-gray-50/40 px-4 py-1">
          <Row label="Decision" value={review.decision ?? "—"} />
          <Row label="Approver" value={review.approver_id ?? "—"} mono />
          <Row label="Signer" value={review.signer_id ?? "—"} mono />
          <Row label="Evidence Report" value={review.evidence_report_id ?? "—"} mono />
          <Row
            label="Evidence Fingerprint"
            value={truncateFingerprint(review.evidence_fingerprint)}
            mono
          />
          <Row
            label="Binding Fingerprint"
            value={truncateFingerprint(review.binding_fingerprint)}
            mono
          />
          <Row label="Review ID" value={truncateFingerprint(review.review_id)} mono />
        </div>

        {/* Warnings */}
        {review.warnings.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div className="text-xs font-semibold text-amber-700 mb-1.5">
              Warnings ({review.warnings.length})
            </div>
            <ul className="space-y-1">
              {review.warnings.map((w, i) => (
                <li key={i} className="text-xs text-amber-800 flex gap-1.5">
                  <span className="text-amber-500">•</span>
                  <span className="break-words">{w}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Human summary */}
        <div className="rounded-lg border border-gray-100 bg-white p-3">
          <div className="text-xs font-semibold text-gray-500 mb-1.5">Audit Narrative</div>
          <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
            {review.human_summary}
          </pre>
        </div>

        {/* Honesty footer */}
        <div className="text-[11px] text-gray-400 border-t border-gray-50 pt-2">
          Trust Spine: Identity (MWT-4E) → Evidence (MWT-4) → Signed Approval (MWT-5+) →
          Provenance (MWT-4F) → Review (MWT-5R). No enforcement, no backend dependency.
        </div>
      </div>
    </section>
  );
}
