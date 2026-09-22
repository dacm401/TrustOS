/**
 * RFC-002 Phase 0b: verify Manager prompt 留痕 (audit trail) actually works.
 *
 * Run: npx tsx scripts/verify-rfc002-managerprompt.mts   (needs DATABASE_URL / Docker PG)
 *
 * Phase 0b made the router persist the Manager's PROCESSED prompt into
 * manager_messages on worker_started (so the audit feed can show what the
 * Manager turned the user's words into). This script closes the loop:
 *
 *   A. Source contract — llm-native-router.ts really calls ManagerMessageRepo.create
 *      in the worker_started branch (the 留痕 path is wired, not just a table).
 *   B. Behavioral — a manager_messages row (the same shape the router writes) surfaces
 *      in /v1/work-history as type "manager_prompt" with the processed content, so the
 *      user can audit Manager's prompt + the dispatched task end-to-end.
 */

import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { v4 as uuid } from "uuid";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query } from "../src/db/connection.js";
import { workHistoryRouter } from "../src/api/work-history.js";
import { ManagerMessageRepo } from "../src/db/repositories/manager-message.js";
import { ConversationTurnRepo } from "../src/db/repositories/conversation-turn.js";
import { initEventStore } from "../src/services/trst1/jsonl-event-store.js";

// Bootstrap the Event Backbone (mirrors src/index.ts) so Manager-prompt 留痕
// seeding doesn't spam misleading "EVENT_WRITE_FAILED".
initEventStore(join(tmpdir(), "trustos-rfc002-verify.jsonl"));

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

function makeApp(): Hono {
  const app = new Hono();
  app.use(async (c, next) => {
    c.set("userId", c.req.header("X-User-Id") ?? undefined);
    await next();
  });
  app.route("/", workHistoryRouter);
  return app;
}

async function getFeed(app: Hono, userId: string, q?: string) {
  const qs = q ? `?q=${encodeURIComponent(q)}` : "";
  const res = await app.request(`/${qs}`, { headers: { "X-User-Id": userId } });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { __raw: text }; }
  return { status: res.status, body };
}

async function main() {
  const app = makeApp();
  const ROUTER = readFileSync("src/services/llm-native-router.ts", "utf8");

  console.log("\n── A. Phase 0b 留痕路径已接线（源码层）──────────────────");
  {
    check("router 引入 ManagerMessageRepo", /ManagerMessageRepo/.test(ROUTER));
    check("router 调用 ManagerMessageRepo.create（写留痕）", /ManagerMessageRepo\.create\(/.test(ROUTER));
    check("留痕写的是 manager 角色（加工后 prompt）", /role:\s*["']manager["']/.test(ROUTER));
    check("留痕带 related_session_id（可追溯会话）", /related_session_id:\s*session_id/.test(ROUTER) || /related_session_id/.test(ROUTER));
    check("留痕内容为加工后的 brief（非原始 message）",
      /content:\s*brief\b/.test(ROUTER), "应写 processedCommand 的 brief，而非用户原话");
    check("写失败不影响派发（try/catch 最佳努力）",
      /try\s*\{[\s\S]{0,400}ManagerMessageRepo\.create[\s\S]{0,200}\}\s*catch/.test(ROUTER) ||
      /ManagerMessageRepo\.create[\s\S]{0,200}\}\s*catch/.test(ROUTER));
  }

  console.log("\n── B. 留痕真实出现在审计流（行为层）────────────────────");
  const u1 = `rfc002_mp_${uuid().slice(0, 8)}`;
  const s1 = uuid();
  const convId = uuid();
  let mmId = "";
  let turnId = "";
  try {
    // Mimic exactly what Phase 0b writes: role manager, content = processed brief.
    const mm = await ManagerMessageRepo.create({
      user_id: u1, conversation_id: convId, role: "manager",
      content: "Phase0b 加工后派发：将用户请求改写为快速排序任务简报",
      related_session_id: s1,
    });
    mmId = mm.id;

    const { status, body } = await getFeed(app, u1);
    check("HTTP 200", status === 200, `status=${status}`);
    const prompt = body.items.find((i: any) => i.type === "manager_prompt");
    check("审计流出现 type=manager_prompt", !!prompt);
    if (prompt) {
      check("内容为加工后的 prompt", prompt.content.includes("Phase0b 加工后派发"), prompt.content);
      check("role=manager", prompt.role === "manager");
      check("session_id 可追溯", prompt.session_id === s1, `session=${prompt.session_id}`);
    }

    // The user can ALSO search their Manager prompt by keyword (audit transparency).
    const { body: searched } = await getFeed(app, u1, "加工后派发");
    check("按关键字可检索到 Manager 加工 prompt",
      searched.items.some((i: any) => i.type === "manager_prompt" && i.content.includes("加工后派发")));

    // Cross-check: a plain conversation turn also surfaces, proving the merge is real.
    const turn = await ConversationTurnRepo
      .record({ sessionId: s1, turnIndex: 1, role: "user", content: "用户原始请求：帮我写排序", userId: u1 });
    if (turn.stored) turnId = turn.id;
    const { body: merged } = await getFeed(app, u1);
    const types = new Set(merged.items.map((i: any) => i.type));
    check("同一用户流里 message + manager_prompt 并存（原文→加工可审计）",
      types.has("message") && types.has("manager_prompt"));
  } finally {
    try { if (mmId) await query("DELETE FROM manager_messages WHERE id=$1", [mmId]); } catch {}
    try { if (turnId) await query("DELETE FROM conversation_turns WHERE id=$1", [turnId]); } catch {}
  }
}

main()
  .then(() => {
    console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILURES"}: ${pass} passed, ${fail} failed\n`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error("verify-rfc002-managerprompt crashed:", e);
    process.exit(1);
  });
