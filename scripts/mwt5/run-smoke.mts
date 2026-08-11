// MWT-5 smoke — module callable + record shape sanity (sync core + sync hash).
// Run: npx tsx scripts/mwt5/run-smoke.mts

import { createHash } from "node:crypto";
import {
  buildApprovalRecordSync,
  verifyApprovalChainSync,
  toJsonlLine,
  parseJsonl,
  GENESIS_PREV_HASH,
  APPROVAL_SCHEMA_VERSION,
  type ApprovalRecord,
} from "../../frontend/src/lib/approval-record.js";

// Deterministic sync sha256 for test injection (Node-only; browser uses Web Crypto).
function syncSha(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) { pass++; process.stdout.write(`  ✅ ${name}\n`); }
  else { fail++; process.stdout.write(`  ❌ ${name}\n`); }
}

const r1 = buildApprovalRecordSync(
  {
    approver_id: "reviewer-01",
    target_ref: "task-smoke",
    decision: "approved",
    note: "looks good",
    ts: "2026-08-10T00:00:00.000Z",
    prev_hash: GENESIS_PREV_HASH,
    seq: 1,
  },
  syncSha,
);

check("S1: record has schema_version", r1.schema_version === APPROVAL_SCHEMA_VERSION);
check("S2: seq starts at 1", r1.seq === 1);
check("S3: prev_hash is genesis on first", r1.prev_hash === GENESIS_PREV_HASH);
check("S4: record_hash present", typeof r1.record_hash === "string" && r1.record_hash.length === 64);
check("S5: decision propagated", r1.decision === "approved");
check("S6: approver_id opaque string", r1.approver_id === "reviewer-01");
check("S7: note optional present", r1.note === "looks good");
check("S8: verify chain of 1 ok", verifyApprovalChainSync([r1], syncSha).ok === true);
check("S9: jsonl round-trip parses", (() => {
  const parsed = parseJsonl(toJsonlLine(r1)) as ApprovalRecord[];
  return parsed.length === 1 && parsed[0].record_hash === r1.record_hash;
})());

process.stdout.write(`\nMWT-5 Smoke: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
process.exit(0);
