/**
 * S64P Budget single message test - verify bypass path budget field
 * Simulates MSG3 (revision bypass) with pre-built history
 */
import http from "http";

const SESSION = "budget-single-" + Date.now();
const USER = "budget-test";

// Simulate history with an artifact (from MSG1)
const history = [
  { role: "user", content: "帮我写一个 React 登录页，包含用户名、密码、校验和提交按钮。" },
  {
    role: "assistant",
    content: "import React from 'react'; export default function LoginPage() { return <div className=\"login\"><h1 className=\"text-xl font-bold\">Login</h1><button className=\"bg-green-500\">Login</button></div>; }",
    meta: {
      origin: "worker",
      contentKind: "code",
      taskId: "mock-task-111",
      artifactId: "mock-artifact-111",
      summaryForManager: "React login page with username, password, validation, submit button.",
    },
  },
];

async function collectSSE(msg, hist, timeoutMs = 180000) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ message: msg, history: hist, userId: USER, sessionId: SESSION, stream: true });
    const events = [];
    let buf = "";
    let ended = false;
    const timer = setTimeout(() => {
      if (!ended) { ended = true; resolve({ events, timedOut: true }); }
    }, timeoutMs);

    const req = http.request("http://localhost:3001/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Accept": "text/event-stream", "X-User-Id": USER },
    }, (res) => {
      res.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw || raw === "[DONE]") continue;
          try { events.push(JSON.parse(raw)); } catch {}
        }
      });
      res.on("end", () => {
        clearTimeout(timer);
        if (!ended) { ended = true; resolve({ events, timedOut: false }); }
      });
      res.on("error", () => {
        clearTimeout(timer);
        if (!ended) { ended = true; resolve({ events, timedOut: true }); }
      });
    });
    req.on("error", (e) => {
      clearTimeout(timer);
      if (!ended) { ended = true; resolve({ events: [], timedOut: true, error: e.message }); }
    });
    req.write(body);
    req.end();
  });
}

const t = Date.now();
console.log("[budget-single] Testing MSG3 (revision bypass) with pre-built history...");
const { events, timedOut } = await collectSSE("再把标题改大一点。", history);
const ms = Date.now() - t;

const dones = events.filter(e => e.type === "done");
const budgetDone = dones.find(d => d.budget);
const budget = budgetDone?.budget || null;
const ledger = dones.find(d => d.ledger?.managerCalls !== undefined)?.ledger || null;

console.log(`\nDone in ${ms}ms, timedOut=${timedOut}, events=${events.length}`);
console.log(`done count: ${dones.length}`);
console.log(`budget: ${JSON.stringify(budget)?.slice(0, 400) ?? "null"}`);
console.log(`ledger: managerCalls=${ledger?.managerCalls} workerCalls=${ledger?.workerCalls}`);

if (budget) {
  console.log("\n✅ budget.enabled =", budget.enabled);
  console.log("✅ budget.action =", budget.action);
  console.log("✅ budget.pricingKnown =", budget.pricingKnown);
  console.log("✅ budget.estimatedCostUsd =", budget.estimatedCostUsd);
  console.log("✅ budget.blocked =", budget.blocked);
  console.log("✅ budget.requestBudgetUsd =", budget.requestBudgetUsd);
} else {
  console.log("\n❌ budget is null");
  if (timedOut) console.log("  (stream timed out - server likely still processing)");
}
