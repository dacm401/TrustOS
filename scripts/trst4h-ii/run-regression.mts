/**
 * TRST-4H-II — Clarification UX/API Handling v0 — Regression
 *
 * Broader coverage ensuring: clarification path is honest + no task id, while
 * existing route types (normal / delegate / update / ambiguous) keep their
 * behavior through the response shaper.
 *
 * Run: npx tsx scripts/trst4h-ii/run-regression.mts
 */

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

console.log("TRST-4H-II Clarification Handling — Regression");

const noSessions: ActiveSessionSummary[] = [];
const single: ActiveSessionSummary[] = [{ id: "s1", title: "登录页重构", goal: "x", status: "planning" }];
const multi: ActiveSessionSummary[] = [
  { id: "s1", title: "登录页重构", goal: "x", status: "planning" },
  { id: "s2", title: "数据库迁移", goal: "y", status: "planning" },
];
const base = { user_id: "u", conversation_id: "c" };

// Clarification route shaping.
for (const msg of ["怎么弄？", "什么意思", "这个怎么改？"]) {
  const r = routeMessage({ ...base, message: msg, target_session_id: null, active_sessions: noSessions });
  const resp = shapeManagerRouteResponse(r, "u");
  check(`"${msg}" → ask_clarification response`, resp.routeType === "ask_clarification");
  check(`"${msg}" → clarificationRequired true`, resp.clarificationRequired === true);
  check(`"${msg}" → no createdSession`, resp.createdSession === null);
  check(`"${msg}" → message non-empty`, !!resp.managerMessage && resp.managerMessage.content.length > 0);
}

// Sealed route types preserved through shaper.
const normal = routeMessage({ ...base, message: "你好", target_session_id: null, active_sessions: noSessions });
const normalResp = shapeManagerRouteResponse(normal, "u");
check("greeting → normal_conversation response", normalResp.routeType === "normal_conversation");
check("greeting → no clarificationRequired", normalResp.clarificationRequired === false);

const delegate = routeMessage({ ...base, message: "请用3、4、9、10拼出24点", target_session_id: null, active_sessions: noSessions });
const delResp = shapeManagerRouteResponse(delegate, "u");
check("24点 → new_delegated_task response", delResp.routeType === "new_delegated_task");
check("24点 → createdSession present", delResp.createdSession !== null);
check("24点 → NOT clarificationRequired", delResp.clarificationRequired === false);

const update = routeMessage({ ...base, message: "把按钮改成蓝色", target_session_id: "s1", active_sessions: single });
const updResp = shapeManagerRouteResponse(update, "u");
check("target session → update_existing_session response", updResp.routeType === "update_existing_session");
check("target session → targetSessionId set", updResp.targetSessionId === "s1");

const amb = routeMessage({ ...base, message: "那个任务怎么样了", target_session_id: null, active_sessions: multi });
const ambResp = shapeManagerRouteResponse(amb, "u");
check("ambiguous ref → ambiguous_session_reference response", ambResp.routeType === "ambiguous_session_reference");
check("ambiguous → clarificationRequired true", ambResp.clarificationRequired === true);

// Helper determinism.
const a = shapeManagerRouteResponse(delegate, "u");
const b = shapeManagerRouteResponse(delegate, "u");
// Only non-deterministic field is message id/timestamp; routeType + createdSession must match.
check("helper deterministic on route shape", a.routeType === b.routeType && a.createdSession?.title === b.createdSession?.title);

// Helper does not mutate input.
const before = JSON.stringify(delegate);
shapeManagerRouteResponse(delegate, "u");
check("helper does not mutate input routing", JSON.stringify(delegate) === before);

console.log(`\nRegression: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
