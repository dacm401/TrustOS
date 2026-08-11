// MWT-5+ — Signed Approval Dry-run v0 regression.
//
// Covers: determinism of sign/verify, decision mapping preserved, wrong-key
// rejection, signer/approver honesty, canonical body sensitivity, no backend/network.
// Must stay at 0 failures against the MWT-4 Mainline baseline.

import { generateIdentity, webCryptoSign, webCryptoVerify } from "../../src/services/identity/local-identity.ts";
import {
  signSignedApproval,
  verifySignedApproval,
  signedApprovalCanonicalBody,
  toApprovalRecordLike,
  toIdentityVerificationStatus,
} from "../../src/services/mwt5/signed-approval.ts";

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

async function main(): Promise<void> {
  const alice = await generateIdentity("alice", "2026-08-11T00:00:00Z");
  const bob = await generateIdentity("bob", "2026-08-11T00:00:00Z");

  const base = {
    schema_version: "mwt5-adv-1",
    approver_id: "alice",
    target_ref: "task-1",
    decision: "approved" as const,
    note: "ok",
    created_at: "2026-08-11T00:00:00Z",
  };

  // R1. sign is deterministic given same key + body
  const s1 = await signSignedApproval(base, alice.private_key_pem, { publicKeyPem: alice.public_key_pem });
  const s2 = await signSignedApproval(base, alice.private_key_pem, { publicKeyPem: alice.public_key_pem });
  check("R1. sign deterministic", s1.signature!.signature === s2.signature!.signature, `${s1.signature!.signature} vs ${s2.signature!.signature}`);

  // R2. decision mapping preserved (approved/noted/rejected all signable)
  for (const decision of ["approved", "noted", "rejected"] as const) {
    const rec = { ...base, decision, approver_id: "alice" };
    const signed = await signSignedApproval(rec, alice.private_key_pem, { publicKeyPem: alice.public_key_pem });
    const v = await verifySignedApproval(signed, alice.public_key_pem, { verifyFn: webCryptoVerify });
    check(`R2. decision '${decision}' verifies`, v.status === "verified", `got ${v.status}`);
  }

  // R3. wrong key rejected
  const signedByAlice = await signSignedApproval(base, alice.private_key_pem, { publicKeyPem: alice.public_key_pem });
  const wrongKey = await verifySignedApproval(signedByAlice, bob.public_key_pem, { verifyFn: webCryptoVerify });
  check("R3. wrong public key → unverified", wrongKey.status === "unverified", `got ${wrongKey.status}`);

  // R4. signer_id tampering fails
  const tamperedSigner = { ...signedByAlice, signature: { ...signedByAlice.signature!, signer_id: "eve" } };
  const v4 = await verifySignedApproval(tamperedSigner, alice.public_key_pem, { verifyFn: webCryptoVerify });
  check("R4. signer_id tamper → unverified", v4.status === "unverified", `got ${v4.status}`);

  // R5. canonical body sensitive to each semantic field
  for (const [field, mutate] of [
    ["approver_id", (r: typeof base) => ({ ...r, approver_id: "mallory" })],
    ["target_ref", (r: typeof base) => ({ ...r, target_ref: "task-999" })],
    ["decision", (r: typeof base) => ({ ...r, decision: "rejected" as const })],
    ["note", (r: typeof base) => ({ ...r, note: "changed note" })],
    ["created_at", (r: typeof base) => ({ ...r, created_at: "2026-08-12T00:00:00Z" })],
  ] as const) {
    const bodyA = signedApprovalCanonicalBody(base);
    const bodyB = signedApprovalCanonicalBody(mutate(base));
    check(`R5. canonical sensitive to ${field}`, bodyA !== bodyB);
  }

  // R6. identity verification status mapping is a faithful pass-through
  const vVerified = await verifySignedApproval(signedByAlice, alice.public_key_pem, { verifyFn: webCryptoVerify });
  const vLegacy = await verifySignedApproval(base);
  const vNoKey = await verifySignedApproval(signedByAlice);
  check("R6. verified→verified", toIdentityVerificationStatus(vVerified) === "verified");
  check("R6. legacy→legacy_unsigned", toIdentityVerificationStatus(vLegacy) === "legacy_unsigned");
  check("R6. nokey→unverified", toIdentityVerificationStatus(vNoKey) === "unverified");

  // R7. toApprovalRecordLike preserves fields for report consumption
  const like = toApprovalRecordLike(signedByAlice);
  check("R7. like.decision preserved", like.decision === "approved");
  check("R7. like.approver_id preserved", like.approver_id === "alice");
  check("R7. like.signature present", !!like.signature);
  check("R7. like.signature.algo = Ed25519", like.signature!.algo === "Ed25519");

  // R8. no backend/network — generated_at absent yields current-time envelope but deterministic body
  const noTs = { approver_id: "alice", decision: "approved" as const };
  const sNoTs = await signSignedApproval(noTs, alice.private_key_pem, { publicKeyPem: alice.public_key_pem });
  const vNoTs = await verifySignedApproval(sNoTs, alice.public_key_pem, { verifyFn: webCryptoVerify });
  check("R8. missing created_at still verifies", vNoTs.status === "verified", `got ${vNoTs.status}`);

  console.log(`\nMWT-5+ Signed Approval regression: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("FAILED: " + fails.join(", "));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("regression crashed:", e);
  process.exit(1);
});
