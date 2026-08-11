// MWT-5 regression — determinism, hash-chain linking, tamper detection, privacy.
// Run: npx tsx scripts/mwt5/run-regression.mts

import { createHash } from "node:crypto";
import {
  buildApprovalRecordSync,
  verifyApprovalChainSync,
  toJsonlLine,
  GENESIS_PREV_HASH,
  APPROVAL_SCHEMA_VERSION,
  type ApprovalRecord,
} from "../../frontend/src/lib/approval-record.js";

function syncSha(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

let pass = 0;
let fail = 0;
const fails: string[] = [];
function check(name: string, cond: boolean): void {
  if (cond) { pass++; process.stdout.write(`  ✅ ${name}\n`); }
  else { fail++; fails.push(name); process.stdout.write(`  ❌ ${name}\n`); }
}

const FIXED_AT = "2026-08-10T00:00:00.000Z";

function makeRecord(seq: number, prev: string, over: Partial<Parameters<typeof buildApprovalRecordSync>[0]> = {}): ApprovalRecord {
  return buildApprovalRecordSync(
    {
      approver_id: "reviewer-01",
      target_ref: "task-reg",
      decision: "approved",
      ts: FIXED_AT,
      prev_hash: prev,
      seq,
      ...over,
    },
    syncSha,
  );
}

// Build a 3-record chain.
const c1 = makeRecord(1, GENESIS_PREV_HASH);
const c2 = makeRecord(2, c1.record_hash);
const c3 = makeRecord(3, c2.record_hash);
const chain: ApprovalRecord[] = [c1, c2, c3];

// R1: determinism — same input + pinned ts → identical record_hash.
const c1b = makeRecord(1, GENESIS_PREV_HASH);
check("R1: deterministic record_hash given pinned ts", c1b.record_hash === c1.record_hash);

// R2: chain links — each prev_hash equals prior record_hash.
check("R2: c2.prev_hash = c1.record_hash", c2.prev_hash === c1.record_hash);
check("R2: c3.prev_hash = c2.record_hash", c3.prev_hash === c2.record_hash);

// R3: schema_version stable.
check("R3: schema_version mwt5.approval.v0", c1.schema_version === APPROVAL_SCHEMA_VERSION);

// R4: full chain verifies ok.
check("R4: verifyApprovalChainSync ok for intact chain", verifyApprovalChainSync(chain, syncSha).ok === true);
check("R4: brokenAt null for intact chain", verifyApprovalChainSync(chain, syncSha).brokenAt === null);

// R5: tamper detection — mutate a record's content, chain must break.
const tampered: ApprovalRecord[] = chain.map((r, i) =>
  i === 1 ? { ...r, note: "tampered" } : r,
);
const vr = verifyApprovalChainSync(tampered, syncSha);
check("R5: tampered record breaks chain", vr.ok === false);
check("R5: brokenAt points to seq 2", vr.brokenAt === 2);

// R6: link break — drop middle record, prev_hash mismatch.
const dropped = [c1, c3];
check("R6: missing record breaks prev_hash link", verifyApprovalChainSync(dropped, syncSha).ok === false);

// R7: privacy — no raw content / secrets in JSONL line.
const line = toJsonlLine(c1);
check("R7: jsonl has no raw_prompt", !line.includes("raw_prompt"));
check("R7: jsonl has no raw_output", !line.includes("raw_output"));
check("R7: jsonl has no api_key", !line.includes("api_key"));
check("R7: jsonl has no provider_raw_payload", !line.includes("provider_raw_payload"));

// R8: opaque approver_id — not structurally bound to identity (free string).
const freeR = makeRecord(1, GENESIS_PREV_HASH, { approver_id: "any-string-here" });
check("R8: approver_id accepts arbitrary opaque string", freeR.approver_id === "any-string-here");

// R9: advisory boundary — decision field is recorded, never enforced here.
check("R9: decision recorded as approved", c1.decision === "approved");
check("R9: rejected decision also recordable", makeRecord(1, GENESIS_PREV_HASH, { decision: "rejected" }).decision === "rejected");

// R10: no new TrstEventType — the record is a plain sidecar object, not in any union.
// (Enforced by construction: ApprovalRecord is independent; we assert no event_type field.)
check("R10: record carries no event_type field (sidecar, not event)", !("event_type" in c1));

process.stdout.write(`\nMWT-5 Regression: ${pass} passed, ${fail} failed\n`);
if (fail > 0) {
  process.stdout.write(`  failed: ${fails.join(", ")}\n`);
  process.exit(1);
}
process.exit(0);
