/**
 * RFC-002 Phase 2: verify the unified work-history audit query surface.
 *
 * Run: npx tsx scripts/verify-rfc002-workhistory.mts   (needs DATABASE_URL / Docker PG)
 *
 * Behavioral DB test. Seeds a single user across all FOUR audit stores
 * (conversation_turns / manager_messages / task_commands / task_worker_results),
 * then drives the real `workHistoryRouter` (mounted at root for the test) and
 * asserts the merged feed behaves correctly:
 *   1. all 4 type discriminants surface
 *   2. ILIKE full-text search narrows the feed
 *   3. session_id filter scopes the feed
 *   4. user_id scoping prevents cross-user leakage
 *   5. limit/offset pagination works
 *
 * Seeded rows are cleaned up in a finally block regardless of assertion outcome.
 */

import { Hono } from "hono";
import { v4 as uuid } from "uuid";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query } from "../src/db/connection.js";
import { workHistoryRouter } from "../src/api/work-history.js";
import { TaskArchiveRepo, TaskCommandRepo, TaskWorkerResultRepo } from "../src/db/task-archive-repo.js";
import { ManagerMessageRepo } from "../src/db/repositories/manager-message.js";
import { ConversationTurnRepo } from "../src/db/repositories/conversation-turn.js";
import { initEventStore } from "../src/services/trst1/jsonl-event-store.js";

// RFC-002 Phase 1c: bootstrap the Event Backbone the same way src/index.ts does,
// so task_commands/task_worker_results writes exercise the hash chain instead of
// emitting misleading "EVENT_WRITE_FAILED" (the store is only initialised by the
// full app bootstrap, not when a repo module is imported directly).
initEventStore(join(tmpdir(), "trustos-rfc002-verify.jsonl"));

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

/** Mirror production: X-User-Id header → userId context var. */
function makeApp(): Hono {
  const app = new Hono();
  app.use(async (c, next) => {
    c.set("userId", c.req.header("X-User-Id") ?? undefined);
    await next();
  });
  app.route("/", workHistoryRouter);
  return app;
}

async function getFeed(
  app: Hono,
  userId: string,
  params: Record<string, string | number | undefined> = {}
): Promise<{ status: number; body: any }> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  }
  const res = await app.request(`/?${qs.toString()}`, { headers: { "X-User-Id": userId } });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { __raw: text }; }
  return { status: res.status, body };
}

function itemText(it: any): string {
  if (it.type === "message" || it.type === "manager_prompt" || it.type === "archive") return it.content ?? "";
  if (it.type === "dispatch") return JSON.stringify(it.payload_json ?? "");
  return it.summary ?? JSON.stringify(it.result_json ?? "");
}

