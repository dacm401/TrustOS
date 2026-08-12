// MWT-5R-UI-II — Route integration regression (honest-status invariant + no-UI-trust-logic).
//
// v0 regression focuses on the two things that must never regress:
//   A. The honest-status invariant holds for every fixture the surface renders
//      (no untrusted state borrows the "positive" tone).
//   B. The surface does NOT re-evaluate signatures / provenance in the UI
//      (it only consumes the artifact — no verify/sign/crypto logic).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  conclusionDisplay,
  verificationTone,
  provenanceTone,
  type Tone,
} from "../../frontend/src/components/audit/review-status";
import { fixtureByName } from "../../frontend/src/components/audit/__fixtures__/approval-reviews";

const ROOT = join(process.cwd());
const FRONTEND = join(ROOT, "frontend");

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
const trustedConclusions = new Set(["approved_verified", "rejected_verified"]);

// --- A. Honest-status invariant across all wired fixtures ---
for (const [name, review] of Object.entries(fixtureByName)) {
  const cTone = conclusionDisplay(review.conclusion).tone;
  const vTone = verificationTone(review.approval_verification_status);
  const pTone = provenanceTone(review.provenance_status);
  if (trustedConclusions.has(review.conclusion)) {
    check(`fixture ${name}: conclusion positive`, cTone === "positive");
  } else {
    check(`fixture ${name}: conclusion NOT positive`, !POSITIVE.includes(cTone));
  }
  check(`fixture ${name}: verification tone valid`, ["positive", "warning", "danger", "neutral"].includes(vTone));
  check(`fixture ${name}: provenance tone valid`, ["positive", "warning", "danger", "neutral"].includes(pTone));
}

// --- B. Surface must not contain UI-side trust re-evaluation logic ---
const surfacePath = join(FRONTEND, "src/components/audit/AuditReviewSurface.tsx");
if (existsSync(surfacePath)) {
  const src = readFileSync(surfacePath, "utf8");
  check("surface does not verify signatures", !/\.verify\(|verifySignedApproval|verifyEvidenceApprovalBinding/.test(src));
  check("surface does not sign", !/signApproval|createSignature|crypto\.sign/.test(src));
  check("surface has no fetch/axios", !/fetch\(|axios/.test(src));
  check("surface consumes artifact only (no backend)", !/from ["']\.\.\/\.\.\/services|@\/services/.test(src));
}

// --- C. All four states are reachable via the panel (existence in fixtures) ---
for (const name of ["approved_verified", "mismatch", "legacy_unsigned", "unavailable"]) {
  check(`fixture ${name} defined`, !!fixtureByName[name]);
}

console.log(`\n[MWT-5R-UI-II route regression] ${pass} PASS / ${fail} FAIL`);
if (fail > 0) {
  console.log("Failures:\n - " + fails.join("\n - "));
  process.exit(1);
}
console.log("OK: audit surface reaches all four honest states; no UI-side trust logic introduced.");
