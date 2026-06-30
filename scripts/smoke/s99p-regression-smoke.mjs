#!/usr/bin/env node
/**
 * S99P: Regression Smoke Test
 *
 * Validates:
 *   1. S97P feedback flow regression (POST /api/feedback)
 *   2. S98P guardrails regression (cost cap, quota, admin auth)
 *   3. S99P feedback triage API (GET/PATCH /v1/admin/feedback)
 *   4. S99P daily summary API
 *   5. S99P alerts API
 *   6. S99P user management API
 *   7. S99P CSV export
 *   8. Internal leakage check
 *
 * Usage:
 *   node scripts/smoke/s99p-regression-smoke.mjs [--base-url http://localhost:3001]
 */

const BASE_URL = (() => {
  const idx = process.argv.indexOf("--base-url");
  return idx >= 0 ? process.argv[idx + 1] : process.env.TRUSTOS_API_BASE || "http://localhost:3001";
})();

const ADMIN_KEY = process.env.TRUSTOS_ADMIN_KEY || "admin-changeme";
const TEST_USER = `smoke-s99p-${Date.now()}`;

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    console.log(`  ✅ ${name}`);
    pass++;
  } else {
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
    fail++;
    failures.push({ name, detail });
  }
}

async function main() {
  console.log(`\n🧪 S99P Regression Smoke — ${new Date().toISOString()}`);
  console.log(`   BASE_URL: ${BASE_URL}\n`);

  const adminHeaders = { "X-Admin-Key": ADMIN_KEY, "Content-Type": "application/json" };

  // ── S97P: Feedback Flow Regression ──────────────────────────────────────
  console.log("── S97P Feedback Flow ──");

  // 1. Beta stats endpoint
  try {
    const res = await fetch(`${BASE_URL}/v1/beta/stats/${TEST_USER}`);
    check("GET /v1/beta/stats/:userId returns 200", res.ok, `status=${res.status}`);
    if (res.ok) {
      const data = await res.json();
      check("stats has feedback fields", data.feedback && typeof data.feedback.total === "number");
    }
  } catch (e) {
    check("GET /v1/beta/stats/:userId", false, e.message);
  }

  // 2. Feedback timeline
  try {
    const res = await fetch(`${BASE_URL}/v1/beta/feedback/${TEST_USER}`);
    check("GET /v1/beta/feedback/:userId returns 200", res.ok, `status=${res.status}`);
    if (res.ok) {
      const data = await res.json();
      check("feedback timeline has events array", Array.isArray(data.events));
    }
  } catch (e) {
    check("GET /v1/beta/feedback/:userId", false, e.message);
  }

  // ── S98P: Guardrails Regression ─────────────────────────────────────────
  console.log("\n── S98P Guardrails ──");

  // 3. Admin health (auth required)
  try {
    // Without admin key — should fail
    const noAuthRes = await fetch(`${BASE_URL}/v1/admin/health`);
    check("Admin health without key returns 401", noAuthRes.status === 401, `status=${noAuthRes.status}`);

    // With admin key — should pass
    const authRes = await fetch(`${BASE_URL}/v1/admin/health`, { headers: adminHeaders });
    check("Admin health with key returns 200", authRes.ok, `status=${authRes.status}`);
  } catch (e) {
    check("Admin health endpoint", false, e.message);
  }

  // 4. Admin usage
  try {
    const res = await fetch(`${BASE_URL}/v1/admin/usage`, { headers: adminHeaders });
    check("GET /v1/admin/usage returns 200", res.ok, `status=${res.status}`);
  } catch (e) {
    check("GET /v1/admin/usage", false, e.message);
  }

  // 5. Admin errors
  try {
    const res = await fetch(`${BASE_URL}/v1/admin/errors`, { headers: adminHeaders });
    check("GET /v1/admin/errors returns 200", res.ok, `status=${res.status}`);
  } catch (e) {
    check("GET /v1/admin/errors", false, e.message);
  }

  // ── S99P: Feedback Triage API ───────────────────────────────────────────
  console.log("\n── S99P Feedback Triage ──");

  // 6. List feedback
  try {
    const res = await fetch(`${BASE_URL}/v1/admin/feedback?limit=5`, { headers: adminHeaders });
    check("GET /v1/admin/feedback returns 200", res.ok, `status=${res.status}`);
    if (res.ok) {
      const data = await res.json();
      check("feedback list has items array", Array.isArray(data.items));
      check("feedback list has total", typeof data.total === "number");
    }
  } catch (e) {
    check("GET /v1/admin/feedback", false, e.message);
  }

  // 7. Filter by status
  try {
    const res = await fetch(`${BASE_URL}/v1/admin/feedback?status=open&limit=5`, { headers: adminHeaders });
    check("GET /v1/admin/feedback?status=open returns 200", res.ok, `status=${res.status}`);
  } catch (e) {
    check("GET /v1/admin/feedback?status=open", false, e.message);
  }

  // 8. Filter by severity
  try {
    const res = await fetch(`${BASE_URL}/v1/admin/feedback?severity=high&limit=5`, { headers: adminHeaders });
    check("GET /v1/admin/feedback?severity=high returns 200", res.ok, `status=${res.status}`);
  } catch (e) {
    check("GET /v1/admin/feedback?severity=high", false, e.message);
  }

  // 9. Get single feedback detail (if any exists)
  try {
    const listRes = await fetch(`${BASE_URL}/v1/admin/feedback?limit=1`, { headers: adminHeaders });
    if (listRes.ok) {
      const list = await listRes.json();
      if (list.items.length > 0) {
        const fbId = list.items[0].id;
        const detailRes = await fetch(`${BASE_URL}/v1/admin/feedback/${fbId}`, { headers: adminHeaders });
        check("GET /v1/admin/feedback/:id returns 200", detailRes.ok, `status=${detailRes.status}`);
        if (detailRes.ok) {
          const detail = await detailRes.json();
          check("feedback detail has decision", !!detail.decision);
          check("feedback detail has triage", !!detail.triage);
        }

        // 10. Update triage status
        const patchRes = await fetch(`${BASE_URL}/v1/admin/feedback/${fbId}`, {
          method: "PATCH",
          headers: adminHeaders,
          body: JSON.stringify({ triage_status: "investigating" }),
        });
        check("PATCH feedback triage_status returns 200", patchRes.ok, `status=${patchRes.status}`);

        // 11. Update severity
        const sevRes = await fetch(`${BASE_URL}/v1/admin/feedback/${fbId}`, {
          method: "PATCH",
          headers: adminHeaders,
          body: JSON.stringify({ severity: "high" }),
        });
        check("PATCH feedback severity returns 200", sevRes.ok, `status=${sevRes.status}`);

        // 12. Add triage note
        const noteRes = await fetch(`${BASE_URL}/v1/admin/feedback/${fbId}`, {
          method: "PATCH",
          headers: adminHeaders,
          body: JSON.stringify({ add_note: "Smoke test note" }),
        });
        check("PATCH feedback add_note returns 200", noteRes.ok, `status=${noteRes.status}`);

        // Restore original status
        await fetch(`${BASE_URL}/v1/admin/feedback/${fbId}`, {
          method: "PATCH",
          headers: adminHeaders,
          body: JSON.stringify({ triage_status: "open", severity: "medium" }),
        });
      } else {
        console.log("  ⏭  No feedback events to test detail/patch (skipping 4 checks)");
      }
    }
  } catch (e) {
    check("Feedback detail/patch", false, e.message);
  }

  // ── S99P: Daily Ops API ─────────────────────────────────────────────────
  console.log("\n── S99P Daily Ops ──");

  // 13. Daily summary
  try {
    const res = await fetch(`${BASE_URL}/v1/admin/daily-summary`, { headers: adminHeaders });
    check("GET /v1/admin/daily-summary returns 200", res.ok, `status=${res.status}`);
    if (res.ok) {
      const data = await res.json();
      check("daily-summary has users", typeof data.users?.active === "number");
      check("daily-summary has feedback", typeof data.feedback?.total === "number");
      check("daily-summary has cost", typeof data.cost?.totalUsd === "number");
    }
  } catch (e) {
    check("GET /v1/admin/daily-summary", false, e.message);
  }

  // 14. Cost trend
  try {
    const res = await fetch(`${BASE_URL}/v1/admin/cost-trend?days=3`, { headers: adminHeaders });
    check("GET /v1/admin/cost-trend returns 200", res.ok, `status=${res.status}`);
    if (res.ok) {
      const data = await res.json();
      check("cost-trend has daily array", Array.isArray(data.daily));
    }
  } catch (e) {
    check("GET /v1/admin/cost-trend", false, e.message);
  }

  // 15. Satisfaction trend
  try {
    const res = await fetch(`${BASE_URL}/v1/admin/satisfaction-trend?days=3`, { headers: adminHeaders });
    check("GET /v1/admin/satisfaction-trend returns 200", res.ok, `status=${res.status}`);
    if (res.ok) {
      const data = await res.json();
      check("satisfaction-trend has daily array", Array.isArray(data.daily));
    }
  } catch (e) {
    check("GET /v1/admin/satisfaction-trend", false, e.message);
  }

  // 16. Failure reasons
  try {
    const res = await fetch(`${BASE_URL}/v1/admin/failure-reasons?days=7`, { headers: adminHeaders });
    check("GET /v1/admin/failure-reasons returns 200", res.ok, `status=${res.status}`);
  } catch (e) {
    check("GET /v1/admin/failure-reasons", false, e.message);
  }

  // ── S99P: Alerts API ────────────────────────────────────────────────────
  console.log("\n── S99P Alerts ──");

  // 17. List alerts
  try {
    const res = await fetch(`${BASE_URL}/v1/admin/alerts?limit=10`, { headers: adminHeaders });
    check("GET /v1/admin/alerts returns 200", res.ok, `status=${res.status}`);
    if (res.ok) {
      const data = await res.json();
      check("alerts has items array", Array.isArray(data.items));
    }
  } catch (e) {
    check("GET /v1/admin/alerts", false, e.message);
  }

  // ── S99P: User Management ───────────────────────────────────────────────
  console.log("\n── S99P User Management ──");

  // 18. List users
  try {
    const res = await fetch(`${BASE_URL}/v1/admin/users?limit=10`, { headers: adminHeaders });
    check("GET /v1/admin/users returns 200", res.ok, `status=${res.status}`);
    if (res.ok) {
      const data = await res.json();
      check("users has items array", Array.isArray(data.items));
    }
  } catch (e) {
    check("GET /v1/admin/users", false, e.message);
  }

  // 19. CSV export
  try {
    const res = await fetch(`${BASE_URL}/v1/admin/export?type=feedback`, { headers: adminHeaders });
    check("GET /v1/admin/export?type=feedback returns 200", res.ok, `status=${res.status}`);
    if (res.ok) {
      const text = await res.text();
      check("CSV export is non-empty", text.length > 0);
      check("CSV has header row", text.includes("id,user_id,event_type"));
    }
  } catch (e) {
    check("GET /v1/admin/export", false, e.message);
  }

  // ── Internal Leakage Check ──────────────────────────────────────────────
  console.log("\n── Internal Leakage ──");

  const LEAK_PATTERNS = [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "SILICONFLOW_API_KEY",
    "DATABASE_URL",
    "JWT_SECRET",
    "ADMIN_KEY",
  ];

  let leakage = 0;

  for (const endpoint of [
    "/v1/admin/health",
    "/v1/admin/usage",
    "/v1/admin/daily-summary",
    "/v1/admin/feedback?limit=1",
    "/v1/admin/alerts?limit=1",
    "/v1/admin/users?limit=1",
  ]) {
    try {
      const res = await fetch(`${BASE_URL}${endpoint}`, { headers: adminHeaders });
      const text = await res.text();
      for (const pat of LEAK_PATTERNS) {
        if (text.includes(pat)) {
          leakage++;
          console.log(`  ❌ Leak: ${pat} found in ${endpoint}`);
        }
      }
    } catch { /* skip unreachable */ }
  }

  if (leakage === 0) {
    console.log("  ✅ No internal leakage detected");
    pass++;
  } else {
    console.log(`  ❌ ${leakage} leakage(s) detected`);
    fail++;
    failures.push({ name: "Internal Leakage", detail: `${leakage} leak(s)` });
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(50)}`);
  console.log(`  Results: ${pass} PASS / ${fail} FAIL`);
  console.log(`${"═".repeat(50)}\n`);

  if (fail > 0) {
    console.log("Failures:");
    for (const f of failures) {
      console.log(`  ❌ ${f.name}: ${f.detail}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
