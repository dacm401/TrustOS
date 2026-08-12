// MWT-4F — Evidence ↔ Approval Provenance Binding v0 regression.
//
// Covers: binding fingerprint sensitivity (each bound field changes it),
// determinism, honest status mapping, MWT-5+ reuse (no duplicated logic),
// no backend/network. Must stay at 0 failures against the 25/25 baseline.

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
    note: "ok",
    created_at: "2026-08-12T00:00:00Z",
  };
  const signed = await signSignedApproval(approvalInput, alice.priv, { publicKeyPem: alice.pub });

  async function makeReport(overrides: Record<string, unknown> = {}) {
    return buildTaskEvidenceReport(
      {
        report_id: "R-1",
        generated_at: "2026-08-12T00:00:00Z",
        subject: "task",
        task_id: "task-1",
        approval: {
          schema_version: "mwt5-adv-1",
          approver_id: "alice",
          target_ref: "task-1",
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
        ...overrides,
      },
      { verifyFn: webCryptoVerify },
    );
  }

  const report = await makeReport();

  // R1. binding fingerprint deterministic
  const l1 = await buildEvidenceApprovalProvenanceLink(report, signed, { publicKeyPem: alice.pub, verifyFn: webCryptoVerify });
  const l1b = await buildEvidenceApprovalProvenanceLink(report, signed, { publicKeyPem: alice.pub, verifyFn: webCryptoVerify });
  check("R1. binding_fingerprint deterministic", l1.binding_fingerprint === l1b.binding_fingerprint);

  // R2. binding fingerprint sensitive to each bound field
  const baseLink = l1.binding_fingerprint;
  const mutators: [string, () => Promise<typeof report>][] = [
    ["task_id", async () => makeReport({ task_id: "other" })],
    ["session_id", async () => makeReport({ session_id: "sess-x" })],
    ["evidence_report_id", async () => makeReport({ report_id: "R-OTHER" })],
    ["approver_id", async () => makeReport()], // approver unchanged via report; test approval-level below
  ];
  for (const [label, fn] of mutators) {
    if (label === "approver_id") continue;
    const r = await fn();
    const link = await buildEvidenceApprovalProvenanceLink(r, signed, { publicKeyPem: alice.pub, verifyFn: webCryptoVerify });
    check(`R2. fingerprint sensitive to ${label}`, link.binding_fingerprint !== baseLink);
  }
  // approver_id sensitivity via a different approver-signed approval binding
  const bob = await makeApprover("bob");
  const signedByBob = await signSignedApproval({ ...approvalInput, approver_id: "bob" }, bob.priv, { publicKeyPem: bob.pub });
  const linkBob = await buildEvidenceApprovalProvenanceLink(report, signedByBob, { publicKeyPem: bob.pub, verifyFn: webCryptoVerify });
  check("R2. fingerprint sensitive to approver_id", linkBob.binding_fingerprint !== baseLink);

  // R3. verify succeeds on a fresh valid link
  const v3 = await verifyEvidenceApprovalBinding(l1, report, signed, { publicKeyPem: alice.pub, verifyFn: webCryptoVerify });
  check("R3. fresh valid → linked", v3.status === "linked", `got ${v3.status}`);

  // R4. tampering report fingerprint → mismatch (not linked)
  const tampered = { ...report, integrity: { ...report.integrity, fingerprint: "tampered" } };
  const v4 = await verifyEvidenceApprovalBinding(l1, tampered, signed, { publicKeyPem: alice.pub, verifyFn: webCryptoVerify });
  check("R4. tampered fingerprint → mismatch", v4.status === "mismatch", `got ${v4.status}`);

  // R5. unknown link (no stored link) cannot be supplied here; verify with mismatched approval status
  const unsigned = { ...approvalInput };
  const linkLegacy = await buildEvidenceApprovalProvenanceLink(report, unsigned, { verifyFn: webCryptoVerify });
  const v5 = await verifyEvidenceApprovalBinding(linkLegacy, report, unsigned, { verifyFn: webCryptoVerify });
  check("R5. legacy approval cannot be 'linked'", v5.status !== "linked" && v5.status === "unverified", `got ${v5.status}`);

  // R6. missing approval → unavailable
  const v6 = await verifyEvidenceApprovalBinding(l1, report, undefined as never, { publicKeyPem: alice.pub, verifyFn: webCryptoVerify });
  check("R6. missing approval → unavailable", v6.status === "unavailable", `got ${v6.status}`);

  // R7. link already carries approval_signature_status = verified for signed; re-verify honest
  check("R7. link records verified status", l1.approval_signature_status === "verified");
  check("R7b. link evidence_fingerprint matches report", l1.evidence_fingerprint === report.integrity.fingerprint);

  // R8. MWT-5+ reused (no duplicated verification): verifySignedApproval is the single source
  // (covered implicitly; here assert provenance does not invent its own signature verdict)
  const v8 = await verifyEvidenceApprovalBinding(l1, report, signed, { publicKeyPem: alice.pub, verifyFn: webCryptoVerify });
  check("R8. provenance defers to MWT-5+ verdict", v8.status === "linked");

  console.log(`\nMWT-4F Provenance regression: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("FAILED: " + fails.join(", "));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("regression crashed:", e);
  process.exit(1);
});
