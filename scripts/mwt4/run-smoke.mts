// MWT-4 Mainline — Task Evidence Report smoke (8/0 expected).
//
// Covers PM-required behavior examples: signed verification, tampered detection,
// legacy unsigned, no-approval, delegated metadata, clarification honesty, missing
// optional fields, deterministic fingerprint. No backend / no network.

import { generateIdentity, signBody, webCryptoSign, webCryptoVerify } from "../../src/services/identity/local-identity.ts";
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

async function signedApproval(approverId: string, decision: "approved" | "rejected" | "noted" = "approved") {
  const id = await generateIdentity(approverId, "2026-08-11T00:00:00Z");
  const rec = buildApprovalRecordSync(
    {
      approver_id: approverId,
      target_ref: "task-1",
      decision,
      ts: "2026-08-11T00:00:00Z",
      prev_hash: "",
      seq: 1,
    },
    (b) => b, // hashFn unused for signature; any stable fn works
  );
  const sig = await signBody(id.private_key_pem, approvalCanonicalBody(rec), webCryptoSign);
  const withSig: ApprovalRecord = {
    ...rec,
    signature: {
      signer_id: approverId,
      public_key_fingerprint: id.descriptor.public_key_fingerprint,
      algo: "Ed25519",
      signature: sig,
    },
  };
  return { rec: withSig, pub: id.public_key_pem, fp: id.descriptor.public_key_fingerprint };
}

async function main(): Promise<void> {
  // 1. minimal task → report generated, no crash
  const r1 = await buildTaskEvidenceReport({
    report_id: "R-1",
    generated_at: "2026-08-11T00:00:00Z",
    subject: "minimal task",
  });
  check("1. minimal task report generated", r1.report_id === "R-1" && r1.approval_status === "not_required");

  // 2. signed identity verified
  const a = await signedApproval("approver-alice");
  const r2 = await buildTaskEvidenceReport({
    report_id: "R-2",
    generated_at: "2026-08-11T00:00:00Z",
    subject: "signed task",
    approval: a.rec,
    approver_public_key_pem: a.pub,
  }, { verifyFn: webCryptoVerify });
  check("2. signed approval → approver verified", r2.approver.verification === "verified", `got ${r2.approver.verification}`);
  check("2b. fingerprint present", typeof r2.integrity.fingerprint === "string" && r2.integrity.fingerprint.length > 0);

  // 3. tampered signed record → unverified + warning
  const tampered: ApprovalRecord = {
    ...a.rec,
    note: "I WAS TAMPERED",
  };
  const r3 = await buildTaskEvidenceReport({
    report_id: "R-3",
    generated_at: "2026-08-11T00:00:00Z",
    subject: "tampered task",
    approval: tampered,
    approver_public_key_pem: a.pub,
  }, { verifyFn: webCryptoVerify });
  check("3. tampered → unverified", r3.approver.verification === "unverified", `got ${r3.approver.verification}`);
  check("3b. tampered → warning present", r3.warnings.some((w) => /FAILED/.test(w)));

  // 4. legacy unsigned approval → legacy_unsigned + warning
  const legacy = buildApprovalRecordSync(
    { approver_id: "bob", target_ref: "task-x", decision: "approved", ts: "2026-08-11T00:00:00Z", prev_hash: "", seq: 1 },
    (b) => b,
  );
  const r4 = await buildTaskEvidenceReport({
    report_id: "R-4",
    generated_at: "2026-08-11T00:00:00Z",
    subject: "legacy task",
    approval: legacy,
  }, { verifyFn: webCryptoVerify });
  check("4. legacy unsigned → legacy_unsigned", r4.approver.verification === "legacy_unsigned", `got ${r4.approver.verification}`);
  check("4b. legacy → warning present", r4.warnings.some((w) => /legacy/.test(w)));

  // 5. deterministic fingerprint stable across two builds
  const in5 = {
    report_id: "R-5",
    task_id: "t-5",
    generated_at: "2026-08-11T00:00:00Z",
    subject: "deterministic",
    inputs: ["in"],
    outputs: ["out"],
    evidence: [{ kind: "event", ref_id: "ev-1" }],
  };
  const r5a = await buildTaskEvidenceReport(in5);
  const r5b = await buildTaskEvidenceReport(in5);
  check("5. fingerprint deterministic", r5a.integrity.fingerprint === r5b.integrity.fingerprint, `${r5a.integrity.fingerprint} vs ${r5b.integrity.fingerprint}`);

  // 6. missing optional fields → warnings, no crash
  const r6 = await buildTaskEvidenceReport({
    report_id: "R-6",
    generated_at: "2026-08-11T00:00:00Z",
    subject: "missing fields",
  });
  check("6. missing fields → warnings", r6.warnings.length >= 2, `warnings=${r6.warnings.length}`);
  check("6b. missing fields → not_required", r6.approval_status === "not_required");

  // 7. delegated task metadata preserved
  const r7 = await buildTaskEvidenceReport({
    report_id: "R-7",
    generated_at: "2026-08-11T00:00:00Z",
    subject: "delegated task",
    routing: { route_type: "delegated", delegated_to: "agent-research", manager_decision: "delegate" },
  });
  check("7. delegated metadata preserved", r7.routing?.route_type === "delegated" && r7.routing?.delegated_to === "agent-research");
  check("7b. delegated → human summary mentions delegation", /delegated to agent-research/.test(r7.human_readable_summary));

  // 8. clarification event represented honestly (no fake completion)
  const r8 = await buildTaskEvidenceReport({
    report_id: "R-8",
    generated_at: "2026-08-11T00:00:00Z",
    subject: "clarification task",
    routing: { route_type: "ask_clarification", clarification: { question: "Which region?", requires_input: true } },
  });
  check("8. clarification represented", r8.routing?.route_type === "ask_clarification");
  check("8b. clarification → summary honest", /clarification required/.test(r8.human_readable_summary));

  console.log(`\nMWT-4 Mainline smoke: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("FAILED: " + fails.join(", "));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("smoke crashed:", e);
  process.exit(1);
});
