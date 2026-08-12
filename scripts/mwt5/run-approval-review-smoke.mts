// MWT-5R Approval Review Replay — smoke test.
// Validates behavior examples: valid signed approval, rejected, tampered,
// evidence mismatch, task mismatch, legacy unsigned, missing data, determinism.
// No backend / network dependencies.

import { generateIdentity, webCryptoVerify } from "../../src/services/identity/local-identity.ts";
import { signSignedApproval } from "../../src/services/mwt5/signed-approval.ts";
import { buildTaskEvidenceReport } from "../../src/services/mwt4/task-evidence-report.ts";
import { buildApprovalReviewReplay } from "../../src/services/mwt5/approval-review-replay.ts";
import type { SignedApprovalRecord, UnsignedApprovalRecord } from "../../src/services/mwt5/signed-approval-types.ts";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  [PASS] ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  [FAIL] ${name} ${extra}`);
  }
}

async function makeApprover(id: string) {
  const ident = await generateIdentity(id, "2026-08-12T00:00:00Z");
  return { pub: ident.public_key_pem, priv: ident.private_key_pem };
}

async function main(): Promise<void> {
  console.log("MWT-5R Approval Review Replay — smoke");

  const alice = await makeApprover("alice");

  const approvalInput = {
    schema_version: "mwt5-adv-1",
    approver_id: "alice",
    target_ref: "task-1",
    decision: "approved" as const,
    note: "looks good",
    created_at: "2026-08-12T00:00:00Z",
  };
  const signed = (await signSignedApproval(approvalInput, alice.priv, {
    publicKeyPem: alice.pub,
  })) as SignedApprovalRecord;

  async function makeReport(taskId = "task-1", subject = "task with signed approval") {
    return await buildTaskEvidenceReport(
      {
        report_id: "R-1",
        generated_at: "2026-08-12T00:00:00Z",
        subject,
        task_id: taskId,
        approval: {
          schema_version: "mwt5-adv-1",
          approver_id: "alice",
          target_ref: taskId,
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
  }

  // 1. Valid signed approval + matching report
  {
    const report = await makeReport("task-1");
    const r = await buildApprovalReviewReplay({ approval: signed, report, publicKeyPem: alice.pub });
    check("1. valid approved: conclusion approved_verified", r.conclusion === "approved_verified");
    check("1b. valid approved: provenance linked", r.provenance_status === "linked");
    check("1c. valid approved: verification verified", r.approval_verification_status === "verified");
    check("1d. valid approved: binding_fingerprint present", !!r.binding_fingerprint);
    check("1e. valid approved: approver alice", r.approver_id === "alice");
  }

  // 2. Signed reject + matching report
  {
    const rejectInput = { ...approvalInput, decision: "rejected" as const };
    const rejectSigned = (await signSignedApproval(rejectInput, alice.priv, {
      publicKeyPem: alice.pub,
    })) as SignedApprovalRecord;
    const report = await makeReport("task-1");
    const r = await buildApprovalReviewReplay({ approval: rejectSigned, report, publicKeyPem: alice.pub });
    check("2. signed reject: conclusion rejected_verified", r.conclusion === "rejected_verified");
    check("2b. signed reject: provenance linked", r.provenance_status === "linked");
  }

  // 3. Tampered approval (signature no longer verifies)
  {
    const tampered = { ...signed, note: "modified after signing" } as SignedApprovalRecord;
    const report = await makeReport("task-1");
    const r = await buildApprovalReviewReplay({ approval: tampered, report, publicKeyPem: alice.pub });
    check("3. tampered: verification unverified", r.approval_verification_status === "unverified");
    check("3b. tampered: conclusion approved_unverified", r.conclusion === "approved_unverified");
    check("3c. tampered: warning present", r.warnings.some((w) => w.includes("signature_unverified")));
  }

  // 4. Evidence fingerprint mismatch (report tampered after a link was bound)
  {
    const original = await makeReport("task-1", "original subject");
    // Persisted link is built once against the original, honest report.
    const { buildEvidenceApprovalProvenanceLink } = await import("../../src/services/mwt4/provenance-binding.ts");
    const link = await buildEvidenceApprovalProvenanceLink(original, signed, {
      publicKeyPem: alice.pub,
      verifyFn: webCryptoVerify,
    });
    // Tamper: rebuild the report so its integrity fingerprint actually changes.
    const tamperedReport = await makeReport("task-1", "changed subject");
    const r = await buildApprovalReviewReplay({
      approval: signed,
      report: tamperedReport,
      provenanceLink: link,
      publicKeyPem: alice.pub,
    });
    check("4. evidence mismatch: provenance mismatch", r.provenance_status === "mismatch");
    check("4b. evidence mismatch: conclusion mismatch", r.conclusion === "mismatch");
    check("4c. evidence mismatch: warning present", r.warnings.some((w) => w.includes("provenance_mismatch")));
  }

  // 5. Different task_id (approval target_ref vs report task_id)
  {
    const otherApproval = (await signSignedApproval(
      { ...approvalInput, target_ref: "task-999" },
      alice.priv,
      { publicKeyPem: alice.pub },
    )) as SignedApprovalRecord;
    const report = await makeReport("task-1");
    const r = await buildApprovalReviewReplay({ approval: otherApproval, report, publicKeyPem: alice.pub });
    check("5. task mismatch: provenance mismatch", r.provenance_status === "mismatch");
    check("5b. task mismatch: conclusion mismatch", r.conclusion === "mismatch");
    check("5c. task mismatch: warning present", r.warnings.some((w) => w.includes("task_divergence")));
  }

  // 6. Legacy unsigned approval
  {
    const unsigned = { ...approvalInput } as UnsignedApprovalRecord;
    const report = await makeReport("task-1");
    const r = await buildApprovalReviewReplay({ approval: unsigned, report });
    check("6. legacy: conclusion legacy_unsigned", r.conclusion === "legacy_unsigned");
    check("6b. legacy: verification legacy_unsigned", r.approval_verification_status === "legacy_unsigned");
    check("6c. legacy: warning present", r.warnings.some((w) => w.includes("legacy_unsigned")));
  }

  // 7. Missing approval
  {
    const report = await makeReport("task-1");
    const r = await buildApprovalReviewReplay({ report });
    check("7. missing approval: conclusion unavailable", r.conclusion === "unavailable");
    check("7b. missing approval: warning present", r.warnings.some((w) => w.includes("approval_missing")));
  }

  // 8. Missing report
  {
    const r = await buildApprovalReviewReplay({ approval: signed, publicKeyPem: alice.pub });
    check("8. missing report: conclusion unavailable", r.conclusion === "unavailable");
    check("8b. missing report: warning present", r.warnings.some((w) => w.includes("evidence_report_missing")));
  }

  // 9. Determinism
  {
    const report = await makeReport("task-1");
    const a = await buildApprovalReviewReplay({ approval: signed, report, publicKeyPem: alice.pub });
    const b = await buildApprovalReviewReplay({ approval: signed, report, publicKeyPem: alice.pub });
    check("9. determinism: same review_id", a.review_id === b.review_id);
    check("9b. determinism: same conclusion", a.conclusion === b.conclusion);
    check("9c. determinism: same warnings", JSON.stringify(a.warnings) === JSON.stringify(b.warnings));
  }

  console.log(`\nMWT-5R smoke result: ${pass} pass / ${fail} fail`);
  if (fail > 0) {
    console.log("Failures: " + failures.join(", "));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
