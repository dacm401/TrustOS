// MWT-5+ — Signed Approval Dry-run v0 smoke (behavior examples).
//
// Covers PM-required behavior examples:
//   valid signed approval (verified)
//   tampered decision (unverified)
//   signer/approver mismatch (unverified + warning)
//   legacy unsigned (legacy_unsigned, no crash)
//   missing public key (unverified + warning)
//   canonical body deterministic
//   evidence report consumes verification result
//
// No backend / no network. Reuses MWT-4E local-identity + MWT-4 Mainline report.

import { generateIdentity, webCryptoSign, webCryptoVerify } from "../../src/services/identity/local-identity.ts";
import {
  signSignedApproval,
  verifySignedApproval,
  signedApprovalCanonicalBody,
  toApprovalRecordLike,
} from "../../src/services/mwt5/signed-approval.ts";
import { buildTaskEvidenceReport } from "../../src/services/mwt4/task-evidence-report.ts";

let passed = 0;
let failed = 0;
const fails: string[] = [];

function check(name: string, cond: boolean, extra = ""): void {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    fails.push(name);
    console.log(`  ❌ ${name} ${extra}`);
  }
}

async function makeApprover(id: string) {
  const ident = await generateIdentity(id, "2026-08-11T00:00:00Z");
  return { ident, pub: ident.public_key_pem, priv: ident.private_key_pem };
}

async function main(): Promise<void> {
  const alice = await makeApprover("alice");
  const bob = await makeApprover("bob");

  const unsigned = {
    schema_version: "mwt5-adv-1",
    approver_id: "alice",
    target_ref: "task-1",
    decision: "approved" as const,
    note: "looks good",
    created_at: "2026-08-11T00:00:00Z",
  };

  // 1. sign produces envelope
  const signed = await signSignedApproval(unsigned, alice.priv, { publicKeyPem: alice.pub });
  check("1. sign produces envelope", !!signed.signature && signed.signature.algorithm === "Ed25519");
  check("1b. envelope signer_id === approver_id", signed.signature!.signer_id === "alice");

  // 2. verify valid signed approval → verified
  const v2 = await verifySignedApproval(signed, alice.pub, { verifyFn: webCryptoVerify });
  check("2. valid signed → verified", v2.status === "verified", `got ${v2.status}`);
  check("2b. signer matches approver", v2.signer_matches_approver === true);

  // 3. tampered decision → unverified
  const tampered = { ...signed, decision: "rejected" as const };
  const v3 = await verifySignedApproval(tampered, alice.pub, { verifyFn: webCryptoVerify });
  check("3. tampered decision → unverified", v3.status === "unverified", `got ${v3.status}`);
  check("3b. tampered → warning", v3.warnings.some((w) => /FAILED/.test(w)));

  // 4. signer mismatch → unverified + warning
  const signedByBob = await signSignedApproval(
    { ...unsigned, approver_id: "alice" },
    bob.priv,
    { publicKeyPem: bob.pub },
  );
  // force signer_id to bob so approver_id (alice) != signer_id (bob)
  signedByBob.signature!.signer_id = "bob";
  const v4 = await verifySignedApproval(signedByBob, bob.pub, { verifyFn: webCryptoVerify });
  check("4. signer/approver mismatch → unverified", v4.status === "unverified", `got ${v4.status}`);
  check("4b. mismatch warning present", v4.warnings.some((w) => /does not match/.test(w)));
  check("4c. signer_matches_approver false", v4.signer_matches_approver === false);

  // 5. legacy unsigned → legacy_unsigned, no crash
  const v5 = await verifySignedApproval(unsigned);
  check("5. legacy unsigned → legacy_unsigned", v5.status === "legacy_unsigned", `got ${v5.status}`);
  check("5b. legacy warning present", v5.warnings.some((w) => /legacy/.test(w)));

  // 6. missing public key → unverified + warning
  const v6 = await verifySignedApproval(signed);
  check("6. missing public key → unverified", v6.status === "unverified", `got ${v6.status}`);
  check("6b. missing key warning present", v6.warnings.some((w) => /public key/.test(w)));

  // 7. canonical body deterministic
  const bodyA = signedApprovalCanonicalBody(unsigned);
  const bodyB = signedApprovalCanonicalBody({ ...unsigned });
  check("7. canonical body deterministic", bodyA === bodyB);
  check("7b. canonical body excludes signature", !bodyA.includes("signature") && !bodyA.includes("signer_id"));

  // 8. evidence report with signed approval → approver verified
  const reportSigned = await buildTaskEvidenceReport(
    {
      report_id: "R-MWT5-1",
      generated_at: "2026-08-11T00:00:00Z",
      subject: "task with signed approval",
      approval: toApprovalRecordLike(signed),
      approver_public_key_pem: alice.pub,
    },
    { verifyFn: webCryptoVerify },
  );
  check("8. report approver verified", reportSigned.approver.verification === "verified", `got ${reportSigned.approver.verification}`);

  // 9. evidence report with tampered approval → warning included
  const reportTampered = await buildTaskEvidenceReport(
    {
      report_id: "R-MWT5-2",
      generated_at: "2026-08-11T00:00:00Z",
      subject: "task with tampered approval",
      approval: toApprovalRecordLike(tampered),
      approver_public_key_pem: alice.pub,
    },
    { verifyFn: webCryptoVerify },
  );
  check("9. report tampered → unverified", reportTampered.approver.verification === "unverified", `got ${reportTampered.approver.verification}`);
  check("9b. report tampered warning", reportTampered.warnings.some((w) => /FAILED/.test(w)));

  // 10. evidence report with legacy unsigned → legacy_unsigned
  const reportLegacy = await buildTaskEvidenceReport(
    {
      report_id: "R-MWT5-3",
      generated_at: "2026-08-11T00:00:00Z",
      subject: "task with legacy approval",
      approval: toApprovalRecordLike(unsigned),
    },
    { verifyFn: webCryptoVerify },
  );
  check("10. report legacy → legacy_unsigned", reportLegacy.approver.verification === "legacy_unsigned", `got ${reportLegacy.approver.verification}`);

  console.log(`\nMWT-5+ Signed Approval smoke: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("FAILED: " + fails.join(", "));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("smoke crashed:", e);
  process.exit(1);
});
