// MWT-6-UI — Memory Governance Panel smoke (deterministic, no backend).
//
// Validates the honest status rendering contract used by the UI panel:
//   - active renders positive
//   - limited / expired / legacy / unverified render warning (never positive)
//   - revoked / invalid render danger (never positive)
//   - unknown sensitivity is NOT shown as public
//   - Trust Spine refs are preserved by the fixtures
//   - no backend/network dependency
//
// Run: npx tsx scripts/mwt6/run-memory-governance-ui-smoke.mts

import {
  statusDisplay,
  sensitivityTone,
  type Tone,
} from "../../frontend/src/components/memory/memory-governance-status";
import {
  fixtureByName,
  activeSessionMemory,
  sensitiveLongTermLimited,
  expiredMemory,
  revokedMemory,
  legacyImported,
  invalidMissingScope,
  evidenceReviewLinked,
} from "../../frontend/src/components/memory/__fixtures__/memory-governance";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    passed++;
    process.stdout.write(`  ✅ ${name}\n`);
  } else {
    failed++;
    process.stdout.write(`  ❌ ${name}\n`);
  }
}

// 1. active renders positive
check("active renders positive", statusDisplay(activeSessionMemory.status).tone === "positive");

// 2. limited renders warning
check(
  "sensitive long-term renders limited/warning",
  sensitiveLongTermLimited.status === "limited" &&
    statusDisplay(sensitiveLongTermLimited.status).tone === "warning",
);

// 3. expired not positive
check(
  "expired not positive",
  expiredMemory.status === "expired" && statusDisplay(expiredMemory.status).tone !== "positive",
);

// 4. revoked renders danger
check(
  "revoked renders danger",
  revokedMemory.status === "revoked" && statusDisplay(revokedMemory.status).tone === "danger",
);

// 5. legacy renders warning
check(
  "legacy renders warning",
  legacyImported.status === "legacy" && statusDisplay(legacyImported.status).tone === "warning",
);

// 6. unverified renders warning (use a fixture-like status check via mapping)
check(
  "unverified renders warning",
  statusDisplay("unverified").tone === "warning",
);

// 7. invalid renders danger
check(
  "invalid renders danger",
  invalidMissingScope.status === "invalid" &&
    statusDisplay(invalidMissingScope.status).tone === "danger",
);

// 8. warnings are present on untrusted fixtures
check("sensitive limited has warning", sensitiveLongTermLimited.warnings.length > 0);
check("legacy has warning", legacyImported.warnings.length > 0);
check("revoked has warning", revokedMemory.warnings.length > 0);
check("invalid has warning", invalidMissingScope.warnings.length > 0);

// 9. trust refs preserved on evidence/review linked fixture
check(
  "evidence/review linked preserves refs",
  evidenceReviewLinked.trust_refs.evidence_report_id === "rpt_linked_07" &&
    evidenceReviewLinked.trust_refs.approval_id === "apr_linked_07" &&
    evidenceReviewLinked.trust_refs.review_id === "rv_linked_07" &&
    !!evidenceReviewLinked.trust_refs.evidence_fingerprint &&
    !!evidenceReviewLinked.trust_refs.binding_fingerprint,
);

// 10. unknown sensitivity not shown as public
check("unknown sensitivity not public", sensitivityTone("unknown") !== "positive");

// 11. no backend/network dependency — implicit: this script imports no api/lib calls.

// 12. fixtureByName covers all 7 required states
check(
  "fixtureByName covers 7 states",
  ["active", "limited", "expired", "revoked", "legacy", "invalid", "evidenceReviewLinked"].every(
    (k) => fixtureByName[k] !== undefined,
  ),
);

// Negative invariant: NO untrusted status maps to positive.
const untrusted: Tone[] = [
  statusDisplay("limited").tone,
  statusDisplay("expired").tone,
  statusDisplay("revoked").tone,
  statusDisplay("legacy").tone,
  statusDisplay("unverified").tone,
  statusDisplay("invalid").tone,
];
check("no untrusted status maps to positive", !untrusted.includes("positive"));

process.stdout.write(`\nMWT-6-UI smoke: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
