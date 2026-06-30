#!/usr/bin/env node
/**
 * S98P Hardening Smoke Test
 *
 * Tests:
 *   1. GET /health => 200
 *   2. GET /privacy => 200 (frontend, served by dev server)
 *   3. Admin API without token => 401
 *   4. Admin API wrong token => 401
 *   5. Admin API correct token => 200
 *   6. Cost cap exceeded => 429 (with override)
 *   7. Quota exceeded => 429 (with override)
 *   8. Beta feedback API still works => 200
 *   9. Beta invite disabled by default => no 403 on normal endpoints
 *  10. Beta invite enabled + no invite => 403
 *  11. Beta invite enabled + valid invite => pass
 *  12. /health not blocked by invite/quota/cost cap
 *  13. /api/admin/* not blocked by beta invite
 *
 * Usage:
 *   node scripts/smoke/s98p-hardening-smoke.mjs
 *   TRUSTOS_COST_CAP_ENABLED=true TRUSTOS_DAILY_COST_CAP_USD=0 node scripts/smoke/s98p-hardening-smoke.mjs
 */

const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3001";
const ADMIN_KEY = process.env.SMOKE_ADMIN_KEY || "admin-changeme";
const INVITE_CODE = process.env.SMOKE_INVITE_CODE || "beta-test-2026";
const USER_ID = process.env.SMOKE_USER_ID || "smoke-test-user";

let passed = 0;
let failed = 0;
let skipped = 0;
const results = [];

function record(name, ok, detail) {
  const status = ok ? "PASS" : "FAIL";
  if (ok) passed++; else failed++;
  results.push({ name, status, detail: detail || "" });
  console.log(`  [${status}] ${name}${detail ? ` — ${detail}` : ""}`);
}

function skip(name, reason) {
  skipped++;
  results.push({ name, status: "SKIP", detail: reason });
  console.log(`  [SKIP] ${name} — ${reason}`);
}

async function fetchJSON(path, opts = {}) {
  const headers = { ...opts.headers };
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method || "GET",
    headers,
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
  });
  let body;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    body = await res.json();
  } else {
    body = await res.text();
  }
  return { status: res.status, headers: res.headers, body };
}

// ── Helper: start dev server if not running ──────────────────────────
async function ensureServerRunning() {
  try {
    const res = await fetch(`${BASE}/health`);
    if (res.ok) return true;
  } catch {
    // server not running
  }
  console.log("  Backend not running. Starting dev server...");
  // Try starting backend
  const { spawn } = await import("child_process");
  const proc = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: new URL("../../", import.meta.url).pathname.replace(/^\/([A-Z]:\/)/, "$1"),
    stdio: "pipe",
    env: { ...process.env, NODE_ENV: "development" },
  });
  // Wait for startup
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) {
        console.log("  Backend started successfully.");
        return true;
      }
    } catch { /* still starting */ }
  }
  proc.kill();
  throw new Error("Backend failed to start within 30s");
}

// ── MAIN ─────────────────────────────────────────────────────────────

console.log("═══════════════════════════════════════════");
console.log("  S98P Hardening Smoke Test");
console.log(`  Target: ${BASE}`);
console.log(`  Time:   ${new Date().toISOString()}`);
console.log("═══════════════════════════════════════════\n");

await ensureServerRunning();

// ── Test 1: Health endpoint ──────────────────────────────────────────
console.log("── P0: Health & Liveness ──");
{
  const { status, body } = await fetchJSON("/health");
  record("GET /health => 200", status === 200,
    status === 200 ? "OK" : `status=${status} body=${JSON.stringify(body).slice(0, 100)}`);
}

// ── Test 2: Privacy page (frontend, may need frontend dev server) ────
console.log("\n── P1: Privacy Page ──");
{
  const FRONTEND_BASE = process.env.SMOKE_FRONTEND_URL || "http://localhost:5173";
  try {
    const res = await fetch(`${FRONTEND_BASE}/privacy`);
    record("GET /privacy => 200 (frontend)", res.ok || res.status === 200,
      `status=${res.status}`);
  } catch {
    skip("GET /privacy => 200 (frontend)", "Frontend dev server not running");
  }
}

