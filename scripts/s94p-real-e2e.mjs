// S94P Real-Provider App-level E2E
// Usage: TRUSTOS_E2E_MOCK_LLM=false node scripts/s94p-real-e2e.mjs

const BASE = "http://localhost:3001";

async function get(url, headers = {}) {
  const res = await fetch(`${BASE}${url}`, { headers: { "X-User-Id": "s94p-e2e-real", ...headers } });
  return { status: res.status, body: await res.json() };
}

async function main() {
  const input = "帮我写一个阳光折射原理的科普网页，包含中文解释和简单的HTML页面";
  const sessionId = `s94p-real-${Date.now()}`;
  const startTime = Date.now();
  
  console.log("═══════════════════════════════════════════");
  console.log("  S94P Real-Provider App-Level E2E");
  console.log("═══════════════════════════════════════════\n");
  console.log(`Session: ${sessionId}`);
  console.log(`Input: ${input}`);
  console.log(`Provider: SiliconFlow DeepSeek-V4-Flash`);
  console.log(`Mock: ${process.env.TRUSTOS_E2E_MOCK_LLM || "false"}\n`);

  // Phase 1: SSE Chat
  console.log("── Phase 1: SSE Chat Request ──");
  let ssePass = true;
  let sseEvents = 0;
  let hasDone = false;
  let hasResult = false;
  let hasHtml = false;
  let hasKeywords = false;
  let hasTerminalSummary = false;
  let hasCost = false;
  let fullBody = "";

  try {
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-User-Id": "s94p-e2e-real" },
      body: JSON.stringify({ message: input, session_id: sessionId, stream: true, mode: "fast" }),
      signal: AbortSignal.timeout(180000),
    });

    console.log(`  HTTP Status: ${res.status}`);
    if (res.status !== 200) {
      ssePass = false;
      console.log(`  ❌ Expected 200, got ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullBody += decoder.decode(value, { stream: true });
    }
    fullBody += decoder.decode();

    console.log(`  SSE body length: ${fullBody.length} chars`);

    // Parse SSE events
    const lines = fullBody.split("\n");
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        sseEvents++;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === "done") hasDone = true;
          if (data.type === "result" || data.type === "preview") hasResult = true;
          if (data.terminalSummary) hasTerminalSummary = true;
          if (data.cost || data.cost_usd) hasCost = true;
        } catch {}
      }
    }
    console.log(`  SSE events: ${sseEvents}`);

    // Keyword check
    hasHtml = fullBody.includes("<html") || fullBody.includes("<div") || fullBody.includes("<!DOCTYPE");
    hasKeywords = fullBody.includes("阳光") || fullBody.includes("折射") || fullBody.includes("科普");
    console.log(`  hasHtml: ${hasHtml}, hasKeywords: ${hasKeywords}`);
  } catch (e) {
    ssePass = false;
    console.log(`  ❌ SSE Error: ${e.message}`);
  }

  console.log("── SSE results ──");
  const sseResult = {
    status200: ssePass,
    hasResult, hasDone, hasHtml, hasKeywords, hasTerminalSummary, hasCost,
    sseEvents
  };
  Object.entries(sseResult).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  // Wait for async write
  await new Promise(r => setTimeout(r, 2000));

  // Phase 2: Observability API
  console.log("\n── Phase 2: S94P Observability APIs ──");
  const obsCheck = {};
  
  const obs = await get("/v1/observability/summary");
  obsCheck.obsSummary = obs.status === 200;
  console.log(`  /v1/observability/summary: ${obs.status} ${obsCheck.obsSummary ? "✅" : "❌"}`);
  if (obs.body?.health) console.log(`    health: ${obs.body.health.overall}`);
  
  const errs = await get("/v1/observability/errors");
  obsCheck.obsErrors = errs.status === 200;
  console.log(`  /v1/observability/errors: ${errs.status} ${obsCheck.obsErrors ? "✅" : "❌"}`);

  // Phase 3: Task APIs
  console.log("\n── Phase 3: S94P Task/Session APIs ──");
  
  const tasks = await get("/v1/tasks/recent?limit=10");
  obsCheck.tasksRecent = tasks.status === 200;
  const taskCount = tasks.body?.total ?? 0;
  console.log(`  /v1/tasks/recent: ${tasks.status} total=${taskCount} ${obsCheck.tasksRecent ? "✅" : "❌"}`);
  if (taskCount > 0) {
    const first = tasks.body?.tasks?.[0];
    if (first) console.log(`    Latest: ${first.task_id?.substring(0, 8)}... "${first.title?.substring(0, 40)}"`);
  }

  const sessions = await get("/v1/sessions/recent");
  obsCheck.sessionsRecent = sessions.status === 200;
  console.log(`  /v1/sessions/recent: ${sessions.status} ${obsCheck.sessionsRecent ? "✅" : "❌"}`);

  // Phase 4: DB verification
  console.log("\n── Phase 4: Database Verification ──");
  
  const archiveRes = await get("/v1/tasks/recent?limit=5");
  obsCheck.taskArchive = archiveRes.body?.total > 0;
  console.log(`  task_archives entries for user: ${archiveRes.body?.total ?? 0} ${obsCheck.taskArchive ? "✅" : "❌"}`);

  // ── Summary ──
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  S94P Real-Provider E2E Complete (${elapsed}s)`);
  console.log(`═══════════════════════════════════════════`);

  const allChecks = { ...sseResult, ...obsCheck };
  const passed = Object.values(allChecks).filter(Boolean).length;
  const total = Object.values(allChecks).length;
  
  console.log("\n── Results Summary ──");
  Object.entries(allChecks).forEach(([k, v]) => console.log(`  ${v ? "✅" : "❌"} ${k}`));
  console.log(`\n  ${passed}/${total} checks passed`);

  // PM required checks
  console.log("\n── PM Acceptance Criteria ──");
  const pmChecks = [
    { name: "SSE 200", pass: ssePass },
    { name: "result contains HTML/code", pass: hasHtml },
    { name: "result keywords (阳光/折射/科普)", pass: hasKeywords },
    { name: "SSE done emitted", pass: hasDone },
    { name: "terminalSummary present", pass: hasTerminalSummary },
    { name: "task_archives 写入", pass: obsCheck.taskArchive },
    { name: "observability/summary 200", pass: obsCheck.obsSummary },
    { name: "tasks/recent 200", pass: obsCheck.tasksRecent },
    { name: "sessions/recent 200", pass: obsCheck.sessionsRecent },
  ];
  const pmPassed = pmChecks.filter(c => c.pass).length;
  pmChecks.forEach(c => console.log(`  ${c.pass ? "✅" : "❌"} ${c.name}`));
  console.log(`\n  PM: ${pmPassed}/${pmChecks.length}`);
  
  process.exit(pmPassed === pmChecks.length ? 0 : 1);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(2); });
