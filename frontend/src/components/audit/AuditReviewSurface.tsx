"use client";

// MWT-5R-UI-II — Audit Review entry surface.
//
// Pure presentation: consumes deterministic ApprovalReviewReplay fixtures and
// renders one ApprovalReviewPanel per state. NO backend / API / DB dependency,
// NO re-evaluation of signatures or provenance in the UI. The panel only
// displays the artifact's honest conclusion tone.
//
// This is the smallest reachable product surface for the audit review panel —
// wired into the main sidebar as the "Audit" nav item (see app/page.tsx).

import ApprovalReviewPanel from "@/components/audit/ApprovalReviewPanel";
import EventChainViewer from "@/components/dashboard/EventChainViewer";
import {
  approvedVerified,
  mismatch,
  legacyUnsigned,
  unavailable,
} from "@/components/audit/__fixtures__/approval-reviews";

const SAMPLES = [
  approvedVerified,
  mismatch,
  legacyUnsigned,
  unavailable,
] as const;

interface AuditReviewSurfaceProps {
  /** Real event chain + assessment is pulled from the backend self-observation
   *  store (no gateway required) so the audit surface shows live activity. */
  sessionId?: string;
  userId?: string;
}

export function AuditReviewSurface({ sessionId, userId }: AuditReviewSurfaceProps = {}) {
  return (
    <div className="h-full overflow-y-auto p-6" data-testid="audit-review-surface">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1
            className="text-xl font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            🔍 Audit Review
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
            MWT-5R-UI — Approval review replay with honest status. Each card below
            is a deterministic example artifact (no backend, no live API).
          </p>
        </div>

        {/* Honest legend — what each tone means, stated up front */}
        <div
          className="rounded-xl border p-4 text-xs space-y-1"
          style={{
            backgroundColor: "var(--bg-surface)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <p style={{ color: "var(--text-primary)" }} className="font-semibold mb-1">
            Status legend
          </p>
          <p style={{ color: "var(--text-secondary)" }}>
            <span className="font-medium" style={{ color: "var(--accent-emerald, #059669)" }}>
              Verified
            </span>{" "}
            — signed approval cryptographically confirmed against the evidence.
          </p>
          <p style={{ color: "var(--text-secondary)" }}>
            <span className="font-medium" style={{ color: "var(--accent-amber, #d97706)" }}>
              Warning
            </span>{" "}
            — legacy / unsigned or unverified record; historical note only, not a trusted attestation.
          </p>
          <p style={{ color: "var(--text-secondary)" }}>
            <span className="font-medium" style={{ color: "var(--accent-red, #dc2626)" }}>
              Danger
            </span>{" "}
            — mismatch: target or fingerprint divergence detected. Do not trust.
          </p>
          <p style={{ color: "var(--text-secondary)" }}>
            <span className="font-medium" style={{ color: "var(--text-muted)" }}>
              Neutral
            </span>{" "}
            — insufficient data to form a review. Reported honestly, not assumed safe.
          </p>
        </div>

        {/* One panel per deterministic sample state */}
        <div className="space-y-6">
          {SAMPLES.map((review) => (
            <ApprovalReviewPanel key={review.review_id} review={review} />
          ))}
        </div>

        {/* P1-B: real event chain + server-side assessment (live data, no gateway) */}
        <div className="pt-4 border-t" style={{ borderColor: "var(--border-subtle)" }}>
          <h2
            className="text-base font-semibold mb-3"
            style={{ color: "var(--text-primary)" }}
          >
            🔗 Live Event Chain & Assessment
          </h2>
          <EventChainViewer sessionId={sessionId} userId={userId} />
        </div>
      </div>
    </div>
  );
}
