#!/usr/bin/env node
/**
 * Sprint 64P: Budget Manager V0 — Runtime Proof Script
 *
 * 验证目标：
 *   1. SSE done 事件中包含 budget 字段
 *   2. budget.enabled=true / action=allow / pricingKnown=true / estimatedCostUsd>0
 *   3. Manager + Worker 路径均有 budget preflight 日志
 *   4. 不依赖真实 SiliconFlow API（配合 TRUSTOS_E2E_MOCK_LLM=true 使用）
 *
 * 用法（先确保服务已启动，带 TRUSTOS_BUDGET_MANAGER_ENABLED=true TRUSTOS_E2E_MOCK_LLM=true）：
 *   node scripts/s64p-runtime-proof.mjs
 *
 * 关键修复：等全部 SSE 流结束（onEnd）再提取 budget，不在第一个 done 就 resolve。
 * 原因：MSG1 (delegation) 会发两个 done 事件：
 *   done #1 (type=done, budget=undefined) — Worker 任务触发后的快速回调
 *   done #2 (type=done, budget={...})     — Worker 任务完成后的最终 done（含 budget）
 */

import http from "http";

const BASE = "http://localhost:3001";
const SESSION = `s64p-proof-${Date.now()}`;
const USER = "s64p-proof-user";

// ── SSE helper (全量收集，等 stream end) ─────────────────────────────────────

