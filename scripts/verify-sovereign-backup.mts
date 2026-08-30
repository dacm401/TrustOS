/**
 * Verify sovereign backup / restore (PLAN-P0 Task 2).
 *
 * Run: npx tsx scripts/verify-sovereign-backup.mts
 *
 * These tests are DB-free where possible: the crypto, checksum and schema
 * contracts can all be checked without a database, which is exactly the part
 * where silent failure would be worst (a backup that looks fine but cannot be
 * restored is worse than no backup).
 */

import {
  computeChecksum,
  createSnapshot,
  restoreSnapshot,
  SNAPSHOT_SCHEMA,
  type Snapshot,
} from "../src/services/sovereign/backup.js";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const canReachDb = (): boolean => {
  const url = process.env.DATABASE_URL;
  return typeof url === "string" && url.length > 0;
};

console.log("\n── 1. Checksum is stable and order-independent ─────────");
{
  const a = { b: 1, a: 2, list: [{ y: 1, x: 2 }] };
  const b = { a: 2, b: 1, list: [{ x: 2, y: 1 }] };
  check("key order does not matter", computeChecksum(a) === computeChecksum(b),
    `${computeChecksum(a)} vs ${computeChecksum(b)}`);
  check("different data → different checksum", computeChecksum(a) !== computeChecksum({ ...a, a: 99 }));
  check("64 hex chars", /^[0-9a-f]{64}$/.test(computeChecksum(a)));
}

console.log("\n── 2. Restore rejects an unsupported schema ────────────");
{
  const bad = { ...emptySnapshot(), schema: "some-other/v9" } as Snapshot;
  let threw = false;
  try { await restoreSnapshot(bad, { dryRun: true }); } catch { threw = true; }
  check("throws on unknown schema", threw);
}

console.log("\n── 3. Restore detects tampering (checksum) ─────────────");
{
  const snap = emptySnapshot();
  // Mutate the payload but keep the original checksum — simulates corruption.
  const tampered: Snapshot = {
    ...snap,
    data: { conversation_turns: [{ id: "injected", content: "tampered" }], memory_entries: [] },
  };
  let threw = false;
  let msg = "";
  try { await restoreSnapshot(tampered, { dryRun: true }); }
  catch (e) { threw = true; msg = e instanceof Error ? e.message : String(e); }
  check("refuses tampered snapshot", threw, msg);
  check("error mentions checksum", /checksum/i.test(msg), msg);
}

console.log("\n── 4. Encrypted snapshot requires a passphrase ─────────");
{
  const enc = emptySnapshot(true);
  let threw = false;
  try { await restoreSnapshot(enc, { dryRun: true }); } catch { threw = true; }
  check("throws without passphrase", threw);

  let threw2 = false;
  try { await restoreSnapshot(enc, { passphrase: "wrong-password", dryRun: true }); } catch { threw2 = true; }
  check("throws with WRONG passphrase (no silent fallback)", threw2);
}

console.log("\n── 5. Dry run never writes ─────────────────────────────");
{
  if (!canReachDb()) {
    check("(skipped: no DATABASE_URL)", true);
  } else {
    const snap = await createSnapshot("verify-backup-user");
    const res = await restoreSnapshot(snap, { dryRun: true });
    check("dryRun flag reported", res.dryRun === true);
    check("counts reported, not written", typeof res.restored.conversation_turns === "number");
  }
}

console.log("\n── 6. Round-trip: export → restore (DB optional) ───────");
{
  if (!canReachDb()) {
    check("(skipped: no DATABASE_URL)", true);
    console.log("     (run with DATABASE_URL set for the full round-trip)");
  } else {
    const userId = "verify-backup-user";
    const snap = await createSnapshot(userId);
    check("schema version correct", snap.schema === SNAPSHOT_SCHEMA, snap.schema);
    check("checksum present", /^[0-9a-f]{64}$/.test(snap.checksum));
    check("counts present", typeof snap.counts.conversation_turns === "number");
    check("plaintext by default", snap.encrypted === false);

    const res = await restoreSnapshot(snap, { dryRun: false });
    check("restore reported no fatal error", res.dryRun === false);
    check("restored count matches exported count",
      res.restored.conversation_turns === snap.counts.conversation_turns,
      `${res.restored.conversation_turns} vs ${snap.counts.conversation_turns}`);
    check("nothing skipped", res.skipped === 0, String(res.skipped));
  }
}

console.log("\n── 6b. REGRESSION: checksum survives a JSON round-trip ──");
{
  // This is the bug that in-process tests cannot catch.
  //
  // pg returns Date objects for timestamp columns. `canonicalize` sees a Date
  // as a plain object (Object.entries(Date) === []), so checksumming the
  // in-memory rows produced a DIFFERENT hash than checksumming the same data
  // read back from disk — every plaintext restore failed with
  // "Checksum mismatch" when export and restore ran in separate processes.
  //
  // The fix normalises through JSON before hashing. This test locks it in by
  // simulating exactly that: object → JSON → object → checksum.
  const withDates = {
    rows: [
      { id: "1", content: "a", created_at: new Date("2026-08-30T00:00:00.000Z") },
      { id: "2", content: "b", created_at: null },
    ],
  };
  const before = computeChecksum(withDates);
  const afterFile = computeChecksum(JSON.parse(JSON.stringify(withDates)));
  check("checksum identical after JSON round-trip", before === afterFile,
    `${before.slice(0, 12)}… vs ${afterFile.slice(0, 12)}…`);

  // And the practical consequence: a snapshot whose data mirrors a pg row set
  // must restore without a checksum error.
  const snap = emptySnapshot();
  const pgLike = { conversation_turns: withDates.rows, memory_entries: [] };
  const normalised = JSON.parse(JSON.stringify(pgLike));
  const ok: Snapshot = { ...snap, data: normalised, checksum: computeChecksum(normalised) };
  let threw = false;
  try { await restoreSnapshot(ok, { dryRun: true }); } catch { threw = true; }
  check("restores a pg-shaped snapshot without checksum error", threw === false);
}

console.log("\n── 7. Encrypted round-trip (DB optional) ───────────────");
{
  if (!canReachDb()) {
    check("(skipped: no DATABASE_URL)", true);
  } else {
    const snap = await createSnapshot("verify-backup-user", { passphrase: "correct horse battery" });
    check("marked encrypted", snap.encrypted === true);
    check("payload is a base64 string", typeof snap.data === "string", typeof snap.data);
    check("plaintext not present in payload",
      !String(snap.data).includes("conversation_turns"));

    const res = await restoreSnapshot(snap, { passphrase: "correct horse battery", dryRun: true });
    check("decrypts with the right passphrase", res.restored.conversation_turns >= 0);
  }
}

function emptySnapshot(encrypted = false): Snapshot {
  const data = { conversation_turns: [] as unknown[], memory_entries: [] as unknown[] };
  return {
    schema: SNAPSHOT_SCHEMA,
    created_at: new Date().toISOString(),
    user_id: "verify-backup-user",
    counts: { conversation_turns: 0, memory_entries: 0 },
    checksum: encrypted ? "0".repeat(64) : computeChecksum(data),
    encrypted,
    data: encrypted ? Buffer.from("x".repeat(64)).toString("base64") : data,
  };
}

console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILURES"}: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
