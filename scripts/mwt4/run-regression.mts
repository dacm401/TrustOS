// MWT-4 Mainline — Task Evidence Report regression (10/0 expected).
//
// Regression guards: deterministic builds, decision mapping, wrong-key rejection,
// actor fingerprint pass-through, evidence integrity, fingerprint sensitivity.

import { generateIdentity, signBody, webCryptoSign } from "../../src/services/identity/local-identity.ts";
import {
  type ApprovalRecord,
  buildApprovalRecordSync,
} from "../../frontend/src/lib/approval-record.ts";
import { buildTaskEvidenceReport, approvalCanonicalBody } from "../../src/services/mwt4/task-evidence-report.ts";

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

async function signedApproval(approverId: string) {
  const id = await generateIdentity(approverId, "2026-08-11T00:00:00Z");
  const rec = buildApprovalRecordSync(
    { approver_id: approverId, target_ref: "task-1", decision: "approved", ts: "2026-08-11T00:00:00Z", prev_hash: "", seq: 1 },
    (b) => b,
  );
  const sig = await signBody(id.private_key_pem, approvalCanonicalBody(rec), webCryptoSign);
  const withSig: ApprovalRecord = {
    ...rec,
    signature: { signer_id: approverId, public_key_fingerprint: id.descriptor.public_key_fingerprint, algo: "Ed25519", signature: sig },
  };
  return { rec: withSig, fp: id.descriptor.public_key_fingerprint, pub: id.public_key_pem };
}

// Stub verifyFn that always returns false (simulates wrong key / invalid sig).
const rejectVerify = async () => false;

async function main(): Promise<void> {
  const base = {
    report_id: "RG-1",
    generated_at: "2026-08-11T00:00:00Z",
    subject: "regression base",
    inputs: ["i"],
    outputs: ["o"],
  };

  // 1. three identical builds → identical fingerprint (determinism)
  const ra = await buildTaskEvidenceReport(base);
  const rb = await buildTaskEvidenceReport(base);
  const rc = await buildTaskEvidenceReport(base);
  check("1. determinism across 3 builds", ra.integrity.fingerprint === rb.integrity.fingerprint && rb.integrity.fingerprint === rc.integrity.fingerprint);

  // 2. decision mapping: rejected
  const rej = buildApprovalRecordSync({ approver_id: "x", target_ref: "t", decision: "rejected", ts: "2026-08-11T00:00:00Z", prev_hash: "", seq: 1 }, (b) => b);
  const r2 = await buildTaskEvidenceReport({ ...base, approval: rej });
  check("2. rejected → approval_status rejected", r2.approval_status === "rejected");

  // 3. decision mapping: noted
  const noted = buildApprovalRecordSync({ approver_id: "x", target_ref: "t", decision: "noted", ts: "2026-08-11T00:00:00Z", prev_hash: "", seq: 1 }, (b) => b);
  const r3 = await buildTaskEvidenceReport({ ...base, approval: noted });
  check("3. noted → approval_status noted", r3.approval_status === "noted");

  // 4. wrong-key verifyFn stub → unverified (no fake trust)
  const a = await signedApproval("alice");
  const r4 = await buildTaskEvidenceReport({ ...base, approval: a.rec, approver_public_key_pem: a.pub }, { verifyFn: rejectVerify });
  check("4. wrong-key stub → unverified", r4.approver.verification === "unverified", `got ${r4.approver.verification}`);

  // 5. actor fingerprint pass-through when provided
  const r5 = await buildTaskEvidenceReport({
    ...base,
    requester: { id: "carol", fingerprint: "fp-carol", verification: "verified" },
  });
  check("5. actor fingerprint pass-through", r5.actor.id === "carol" && r5.actor.fingerprint === "fp-carol");

  // 6. actor unavailable when omitted
  const r6 = await buildTaskEvidenceReport(base);
  check("6. actor unavailable when omitted", r6.actor.verification === "unavailable");

  // 7. evidence items preserved with integrity
  const r7 = await buildTaskEvidenceReport({
    ...base,
    evidence: [{ kind: "event", ref_id: "ev-9", integrity: "sha256:abc" }],
  });
  check("7. evidence item + integrity preserved", r7.evidence_items.length === 1 && r7.evidence_items[0].integrity === "sha256:abc");

  // 8. fingerprint sensitivity: different subject → different fingerprint
  const r8a = await buildTaskEvidenceReport(base);
  const r8b = await buildTaskEvidenceReport({ ...base, subject: "different subject" });
  check("8. fingerprint changes with subject", r8a.integrity.fingerprint !== r8b.integrity.fingerprint);

  // 9. signed + verified via real Web Crypto (end-to-end happy path)
  const r9 = await buildTaskEvidenceReport({ ...base, approval: a.rec, approver_public_key_pem: a.pub });
  check("9. signed verified (real crypto)", r9.approver.verification === "verified" && r9.approver.fingerprint === a.fp);

  // 10. human summary always non-empty and mentions subject
  const r10 = await buildTaskEvidenceReport(base);
  check("10. human summary non-empty + mentions subject", r10.human_readable_summary.includes(base.subject));

  console.log(`\nMWT-4 Mainline regression: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("FAILED: " + fails.join(", "));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("regression crashed:", e);
  process.exit(1);
});
