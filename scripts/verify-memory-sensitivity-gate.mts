/**
 * Verify the ADR-004 Stage B1 sensitivity gate (regression guard).
 *
 * Run: npx tsx scripts/verify-memory-sensitivity-gate.mts
 *      (needs DATABASE_URL)
 *
 * The gate lives in `selectMemoriesInner()` and decides which memories may
 * cross the machine boundary when the receiver is a CLOUD model.
 *
 * Why it must be tested against the REAL retriever, not a mock:
 *   the whole point is that egress (a regex DLP) cannot catch semantic
 *   sensitivity — 「用户的老板叫张伟」 matches no pattern. So the decision
 *   has to be made at SELECTION time, and the test has to prove the entry
 *   never reaches the candidate set, not merely that a filter function
 *   returns the right array.
 *
 * These memories are created and deleted by this script (unique marker),
 * so it leaves the user's real corpus untouched.
 */

import { MemoryEntryRepo } from "../src/db/repositories.js";
import { selectMemories } from "../src/services/memory/injector.js";
import type { MemorySensitivityTier } from "../src/types/index.js";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const USER = "b1-gate-verify-user";
// Letters only — a numeric timestamp collides with the phone-number regex
// (`1[3-9]\d{9}`), which would make the "no DLP-detectable pattern" assertion
// fail for a reason that has nothing to do with the gate under test.
const MARK = `b1gate${Math.random().toString(36).slice(2, 10)}`;

// Distinctive so keyword relevance can actually match them.
const TIERS: MemorySensitivityTier[] = [
  "public",
  "internal",
  "sensitive",
  "restricted",
  "unknown",
];

/**
 * Hard-delete every entry for this test user.
 * `MemoryEntryRepo.softDelete` does not exist — an earlier version of this
 * script called it via optional chaining, which failed SILENTLY and let
 * residue from previous runs leak into later runs (making the "remote returns
 * exactly 1" assertion fail for reasons unrelated to the gate).
 */
async function purgeTestUser(): Promise<number> {
  const existing = await MemoryEntryRepo.list(USER, { limit: 500 });
  for (const e of existing) {
    await MemoryEntryRepo.delete(e.id, USER);
  }
  return existing.length;
}

const purged = await purgeTestUser();
if (purged > 0) {
  console.log(`(清理历史残留 ${purged} 条)`);
}

const created: string[] = [];
for (const tier of TIERS) {
  const e = await MemoryEntryRepo.create({
    user_id: USER,
    category: "preference",
    // Content is deliberately SEMANTICALLY sensitive but contains NO pattern
    // that a regex DLP could match — this is exactly egress's blind spot.
    content: `${MARK} 老板叫张伟 年薪八十万 ${tier}`,
    importance: 5,
    tags: [],
    source: "manual",
    sensitivity: tier,
  });
  created.push(e.id);
}

console.log(`\n── 1. LOCAL：不做裁剪（数据不出本机）─────────────────`);
{
  const r = await selectMemories(USER, MARK, "local");
  const got = new Set(r.memories.map((m) => m.id));
  check(`local 返回全部 ${TIERS.length} 条（实际 ${r.memories.length}）`,
    r.memories.length === TIERS.length, `got=${r.memories.length}`);
  check("local 不拦截任何条目", got.size === created.filter((id) => got.has(id)).length);
}

console.log(`\n── 2. REMOTE：只放行 public ───────────────────────────`);
{
  const r = await selectMemories(USER, MARK, "remote");
  const contents = r.memories.map((m) => m.content).join(" | ");

  check(`remote 只返回 public 那 1 条（实际 ${r.memories.length}）`,
    r.memories.length === 1, `contents=${contents.slice(0, 200)}`);
  check("放行的确实是 public", r.memories.every((m) => m.content.includes("public")));

  for (const tier of ["internal", "sensitive", "restricted", "unknown"]) {
    check(`remote 不泄露 ${tier}`, !contents.includes(`${tier}`),
      `泄漏内容: ${contents.slice(0, 160)}`);
  }
}

console.log(`\n── 3. 语义敏感内容确实存在（证明不是空集侥幸通过）──`);
{
  // If the corpus were empty, test 2 would pass vacuously. Prove the entries
  // exist and ARE relevant to the query — they were excluded by policy, not
  // by failing to match.
  const r = await selectMemories(USER, MARK, "local");
  const sensitiveEntry = r.memories.find((m) => m.content.includes("sensitive"));
  check("被拦截的 sensitive 条目在 local 下确实能命中", Boolean(sensitiveEntry));
  check("其内容不含任何可被正则 DLP 识别的格式（邮箱/手机/卡号/密钥）",
    sensitiveEntry ? !/[a-zA-Z0-9._%+-]+@|1[3-9]\d{9}|\b\d{16,}\b|sk-/.test(sensitiveEntry.content) : false,
    sensitiveEntry?.content);
}

console.log(`\n── 4. 缺失字段按 unknown 处理（默认拒绝）──────────────`);
{
  const e = await MemoryEntryRepo.create({
    user_id: USER,
    category: "preference",
    content: `${MARK} 缺省敏感度条目`,
    importance: 5,
    source: "manual",
    // sensitivity omitted on purpose
  });
  created.push(e.id);

  const localR = await selectMemories(USER, MARK, "local");
  check("local 下可见（条目确实创建成功）",
    localR.memories.some((m) => m.id === e.id));

  const remoteR = await selectMemories(USER, MARK, "remote");
  check("remote 下不可见（缺失 = 未审阅 = 拒绝）",
    !remoteR.memories.some((m) => m.id === e.id));
}

// Cleanup — never leave test data in the user's corpus.
const removed = await purgeTestUser();
const leaked = created.length - (removed - 0);
console.log(`\n(已清理 ${removed} 条测试数据${leaked === 0 ? "" : `，⚠️ 仍有 ${leaked} 条残留`})`);

console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILURES"}: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