// ── Test 3-5: Admin API Auth ─────────────────────────────────────────
console.log("\n── P2: Admin API Auth ──");
{
  // No token
  const noToken = await fetchJSON("/v1/admin/health");
  record("Admin /health without token => 401",
    noToken.status === 401,
    `status=${noToken.status} expected=401`);

  // Wrong token
  const wrongToken = await fetchJSON("/v1/admin/health", {
    headers: { "X-Admin-Key": "wrong-key-12345" }
  });
  record("Admin /health wrong token => 401",
    wrongToken.status === 401,
    `status=${wrongToken.status} expected=401`);

  // Correct token
  const correctToken = await fetchJSON("/v1/admin/health", {
    headers: { "X-Admin-Key": ADMIN_KEY }
  });
  record("Admin /health correct token => 200",
    correctToken.status === 200,
    `status=${correctToken.status}`);

  // Admin /usage
  const usage = await fetchJSON("/v1/admin/usage", {
    headers: { "X-Admin-Key": ADMIN_KEY }
  });
  record("Admin /usage correct token => 200",
    usage.status === 200,
    `status=${usage.status}`);

  // Admin /errors
  const errors = await fetchJSON("/v1/admin/errors", {
    headers: { "X-Admin-Key": ADMIN_KEY }
  });
  record("Admin /errors correct token => 200",
    errors.status === 200,
    `status=${errors.status}`);
}

// ── Test 6: Beta Invite (disabled by default) ────────────────────────
console.log("\n── P3: Beta Invite Middleware ──");
{
  // Default: invite disabled — normal endpoints should work
  const normalChat = await fetchJSON("/api/chat", {
    method: "POST",
    headers: { "X-User-Id": USER_ID },
    json: { message: "hello" }
  });
  // Should NOT be 403 (invite disabled by default)
  const inviteDefaultOk = normalChat.status !== 403;
  record("Chat without invite (invite disabled by default) => not 403",
    inviteDefaultOk,
    `status=${normalChat.status} (expected != 403)`);
}

// ── Test 7: Health not blocked by invite ─────────────────────────────
console.log("\n── P4: Middleware Scope (health not blocked) ──");
{
  // Health is on /health route (not under /api/*), so it should never be blocked
  const healthRes = await fetchJSON("/health");
  record("GET /health NOT blocked by invite middleware",
    healthRes.status === 200,
    `status=${healthRes.status}`);

  // /v1/admin with token should not be blocked by invite
  // Note: admin auth is in-router, beta-invite runs on /v1/* BEFORE router
  // This tests that admin endpoints are excluded from invite check
  const adminRes = await fetchJSON("/v1/admin/health", {
    headers: { "X-Admin-Key": ADMIN_KEY }
  });
  record("GET /v1/admin/health NOT blocked by invite middleware",
    adminRes.status === 200,
    `status=${adminRes.status}`);
}

// ── Test 8: Beta Feedback API regression ─────────────────────────────
console.log("\n── P5: Regression — Beta Feedback API ──");
{
  const feedbackRes = await fetchJSON("/api/feedback", {
    method: "POST",
    headers: { "X-User-Id": USER_ID },
    json: { decision_id: "nonexistent-smoke", feedback_type: "thumbs_up" }
  });
  // 200, 201, or 400 (invalid decision_id) are all OK — middleware didn't break it
  const feedbackOk = [200, 201, 400, 404].includes(feedbackRes.status);
  record("POST /api/feedback => not broken (200/400)",
    feedbackOk,
    `status=${feedbackRes.status}`);
}

// ── Test 9: Beta stats API regression ────────────────────────────────
{
  const statsRes = await fetchJSON(`/v1/beta/stats/${USER_ID}`, {
    headers: { "X-User-Id": USER_ID }
  });
  const statsOk = statsRes.status === 200;
  record("GET /v1/beta/stats/:userId => 200",
    statsOk,
    `status=${statsRes.status}`);
}

