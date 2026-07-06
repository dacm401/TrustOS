// S100P Phase 2 — Routing & Visibility API Smoke Test
// Tests POST /v1/manager/route-message end-to-end against live server.
//
// Scenarios:
//   1. Normal conversation (no keywords)
//   2. New delegated task (delegation keyword)
//   3a. Update existing session (explicit targetSessionId)
//   3b. Update existing session (reference match)
//   4. Ambiguous session reference (multiple sessions, no unique match)
//   5. Visibility verification on created session events
//   6. Ownership: route-message is user-scoped (cross-user session not matched)
//
// Run: node scripts/smoke/s100p-routing-smoke.mjs
//   (requires server running on localhost:3001)

const BASE = "http://localhost:3001";

const results = [];
function record(step, label, pass, note = "") {
  results.push({ step, label, pass, note });
  console.log(`${pass ? "✅" : "❌"} [${step}] ${label} ${note}`);
}

async function api(method, path, body, headers = {}) {
  const url = `${BASE}${path}`;
  const opts = { method, headers: { "Content-Type": "application/json", ...headers } };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(url, opts);
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, body: json, text };
  } catch (e) {
    return { status: 0, body: null, text: e.message };
  }
}

async function main() {
  console.log("=== S100P Phase 2 Routing Smoke ===\n");

  // Unique user per run to avoid interference from previous test sessions
  const runId = `p2-${Date.now()}`;
  const userA = `s100p-${runId}`;
  const userB = `s100p-other-${runId}`;

  // Auth
  const authRes = await api("POST", "/auth", { username: "admin", password: "changeme" });
  let token = null;
  if (authRes.status === 200 && authRes.body?.token) {
    token = authRes.body.token;
    console.log(`✅ Auth: got JWT token`);
  } else {
    console.log(`⚠️ Auth failed (${authRes.status}), using X-User-Id header fallback`);
  }
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
  const headersA = { ...authHeaders, "X-User-Id": userA };
  const headersB = { ...authHeaders, "X-User-Id": userB };

  let allPass = true;

  // ── Scenario 1: Normal conversation ──────────────────────────────
  console.log("\n--- Scenario 1: Normal Conversation ---");
  {
    const res = await api("POST", "/v1/manager/route-message", {
      conversationId: `${runId}-conv-1`,
      message: "你好，今天天气怎么样",
    }, headersA);

    const b = res.body;
    const pass = res.status === 200
      && b?.routeType === "normal_conversation"
      && b?.createdSession === null
      && b?.sessionEvent === null
      && b?.clarificationRequired === false;
    record("S1", "normal_conversation", pass,
      `status=${res.status} routeType=${b?.routeType} clarificationRequired=${b?.clarificationRequired}`);
    if (!pass) { allPass = false; console.log("   Response:", res.text); }
  }

  // ── Scenario 2: New delegated task ───────────────────────────────
  console.log("\n--- Scenario 2: New Delegated Task ---");
  let newSessionId = null;
  {
    const res = await api("POST", "/v1/manager/route-message", {
      conversationId: `${runId}-conv-2`,
      message: "帮我修一下登录页的样式",
    }, headersA);

    const b = res.body;
    newSessionId = b?.createdSession?.id;
    const pass = res.status === 200
      && b?.routeType === "new_delegated_task"
      && !!b?.createdSession
      && b?.createdSession?.status === "planning"
      && b?.sessionEvent?.type === "session.created"
      && b?.sessionEvent?.visibility === "session_timeline"
      && b?.clarificationRequired === false
      && !!newSessionId;
    record("S2", "new_delegated_task", pass,
      `status=${res.status} routeType=${b?.routeType} sessionId=${newSessionId} evtType=${b?.sessionEvent?.type} vis=${b?.sessionEvent?.visibility}`);
    if (!pass) { allPass = false; console.log("   Response:", res.text); }
  }

  // ── Scenario 3a: Update existing session (explicit target) ───────
  console.log("\n--- Scenario 3a: Update Existing Session (explicit target) ---");
  {
    const res = await api("POST", "/v1/manager/route-message", {
      conversationId: `${runId}-conv-3`,
      message: "把按钮颜色改成蓝色",
      targetSessionId: newSessionId,
    }, headersA);

    const b = res.body;
    const pass = res.status === 200
      && b?.routeType === "update_existing_session"
      && b?.targetSessionId === newSessionId
      && b?.createdSession === null
      && b?.sessionEvent?.type === "session.updated"
      && b?.sessionEvent?.visibility === "session_timeline"
      && b?.clarificationRequired === false;
    record("S3a", "update_existing_session (explicit)", pass,
      `status=${res.status} routeType=${b?.routeType} target=${b?.targetSessionId} evtType=${b?.sessionEvent?.type} vis=${b?.sessionEvent?.visibility}`);
    if (!pass) { allPass = false; console.log("   Response:", res.text); }
  }

  // ── Scenario 3b: Update via reference match ──────────────────────
  console.log("\n--- Scenario 3b: Update via Reference Match ---");
  // Create a session with a distinctive title for reference matching
  let refSessionId = null;
  {
    const createRes = await api("POST", "/v1/agent-sessions", {
      title: "登录页面重构",
      goal: "Refactor the login page",
      status: "planning",
      risk_level: "low",
    }, headersA);
    refSessionId = createRes.body?.session?.id;

    const res = await api("POST", "/v1/manager/route-message", {
      conversationId: `${runId}-conv-4`,
      message: "登录页面那个任务，再加个验证码",
    }, headersA);

    const b = res.body;
    const pass = res.status === 200
      && b?.routeType === "update_existing_session"
      && b?.targetSessionId === refSessionId
      && b?.sessionEvent?.type === "session.updated";
    record("S3b", "update_existing_session (reference)", pass,
      `status=${res.status} routeType=${b?.routeType} target=${b?.targetSessionId} refSession=${refSessionId} evtType=${b?.sessionEvent?.type}`);
    if (!pass) { allPass = false; console.log("   Response:", res.text); }
  }

  // ── Scenario 4: Ambiguous session reference ──────────────────────
  console.log("\n--- Scenario 4: Ambiguous Session Reference ---");
  // At this point userA has 2+ active sessions (from S2 and S3b).
  // Create one more to ensure ambiguity.
  {
    const createRes = await api("POST", "/v1/agent-sessions", {
      title: "数据库迁移",
      goal: "Migrate database schema",
      status: "planning",
      risk_level: "low",
    }, headersA);

    const res = await api("POST", "/v1/manager/route-message", {
      conversationId: `${runId}-conv-5`,
      message: "那个任务怎么样了",
    }, headersA);

    const b = res.body;
    const pass = res.status === 200
      && b?.routeType === "ambiguous_session_reference"
      && b?.clarificationRequired === true
      && b?.createdSession === null
      && b?.sessionEvent === null
      && typeof b?.managerMessage?.content === "string"
      && b?.managerMessage?.content.includes("「");
    record("S4", "ambiguous_session_reference", pass,
      `status=${res.status} routeType=${b?.routeType} clarificationRequired=${b?.clarificationRequired} msg="${b?.managerMessage?.content?.substring(0, 50)}..."`);
    if (!pass) { allPass = false; console.log("   Response:", res.text); }
  }

  // ── Scenario 5: Visibility verification ──────────────────────────
  console.log("\n--- Scenario 5: Visibility Verification ---");
  {
    // Check events on the session created in S2
    const evtRes = await api("GET", `/v1/session-events?sessionId=${newSessionId}`, null, headersA);
    const events = evtRes.body?.events || [];

    // Find the session.created event (from S2 routing)
    const createdEvt = events.find(e => e.type === "session.created");
    const passCreated = !!createdEvt && createdEvt.visibility === "session_timeline";
    record("S5a", "session.created → session_timeline", passCreated,
      `found=${!!createdEvt} vis=${createdEvt?.visibility}`);

    // Find the session.updated event (from S3a routing)
    const updatedEvt = events.find(e => e.type === "session.updated");
    const passUpdated = !!updatedEvt && updatedEvt.visibility === "session_timeline";
    record("S5b", "session.updated → session_timeline", passUpdated,
      `found=${!!updatedEvt} vis=${updatedEvt?.visibility}`);

    // Verify no events have invalid visibility values
    const validVisibilities = ["silent_audit", "session_timeline", "approval_required", "manager_chat_summary", "trust_report_only", "critical_alert"];
    const allValid = events.every(e => validVisibilities.includes(e.visibility));
    record("S5c", "all event visibilities valid", allValid,
      `eventCount=${events.length} allValid=${allValid}`);

    if (!passCreated || !passUpdated || !allValid) allPass = false;
  }

  // ── Scenario 6: Ownership / user-scoping ─────────────────────────
  console.log("\n--- Scenario 6: Ownership / User-Scoping ---");
  {
    // User B sends a message referencing User A's session by targetSessionId.
    // The router fetches User B's own active sessions (none), so the
    // target_session_id won't be found → should fall through, NOT update A's session.
    const res = await api("POST", "/v1/manager/route-message", {
      conversationId: `${runId}-conv-b`,
      message: "更新一下这个",
      targetSessionId: newSessionId, // User A's session
    }, headersB);

    const b = res.body;
    // target_session_id not in User B's active sessions → falls through
    // "更新一下这个" has no delegation keyword, no reference keyword → normal_conversation
    const pass = res.status === 200
      && b?.routeType === "normal_conversation"
      && b?.targetSessionId === null
      && b?.createdSession === null;
    record("S6", "cross-user target_session_id not matched", pass,
      `status=${res.status} routeType=${b?.routeType} target=${b?.targetSessionId}`);
    if (!pass) { allPass = false; console.log("   Response:", res.text); }

    // Verify User B cannot see User A's session events
    const evtRes = await api("GET", `/v1/session-events?sessionId=${newSessionId}`, null, headersB);
    record("S6b", "cross-user session-events → 403", evtRes.status === 403,
      `status=${evtRes.status}`);
    if (evtRes.status !== 403) allPass = false;
  }

  // ── Input validation ─────────────────────────────────────────────
  console.log("\n--- Input Validation ---");
  {
    // Missing conversationId
    const r1 = await api("POST", "/v1/manager/route-message", {
      message: "hello",
    }, headersA);
    record("V1", "missing conversationId → 400", r1.status === 400, `status=${r1.status}`);
    if (r1.status !== 400) allPass = false;

    // Missing message
    const r2 = await api("POST", "/v1/manager/route-message", {
      conversationId: `${runId}-conv-v`,
    }, headersA);
    record("V2", "missing message → 400", r2.status === 400, `status=${r2.status}`);
    if (r2.status !== 400) allPass = false;

    // Empty message
    const r3 = await api("POST", "/v1/manager/route-message", {
      conversationId: `${runId}-conv-v`,
      message: "   ",
    }, headersA);
    record("V3", "empty message → 400", r3.status === 400, `status=${r3.status}`);
    if (r3.status !== 400) allPass = false;
  }

  // ── Summary ──────────────────────────────────────────────────────
  console.log("\n=== Summary ===");
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`Passed: ${passed}/${results.length}, Failed: ${failed}`);

  if (failed > 0) {
    console.log("\n❌ FAILED checks:");
    results.filter(r => !r.pass).forEach(r => {
      console.log(`  - [${r.step}] ${r.label} ${r.note}`);
    });
  }

  const fs = await import("fs");
  fs.writeFileSync("s100p-routing-smoke-result.json", JSON.stringify(results, null, 2));

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Smoke test failed:", err.message);
  process.exit(1);
});
