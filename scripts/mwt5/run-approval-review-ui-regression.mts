// MWT-5R-UI — UI regression: full honest-status matrix against review-status.ts.
//
// Exhaustive over the conclusion + verification + provenance status unions.
// Asserts the single invariant that defines the panel's honesty: untrusted
// states never borrow the "positive" tone.

import {
  conclusionDisplay,
  verificationTone,
  provenanceTone,
  truncateFingerprint,
  type Tone,
} from "../../frontend/src/components/audit/review-status";
import {
  fixtureByName,
  allFixtures,
} from "../../frontend/src/components/audit/__fixtures__/approval-reviews";
import type {
  ApprovalReviewConclusion,
  ApprovalReviewVerificationStatus,
  ApprovalReviewProvenanceStatus,
} from "../../frontend/src/types/audit";

let pass = 0;
let fail = 0;
const fails: string[] = [];
function check(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    fails.push(name);
  }
}

const POSITIVE: Tone[] = ["positive"];

// --- Exhaustive conclusion matrix ---
const conclusions: ApprovalReviewConclusion[] = [
  "approved_verified",
  "approved_unverified",
  "rejected_verified",
  "rejected_unverified",
  "legacy_unsigned",
  "mismatch",
  "unavailable",
];
const trustedConclusions = new Set<ApprovalReviewConclusion>(["approved_verified", "rejected_verified"]);
for (const c of conclusions) {
  const tone = conclusionDisplay(c).tone;
  if (trustedConclusions.has(c)) {
    check(`conclusion ${c} → positive`, tone === "positive");
  } else {
    check(`conclusion ${c} NOT positive`, !POSITIVE.includes(tone));
  }
  // label must be a non-empty string
  check(`conclusion ${c} label non-empty`, conclusionDisplay(c).label.length > 0);
}

// --- Exhaustive verification matrix ---
const verifs: ApprovalReviewVerificationStatus[] = ["verified", "unverified", "legacy_unsigned", "unavailable"];
const trustedVerif = new Set<ApprovalReviewVerificationStatus>(["verified"]);
for (const v of verifs) {
  const tone = verificationTone(v);
  if (trustedVerif.has(v)) check(`verif ${v} → positive`, tone === "positive");
  else check(`verif ${v} NOT positive`, !POSITIVE.includes(tone));
}

// --- Exhaustive provenance matrix ---
const provs: ApprovalReviewProvenanceStatus[] = ["linked", "mismatch", "unverified", "unavailable"];
const trustedProv = new Set<ApprovalReviewProvenanceStatus>(["linked"]);
for (const p of provs) {
  const tone = provenanceTone(p);
  if (trustedProv.has(p)) check(`prov ${p} → positive`, tone === "positive");
  else check(`prov ${p} NOT positive`, !POSITIVE.includes(tone));
}

// --- Fixture round-trip: every fixture maps to a valid tone + label ---
for (const f of allFixtures) {
  check(`fixture ${f.review_id} conclusion tone valid`, ["positive", "warning", "danger", "neutral"].includes(conclusionDisplay(f.conclusion).tone));
  check(`fixture ${f.review_id} verification tone valid`, ["positive", "warning", "danger", "neutral"].includes(verificationTone(f.approval_verification_status)));
  check(`fixture ${f.review_id} provenance tone valid`, ["positive", "warning", "danger", "neutral"].includes(provenanceTone(f.provenance_status)));
}

// --- Truncation honesty ---
check("truncate undefined → em dash", truncateFingerprint(undefined) === "—");
check("truncate short → unchanged", truncateFingerprint("abc") === "abc");
const fp = "sha256:" + "a".repeat(60);
const t = truncateFingerprint(fp);
check("truncate long keeps head+tail", t.startsWith("sha256:aaaaa") && t.includes("…") && t.endsWith("aaaaaaaa"));

// --- Fixture name lookup covers all four honest states ---
for (const name of ["approved_verified", "mismatch", "legacy_unsigned", "unavailable"]) {
  check(`fixtureByName has ${name}`, !!fixtureByName[name]);
}

console.log(`\n[MWT-5R-UI regression] ${pass} PASS / ${fail} FAIL`);
if (fail > 0) {
  console.log("Failures:\n - " + fails.join("\n - "));
  process.exit(1);
}
console.log("OK: full honest-status matrix holds — no untrusted state borrows 'positive'.");