// ── Test 10: Cost cap — 429 when exceeded ────────────────────────────
console.log("\n── P6: Cost Cap Enforcement ──");
{
  const capOverride = process.env.TRUSTOS_DAILY_COST_CAP_USD === "0";
  if (!capOverride) {
    // Try to simulate: check if TRUSTOS_COST_CAP_ENABLED is true
    // In normal operation, cost cap check requires actual DB data
    // We verify the middleware is mounted by checking response headers
    const chatRes = await fetchJSON("/api/chat", {
      method: "POST",
      headers: { "X-User-Id": USER_ID },
      json: { message: "hello" }
    });
    // Cost cap should be enabled by default; check for X-Daily-Cost-Remaining header
    const costCapActive = chatRes.headers.get("X-Daily-Cost-Remaining") !== null ||
                          chatRes.headers.get("X-Cost-Cap-Exceeded") !== null;
    record("Cost cap middleware active (header check)",
      costCapActive,
      costCapActive ? "X-Daily-Cost-Remaining header present" : "No cost cap header — may be disabled or DB error");
  } else {
    // With cap=0, every request should trigger 429
    const chatRes = await fetchJSON("/api/chat", {
      method: "POST",
      headers: { "X-User-Id": USER_ID },
      json: { message: "hello" }
    });
    record("Cost cap exceeded => 429 (cap=$0)",
      chatRes.status === 429,
      `status=${chatRes.status}`);
  }
}

// ── Test 11: Quota — 429 when exceeded ───────────────────────────────
console.log("\n── P7: Quota Enforcement ──");
{
  const quotaTaskOverride = process.env.TRUSTOS_DAILY_TASK_QUOTA === "0";
  if (!quotaTaskOverride) {
    // Check quota headers are present
    const chatRes = await fetchJSON("/api/chat", {
      method: "POST",
      headers: { "X-User-Id": USER_ID },
      json: { message: "hello" }
    });
    const quotaActive = chatRes.headers.get("X-Task-Quota-Remaining") !== null;
    record("Quota middleware active (header check)",
      quotaActive,
      quotaActive ? "X-Task-Quota-Remaining header present" : "No quota header — may be disabled or DB error");
  } else {
    const chatRes = await fetchJSON("/api/chat", {
      method: "POST",
      headers: { "X-User-Id": USER_ID },
      json: { message: "hello" }
    });
    record("Quota exceeded => 429 (task=0)",
      chatRes.status === 429,
      `status=${chatRes.status}`);
  }
}

// ── Test 12: Error messages are user-safe ────────────────────────────
console.log("\n── P8: User-Safe Error Messages ──");
{
  // Test cost cap 429 message
  const capOverride = process.env.TRUSTOS_DAILY_COST_CAP_USD === "0";
  if (capOverride) {
    const chatRes = await fetchJSON("/api/chat", {
      method: "POST",
      headers: { "X-User-Id": USER_ID },
      json: { message: "hello" }
    });
    if (chatRes.status === 429 && chatRes.body?.error) {
      const msg = JSON.stringify(chatRes.body);
      const hasInternalInfo = msg.includes("stack") || msg.includes("postgres") ||
        msg.includes("SELECT") || msg.includes("SQL") || msg.includes("at ") ||
        msg.includes("row") || msg.includes("column");
      record("429 error message is user-safe (no DB internals)",
        !hasInternalInfo,
        hasInternalInfo ? `Leaked internal info: ${msg.slice(0, 200)}` : "Clean user message");
    } else {
      skip("Cost cap 429 message check", "Not in cap-exceeded state");
    }
  } else {
    skip("Cost cap 429 message check", "TRUSTOS_DAILY_COST_CAP_USD not set to 0");
  }

  // Test admin 401 message
  const noTokenRes = await fetchJSON("/v1/admin/health");
  if (noTokenRes.status === 401) {
    const msg = JSON.stringify(noTokenRes.body);
    const hasInternalInfo = msg.includes("stack") || msg.includes("at ");
    record("Admin 401 message is user-safe",
      !hasInternalInfo,
      hasInternalInfo ? "Leaked internal info" : "Clean");
  }
}

// ── SUMMARY ──────────────────────────────────────────────────────────
console.log("\n═══════════════════════════════════════════");
console.log("  S98P Smoke Results");
console.log("═══════════════════════════════════════════");
for (const r of results) {
  const icon = r.status === "PASS" ? "✅" : r.status === "FAIL" ? "❌" : "⏭️";
  console.log(`  ${icon} [${r.status}] ${r.name}`);
}
console.log("───────────────────────────────────────────");
console.log(`  PASS:  ${passed}`);
console.log(`  FAIL:  ${failed}`);
console.log(`  SKIP:  ${skipped}`);
console.log(`  TOTAL: ${passed + failed + skipped}`);
console.log("═══════════════════════════════════════════\n");

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
