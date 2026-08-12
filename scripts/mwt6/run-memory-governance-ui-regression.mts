// MWT-6-UI — Memory Governance Panel regression (deterministic, no backend).
//
// Exhaustive matrix over every MemoryGovernanceStatus x Sensitivity to assert
// the honest rendering contract holds for ALL combinations, plus:
//   - determinism: same status -> same tone across many calls
//   - no untrusted status ever maps to "positive"
//   - fingerprint truncation is stable + honest
//   - sensitivity "unknown" never positive
//
// Run: npx tsx scripts/mwt6/run-memory-governance-ui-regression.mts

import {
  statusDisplay,
  sensitivityTone,
  sensitivityLabel,
  truncateFingerprint,
  type Tone,
} from "../../frontend/src/components/memory/memory-governance-status";

const STATUSES = [
  "active",
  "limited",
  "expired",
  "revoked",
  "legacy",
  "unverified",
  "invalid",
] as const;

const SENSITIVITIES = ["public", "internal", "sensitive", "restricted", "unknown"] as const;

const TRUSTED_POSITIVE: ReadonlySet<string> = new Set(["active"]);

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    process.stdout.write(`  ❌ ${name}\n`);
  }
}

// Matrix: every status x sensitivity tone mapping.
for (const s of STATUSES) {
  const tone = statusDisplay(s).tone;
  // Core invariant: only trusted statuses may be positive.
  check(`status ${s} positive iff trusted`, (tone === "positive") === TRUSTED_POSITIVE.has(s));
  // Danger states.
  if (s === "revoked" || s === "invalid") {
    check(`status ${s} is danger`, tone === "danger");
  } else if (s === "active") {
    check(`status ${s} is positive`, tone === "positive");
  } else {
    check(`status ${s} is warning/neutral (not positive)`, tone !== "positive");
  }
}

// Sensitivity matrix.
for (const sens of SENSITIVITIES) {
  const tone = sensitivityTone(sens);
  // unknown must NEVER be positive.
  check(`sensitivity ${sens} not positive when unknown`, sens === "unknown" ? tone !== "positive" : true);
  // public is the only explicitly safe sensitivity.
  check(`sensitivity ${sens} positive iff public`, (tone === "positive") === (sens === "public"));
  check(`sensitivity label preserved`, sensitivityLabel(sens) === sens);
}

// Determinism: 50 calls each produce identical tone.
for (const s of STATUSES) {
  const baseline = statusDisplay(s).tone;
  let deterministic = true;
  for (let i = 0; i < 50; i++) {
    if (statusDisplay(s).tone !== baseline) deterministic = false;
  }
  check(`status ${s} deterministic tone`, deterministic);
}

// Fingerprint truncation honesty.
check("truncate empty -> dash", truncateFingerprint(undefined) === "—");
check("truncate short -> as-is", truncateFingerprint("sha256:abc") === "sha256:abc");
const longFp = "sha256:" + "a".repeat(64);
const t = truncateFingerprint(longFp);
check("truncate long keeps ellipsis", t.includes("…"));
check("truncate long not full length", t.length < longFp.length);
check("truncate long starts with prefix", t.startsWith("sha256:"));

// Tone set completeness: every tone value is one of the four.
const validTones: Tone[] = ["positive", "warning", "danger", "neutral"];
for (const s of STATUSES) {
  check(`status ${s} tone valid`, validTones.includes(statusDisplay(s).tone));
}
for (const sens of SENSITIVITIES) {
  check(`sensitivity ${sens} tone valid`, validTones.includes(sensitivityTone(sens)));
}

process.stdout.write(`\nMWT-6-UI regression: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
