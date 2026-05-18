#!/usr/bin/env node
/**
 * S64P Smoke A: Low Budget Intercept
 * 服务器需要用 TRUSTOS_REQUEST_BUDGET_USD=0.000001 启动
 */
import http from "http";

const BASE = "http://localhost:3001";

function sseCollect(message, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      message,
      history: [],
      userId: "smoke-low",
      sessionId: "smoke-low-" + Date.now(),
      stream: true,
    });
    const req = http.request(`${BASE}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        "Accept": "text/event-stream",
      },
    }, (res) => {
      const events = [];
      let buf = "";
      const timer = setTimeout(() => { req.destroy(); resolve({ events, timedOut: true }); }, timeoutMs);
      res.on("data", (c) => {
        buf += c.toString("utf8");
        const lines = buf.split("\n"); buf = lines.pop() || "";
        for (const l of lines) {
          if (!l.startsWith("data: ")) continue;
          const r = l.slice(6).trim();
          if (!r || r === "[DONE]") continue;
          try { events.push(JSON.parse(r)); } catch {}
        }
      });
      res.on("end", () => { clearTimeout(timer); resolve({ events, timedOut: false }); });
      res.on("error", (e) => { clearTimeout(timer); reject(e); });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

const { events, timedOut } = await sseCollect("帮我写一个 React 按钮组件。");
const dones = events.filter(e => e.type === "done");
const budget = dones.find(d => d.budget)?.budget ?? null;
const ledger = dones.find(d => d.ledger?.workerCalls !== undefined)?.ledger ?? null;

console.log("=== S64P Smoke A: Low Budget Intercept ===");
console.log("timedOut:", timedOut);
console.log("budget.action:", budget?.action);
console.log("budget.blocked:", budget?.blocked);
console.log("budget.requiresUserConfirm:", budget?.requiresUserConfirm);
console.log("budget.estimatedCostUsd:", budget?.estimatedCostUsd);
console.log("budget.requestBudgetUsd:", budget?.requestBudgetUsd);
console.log("workerCalls:", ledger?.workerCalls);
console.log("Full budget:", JSON.stringify(budget));

const pass = [];
const fail = [];
function check(label, cond, detail = "") {
  if (cond) { pass.push(label); console.log(`  ✅ ${label}${detail ? " — "+detail : ""}`); }
  else { fail.push(label); console.log(`  ❌ ${label}${detail ? " — "+detail : ""}`); }
}

check("budget exists", budget !== null);
check("budget.enabled = true", budget?.enabled === true);
check("action = ask_user_confirm or block", ["ask_user_confirm", "block"].includes(budget?.action), budget?.action ?? "null");
check("blocked=true or requiresUserConfirm=true",
  budget?.blocked === true || budget?.requiresUserConfirm === true,
  `blocked=${budget?.blocked} requiresConfirm=${budget?.requiresUserConfirm}`);
check("workerCalls = 0", (ledger?.workerCalls ?? 0) === 0, String(ledger?.workerCalls));

console.log(`\nResult: ${pass.length}/${pass.length+fail.length} passed`);
