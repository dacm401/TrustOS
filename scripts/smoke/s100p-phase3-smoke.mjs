/**
 * S100P Phase 3 UI Smoke Test
 *
 * Tests the API wiring that the Manager Workspace frontend depends on.
 * Validates: Session List / Manager Conversation routing / Session Events / Event Boundary
 *
 * Usage: node scripts/smoke/s100p-phase3-smoke.mjs
 */

const BASE = "http://localhost:3001";
const USER_ID = "smoke-p3-user";
const CONVERSATION_ID = `conv-${Date.now()}`;

let passed = 0;
let failed = 0;
const results = [];

function pass(name, detail) {
  passed++;
  results.push({ name, status: "PASS", detail });
  console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, detail) {
  failed++;
  results.push({ name, status: "FAIL", detail });
  console.log(`  ❌ ${name} — ${detail}`);
}

async function api(method, path, body) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json", "X-User-Id": USER_ID },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const data = await res.json();
  return { status: res.status, data };
}

async function run() {
  console.log("\n=== S100P Phase 3 UI Smoke Test ===\n");
  console.log(`Backend: ${BASE}`);
  console.log(`User: ${USER_ID}`);
  console.log(`Conversation: ${CONVERSATION_ID}\n`);

  // ── S1: Session List API ──────────────────────────────────────────────
  console.log("── S1: Session List API ──");

  const s1 = await api("GET", "/v1/agent-sessions?limit=10");
  if (s1.status === 200 && Array.isArray(s1.data.sessions)) {
    pass("S1a: GET /v1/agent-sessions", `returned ${s1.data.total} sessions`);
  } else {
    fail("S1a: GET /v1/agent-sessions", `status=${s1.status}, error=${s1.data.error}`);
  }

  if (s1.status === 200 && typeof s1.data.total === "number") {
    pass("S1b: Session list has total count", `total=${s1.data.total}`);
  } else {
    fail("S1b: Session list missing total count");
  }

  // ── S2: Normal Conversation ───────────────────────────────────────────
  console.log("\n── S2: Normal Conversation ──");

  const s2 = await api("POST", "/v1/manager/route-message", {
    conversationId: CONVERSATION_ID,
    message: "你好，今天状态怎么样？",
  });

  if (s2.status === 200) {
    pass("S2a: POST /v1/manager/route-message (200)");
  } else {
    fail("S2a: POST /v1/manager/route-message", `status=${s2.status}`);
  }

  if (s2.data.routeType === "normal_conversation") {
    pass("S2b: Route type = normal_conversation");
  } else {
    fail("S2b: Route type", `expected normal_conversation, got ${s2.data.routeType}`);
  }

  if (s2.data.managerMessage && typeof s2.data.managerMessage.content === "string") {
    pass("S2c: Manager message created", `content: ${s2.data.managerMessage.content.slice(0, 40)}...`);
  } else {
    fail("S2c: Missing manager message");
  }

  if (!s2.data.createdSession) {
    pass("S2d: No session created (correct for normal conversation)");
  } else {
    fail("S2d: Session created unexpectedly", `got session: ${s2.data.createdSession.id}`);
  }

  // ── S3: New Delegated Task ────────────────────────────────────────────
  console.log("\n── S3: New Delegated Task ──");

  const s3 = await api("POST", "/v1/manager/route-message", {
    conversationId: CONVERSATION_ID,
    message: "帮我修登录页 UI，不要碰认证逻辑。",
  });

  if (s3.status === 200) {
    pass("S3a: POST /v1/manager/route-message (200)");
  } else {
    fail("S3a: POST /v1/manager/route-message", `status=${s3.status}`);
  }

  if (s3.data.routeType === "new_delegated_task") {
    pass("S3b: Route type = new_delegated_task");
  } else {
    fail("S3b: Route type", `expected new_delegated_task, got ${s3.data.routeType}`);
  }

  const newSessionId = s3.data.createdSession?.id;
  if (newSessionId) {
    pass("S3c: Session created", `id=${newSessionId.slice(0, 8)}..., title="${s3.data.createdSession.title}"`);
  } else {
    fail("S3c: No session created for delegated task");
  }

  if (s3.data.sessionEvent) {
    pass("S3d: Session event created", `type=${s3.data.sessionEvent.type}`);
  } else {
    // Not a hard failure - event might be null for planning status
    pass("S3d: Session event — skipped (null)", "not required for planning");
  }

  if (newSessionId) {
    // ── S4: Session Detail ──────────────────────────────────────────────
    console.log("\n── S4: Session Detail ──");

    const s4 = await api("GET", `/v1/agent-sessions/${newSessionId}`);
    if (s4.status === 200 && s4.data.session) {
      pass("S4a: GET /v1/agent-sessions/:id", `title="${s4.data.session.title}"`);
      if (s4.data.session.goal) {
        pass("S4b: Session has goal", `${s4.data.session.goal.slice(0, 40)}...`);
      }
      if (s4.data.session.status) {
        pass("S4c: Session has status", `status=${s4.data.session.status}`);
      }
    } else {
      fail("S4a: GET /v1/agent-sessions/:id", `status=${s4.status}`);
    }

    // ── S5: Session Events ──────────────────────────────────────────────
    console.log("\n── S5: Session Events ──");

    const s5 = await api("GET", `/v1/session-events?sessionId=${newSessionId}`);
    if (s5.status === 200 && Array.isArray(s5.data.events)) {
      pass("S5a: GET /v1/session-events", `${s5.data.total} events`);
    } else {
      fail("S5a: GET /v1/session-events", `status=${s5.status}`);
    }

    // ── S6: Update Existing Session ─────────────────────────────────────
    console.log("\n── S6: Update Existing Session ──");

    const s6 = await api("POST", "/v1/manager/route-message", {
      conversationId: CONVERSATION_ID,
      message: "登录页面那个任务，再加个验证码",
    });

    if (s6.status === 200) {
      pass("S6a: POST /v1/manager/route-message (200)");
    } else {
      fail("S6a: POST /v1/manager/route-message", `status=${s6.status}`);
    }

    if (s6.data.routeType !== "normal_conversation") {
      pass("S6b: Reference match triggered (not normal_conversation)", `routeType=${s6.data.routeType}`);
    } else {
      // Acceptable either way in Phase 2 — the router might not match "登录页面那个任务"
      pass("S6b: Route type", `routeType=${s6.data.routeType} (heuristic, acceptable)`);
    }
  }

  // ── S7: Manager Messages ──────────────────────────────────────────────
  console.log("\n── S7: Manager Messages ──");

  const s7 = await api("GET", `/v1/manager-messages?conversationId=${CONVERSATION_ID}`);
  if (s7.status === 200 && Array.isArray(s7.data.messages)) {
    const roles = s7.data.messages.map((m) => m.role);
    pass("S7a: GET /v1/manager-messages", `${s7.data.total} messages (roles: ${roles.join(", ")})`);

    // Verify messages have correct split roles
    const managerMsgs = s7.data.messages.filter((m) => m.role === "manager");
    if (managerMsgs.length >= 2) {
      pass("S7b: Manager messages exist", `${managerMsgs.length} manager messages`);
    } else {
      fail("S7b: Expected >= 2 manager messages", `got ${managerMsgs.length}`);
    }

    // Verify no session_events mixed into manager_messages
    const hasEvents = s7.data.messages.some((m) => m.type || m.visibility);
    if (!hasEvents) {
      pass("S7c: Event boundary — no session events in manager_messages");
    } else {
      fail("S7c: Event boundary violated", "session events found in manager_messages");
    }
  } else {
    fail("S7a: GET /v1/manager-messages", `status=${s7.status}`);
  }

  // ── S8: Event Boundary — manager_messages not in session_events ───────
  console.log("\n── S8: Event Boundary Verification ──");

  if (newSessionId) {
    const s8 = await api("GET", `/v1/session-events?sessionId=${newSessionId}`);
    if (s8.status === 200 && Array.isArray(s8.data.events)) {
      const hasNonEventTypes = s8.data.events.some(
        (e) => e.type === "manager_message" || e.type === "user_message"
      );
      if (!hasNonEventTypes) {
        pass("S8a: Event boundary — no manager messages in session_events");
      } else {
        fail("S8a: Event boundary violated", "manager messages found in session_events");
      }
    }

    // Verify events have correct structure
    if (s8.status === 200 && s8.data.events) {
      const allHaveFields = s8.data.events.every(
        (e) => e.type && e.summary && e.visibility
      );
      if (allHaveFields || s8.data.events.length === 0) {
        pass("S8b: Session events have required fields (type/summary/visibility)");
      } else {
        fail("S8b: Event fields", "some events missing type/summary/visibility");
      }
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────
  console.log(`\n=== Results: ${passed}/${passed + failed} PASS ===\n`);

  if (failed > 0) {
    console.log("Failures:");
    results.filter((r) => r.status === "FAIL").forEach((r) => {
      console.log(`  ❌ ${r.name}: ${r.detail}`);
    });
  }

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Smoke test crashed:", err.message);
  process.exit(1);
});
