// S100P Phase 1.5 — API Smoke Verification Script
// Tests all S100P API endpoints, ownership checks, and event boundary

const BASE = "http://localhost:3001";

// Results collector
const results = [];
function record(step, method, endpoint, status, pass, note = "") {
  results.push({ step, method, endpoint, status, pass, note });
  console.log(`${pass ? "✅" : "❌"} [${step}] ${method} ${endpoint} → ${status} ${note}`);
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
  console.log("=== S100P Phase 1.5 API Smoke ===\n");

  // ── Auth: Get JWT token ──────────────────────────────────────────
  console.log("--- Authentication ---");
  const authRes = await api("POST", "/auth", { username: "admin", password: "changeme" });
  let token = null;
  if (authRes.status === 200 && authRes.body?.token) {
    token = authRes.body.token;
    console.log(`✅ Auth: got JWT token (len=${token.length})`);
  } else {
    console.log(`⚠️ Auth failed (${authRes.status}), will use X-User-Id header fallback`);
  }
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

  // ── User A and User B headers for ownership tests ────────────────
  const userAHeaders = { ...authHeaders, "X-User-Id": "smoke-user-a" };
  const userBHeaders = { ...authHeaders, "X-User-Id": "smoke-user-b" };

  // ── Step 1: POST /v1/agent-sessions (create session) ─────────────
  console.log("\n--- Step 1: POST /v1/agent-sessions ---");
  const createRes = await api("POST", "/v1/agent-sessions", {
    title: "S100P Smoke Test Session",
    goal: "Verify Phase 1 API endpoints",
    status: "planning",
    risk_level: "low",
  }, userAHeaders);
  const sessionId = createRes.body?.session?.id;
  record("1", "POST", "/v1/agent-sessions", createRes.status,
    createRes.status === 201 && !!sessionId,
    `sessionId=${sessionId}`);

  if (!sessionId) {
    console.log("❌ Cannot continue without session ID. Aborting.");
    console.log("   Response:", createRes.text);
    await printSummary();
    return;
  }

  // ── Step 2: GET /v1/agent-sessions (list sessions) ───────────────
  console.log("\n--- Step 2: GET /v1/agent-sessions ---");
  const listRes = await api("GET", "/v1/agent-sessions", null, userAHeaders);
  const listCount = listRes.body?.total;
  const listContainsOwn = listRes.body?.sessions?.some(s => s.id === sessionId);
  record("2", "GET", "/v1/agent-sessions", listRes.status,
    listRes.status === 200 && listContainsOwn,
    `total=${listCount}, contains own=${listContainsOwn}`);

  // ── Step 3: GET /v1/agent-sessions/:id (get detail) ──────────────
  console.log("\n--- Step 3: GET /v1/agent-sessions/:id ---");
  const getRes = await api("GET", `/v1/agent-sessions/${sessionId}`, null, userAHeaders);
  record("3", "GET", "/v1/agent-sessions/:id", getRes.status,
    getRes.status === 200 && getRes.body?.session?.id === sessionId,
    `title=${getRes.body?.session?.title}`);

  // ── Step 4: PATCH /v1/agent-sessions/:id (update status) ─────────
  console.log("\n--- Step 4: PATCH /v1/agent-sessions/:id ---");
  const patchRes = await api("PATCH", `/v1/agent-sessions/${sessionId}`, { status: "running" }, userAHeaders);
  record("4", "PATCH", "/v1/agent-sessions/:id", patchRes.status,
    patchRes.status === 200 && patchRes.body?.session?.status === "running",
    `status=${patchRes.body?.session?.status}`);

  // ── Step 5: POST /v1/manager-messages (create message) ───────────
  console.log("\n--- Step 5: POST /v1/manager-messages ---");
  const msgRes = await api("POST", "/v1/manager-messages", {
    conversationId: "smoke-conv-1",
    role: "manager",
    content: "Starting delegated task for S100P smoke test",
    relatedSessionId: sessionId,
  }, userAHeaders);
  const messageId = msgRes.body?.message?.id;
  record("5", "POST", "/v1/manager-messages", msgRes.status,
    msgRes.status === 201 && !!messageId,
    `messageId=${messageId}`);

  // ── Step 6: GET /v1/manager-messages?conversationId=... ──────────
  console.log("\n--- Step 6: GET /v1/manager-messages ---");
  const msgListRes = await api("GET", "/v1/manager-messages?conversationId=smoke-conv-1", null, userAHeaders);
  const msgListContains = msgListRes.body?.messages?.some(m => m.id === messageId);
  record("6", "GET", "/v1/manager-messages", msgListRes.status,
    msgListRes.status === 200 && msgListContains,
    `total=${msgListRes.body?.total}, contains own=${msgListContains}`);

  // ── Step 7: POST /v1/session-events (create event) ───────────────
  console.log("\n--- Step 7: POST /v1/session-events ---");
  const evtRes = await api("POST", "/v1/session-events", {
    sessionId: sessionId,
    type: "worker_started",
    summary: "Worker started for S100P smoke test",
    severity: "info",
    visibility: "session_timeline",
  }, userAHeaders);
  const eventId = evtRes.body?.event?.id;
  record("7", "POST", "/v1/session-events", evtRes.status,
    evtRes.status === 201 && !!eventId,
    `eventId=${eventId}`);

  // ── Step 8: GET /v1/session-events?sessionId=... ─────────────────
  console.log("\n--- Step 8: GET /v1/session-events ---");
  const evtListRes = await api("GET", `/v1/session-events?sessionId=${sessionId}`, null, userAHeaders);
  const evtListContains = evtListRes.body?.events?.some(e => e.id === eventId);
  record("8", "GET", "/v1/session-events", evtListRes.status,
    evtListRes.status === 200 && evtListContains,
    `total=${evtListRes.body?.total}, contains own=${evtListContains}`);

  // ── Ownership Negative Tests ─────────────────────────────────────
  console.log("\n=== Ownership Negative Tests ===\n");

  // Test 1: User B cannot read User A's agent_session
  console.log("--- Negative Test 1: User B → User A's session ---");
  const negGetRes = await api("GET", `/v1/agent-sessions/${sessionId}`, null, userBHeaders);
  record("N1", "GET", "/v1/agent-sessions/:id (User B → A)", negGetRes.status,
    negGetRes.status === 403,
    `expected 403, got ${negGetRes.status}`);

  // Test 2: User B cannot read User A's session_events
  console.log("--- Negative Test 2: User B → User A's session_events ---");
  const negEvtRes = await api("GET", `/v1/session-events?sessionId=${sessionId}`, null, userBHeaders);
  record("N2", "GET", "/v1/session-events (User B → A)", negEvtRes.status,
    negEvtRes.status === 403,
    `expected 403, got ${negEvtRes.status}`);

  // Test 3: User B cannot read User A's manager_message
  console.log("--- Negative Test 3: User B → User A's manager_message ---");
  if (messageId) {
    const negMsgRes = await api("GET", `/v1/manager-messages/${messageId}`, null, userBHeaders);
    record("N3", "GET", "/v1/manager-messages/:id (User B → A)", negMsgRes.status,
      negMsgRes.status === 403,
      `expected 403, got ${negMsgRes.status}`);
  }

  // ── Event Boundary Verification ──────────────────────────────────
  console.log("\n=== Event Boundary Verification ===\n");

  // Check: manager_message does NOT appear in session_events
  console.log("--- Boundary 1: manager_message not in session_events ---");
  const evtCheckRes = await api("GET", `/v1/session-events?sessionId=${sessionId}`, null, userAHeaders);
  const managerMsgInEvents = evtCheckRes.body?.events?.some(e =>
    e.summary?.includes("Starting delegated task") || e.type === "manager"
  );
  record("B1", "CHECK", "manager_message not in session_events", 200,
    !managerMsgInEvents,
    `manager_message leaked into session_events=${managerMsgInEvents}`);

  // Check: session_event does NOT appear in manager_messages
  console.log("--- Boundary 2: session_event not in manager_messages ---");
  const msgCheckRes = await api("GET", "/v1/manager-messages?conversationId=smoke-conv-1", null, userAHeaders);
  const sessionEvtInMessages = msgCheckRes.body?.messages?.some(m =>
    m.content?.includes("Worker started") || m.role === "worker"
  );
  record("B2", "CHECK", "session_event not in manager_messages", 200,
    !sessionEvtInMessages,
    `session_event leaked into manager_messages=${sessionEvtInMessages}`);

  // Check: session_events are properly typed (not chat messages)
  console.log("--- Boundary 3: session_events have proper event types ---");
  const evtTypes = evtCheckRes.body?.events?.map(e => e.type) || [];
  const allEventTypes = evtTypes.every(t => t !== "chat_message" && t !== "user_message" && t !== "assistant_message");
  record("B3", "CHECK", "session_events have event types (not chat)", 200,
    allEventTypes,
    `types=${JSON.stringify(evtTypes)}`);

  // ── Summary ──────────────────────────────────────────────────────
  await printSummary();
}

async function printSummary() {
  console.log("\n=== Summary ===");
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`Passed: ${passed}/${results.length}, Failed: ${failed}`);

  if (failed > 0) {
    console.log("\n❌ FAILED checks:");
    results.filter(r => !r.pass).forEach(r => {
      console.log(`  - [${r.step}] ${r.method} ${r.endpoint} → ${r.status} ${r.note}`);
    });
  }

  // Write results to file for report
  const fs = await import("fs");
  fs.writeFileSync("s100p-api-smoke-result.json", JSON.stringify(results, null, 2));

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Smoke test failed:", err.message);
  process.exit(1);
});
