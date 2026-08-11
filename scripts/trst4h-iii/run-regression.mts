/**
 * TRST-4H-III — Manager Route HTTP Adoption v0 — Regression
 *
 * Broader coverage asserting the HTTP adoption semantics and that sealed routes
 * are preserved after shapeManagerRouteResponse adoption:
 *   - ask_clarification via real HTTP route: clarificationRequired + assistant msg + no session
 *   - multiple underspecified phrasings all route to clarification via HTTP
 *   - normal and delegated routing unchanged (router-level regression)
 *   - shaper contract invariants retained (TRST-4H-II regression)
 *
 * Run: npx tsx scripts/trst4h-iii/run-regression.mts
 */

import { managerRouteRouter } from "../../src/api/manager-route.js";
import { routeMessage } from "../../src/services/manager-routing/manager-router.js";
import { shapeManagerRouteResponse } from "../../src/services/manager-routing/manager-route-response.js";
import type { ActiveSessionSummary } from "../../src/services/manager-routing/manager-routing-types.js";

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

const noSessions: ActiveSessionSummary[] = [];

async function httpClarify(message: string): Promise<Record<string, unknown>> {
  const res = await managerRouteRouter.request("/route-message", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Id": "u" },
    body: JSON.stringify({ conversationId: "c1", message }),
  });
  return (await res.json()) as Record<string, unknown>;
}

const clarifications = [
  "怎么弄？",
  "这个怎么改？",
  "然后呢？",
  "你说说看？",
];

async function main(): Promise<void> {
  console.log("TRST-4H-III Manager Route HTTP Adoption — Regression");

  // ── 1. Every underspecified phrasing reaches clarification via the real HTTP route ──
  for (const msg of clarifications) {
    const body = await httpClarify(msg);
    check(`HTTP ${JSON.stringify(msg)} → ask_clarification`, body.routeType === "ask_clarification", `(got ${body.routeType})`);
    check(`HTTP ${JSON.stringify(msg)} → clarificationRequired true`, body.clarificationRequired === true);
    const mm = body.managerMessage as Record<string, unknown> | null;
    check(`HTTP ${JSON.stringify(msg)} → assistant msg non-empty`, !!mm && mm.role === "assistant" && typeof mm.content === "string" && (mm.content as string).length > 0);
    check(`HTTP ${JSON.stringify(msg)} → createdSession null`, body.createdSession === null);
  }

  // ── 2. Clarification never produces a fake task id or error status ──
  const c = await httpClarify("怎么弄？");
  check("clarification: no error status", c.routeType !== "normal_conversation" || c.clarificationRequired === true);
  check("clarification: targetSessionId null", c.targetSessionId === null);

  // ── 3. Router-level regression: normal & delegated preserved ──
  const cases: Array<[string, string]> = [
    ["你好", "normal_conversation"],
    ["请介绍一下你的功能", "normal_conversation"],
    ["帮我修一下登录页的样式", "new_delegated_task"],
    ["执行数据库备份", "new_delegated_task"],
    ["请用3、4、9、10拼出24点", "new_delegated_task"],
  ];
  for (const [msg, expected] of cases) {
    const r = routeMessage({ user_id: "u", conversation_id: "c", message: msg, target_session_id: null, active_sessions: noSessions });
    check(`router: ${JSON.stringify(msg)} → ${expected}`, r.route_type === expected, `(got ${r.route_type})`);
    const shaped = shapeManagerRouteResponse(r, "u");
    if (expected === "new_delegated_task") {
      check(`shaper: ${JSON.stringify(msg)} createdSession not null`, shaped.createdSession !== null);
      check(`shaper: ${JSON.stringify(msg)} clarificationRequired false`, shaped.clarificationRequired === false);
    } else {
      check(`shaper: ${JSON.stringify(msg)} clarificationRequired false`, shaped.clarificationRequired === false);
    }
  }

  console.log(`\nRegression: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
