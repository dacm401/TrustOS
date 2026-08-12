// MWT-5R-UI — UI smoke: honest status mapping + fixture integrity.
//
// Pure-module test (no React harness). Exercises review-status.ts against the
// deterministic fixtures. Critical invariant: NO untrusted state (unverified /
// mismatch / legacy / unavailable) may ever render with a "positive/verified"
// tone. The regression suite asserts this; this smoke does a fast subset.

import {
  conclusionDisplay,
  verificationTone,
  provenanceTone,
  toneClasses,
  type Tone,
} from "../../frontend/src/components/audit/review-status";
import {
  approvedVerified,
  mismatch,
  legacyUnsigned,
  unavailable,
} from "../../frontend/src/components/audit/__fixtures__/approval-reviews";

let pass = 0;
let fail = 0;
const fails: string[] = [];

function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    fails.push(name);
  }
}

// 1. Honest tone invariant — the core MWT-5R-UI contract.
const trustedTones = new Set<Tone>(["positive"]);
const untrustedConclusions = [mismatch.conclusion, legacyUnsigned.conclusion, unavailable.conclusion];
for (const c of untrustedConclusions) {
  check(`conclusion ${c} is NOT positive`, !trustedTones.has(conclusionDisplay(c).tone));
}
check("approved_verified maps positive", conclusionDisplay(approvedVerified.conclusion).tone === "positive");

// 2. Fixture-specific tone checks.
check("mismatch → danger", conclusionDisplay(mismatch.conclusion).tone === "danger");
check("legacy_unsigned → warning", conclusionDisplay(legacyUnsigned.conclusion).tone === "warning");
check("unavailable → neutral", conclusionDisplay(unavailable.conclusion).tone === "neutral");
check("verified verification → positive", verificationTone("verified") === "positive");
check("unverified verification → warning", verificationTone("unverified") === "warning");
check("mismatch provenance → danger", provenanceTone("mismatch") === "danger");

// 3. Label honesty — no misleading "verified" wording on untrusted conclusions.
check("mismatch label honest", conclusionDisplay("mismatch").label === "Mismatch");
check("legacy label honest", conclusionDisplay("legacy_unsigned").label === "Legacy · Unsigned");

// 4. toneClasses returns a non-empty class string for every tone (panel uses it).
for (const t of ["positive", "warning", "danger", "neutral"] as Tone[]) {
  check(`toneClasses(${t}) non-empty`, toneClasses(t).length > 0);
}

// 5. Fixtures carry the fields the panel renders.
check("approvedVerified has evidence_fingerprint", !!approvedVerified.evidence_fingerprint);
check("mismatch has warnings", mismatch.warnings.length > 0);
check("legacyUnsigned flagged unverified tone", verificationTone(legacyUnsigned.approval_verification_status) === "warning");

console.log(`\n[MWT-5R-UI smoke] ${pass} PASS / ${fail} FAIL`);
if (fail > 0) {
  console.log("Failures:\n - " + fails.join("\n - "));
  process.exit(1);
}
console.log("OK: honest status mapping + fixture integrity verified.");
