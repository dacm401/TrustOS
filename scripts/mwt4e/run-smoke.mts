/**
 * MWT-4E — Authenticated Identity v0 — Smoke
 *
 * Proves the local deterministic identity binding for approval records using the
 * real Web Crypto Ed25519 path (no new dependency, identical in Node 18+ and browser).
 *
 * Required proofs:
 *   1. approver_id matches signer identity → verification passes.
 *   2. tampered approval (changed approver_id / note) → verification fails.
 *   3. legacy unsigned approval (no envelope) → readable + marked "unsigned" (not error).
 *
 * Run: npx tsx scripts/mwt4e/run-smoke.mts
 */

import {
  generateIdentity,
  signBody,
  webCryptoSign,
} from "../../src/services/identity/local-identity.js";
import {
  buildApprovalRecordAsync,
  checkApprovalSignature,
  canonicalBody,
  type ApprovalRecord,
  GENESIS_PREV_HASH,
} from "../../frontend/src/lib/approval-record.js";
import { webCryptoVerify } from "../../src/services/identity/local-identity.js";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name} ${detail}`);
  }
}

/** Build a signed approval record bound to a local identity. */
async function buildSignedApproval(
  id: ReturnType<typeof generateIdentity> extends Promise<infer T> ? T : never,
  approverId: string,
  note: string,
  prevHash: string,
  seq: number,
): Promise<ApprovalRecord> {
  const rec = await buildApprovalRecordAsync({
    approver_id: approverId,
    target_ref: "task:abc",
    decision: "approved",
    note,
    ts: "2026-08-11T00:00:00.000Z",
    prev_hash: prevHash,
    seq,
  });
  const body = canonicalBody({
    schema_version: rec.schema_version,
    seq: rec.seq,
    approver_id: rec.approver_id,
    target_ref: rec.target_ref,
    decision: rec.decision,
    note: rec.note,
    ts: rec.ts,
    prev_hash: rec.prev_hash,
  });
  const signature = await signBody(id.private_key_pem, body, webCryptoSign);
  return {
    ...rec,
    signature: {
      signer_id: id.descriptor.id,
      public_key_fingerprint: id.descriptor.public_key_fingerprint,
      algo: "Ed25519",
      signature,
    },
  };
}

async function main(): Promise<void> {
  console.log("MWT-4E Authenticated Identity v0 — Smoke");

  const id = await generateIdentity("local:pm:01", "2026-08-11T00:00:00.000Z");

  // ── 1. approver_id matches signer identity → verified ──
  const signed = await buildSignedApproval(id, id.descriptor.id, "accept", GENESIS_PREV_HASH, 1);
  const c1 = await checkApprovalSignature(signed, id.public_key_pem, webCryptoVerify);
  check("signed approval → status verified", c1.status === "verified", `(got ${c1.status})`);
  check("verified signer_id matches approver_id", c1.signer_id === id.descriptor.id);
  check("approver_id matches signer identity", signed.approver_id === signed.signature?.signer_id);

  // ── 2. tampered approval → invalid ──
  const tampered: ApprovalRecord = {
    ...signed,
    approver_id: "someone-else",
  };
  const c2 = await checkApprovalSignature(tampered, id.public_key_pem, webCryptoVerify);
  check("tampered approver_id → status invalid", c2.status === "invalid", `(got ${c2.status})`);

  const tamperedNote: ApprovalRecord = { ...signed, note: "changed note" };
  const c2b = await checkApprovalSignature(tamperedNote, id.public_key_pem, webCryptoVerify);
  check("tampered note → status invalid", c2b.status === "invalid", `(got ${c2b.status})`);

  // ── 3. legacy unsigned approval → unsigned (readable, not error) ──
  const legacy = await buildApprovalRecordAsync({
    approver_id: "pm-legacy",
    target_ref: "task:xyz",
    decision: "approved",
    ts: "2026-08-11T00:00:00.000Z",
    prev_hash: GENESIS_PREV_HASH,
    seq: 1,
  });
  const c3 = await checkApprovalSignature(legacy, id.public_key_pem, webCryptoVerify);
  check("legacy unsigned → status unsigned", c3.status === "unsigned", `(got ${c3.status})`);
  check("legacy unsigned signer_id null", c3.signer_id === null);

  // ── 4. wrong public key → invalid (isolation) ──
  const otherId = await generateIdentity("local:pm:02", "2026-08-11T00:00:00.000Z");
  const c4 = await checkApprovalSignature(signed, otherId.public_key_pem, webCryptoVerify);
  check("verify with wrong key → invalid", c4.status === "invalid", `(got ${c4.status})`);

  console.log(`\nSmoke: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
