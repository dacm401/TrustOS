/**
 * TRST-4H-I — Manager Routing Integration v0 — Regression
 *
 * Broader coverage of the REAL routeMessage path after classifier integration,
 * ensuring sealed routing behavior is preserved and no silent misroute.
 *
 * Run: npx tsx scripts/trst4h-i/run-regression.mts
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

console.log("TRST-4H-I Routing Integration — Regression");

const noSessions: ActiveSessionSummary[] = [];
const single: ActiveSessionSummary[] = [{ id: "s1", title: "登录页面重构", goal: "x", status: "planning" }];
const base = { user_id: "u", conversation_id: "c" };

// Delegation route via classifier heuristic (no keyword hit).
const cases: Array<[string, "new_delegated_task" | "normal_conversation" | "ask_clarification"]> = [
  ["求解下面的问题", "new_delegated_task"],
  ["帮我计算一下这组数据的标准差", "new_delegated_task"],
  ["请评估并优化数据库查询性能", "new_delegated_task"],
  ["翻译这段英文", "new_delegated_task"],
  ["写一个脚本抓取数据", "new_delegated_task"],
  ["你好", "normal_conversation"],
  ["今天天气不错", "normal_conversation"],
  ["谢谢", "normal_conversation"],
  ["怎么弄？", "ask_clarification"],
  ["什么意思", "ask_clarification"],
];

for (const [msg, expected] of cases) {
  const r = routeMessage({ ...base, message: msg, target_session_id: null, active_sessions: noSessions });
  check(`"${msg}" → ${expected}`, r.route_type === expected, `(got ${r.route_type})`);
}

// Sealed behaviors preserved.
// 1. Explicit target_session_id → update_existing_session
const rTarget = routeMessage({ ...base, message: "把按钮改成蓝色", target_session_id: "s1", active_sessions: single });
check("explicit target → update_existing_session", rTarget.route_type === "update_existing_session");

// 2. Reference keyword + unique session → update_existing_session
const rRef = routeMessage({ ...base, message: "登录页面那个任务，再加个验证码", target_session_id: null, active_sessions: single });
check("reference match → update_existing_session", rRef.route_type === "update_existing_session");

// 3. Reference keyword + multiple sessions + no match → ambiguous_session_reference
const multi: ActiveSessionSummary[] = [
  { id: "s1", title: "登录页面重构", goal: "x", status: "planning" },
  { id: "s2", title: "数据库迁移", goal: "y", status: "planning" },
];
const rAmb = routeMessage({ ...base, message: "那个任务怎么样了", target_session_id: null, active_sessions: multi });
check("ambiguous ref → ambiguous_session_reference", rAmb.route_type === "ambiguous_session_reference");
check("ambiguous → clarification_required true", rAmb.clarification_required === true);

// 4. Delegation priority over classifier normal — keyword still wins
const rKw = routeMessage({ ...base, message: "帮我生成报告", target_session_id: null, active_sessions: noSessions });
check("keyword 帮我 still wins → new_delegated_task", rKw.route_type === "new_delegated_task");

// 5. ask_clarification mapping is explicit (not ambient_session_reference)
const rClar = routeMessage({ ...base, message: "怎么弄？", target_session_id: null, active_sessions: noSessions });
check("ask_clarification is its own route_type", rClar.route_type === "ask_clarification");
check("ask_clarification honest msg", /补充|了解更多信息/.test(rClar.manager_message_content));

// 6. Normal greeting not misrouted to delegate
const rGreet = routeMessage({ ...base, message: "在吗", target_session_id: null, active_sessions: noSessions });
check("casual 在吗 → normal_conversation", rGreet.route_type === "normal_conversation");

console.log(`\nRegression: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
