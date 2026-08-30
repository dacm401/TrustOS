/**
 * Verify the sovereign archive bundle (RFC-001 Phase 2).
 *
 * Run: npx tsx scripts/verify-sovereign-archive.mts
 *
 * The two properties that matter most are the ones an archive could most
 * easily get wrong:
 *   1. Archiving MARKS, never DELETES (sovereign data accumulates forever).
 *   2. Distilled memory is never archived (it is what makes the Manager
 *      progressively understand the user).
 */

import {
  ARCHIVE_SCHEMA,
  createArchiveBundle,
  importArchiveBundle,
  countArchiveable,
  type ArchiveBundle,
} from "../src/services/sovereign/archive.js";
import { MemoryEntryRepo, ConversationTurnRepo } from "../src/db/repositories.js";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const hasDb = (): boolean => {
  const url = process.env.DATABASE_URL;
  return typeof url === "string" && url.length > 0;
};
const PASSPHRASE = "archive-test-passphrase";

console.log("\n── 1. Passphrase is mandatory ──────────────────────────");
{
  let threw = false;
  try {
    await createArchiveBundle("u", { passphrase: "" });
  } catch { threw = true; }
  check("create throws without passphrase", threw);
}

console.log("\n── 2. Wrong schema is rejected ─────────────────────────");
{
  const bad = {
    schema: "wrong/v9", archive_id: "a", created_at: "", user_id: "u",
    turn_count: 0, range: { from: null, to: null },
    checksum: "0".repeat(64), encrypted: true,
    payload: Buffer.from("x".repeat(64)).toString("base64"),
  } as unknown as ArchiveBundle;
  let threw = false;
  try { await importArchiveBundle(bad, { passphrase: PASSPHRASE, dryRun: true }); } catch { threw = true; }
  check("import throws on unknown schema", threw);
}

console.log("\n── 3. Import requires the right passphrase ─────────────");
{
  const enc = {
    schema: ARCHIVE_SCHEMA, archive_id: "a", created_at: "", user_id: "u",
    turn_count: 0, range: { from: null, to: null },
    checksum: "0".repeat(64), encrypted: true,
    payload: Buffer.from("x".repeat(64)).toString("base64"),
  } as ArchiveBundle;

  let noPw = false;
  try { await importArchiveBundle(enc, { passphrase: "", dryRun: true }); } catch { noPw = true; }
  check("throws without passphrase", noPw);

  let wrongPw = false;
  try { await importArchiveBundle(enc, { passphrase: "nope", dryRun: true }); } catch { wrongPw = true; }
  check("throws with WRONG passphrase (no silent fallback)", wrongPw);
}

console.log("\n── 4. End-to-end (DB required) ─────────────────────────");
if (!hasDb()) {
  console.log("   (skipped: set DATABASE_URL for the full round-trip)");
} else {
  const userId = "verify-archive-user";
  const sessionId = "verify-archive-session-" + Date.now();

  // Seed: two turns (user + assistant) and one memory entry.
  await ConversationTurnRepo.record({
    sessionId, turnIndex: 0, role: "user",
    content: "归档测试问题：什么是归档？", userId,
  });
  await ConversationTurnRepo.recordAssistant({
    sessionId, userId, content: "归档是把冷数据打包加密，但永不删除。",
  });
  const mem = await MemoryEntryRepo.create({
    user_id: userId, category: "fact", content: "归档测试记忆：冷数据归档后仍可追溯",
    importance: 3, tags: ["verify"], source: "manual",
  });

  const beforeTurns = await ConversationTurnRepo.listBySession(sessionId);
  check("seeded 2 turns", beforeTurns.length === 2, String(beforeTurns.length));

  const hotBefore = await countArchiveable(userId);
  check("hot-layer count > 0 before archive", hotBefore > 0, String(hotBefore));

  // Archive
  const bundle = await createArchiveBundle(userId, { passphrase: PASSPHRASE });
  check("schema correct", bundle.schema === ARCHIVE_SCHEMA);
  check("turn_count reported", bundle.turn_count >= 2, String(bundle.turn_count));
  check("marked encrypted", bundle.encrypted === true);
  check("payload does not contain plaintext", !bundle.payload.includes("归档测试问题"));

  // ⭐ The critical property: archived but NOT deleted.
  const afterTurns = await ConversationTurnRepo.listBySession(sessionId);
  check("🚨 turns still exist after archive (marked, not deleted)",
    afterTurns.length === 2, String(afterTurns.length));
  check("turns carry an archive_id",
    afterTurns.every((t) => t.archive_id !== null),
    JSON.stringify(afterTurns.map((t) => t.archive_id)));

  const hotAfter = await countArchiveable(userId);
  check("hot layer shrank", hotAfter < hotBefore, `${hotBefore} → ${hotAfter}`);

  // ⭐ Memory must survive archiving untouched.
  const memAfter = await MemoryEntryRepo.list(userId, { limit: 100 });
  const stillThere = memAfter.some((m) => m.id === mem.id);
  check("🚨 distilled memory NOT archived away", stillThere);

  // Import back
  const res = await importArchiveBundle(bundle, { passphrase: PASSPHRASE, dryRun: true });
  check("dry-run reports without writing", res.dryRun === true && res.restored === bundle.turn_count);

  const res2 = await importArchiveBundle(bundle, { passphrase: PASSPHRASE });
  check("import restored turns", res2.restored === bundle.turn_count, String(res2.restored));
  check("nothing skipped", res2.skipped === 0, String(res2.skipped));

  const hotRestored = await countArchiveable(userId);
  check("turns returned to the hot layer", hotRestored >= bundle.turn_count,
    `${hotAfter} → ${hotRestored}`);

  // Cleanup
  await MemoryEntryRepo.delete(mem.id);
  console.log("     (cleaned up test memory entry)");
}

console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILURES"}: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