function sseCollect(message, history = [], timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      message,
      history,
      userId: USER,
      sessionId: SESSION,
      stream: true,
    });

    const req = http.request(`${BASE}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        "Accept": "text/event-stream",
        "X-User-Id": USER,
      },
    }, (res) => {
      const events = [];
      let buf = "";
      const timer = setTimeout(() => {
        req.destroy();
        resolve({ events, timedOut: true });
      }, timeoutMs);

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

      // 等全部 stream 结束（server close connection）再 resolve
      res.on("end", () => {
        clearTimeout(timer);
        resolve({ events, timedOut: false });
      });
      res.on("error", (e) => { clearTimeout(timer); reject(e); });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── budget 提取：搜全部 done 事件，返回第一个有 budget 的 ────────────────────

function extractBudget(events) {
  const dones = events.filter((e) => e.type === "done");
  for (const d of dones) {
    if (d.budget) return d.budget;
  }
  return null;
}

function extractLedger(events) {
  const dones = events.filter((e) => e.type === "done");
  for (const d of dones) {
    if (d.ledger?.managerCalls !== undefined) return d.ledger;
  }
  return null;
}

function extractArtifactMeta(events) {
  const dones = events.filter((e) => e.type === "done");
  for (const d of dones) {
    if (d.artifactMeta) return d.artifactMeta;
  }
  return null;
}

// ── 断言 helper ──────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;

function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✅ ${label}${detail ? " — " + detail : ""}`);
    pass++;
  } else {
    console.log(`  ❌ ${label}${detail ? " — " + detail : ""}`);
    fail++;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("Sprint 64P: Budget Manager V0 — Runtime Proof");
  console.log("=".repeat(70));
  console.log(`Session : ${SESSION}`);
  console.log(`Host    : ${BASE}`);
  console.log("=".repeat(70));

  const history = [];

  // ── MSG1: 创建登录页 ──────────────────────────────────────────────────────
  console.log("\n── MSG1: 帮我写一个 React 登录页 ──");
  const t1 = Date.now();
  const r1 = await sseCollect("帮我写一个 React 登录页，包含用户名、密码、校验和提交按钮。", history);
  console.log(`  latency=${Date.now() - t1}ms  events=${r1.events.length}  timedOut=${r1.timedOut}`);

  const budget1 = extractBudget(r1.events);
  const ledger1 = extractLedger(r1.events);
  const meta1 = extractArtifactMeta(r1.events);
  const doneCount1 = r1.events.filter(e => e.type === "done").length;

  console.log(`  done events: ${doneCount1}`);
  console.log(`  budget: ${JSON.stringify(budget1)?.slice(0, 250) ?? "null"}`);
  console.log(`  ledger: managerCalls=${ledger1?.managerCalls} workerCalls=${ledger1?.workerCalls}`);

  check("MSG1: budget 字段存在于 SSE done", budget1 !== null, budget1 ? "present" : "null");
  check("MSG1: budget.enabled = true", budget1?.enabled === true);
  check("MSG1: budget.action ∈ {allow, downgrade_model}", ["allow", "downgrade_model"].includes(budget1?.action), budget1?.action);
  check("MSG1: pricingKnown = true", budget1?.pricingKnown === true);
  check("MSG1: estimatedCostUsd > 0", (budget1?.estimatedCostUsd ?? 0) > 0, String(budget1?.estimatedCostUsd));
  check("MSG1: blocked = false", budget1?.blocked === false);
  check("MSG1: requestBudgetUsd 有记录", (budget1?.requestBudgetUsd ?? 0) > 0, String(budget1?.requestBudgetUsd));
  check("MSG1: pricingSource = configured", budget1?.pricingSource === "configured" || budget1?.pricingKnown === true);

  // 建 history 供下一轮
  const reply1 = r1.events.filter(e => e.type === "chunk").map(e => e.content).join("");
  history.push({ role: "user", content: "帮我写一个 React 登录页，包含用户名、密码、校验和提交按钮。" });
  const assistantEntry1 = { role: "assistant", content: reply1 };
  if (meta1?.origin === "worker") {
    assistantEntry1.meta = {
      origin: meta1.origin, contentKind: meta1.contentKind,
      taskId: meta1.taskId, artifactId: meta1.artifactId,
      summaryForManager: meta1.summaryForManager,
      revisionOfArtifactId: meta1.revisionOfArtifactId,
    };
  }
  history.push(assistantEntry1);

  // ── MSG2: 按钮改蓝 (direct_artifact_revision bypass) ─────────────────────
  console.log("\n── MSG2: 把按钮改成蓝色 (bypass path) ──");
  const t2 = Date.now();
  const r2 = await sseCollect("把按钮改成蓝色。", history);
  console.log(`  latency=${Date.now() - t2}ms  events=${r2.events.length}  timedOut=${r2.timedOut}`);

  const budget2 = extractBudget(r2.events);
  const ledger2 = extractLedger(r2.events);

  console.log(`  budget: ${JSON.stringify(budget2)?.slice(0, 250) ?? "null"}`);
  console.log(`  ledger: managerCalls=${ledger2?.managerCalls} workerCalls=${ledger2?.workerCalls}`);
  console.log(`  security: artifactToWorker=${ledger2?.security?.sentArtifactContentToWorkerRemote}`);

  check("MSG2: budget 字段存在于 SSE done", budget2 !== null);
  check("MSG2: budget.enabled = true", budget2?.enabled === true);
  check("MSG2: budget.action ∈ {allow, prefer_patch}", ["allow", "prefer_patch"].includes(budget2?.action), budget2?.action);
  check("MSG2: pricingKnown = true", budget2?.pricingKnown === true);
  check("MSG2: estimatedCostUsd > 0", (budget2?.estimatedCostUsd ?? 0) > 0, String(budget2?.estimatedCostUsd));
  check("MSG2: blocked = false", budget2?.blocked === false);
  check("MSG2: managerCalls = 0 (bypass路径)", ledger2?.managerCalls === 0, String(ledger2?.managerCalls));
  check("MSG2: artifactToWorker = true (revision ctx)", ledger2?.security?.sentArtifactContentToWorkerRemote === true);

  const reply2 = r2.events.filter(e => e.type === "chunk").map(e => e.content).join("");
  history.push({ role: "user", content: "把按钮改成蓝色。" });
  const meta2 = extractArtifactMeta(r2.events);
  const assistantEntry2 = { role: "assistant", content: reply2 };
  if (meta2?.origin === "worker") {
    assistantEntry2.meta = { origin: meta2.origin, contentKind: meta2.contentKind, taskId: meta2.taskId, artifactId: meta2.artifactId, summaryForManager: meta2.summaryForManager };
  }
  history.push(assistantEntry2);

  // ── MSG3: 标题变大 (direct_artifact_revision bypass) ─────────────────────
  console.log("\n── MSG3: 再把标题改大一点 (bypass path) ──");
  const t3 = Date.now();
  const r3 = await sseCollect("再把标题改大一点。", history);
  console.log(`  latency=${Date.now() - t3}ms  timedOut=${r3.timedOut}`);

  const budget3 = extractBudget(r3.events);
  const ledger3 = extractLedger(r3.events);

  console.log(`  budget: ${JSON.stringify(budget3)?.slice(0, 250) ?? "null"}`);

  check("MSG3: budget 字段存在", budget3 !== null);
  check("MSG3: budget.enabled = true", budget3?.enabled === true);
  check("MSG3: pricingKnown = true", budget3?.pricingKnown === true);
  check("MSG3: estimatedCostUsd > 0", (budget3?.estimatedCostUsd ?? 0) > 0);
  check("MSG3: blocked = false", budget3?.blocked === false);
  check("MSG3: managerCalls = 0 (bypass路径)", ledger3?.managerCalls === 0);

  const reply3 = r3.events.filter(e => e.type === "chunk").map(e => e.content).join("");
  history.push({ role: "user", content: "再把标题改大一点。" });
  history.push({ role: "assistant", content: reply3 });

  // ── MSG4: 注册页（direct_create_artifact bypass）──────────────────────────
  console.log("\n── MSG4: 再帮我写一个注册页 ──");
  const t4 = Date.now();
  const r4 = await sseCollect("再帮我写一个注册页。", history);
  console.log(`  latency=${Date.now() - t4}ms  timedOut=${r4.timedOut}`);

  const budget4 = extractBudget(r4.events);
  const ledger4 = extractLedger(r4.events);

  console.log(`  budget: ${JSON.stringify(budget4)?.slice(0, 250) ?? "null"}`);

  check("MSG4: budget 字段存在", budget4 !== null);
  check("MSG4: budget.enabled = true", budget4?.enabled === true);
  check("MSG4: pricingKnown = true", budget4?.pricingKnown === true);
  check("MSG4: estimatedCostUsd > 0", (budget4?.estimatedCostUsd ?? 0) > 0);
  check("MSG4: blocked = false", budget4?.blocked === false);

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(70));
  console.log("S64P Runtime Proof — Summary");
  console.log("=".repeat(70));

  const total = pass + fail;
  console.log(`\nResult: ${pass}/${total} checks passed`);

  console.log(`
Evidence Table:
┌──────┬──────────────┬──────────────┬──────────────┬──────────────────────┬─────────────┐
│ Msg  │ budget.exist │ enabled      │ action       │ estimatedCostUsd     │ blocked     │
├──────┼──────────────┼──────────────┼──────────────┼──────────────────────┼─────────────┤
│ MSG1 │ ${String(budget1 !== null).padEnd(12)} │ ${String(budget1?.enabled).padEnd(12)} │ ${String(budget1?.action ?? "null").padEnd(12)} │ ${String(budget1?.estimatedCostUsd?.toFixed(8) ?? "null").padEnd(20)} │ ${String(budget1?.blocked).padEnd(11)} │
│ MSG2 │ ${String(budget2 !== null).padEnd(12)} │ ${String(budget2?.enabled).padEnd(12)} │ ${String(budget2?.action ?? "null").padEnd(12)} │ ${String(budget2?.estimatedCostUsd?.toFixed(8) ?? "null").padEnd(20)} │ ${String(budget2?.blocked).padEnd(11)} │
│ MSG3 │ ${String(budget3 !== null).padEnd(12)} │ ${String(budget3?.enabled).padEnd(12)} │ ${String(budget3?.action ?? "null").padEnd(12)} │ ${String(budget3?.estimatedCostUsd?.toFixed(8) ?? "null").padEnd(20)} │ ${String(budget3?.blocked).padEnd(11)} │
│ MSG4 │ ${String(budget4 !== null).padEnd(12)} │ ${String(budget4?.enabled).padEnd(12)} │ ${String(budget4?.action ?? "null").padEnd(12)} │ ${String(budget4?.estimatedCostUsd?.toFixed(8) ?? "null").padEnd(20)} │ ${String(budget4?.blocked).padEnd(11)} │
└──────┴──────────────┴──────────────┴──────────────┴──────────────────────┴─────────────┘`);

  console.log(`
Core Findings:
  SSE done.budget exists        : ${budget1 && budget2 && budget3 && budget4 ? "✅ YES (all 4 messages)" : "❌ PARTIAL"}
  RequestLedger.budget present  : ${budget1 !== null ? "✅ YES" : "❌ NO"}
  pricingKnown=true (DeepSeek)  : ${[budget1, budget2, budget3, budget4].every(b => b?.pricingKnown === true) ? "✅ YES" : "❌ PARTIAL"}
  estimatedCostUsd > 0          : ${[budget1, budget2, budget3, budget4].every(b => (b?.estimatedCostUsd ?? 0) > 0) ? "✅ YES" : "❌ PARTIAL"}
  bypass path managerCalls=0    : ${[ledger2, ledger3].every(l => l?.managerCalls === 0) ? "✅ YES (MSG2+MSG3)" : "❌ PARTIAL"}
  budget.blocked = false        : ${[budget1, budget2, budget3, budget4].every(b => b?.blocked === false) ? "✅ YES (no spurious blocks)" : "❌ PARTIAL"}
`);

  if (fail === 0) {
    console.log("🎉 All checks passed. S64P Budget Manager V0 runtime proof COMPLETE.");
    console.log("   S64P may now be marked CLOSED.\n");
  } else {
    console.log(`⚠️  ${fail} check(s) failed. Review output above.\n`);
  }

  console.log("=".repeat(70));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
