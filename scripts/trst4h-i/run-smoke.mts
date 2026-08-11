/**
 * TRST-4H-I — Manager Routing Integration v0 — Smoke
 *
 * Verifies the REAL routing entrypoint (routeMessage in manager-router.ts)
 * now uses the hybrid classifier, not only standalone classifier tests.
 *
 * Run: npx tsx scripts/trst4h-i/run-smoke.mts
 */

import { routeMessage } from "../../src/services/manager-routing/manager-router.js";
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

console.log("TRST-4H-I Routing Integration — Smoke");

const noSessions: ActiveSessionSummary[] = [];
const base = { user_id: "u", conversation_id: "c" };

// 24-point prompt → delegate (real path, keyword + classifier)
const r24 = routeMessage({ ...base, message: "请用3、4、9、10拼出24点", target_session_id: null, active_sessions: noSessions });
check("24-point → new_delegated_task", r24.route_type === "new_delegated_task", `(got ${r24.route_type})`);
check("24-point → created_session present", r24.created_session !== null);

// Explicit analysis → delegate
const rAna = routeMessage({ ...base, message: "帮我分析这个问题", target_session_id: null, active_sessions: noSessions });
check("analysis → new_delegated_task", rAna.route_type === "new_delegated_task");

// Design request → delegate
const rDesign = routeMessage({ ...base, message: "设计一个方案", target_session_id: null, active_sessions: noSessions });
check("design → new_delegated_task", rDesign.route_type === "new_delegated_task");

// Greeting → normal
const rHi = routeMessage({ ...base, message: "你好", target_session_id: null, active_sessions: noSessions });
check("greeting → normal_conversation", rHi.route_type === "normal_conversation");
check("greeting → no clarification_required", rHi.clarification_required === false);

// Underspecified short question → ask_clarification
const rUn = routeMessage({ ...base, message: "怎么弄？", target_session_id: null, active_sessions: noSessions });
check("underspecified → ask_clarification", rUn.route_type === "ask_clarification", `(got ${rUn.route_type})`);
check("ask_clarification → clarification_required true", rUn.clarification_required === true);

// Existing keyword fast-path still works (legacy delegation keyword)
const rLegacy = routeMessage({ ...base, message: "帮我修一下登录页", target_session_id: null, active_sessions: noSessions });
check("legacy 帮我 keyword → new_delegated_task", rLegacy.route_type === "new_delegated_task");

// Honest clarification message (does not falsely blame user)
check("clarification message is honest", /补充|了解更多信息|具体/.test(rUn.manager_message_content));

console.log(`\nSmoke: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