async function main() {
  const app = makeApp();

  // Isolated random identities so a failed cleanup can never pollute real data.
  const u1 = `rfc002_wh_a_${uuid().slice(0, 8)}`;
  const u2 = `rfc002_wh_b_${uuid().slice(0, 8)}`;
  const s1 = uuid();   // primary session for u1
  const s1b = uuid();  // second session for u1 (to exercise session filter)
  const s2 = uuid();   // session for u2
  const convId = uuid();

  const turnIds: string[] = [];
  let mmId = "";
  let archiveId = "";
  let cmdId = "";
  let resId = "";
  let u2TurnId = "";

  try {
    // ── Seed u1 across all four stores ──
    const t1 = await ConversationTurnRepo.record({ sessionId: s1, turnIndex: 1, role: "user", content: "我要写快速排序", userId: u1 });
    if (t1.stored) turnIds.push(t1.id);
    const t2 = await ConversationTurnRepo.record({ sessionId: s1b, turnIndex: 1, role: "user", content: "天空为什么是蓝的", userId: u1 });
    if (t2.stored) turnIds.push(t2.id);

    const mm = await ManagerMessageRepo.create({
      user_id: u1, conversation_id: convId, role: "manager",
      content: "加工后派发：快速排序任务", related_session_id: s1,
    });
    mmId = mm.id;

    const archive = await TaskArchiveRepo.create({
      session_id: s1, user_id: u1,
      decision: { decision_type: "delegate_to_slow", command: { goal: "写快速排序", task_brief: "生成快速排序代码", worker_hint: "" } },
      user_input: "用户原话：我要写快速排序",
      task_brief: "生成快速排序代码", goal: "写快速排序",
    });
    archiveId = archive.id;

    const cmd = await TaskCommandRepo.create({
      task_id: archiveId, archive_id: archiveId, user_id: u1,
      command_type: "delegate_to_slow",
      payload: { goal: "写快速排序", task_brief: "生成快速排序代码", worker_hint: "用 Python" },
    });
    cmdId = cmd.id;

    const wr = await TaskWorkerResultRepo.create({
      task_id: archiveId, archive_id: archiveId, command_id: cmdId, user_id: u1,
      worker_role: "slow",
      result: { status: "completed", summary: "已生成快速排序代码", structured_result: { code: "def quick_sort(): pass" }, confidence: 0.9 },
    });
    resId = wr.id;

    // ── Seed u2 (isolation control) ──
    const t3 = await ConversationTurnRepo.record({ sessionId: s2, turnIndex: 1, role: "user", content: "u2 的私有对话不应出现在 u1 的审计流", userId: u2 });
    if (t3.stored) u2TurnId = t3.id;

    console.log("\n── 1. 五表合并：所有 type 都出现 ─────────────────────");
    {
      const { status, body } = await getFeed(app, u1);
      check("HTTP 200", status === 200, `status=${status}`);
      check("total = 6（2 对话 + 1 manager + 1 派发 + 1 结果 + 1 归档）", body.total === 6, `total=${body.total}`);
      const types = new Set(body.items.map((i: any) => i.type));
      for (const t of ["message", "manager_prompt", "dispatch", "result", "archive"]) {
        check(`包含 type="${t}"`, types.has(t));
      }
    }

    console.log("\n── 2. ILIKE 全文检索缩小结果集 ───────────────────────");
    {
      const { body: all } = await getFeed(app, u1);
      check("无 q 时返回全部 6 条", all.total === 6);

      const { body: q1 } = await getFeed(app, u1, { q: "快速排序" });
      check("q=快速排序 命中（>=3）", q1.total >= 3, `total=${q1.total}`);
      const allMatch = q1.items.every((i: any) => itemText(i).toLowerCase().includes("快速排序"));
      check("q=快速排序 的每条都含关键字", allMatch);

      const { body: q2 } = await getFeed(app, u1, { q: "加工后派发" });
      check("q=加工后派发 仅 manager_prompt（1 条）", q2.total === 1 && q2.items[0].type === "manager_prompt", `total=${q2.total}`);

      const { body: q3 } = await getFeed(app, u1, { q: "不存在的关键字zzz" });
      check("q=不存在 返回 0 条", q3.total === 0);
    }

    console.log("\n── 3. session_id 过滤 ────────────────────────────────");
    {
      const { body: sMain } = await getFeed(app, u1, { session_id: s1 });
      check("session=s1 返回 5 条（t1+mm+dispatch+result+archive）", sMain.total === 5, `total=${sMain.total}`);
      const { body: sAlt } = await getFeed(app, u1, { session_id: s1b });
      check("session=s1b 仅返回该会话的 1 条对话", sAlt.total === 1 && sAlt.items[0].type === "message", `total=${sAlt.total}`);
    }

    console.log("\n── 4. user_id 隔离（防越权泄漏）──────────────────────");
    {
      const { body: u2feed } = await getFeed(app, u2);
      check("u2 自身可见其 1 条", u2feed.total === 1, `total=${u2feed.total}`);
      const u1feed = (await getFeed(app, u1)).body;
      const leaked = u1feed.items.some((i: any) => itemText(i).includes("u2 的私有对话"));
      check("u1 的审计流不含 u2 的私有内容", !leaked);
    }

    console.log("\n── 5. 分页 limit / offset ────────────────────────────");
    {
      const { body: p } = await getFeed(app, u1, { limit: 2, offset: 0 });
      check("limit=2 仅返回 2 条", p.items.length === 2, `len=${p.items.length}`);
      check("total 仍为全量 6", p.total === 6, `total=${p.total}`);
      check("回显 limit/offset", p.limit === 2 && p.offset === 0);
    }
  } finally {
    // Best-effort cleanup, newest FK first.
    try { if (cmdId) await query("DELETE FROM task_commands WHERE id=$1", [cmdId]); } catch {}
    try { if (resId) await query("DELETE FROM task_worker_results WHERE id=$1", [resId]); } catch {}
    try { if (archiveId) await query("DELETE FROM task_archives WHERE id=$1", [archiveId]); } catch {}
    try { if (mmId) await query("DELETE FROM manager_messages WHERE id=$1", [mmId]); } catch {}
    for (const id of turnIds) { try { await query("DELETE FROM conversation_turns WHERE id=$1", [id]); } catch {} }
    try { if (u2TurnId) await query("DELETE FROM conversation_turns WHERE id=$1", [u2TurnId]); } catch {}
  }
}

main()
  .then(() => {
    console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILURES"}: ${pass} passed, ${fail} failed\n`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error("verify-rfc002-workhistory crashed:", e);
    process.exit(1);
  });
