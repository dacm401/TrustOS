// MWT-4F — Evidence ↔ Approval Provenance Binding v0 smoke.
//
// Behavior examples (PM-required):
//   1. valid signed approval + matching report → linked
//   2. tampered evidence report fingerprint → mismatch
//   3. tampered signed approval decision → unverified
//   4. approval for different task_id → mismatch
//   5. legacy unsigned approval → link built, warning, not verified
//   6. missing approval → unavailable
//   7. missing report fingerprint → mismatch (with warning)
//   8. determinism: same report + approval → same binding_fingerprint
//
// No backend / no network. Reuses MWT-4 Mainline report + MWT-5+ signed approval.

import { generateIdentity, webCryptoVerify } from "../../src/services/identity/local-identity.ts";
import { signSignedApproval } from "../../src/services/mwt5/signed-approval.ts";
import { buildTaskEvidenceReport } from "../../src/services/mwt4/task-evidence-report.ts";
import {
  buildEvidenceApprovalProvenanceLink,
  verifyEvidenceApprovalBinding,
} from "../../src/services/mwt4/provenance-binding.ts";

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
  const ident = await generateIdentity(id, "2026-08-12T00:00:00Z");
  return { pub: ident.public_key_pem, priv: ident.private_key_pem };
}

async function main(): Promise<void> {
  const alice = await makeApprover("alice");

  const approvalInput = {
    schema_version: "mwt5-adv-1",
    approver_id: "alice",
    target_ref: "task-1",
    decision: "approved" as const,
    note: "looks good",
    created_at: "2026-08-12T00:00:00Z",
  };
  const signed = await signSignedApproval(approvalInput, alice.priv, { publicKeyPem: alice.pub });

  const report = await buildTaskEvidenceReport(
    {
      report_id: "R-1",
      generated_at: "2026-08-12T00:00:00Z",
      subject: "task with signed approval",
      task_id: "task-1",
      approval: {
        schema_version: "mwt5-adv-1",
        approver_id: "alice",
        target_ref: "task-1",
        decision: "approved",
        note: "looks good",
        ts: "2026-08-12T00:00:00Z",
        evidence_refs: [],
        signature: {
          signer_id: "alice",
          public_key_fingerprint: alice.pub,
          algo: "Ed25519" as const,
          signature: signed.signature!.signature,
        },
      },
      approver_public_key_pem: alice.pub,
    },
    { verifyFn: webCryptoVerify },
  );

  // 1. valid signed approval + matching report → linked
  const link1 = await buildEvidenceApprovalProvenanceLink(report, signed, { publicKeyPem: alice.pub, verifyFn: webCryptoVerify });
  const v1 = await verifyEvidenceApprovalBinding(link1, report, signed, { publicKeyPem: alice.pub, verifyFn: webCryptoVerify });
  check("1. valid + matching → linked", v1.status === "linked", `got ${v1.status}`);
  check("1b. binding_fingerprint present", !!link1.binding_fingerprint);

  // 2. tampered evidence report fingerprint → mismatch
  const tamperedReport = { ...report, integrity: { ...report.integrity, fingerprint: "deadbeef" } };
  const v2 = await verifyEvidenceApprovalBinding(link1, tamperedReport, signed, { publicKeyPem: alice.pub, verifyFn: webCryptoVerify });
  check("2. tampered fingerprint → mismatch", v2.status === "mismatch", `got ${v2.status}`);
  check("2b. mismatch reason mentions fingerprint", v2.reasons.some((r) => /fingerprint/.test(r)));

  // 3. tampered signed approval decision → unverified
  const tamperedApproval = { ...signed, decision: "rejected" as const };
  const v3 = await verifyEvidenceApprovalBinding(link1, report, tamperedApproval, { publicKeyPem: alice.pub, verifyFn: webCryptoVerify });
  check("3. tampered approval → unverified", v3.status === "unverified", `got ${v3.status}`);

  // 4. approval for different task_id → mismatch
  const otherTaskApproval = await signSignedApproval(
    { ...approvalInput, target_ref: "task-999" },
    alice.priv,
    { publicKeyPem: alice.pub },
  );
  // Build a link for the OTHER task's report context to expose mismatch.
  const otherReport = { ...report, task_id: "task-999" };
  const link4 = await buildEvidenceApprovalProvenanceLink(otherReport, otherTaskApproval, { publicKeyPem: alice.pub, verifyFn: webCryptoVerify });
  // Now verify the original report (task-1) against a link built for task-999 → mismatch.
  const v4 = await verifyEvidenceApprovalBinding(link4, report, otherTaskApproval, { publicKeyPem: alice.pub, verifyFn: webCryptoVerify });
  check("4. different task_id → mismatch", v4.status === "mismatch", `got ${v4.status}`);

  // 5. legacy unsigned approval → link built, warning, not verified
  const legacy = { ...approvalInput };
  const link5 = await buildEvidenceApprovalProvenanceLink(report, legacy, { verifyFn: webCryptoVerify });
  const v5 = await verifyEvidenceApprovalBinding(link5, report, legacy, { verifyFn: webCryptoVerify });
  check("5. legacy → unverified (not fake verified)", v5.status === "unverified", `got ${v5.status}`);
  check("5b. legacy warning present", v5.warnings.some((w) => /legacy|unsigned/i.test(w)));

  // 6. missing approval → unavailable
  const v6 = await verifyEvidenceApprovalBinding(link1, report, undefined as never, { publicKeyPem: alice.pub, verifyFn: webCryptoVerify });
  check("6. missing approval → unavailable", v6.status === "unavailable", `got ${v6.status}`);

  // 7. missing report fingerprint → mismatch with warning
  const noFpReport = { ...report, integrity: { ...report.integrity, fingerprint: "" } };
  const v7 = await verifyEvidenceApprovalBinding(link1, noFpReport, signed, { publicKeyPem: alice.pub, verifyFn: webCryptoVerify });
  check("7. missing fingerprint → mismatch", v7.status === "mismatch", `got ${v7.status}`);
  check("7b. missing fingerprint warning", v7.warnings.some((w) => /fingerprint/i.test(w)));

  // 8. determinism
  const linkA = await buildEvidenceApprovalProvenanceLink(report, signed, { publicKeyPem: alice.pub, verifyFn: webCryptoVerify });
  const linkB = await buildEvidenceApprovalProvenanceLink(report, signed, { publicKeyPem: alice.pub, verifyFn: webCryptoVerify });
  check("8. determinism (same binding_fingerprint)", linkA.binding_fingerprint === linkB.binding_fingerprint);

  console.log(`\nMWT-4F Provenance smoke: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("FAILED: " + fails.join(", "));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("smoke crashed:", e);
  process.exit(1);
});
