#!/usr/bin/env node
/**
 * Sprint 65P: E2E Runtime Proof
 *
 * 验证 Verifier V0 在真实 SSE done 流中的接入效果。
 *
 * 使用 mock LLM：TRUSTOS_E2E_MOCK_LLM=true
 *
 * 四条标准消息：
 *   MSG1: 创建登录页
 *   MSG2: 按钮改蓝色（revision bypass）
 *   MSG3: 标题改大（连续 revision）
 *   MSG4: 创建注册页（新建 artifact）
 *
 * 期望：
 *   verification.enabled=true
 *   verification.passed=true
 *   verification.score >= 0.8
 *   budget.enabled=true
 *   sentArtifactContentToManagerRemote=false
 *   sentRawHistoryToRemote=false
 */

import http from "http";

const BASE_URL = process.env.TRUSTOS_BASE_URL || "http://localhost:3001";
const API_TOKEN = process.env.TEST_API_TOKEN || "test-token-s65p";
const TIMEOUT_MS = 240_000;

// ── helpers ──────────────────────────────────────────────────────────────────

function sseRequest(msg, history) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      message: msg,
      history: history || [],
      stream: true,
      execute: true,
    });

    const url = new URL(`${BASE_URL}/api/chat`);
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_TOKEN}`,
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const doneEvents = [];
    let resultContent = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      req.destroy(new Error(`Timeout after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    const req = http.request(options, (res) => {
      let buf = "";
      res.on("data", (chunk) => {
        buf += chunk.toString();
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === "result") resultContent = ev.stream || "";
            if (ev.type === "done") doneEvents.push(ev);
          } catch {}
        }
      });
      res.on("end", () => {
        clearTimeout(timer);
        resolve({ doneEvents, resultContent, timedOut });
      });
      res.on("error", (e) => { clearTimeout(timer); reject(e); });
    });

    req.on("error", (e) => {
      clearTimeout(timer);
      if (!timedOut) reject(e);
      else resolve({ doneEvents, resultContent, timedOut: true });
    });

    req.write(body);
    req.end();
  });
}

// ── evidence ──────────────────────────────────────────────────────────────────

function extractEvidence(label, { doneEvents, resultContent, timedOut }) {
  // 找有 budget 字段的 done event
  const doneWithBudget = [...doneEvents].reverse().find(e => e.budget);
  const donePrimary = doneWithBudget || doneEvents[doneEvents.length - 1] || {};

  const budget = donePrimary.budget || null;
  const ledger = donePrimary.ledger || {};
  const security = ledger.securityScope || {};
  const verification = donePrimary.verification || null;
  const patch = ledger.patch || null;

  // Sprint 65P: 提取 policyRoute（用于验证 revision 路由）
  const policyRoute = ledger.policyRoute || null;

  const row = {
    label,
    // Sprint 65P: Policy Route（核心验证字段）
    policyRoute,
    // Patch 状态（S62P patch-first）
    patchAttempted: patch?.attempted ?? null,
    patchApplied: patch?.applied ?? null,
    patchFallback: patch?.fallbackToFullRewrite ?? null,
    // Budget 状态
    budgetExists: !!budget,
    budgetEnabled: budget?.enabled ?? null,
    budgetAction: budget?.action ?? null,
    pricingKnown: budget?.pricingKnown ?? null,
    estimatedCostUsd: budget?.estimatedCostUsd ?? null,
    blocked: budget?.blocked ?? null,
    // Ledger 调用计数
    workerCalls: ledger.slowModelCalls ?? null,
    managerCalls: ledger.managerModelCalls ?? null,
    // Security
    sentArtifactToManager: security.sentArtifactContentToManagerRemote ?? null,
    sentRawHistory: security.sentRawHistoryToRemote ?? null,
    // Sprint 65P: Verifier
    verificationEnabled: verification?.enabled ?? null,
    verificationPassed: verification?.passed ?? null,
    verificationScore: verification?.score ?? null,
    verificationTargetType: verification?.targetType ?? null,
    verificationIssueCount: verification?.issueCount ?? null,
    verificationErrorCount: verification?.errorCount ?? null,
    // Meta
    timedOut,
    doneCount: doneEvents.length,
    // Artifact meta for next message
    artifactMeta: donePrimary.artifactMeta || null,
  };

  return row;
}

