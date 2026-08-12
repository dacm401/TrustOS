// MWT-5R-UI — Honest status rendering mapping for the Approval Review Panel.
//
// Pure functions (no React) so they are deterministically testable from a plain
// script without a React test harness. The panel consumes these so the visual
// semantics and the tested semantics are the SAME single source of truth.

import type {
  ApprovalReviewConclusion,
  ApprovalReviewVerificationStatus,
  ApprovalReviewProvenanceStatus,
} from "../../types/audit";

export type Tone = "positive" | "warning" | "danger" | "neutral";

export interface ConclusionDisplay {
  /** Short human label for the conclusion badge. */
  label: string;
  /** Honest tone driving color: positive/warning/danger/neutral. */
  tone: Tone;
}

/**
 * Map a structured conclusion to an honest visual label + tone.
 * Invariant: no unverified/mismatch/legacy/unavailable state may be mapped to
 * a "positive/verified" tone. This is enforced by the mapping below, and the
 * regression test asserts it.
 */
export function conclusionDisplay(conclusion: ApprovalReviewConclusion): ConclusionDisplay {
  switch (conclusion) {
    case "approved_verified":
      return { label: "Approved · Verified", tone: "positive" };
    case "rejected_verified":
      return { label: "Rejected · Verified", tone: "positive" };
    case "approved_unverified":
      return { label: "Approved · Unverified", tone: "warning" };
    case "rejected_unverified":
      return { label: "Rejected · Unverified", tone: "warning" };
    case "legacy_unsigned":
      return { label: "Legacy · Unsigned", tone: "warning" };
    case "mismatch":
      return { label: "Mismatch", tone: "danger" };
    case "unavailable":
      return { label: "Unavailable", tone: "neutral" };
  }
}

/** Tone for the signature verification status chip. */
export function verificationTone(status: ApprovalReviewVerificationStatus): Tone {
  switch (status) {
    case "verified":
      return "positive";
    case "unverified":
      return "warning";
    case "legacy_unsigned":
      return "warning";
    case "unavailable":
      return "neutral";
  }
}

/** Tone for the provenance binding status chip. */
export function provenanceTone(status: ApprovalReviewProvenanceStatus): Tone {
  switch (status) {
    case "linked":
      return "positive";
    case "unverified":
      return "warning";
    case "mismatch":
      return "danger";
    case "unavailable":
      return "neutral";
  }
}

/** Truncate a fingerprint for display while keeping it honestly identifiable. */
export function truncateFingerprint(fp?: string, head = 12, tail = 8): string {
  if (!fp) return "—";
  if (fp.length <= head + tail + 1) return fp;
  return `${fp.slice(0, head)}…${fp.slice(-tail)}`;
}

/** Tailwind class set per tone (shared by the panel chips/badges). */
export function toneClasses(tone: Tone): string {
  switch (tone) {
    case "positive":
      return "bg-emerald-50 border-emerald-200 text-emerald-700";
    case "warning":
      return "bg-amber-50 border-amber-200 text-amber-700";
    case "danger":
      return "bg-red-50 border-red-200 text-red-700";
    case "neutral":
      return "bg-gray-50 border-gray-200 text-gray-500";
  }
}
