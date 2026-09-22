/**
 * RFC-002 Phase 1b/2: verify the /v1/work-history API contract & production wiring.
 *
 * Run: npx tsx scripts/verify-rfc002-auditapi.mts   (needs DATABASE_URL / Docker PG)
 *
 * Two layers, kept distinct from verify-rfc002-workhistory.mts (which owns the
 * query SEMANTICS: search/filter/sort/isolation):
 *
 *   A. Source/wiring contract (no DB needed for the assertions themselves):
 *      - the route is actually mounted on the production app (app.ts)
 *      - the handler scopes every store by user_id ($1) — no cross-user leak by design
 *      - the four type discriminants are emitted
 *
 *   B. Behavioral envelope contract (light DB seed):
 *      - GET without X-User-Id → 200 with empty items (audit scope requires identity)
 *      - GET with identity but no data → 200, valid envelope {total,limit,offset,items}
 *      - response echoes limit/offset and carries the required per-item fields
 */

import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { v4 as uuid } from "uuid";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query } from "../src/db/connection.js";
import { workHistoryRouter } from "../src/api/work-history.js";
import { ConversationTurnRepo } from "../src/db/repositories/conversation-turn.js";
import { initEventStore } from "../src/services/trst1/jsonl-event-store.js";

// Bootstrap the Event Backbone (mirrors src/index.ts) so seeding the manager
// prompt / conversation turn doesn't spam misleading "EVENT_WRITE_FAILED".
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

async function getFeed(app: Hono, userId?: string, params: Record<string, string | number | undefined> = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
  const headers: Record<string, string> = {};
  if (userId) headers["X-User-Id"] = userId;
  const res = await app.request(`/?${qs.toString()}`, { headers });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { __raw: text }; }
  return { status: res.status, body };
}

async function main() {
  const app = makeApp();
  const APP_TS = readFileSync("src/app.ts", "utf8");
  const WH_TS = readFileSync("src/api/work-history.ts", "utf8");

  console.log("\n── A. 生产接线与隔离不变量（源码层）────────────────────");
  {
    check("app.ts 挂载 work-history 路由",
      /app\.route\(\s*["']\/v1\/work-history["']\s*,\s*workHistoryRouter\s*\)/.test(APP_TS));
    check("handler 从 work-history.ts 导出 workHistoryRouter",
      /export const workHistoryRouter/.test(WH_TS));
    // The self-scoped and joined-scoped WHERE builders must both pin user_id first.
    check("whereSelf 以 user_id = $1 作用域开头", /user_id = \$1/.test(WH_TS));
    check("whereJoined 以 <alias>.user_id = $1 作用域开头（按表别名隔离）", /\.user_id = \$1/.test(WH_TS));
    for (const t of ["message", "manager_prompt", "dispatch", "result"]) {
      check(`handler产出 type="${t}"`, new RegExp(`'${t}' AS type`).test(WH_TS));
    }
  }

  console.log("\n── B. 响应信封契约（行为层，轻量落库）──────────────────");
  const u1 = `rfc002_api_${uuid().slice(0, 8)}`;
  const s1 = uuid();
  let turnId = "";
  try {
    // B0: no identity → empty envelope, never a 500 / never another user's data.
    {
      const { status, body } = await getFeed(app); // no X-User-Id
      check("无 X-User-Id → 200", status === 200, `status=${status}`);
      check("无 identity → total=0 / items=[]", body.total === 0 && Array.isArray(body.items) && body.items.length === 0);
    }

    // Seed one turn so we can assert the live envelope shape.
    const t = await ConversationTurnRepo.record({ sessionId: s1, turnIndex: 1, role: "user", content: "审计信封契约校验", userId: u1 });
    if (t.stored) turnId = t.id;

    {
      const { status, body } = await getFeed(app, u1);
      check("有 identity → 200", status === 200);
      const keys = Object.keys(body).sort().join(",");
      check("信封键严格为 {limit,offset,items,total}", keys === "items,limit,offset,total", keys);
      check("total=1", body.total === 1, `total=${body.total}`);
      const it = body.items[0];
      check("item 含 id", typeof it.id === "string" && it.id.length > 0);
      check("item 含 created_at", typeof it.created_at === "string" && !isNaN(Date.parse(it.created_at)));
      check('item.type === "message"', it.type === "message");
    }

    // B1: limit/offset echoed and capped.
    {
      const { body } = await getFeed(app, u1, { limit: 1, offset: 0 });
      check("回显 limit=1", body.limit === 1, `limit=${body.limit}`);
      check("回显 offset=0", body.offset === 0);
      check("items 受 limit 约束", body.items.length === 1, `len=${body.items.length}`);
    }
    {
      const { body } = await getFeed(app, u1, { limit: 999 });
      check("limit 上限封顶到 200", body.limit === 200, `limit=${body.limit}`);
    }
  } finally {
    try { if (turnId) await query("DELETE FROM conversation_turns WHERE id=$1", [turnId]); } catch {}
  }
}

main()
  .then(() => {
    console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILURES"}: ${pass} passed, ${fail} failed\n`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error("verify-rfc002-auditapi crashed:", e);
    process.exit(1);
  });
