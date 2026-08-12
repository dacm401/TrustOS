// MWT-6-UI — Honest status rendering mapping for the Memory Governance Panel.
//
// Pure functions (no React) so they are deterministically testable from a plain
// script WITHOUT a React test harness. The panel consumes these so the visual
// semantics and the tested semantics are the SAME single source of truth.
//
// Invariant (PM requirements):
//   - active            -> positive
//   - limited           -> warning
//   - expired           -> warning   (neutral-leaning but never positive)
//   - revoked           -> danger
//   - legacy            -> warning
//   - unverified        -> warning
//   - invalid           -> danger
//   No untrusted state (limited/legacy/unverified/invalid/revoked) may be
//   mapped to a "positive" tone. This is enforced by the mapping below, and
//   the regression test asserts it.

import type { MemoryGovernanceStatus } from "../../types/memory-governance";

export type Tone = "positive" | "warning" | "danger" | "neutral";

export interface StatusDisplay {
  /** Short human label for the status badge. */
  label: string;
  /** Honest tone driving color: positive/warning/danger/neutral. */
  tone: Tone;
}

const POSITIVE: Tone = "positive";
const WARNING: Tone = "warning";
const DANGER: Tone = "danger";

/**
 * Map a structured governance status to an honest visual label + tone.
 * The default branch is WARNING (never positive) so an unknown status can
 * never silently render as "safe".
 */
export function statusDisplay(status: MemoryGovernanceStatus): StatusDisplay {
  switch (status) {
    case "active":
      return { label: "Active", tone: POSITIVE };
    case "limited":
      return { label: "Limited", tone: WARNING };
    case "expired":
      return { label: "Expired", tone: WARNING };
    case "revoked":
      return { label: "Revoked", tone: DANGER };
    case "legacy":
      return { label: "Legacy", tone: WARNING };
    case "unverified":
      return { label: "Unverified", tone: WARNING };
    case "invalid":
      return { label: "Invalid", tone: DANGER };
    default:
      return { label: "Unknown", tone: WARNING };
  }
}

/** Tone for the sensitivity chip. Honest invariant: never show unknown as safe. */
export function sensitivityTone(sensitivity: string): Tone {
  switch (sensitivity) {
    case "public":
      return POSITIVE;
    case "internal":
      return NEUTRAL_ISH();
    case "sensitive":
    case "restricted":
    case "unknown":
      // unknown is NOT public — it is treated as a caution, never as safe.
      return WARNING;
    default:
      return WARNING;
  }
}

// internal is "neutral" in tone (known, ordinary). We keep it honest but not
// alarming. Using a small helper keeps the intent explicit.
function NEUTRAL_ISH(): Tone {
  return "neutral";
}

/** Label for the sensitivity chip (keeps raw value visible). */
export function sensitivityLabel(sensitivity: string): string {
  return sensitivity;
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
