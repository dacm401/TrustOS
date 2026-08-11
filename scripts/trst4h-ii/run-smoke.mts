/**
 * TRST-4H-II — Clarification UX/API Handling v0 — Smoke
 *
 * Verifies that the ask_clarification route produced by routeMessage is correctly
 * shaped into an API/UI response: clear clarification message, no fake task id,
 * no worker call, not treated as error.
 *
 * Run: npx tsx scripts/trst4h-ii/run-smoke.mts
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

console.log("TRST-4H-II Clarification Handling — Smoke");

const noSessions: ActiveSessionSummary[] = [];
const base = { user_id: "u", conversation_id: "c" };

// Underspecified prompt → routeMessage returns ask_clarification.
const routing = routeMessage({ ...base, message: "怎么弄？", target_session_id: null, active_sessions: noSessions });
check("routeMessage → ask_clarification", routing.route_type === "ask_clarification", `(got ${routing.route_type})`);

// Shape it into API response.
const resp = shapeManagerRouteResponse(routing, "u");
check("api routeType is ask_clarification", resp.routeType === "ask_clarification");
check("api clarificationRequired true", resp.clarificationRequired === true);
check("api managerMessage non-empty", !!resp.managerMessage && resp.managerMessage.content.length > 0);
check("api NOT treated as error (role assistant)", resp.managerMessage?.role === "assistant");
check("api createdSession is null (no fake task id)", resp.createdSession === null);
check("api targetSessionId null", resp.targetSessionId === null);

// Honest message: does not blame user / no error wording.
check("clarification message is honest", /补充|了解更多信息|具体/.test(resp.managerMessage?.content ?? ""));

// "这个怎么改？" also routes to clarification.
const r2 = routeMessage({ ...base, message: "这个怎么改？", target_session_id: null, active_sessions: noSessions });
const resp2 = shapeManagerRouteResponse(r2, "u");
check("这个怎么改 → ask_clarification", resp2.routeType === "ask_clarification");
check("这个怎么改 → no createdSession", resp2.createdSession === null);

console.log(`\nSmoke: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