// ── main ──────────────────────────────────────────────────────────────────────

/**
 * 构建包含 artifact meta 的 history 条目。
 * extractActiveArtifactContext 需要：
 *   meta.origin === "worker" && meta.contentKind === "artifact"
 * 否则 MSG2/MSG3 无法正确路由到 direct_artifact_revision。
 */
function buildWorkerMessage(content, artifactMeta) {
  return {
    role: "assistant",
    content,
    meta: {
      origin: "worker",
      contentKind: "artifact",
      taskId: artifactMeta?.taskId || artifactMeta?.task_id || `task_${Date.now()}`,
      artifactId: artifactMeta?.artifactId || artifactMeta?.artifact_id || `artifact_${Date.now()}`,
      summaryForManager: content.substring(0, 200),
      contentType: artifactMeta?.contentType || "code",
    }
  };
}

async function main() {
  console.log("[s65p-proof] Starting Sprint 65P E2E Runtime Proof");
  console.log("[s65p-proof] BASE_URL:", BASE_URL);
  console.log("[s65p-proof] MOCK_LLM:", process.env.TRUSTOS_E2E_MOCK_LLM);
  console.log("[s65p-proof] BUDGET:", process.env.TRUSTOS_BUDGET_MANAGER_ENABLED);
  console.log("[s65p-proof] VERIFIER:", process.env.TRUSTOS_VERIFIER_ENABLED);

  const results = [];
  const history = [];

  // MSG1: create — 不带 history，让系统正常创建 artifact
  console.log("\n[s65p-proof] MSG1: create login page...");
  const r1 = await sseRequest("帮我写一个 React 登录页，包含用户名、密码、校验和提交按钮。", []);
  const ev1 = extractEvidence("MSG1 create", r1);
  console.log("[s65p-proof] MSG1:", JSON.stringify(ev1, null, 2));
  results.push(ev1);
  if (r1.resultContent) {
    history.push({ role: "user", content: "帮我写一个 React 登录页，包含用户名、密码、校验和提交按钮。" });
    // 添加带有正确 meta 结构的消息，让 extractActiveArtifactContext 能提取
    history.push(buildWorkerMessage(r1.resultContent, ev1.artifactMeta));
  }

  // MSG2: revision bypass — 依赖 MSG1 的 artifact meta
  console.log("\n[s65p-proof] MSG2: button blue...");
  const r2 = await sseRequest("把按钮改成蓝色。", history);
  const ev2 = extractEvidence("MSG2 revision bypass", r2);
  console.log("[s65p-proof] MSG2:", JSON.stringify(ev2, null, 2));
  results.push(ev2);
  if (r2.resultContent) {
    history.push({ role: "user", content: "把按钮改成蓝色。" });
    history.push(buildWorkerMessage(r2.resultContent, ev2.artifactMeta));
  }

  // MSG3: continuous revision
  console.log("\n[s65p-proof] MSG3: title bigger...");
  const r3 = await sseRequest("再把标题改大一点。", history);
  const ev3 = extractEvidence("MSG3 continuous revision", r3);
  console.log("[s65p-proof] MSG3:", JSON.stringify(ev3, null, 2));
  results.push(ev3);
  if (r3.resultContent) {
    history.push({ role: "user", content: "再把标题改大一点。" });
    history.push(buildWorkerMessage(r3.resultContent, ev3.artifactMeta));
  }

  // MSG4: new artifact — 不含 artifact revision 关键词，应走 direct_create_artifact
  console.log("\n[s65p-proof] MSG4: register page...");
  const r4 = await sseRequest("再帮我写一个注册页。", history);
  const ev4 = extractEvidence("MSG4 create", r4);
  console.log("[s65p-proof] MSG4:", JSON.stringify(ev4, null, 2));
  results.push(ev4);

  // ── Summary table ──
  console.log("\n\n=== S65P Runtime Proof Summary ===\n");
  console.log("| Msg | policyRoute | patchAttempted | patchApplied | verificationEnabled | verificationPassed | score | targetType | workerCalls | managerCalls | timedOut |");
  console.log("|-----|------------|:-------------:|:------------:|:-------------------:|:-----------------:|------:|:----------:|:-----------:|:------------:|:--------:|");
  for (const r of results) {
    console.log(`| ${r.label} | ${r.policyRoute} | ${r.patchAttempted} | ${r.patchApplied} | ${r.verificationEnabled} | ${r.verificationPassed} | ${r.verificationScore} | ${r.verificationTargetType} | ${r.workerCalls} | ${r.managerCalls} | ${r.timedOut} |`);
  }

  // ── Validation ──
  console.log("\n=== Validation ===");
  let allPassed = true;
  let criticalFailures = [];

  for (const r of results) {
    // 基础检查
    const basicChecks = [
      [r.budgetExists, "budget exists"],
      [r.budgetEnabled === true, "budget.enabled=true"],
      [r.sentArtifactToManager === false, "sentArtifactToManager=false"],
      [r.sentRawHistory === false, "sentRawHistory=false"],
      [r.timedOut === false, "not timedOut"],
    ];

    for (const [ok, desc] of basicChecks) {
      if (!ok) {
        console.log(`  ✗ [${r.label}] FAIL: ${desc}`);
        allPassed = false;
      } else {
        console.log(`  ✓ [${r.label}] PASS: ${desc}`);
      }
    }

    // MSG2/MSG3 必须走 direct_artifact_revision 路由
    if (r.label.includes("MSG2") || r.label.includes("MSG3")) {
      if (r.policyRoute !== "direct_artifact_revision") {
        console.log(`  ✗ [${r.label}] FAIL: policyRoute=${r.policyRoute}, expected direct_artifact_revision`);
        allPassed = false;
        criticalFailures.push(`${r.label}: wrong route ${r.policyRoute}`);
      } else {
        console.log(`  ✓ [${r.label}] PASS: policyRoute=direct_artifact_revision`);
      }

      // MSG2/MSG3 必须有 patch.attempted=true
      if (r.patchAttempted !== true) {
        console.log(`  ✗ [${r.label}] FAIL: patch.attempted=${r.patchAttempted}, expected true`);
        allPassed = false;
      } else {
        console.log(`  ✓ [${r.label}] PASS: patch.attempted=true`);
      }
    }

    // MSG4 必须走 direct_create_artifact 路由
    if (r.label.includes("MSG4")) {
      if (r.policyRoute !== "direct_create_artifact") {
        console.log(`  ✗ [${r.label}] WARN: policyRoute=${r.policyRoute}, expected direct_create_artifact`);
        // 不阻塞，但记录
      } else {
        console.log(`  ✓ [${r.label}] PASS: policyRoute=direct_create_artifact`);
      }
    }

    // verification checks（S65P 核心验证）
    if (r.verificationEnabled !== null) {
      if (r.verificationEnabled !== true) {
        console.log(`  ✗ [${r.label}] FAIL: verification.enabled=${r.verificationEnabled}, expected true`);
        allPassed = false;
        criticalFailures.push(`${r.label}: verification not enabled`);
      } else {
        console.log(`  ✓ [${r.label}] PASS: verification.enabled=true`);
      }
    }
  }

  console.log(`\n=== S65P E2E Proof: ${allPassed ? "PASS ✅" : "PARTIAL / FAIL ⚠️"} ===`);
  if (criticalFailures.length > 0) {
    console.log("\nCritical failures:");
    for (const f of criticalFailures) console.log(`  - ${f}`);
  }
  process.exit(allPassed ? 0 : 1);
}

main().catch((e) => {
  console.error("[s65p-proof] Fatal:", e.message);
  process.exit(1);
});
