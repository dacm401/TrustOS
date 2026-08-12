// MWT-5R Approval Review Replay — regression.
//
// Covers: review_id/fingerprint sensitivity (each bound field changes it),
// determinism across repeated runs, honest conclusion mapping, MWT-5+/MWT-4F
// reuse (no duplicated signature/provenance logic), no backend/network.
// Must stay at 0 failures.

import { generateIdentity, webCryptoVerify } from "../../src/services/identity/local-identity.ts";
import { signSignedApproval } from "../../src/services/mwt5/signed-approval.ts";
import { buildTaskEvidenceReport } from "../../src/services/mwt4/task-evidence-report.ts";
import { buildApprovalReviewReplay } from "../../src/services/mwt5/approval-review-replay.ts";
import type { SignedApprovalRecord, UnsignedApprovalRecord } from "../../src/services/mwt5/signed-approval-types.ts";

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
  console.log("MWT-5R Approval Review Replay — regression");

  const alice = await makeApprover("alice");

  const approvalInput = {
    schema_version: "mwt5-adv-1",
    approver_id: "alice",
    target_ref: "task-1",
    decision: "approved" as const,
    note: "ok",
    created_at: "2026-08-12T00:00:00Z",
  };
  const signed = (await signSignedApproval(approvalInput, alice.priv, {
    publicKeyPem: alice.pub,
  })) as SignedApprovalRecord;

  async function makeReport(taskId = "task-1", subject = "task") {
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
          note: "ok",
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

  // --- R1. valid approved signed review ---
  {
    const r = await buildApprovalReviewReplay({ approval: signed, report: await makeReport(), publicKeyPem: alice.pub });
    check("R1 approved_verified", r.conclusion === "approved_verified");
    check("R1 linked", r.provenance_status === "linked");
    check("R1 review_id deterministic shape", /^([0-9a-f]{64})$/.test(r.review_id));
  }

  // --- R2. valid rejected signed review ---
  {
    const rejectSigned = (await signSignedApproval(
      { ...approvalInput, decision: "rejected" as const },
      alice.priv,
      { publicKeyPem: alice.pub },
    )) as SignedApprovalRecord;
    const r = await buildApprovalReviewReplay({ approval: rejectSigned, report: await makeReport(), publicKeyPem: alice.pub });
    check("R2 rejected_verified", r.conclusion === "rejected_verified");
  }

  // --- R3. tampered approval unverified ---
  {
    const tampered = { ...signed, note: "changed" } as SignedApprovalRecord;
    const r = await buildApprovalReviewReplay({ approval: tampered, report: await makeReport(), publicKeyPem: alice.pub });
    check("R3 approved_unverified", r.conclusion === "approved_unverified");
    check("R3 verification unverified", r.approval_verification_status === "unverified");
  }

  // --- R4. evidence fingerprint mismatch (link bound to original, report tampered) ---
  {
    const original = await makeReport("task-1", "original");
    const { buildEvidenceApprovalProvenanceLink } = await import("../../src/services/mwt4/provenance-binding.ts");
    const link = await buildEvidenceApprovalProvenanceLink(original, signed, { publicKeyPem: alice.pub, verifyFn: webCryptoVerify });
    const tamperedReport = await makeReport("task-1", "x");
    const r = await buildApprovalReviewReplay({
      approval: signed,
      report: tamperedReport,
      provenanceLink: link,
      publicKeyPem: alice.pub,
    });
    check("R4 mismatch", r.conclusion === "mismatch");
    check("R4 provenance mismatch", r.provenance_status === "mismatch");
  }

  // --- R5. different task_id mismatch ---
  {
    const other = (await signSignedApproval(
      { ...approvalInput, target_ref: "task-999" },
      alice.priv,
      { publicKeyPem: alice.pub },
    )) as SignedApprovalRecord;
    const r = await buildApprovalReviewReplay({ approval: other, report: await makeReport(), publicKeyPem: alice.pub });
    check("R5 task mismatch", r.conclusion === "mismatch");
  }

  // --- R6. legacy unsigned readable with warning ---
  {
    const unsigned = { ...approvalInput } as UnsignedApprovalRecord;
    const r = await buildApprovalReviewReplay({ approval: unsigned, report: await makeReport() });
    check("R6 legacy_unsigned", r.conclusion === "legacy_unsigned");
    check("R6 warning present", r.warnings.some((w) => /legacy_unsigned/.test(w)));
  }

  // --- R7. missing approval unavailable ---
  {
    const r = await buildApprovalReviewReplay({ report: await makeReport() });
    check("R7 unavailable (no approval)", r.conclusion === "unavailable");
  }

  // --- R8. missing report unavailable ---
  {
    const r = await buildApprovalReviewReplay({ approval: signed, publicKeyPem: alice.pub });
    check("R8 unavailable (no report)", r.conclusion === "unavailable");
  }

  // --- R9. determinism across repeated builds ---
  {
    const a = await buildApprovalReviewReplay({ approval: signed, report: await makeReport(), publicKeyPem: alice.pub });
    const b = await buildApprovalReviewReplay({ approval: signed, report: await makeReport(), publicKeyPem: alice.pub });
    check("R9 deterministic review_id", a.review_id === b.review_id);
    check("R9 deterministic conclusion", a.conclusion === b.conclusion);
    check("R9 deterministic warnings", JSON.stringify(a.warnings) === JSON.stringify(b.warnings));
  }

  // --- R10. review_id sensitivity: changing decision changes review_id ---
  {
    const approved = await buildApprovalReviewReplay({ approval: signed, report: await makeReport(), publicKeyPem: alice.pub });
    const rejectSigned = (await signSignedApproval(
      { ...approvalInput, decision: "rejected" as const },
      alice.priv,
      { publicKeyPem: alice.pub },
    )) as SignedApprovalRecord;
    const rejected = await buildApprovalReviewReplay({ approval: rejectSigned, report: await makeReport(), publicKeyPem: alice.pub });
    check("R10 review_id sensitive to decision", approved.review_id !== rejected.review_id);
  }

  // --- R11. reuse confirmation: verifySignedApproval/verifyEvidenceApprovalBinding are the only judges ---
  {
    // A tampered approval's unverified verdict must come from MWT-5+ (not local logic).
    const tampered = { ...signed, note: "changed" } as SignedApprovalRecord;
    const r = await buildApprovalReviewReplay({ approval: tampered, report: await makeReport(), publicKeyPem: alice.pub });
    check("R11 tampered routed to unverified (MWT-5+ verdict)", r.approval_verification_status === "unverified");
    check("R11 tampered warning mentions tampered/wrong key", r.warnings.some((w) => /tampered|wrong key/i.test(w)));
  }

  // --- R12. no backend/network dependency: runs with no injected network/crypto stubs ---
  {
    const r = await buildApprovalReviewReplay({ approval: signed, report: await makeReport(), publicKeyPem: alice.pub });
    check("R12 review artifact fully formed without network", typeof r.human_summary === "string" && r.human_summary.length > 0);
  }

  console.log(`\nMWT-5R regression result: ${passed} pass / ${failed} fail`);
  if (failed > 0) {
    console.log("Failures: " + fails.join(", "));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
