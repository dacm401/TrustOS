#!/usr/bin/env node
/**
 * Sprint 66P: E2E Runtime Proof — Quality-aware Routing V0
 *
 * 验证 S66P 两大能力：
 * 1. 高分 artifact 维持 patch-first（Good path）
 * 2. 低分 / 安全 artifact 触发 quality routing 降级（Downgrade path）
 *
 * 使用 mock LLM：TRUSTOS_E2E_MOCK_LLM=true
 *
 * Case A: Good artifact（score=0.9）
 *   → qualityRouting.decision = allow_patch_first
 *   → policyRoute = direct_artifact_revision
 *   → patchFirstDowngradedByQuality = false
 *
 * Case B: Warning artifact（score=0.75）
 *   → qualityRouting.decision = prefer_full_rewrite
 *   → qualityRouting.source = last_verification
 *
 * Case C: Bad artifact（score=0.4, passed=false）
 *   → qualityRouting.decision = force_full_rewrite
 *   → qualityRouting.source = last_verification
 *
 * Case D: Security artifact（VF-006, score=0.0）
 *   → qualityRouting.decision = block_or_full_rewrite
 *   → qualityRouting.source = last_verification
 */

import http from "http";

const BASE_URL = process.env.TRUSTOS_BASE_URL || "http://localhost:3001";
const API_TOKEN = process.env.TEST_API_TOKEN || "test-token-s66p";
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

// ── evidence extraction ──────────────────────────────────────────────────────

function extractEvidence(label, { doneEvents, resultContent, timedOut }) {
  const doneWithBudget = [...doneEvents].reverse().find(e => e.budget);
  const donePrimary = doneWithBudget || doneEvents[doneEvents.length - 1] || {};

  const ledger = donePrimary.ledger || {};
  const localManager = ledger.localManager || {};
  const budget = donePrimary.budget || null;
  const verification = donePrimary.verification || null;
  const qualityRouting = donePrimary.qualityRouting || null;
  const policyRoute = ledger.policyRoute || null;

  return {
    label,
    policyRoute,
    // Quality Routing (S66P)
    qrExists: !!qualityRouting,
    qrEnabled: qualityRouting?.enabled ?? null,
    qrSource: qualityRouting?.source ?? null,
    qrDecision: qualityRouting?.decision ?? null,
    qrLastScore: qualityRouting?.lastScore ?? null,
    qrReason: qualityRouting?.reason ?? null,
    // patchFirstEligible 降级标记
    patchFirstEligible: localManager.patchFirstEligible ?? null,
    patchFirstDegraded: localManager.patchFirstDowngradedByQuality ?? null,
    // Verifier
    verificationEnabled: verification?.enabled ?? null,
    verificationPassed: verification?.passed ?? null,
    verificationScore: verification?.score ?? null,
    // Ledger
    workerCalls: ledger.workerCalls ?? null,
    managerCalls: ledger.managerCalls ?? null,
    // S64P/S65P 字段保留检查
    budgetEnabled: budget?.enabled ?? null,
    contextPackageKind: donePrimary.contextPackage?.kind ?? null,
    // Meta
    timedOut,
    doneCount: doneEvents.length,
    artifactMeta: donePrimary.artifactMeta || null,
  };
}

// ── synthetic history helpers ────────────────────────────────────────────────

function syntheticHistory(verification) {
  return [
    {
      role: "user",
      content: "帮我写一个 React 按钮组件。",
    },
    {
      role: "assistant",
      content: "这里是一个 React 按钮组件。",
      meta: {
        origin: "worker",
        contentKind: "artifact",
        taskId: "synth-task-001",
        artifactId: "synth-artifact-001",
        contentType: "code",
        summaryForManager: "React 按钮组件",
        verification,
      },
    },
  ];
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("[s66p-proof] Starting Sprint 66P E2E Runtime Proof (v2)");
  console.log("[s66p-proof] BASE_URL:", BASE_URL);
  console.log("[s66p-proof] MOCK_LLM:", process.env.TRUSTOS_E2E_MOCK_LLM);

  const results = [];

  // ── PART 1: Good path (score=0.9) ──────────────────────────────────────────
  console.log("\n=== Part 1: Good path ===");

  const goodHist = [
    {
      role: "user",
      content: "帮我写一个 React 登录页。",
    },
    {
      role: "assistant",
      content: "登录页代码如下。",
      meta: {
        origin: "worker",
        contentKind: "artifact",
        taskId: "good-task-001",
        artifactId: "good-artifact-001",
        contentType: "code",
        summaryForManager: "React 登录页",
        verification: { enabled: true, passed: true, score: 0.9, issues: [] },
      },
    },
  ];

  console.log("\n[s66p-proof] Case A: Good artifact (score=0.9)...");
  const rA = await sseRequest("把按钮文字改成蓝色。", goodHist);
  const evA = extractEvidence("Case A Good", rA);
  console.log("[s66p-proof] Case A:", JSON.stringify(evA, null, 2));
  results.push(evA);

  // ── PART 2: Downgrade path ──────────────────────────────────────────────────

  // Case B: Warning (score=0.75, prefer_full_rewrite)
  console.log("\n=== Part 2: Downgrade paths ===");

  const warnHist = syntheticHistory({
    enabled: true,
    passed: true,
    score: 0.75,
    issues: [{ code: "VF-004", severity: "warning", message: "React structure could be improved" }],
  });

  console.log("\n[s66p-proof] Case B: Warning artifact (score=0.75)...");
  const rB = await sseRequest("把按钮颜色改成红色。", warnHist);
  const evB = extractEvidence("Case B Warning", rB);
  console.log("[s66p-proof] Case B:", JSON.stringify(evB, null, 2));
  results.push(evB);

  // Case C: Bad (score=0.4, force_full_rewrite)
  const badHist = syntheticHistory({
    enabled: true,
    passed: false,
    score: 0.4,
    issues: [{ code: "VF-002", severity: "error", message: "Empty or invalid artifact content" }],
  });

  console.log("\n[s66p-proof] Case C: Bad artifact (score=0.4)...");
  const rC = await sseRequest("把按钮改大一点。", badHist);
  const evC = extractEvidence("Case C Bad", rC);
  console.log("[s66p-proof] Case C:", JSON.stringify(evC, null, 2));
  results.push(evC);

  // Case D: Security (VF-006, block_or_full_rewrite)
  const secHist = syntheticHistory({
    enabled: true,
    passed: false,
    score: 0.0,
    issues: [{ code: "VF-006", severity: "error", message: "artifactToManager must be false" }],
  });

  console.log("\n[s66p-proof] Case D: Security artifact (VF-006)...");
  const rD = await sseRequest("再添加一个表单验证。", secHist);
  const evD = extractEvidence("Case D Security", rD);
  console.log("[s66p-proof] Case D:", JSON.stringify(evD, null, 2));
  results.push(evD);

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log("\n\n=== S66P Runtime Proof Summary ===\n");
  console.log("| Case | qrDecision | qrLastScore | qrSource | patchFirstDegraded | policyRoute | verification | budget |");
  console.log("|------|-----------|:-----------:|----------|:------------------:|------------|:------------:|:------:|");
  for (const r of results) {
    console.log(`| ${r.label} | ${r.qrDecision} | ${r.qrLastScore} | ${r.qrSource} | ${r.patchFirstDegraded} | ${r.policyRoute} | ${r.verificationPassed} | ${r.budgetEnabled} |`);
  }

  // ── Validation ──────────────────────────────────────────────────────────────
  console.log("\n=== Validation ===");
  let allPassed = true;
  const criticalFailures = [];
  const checks = [
    // Case A: Good path
    { label: "Case A", field: "qrExists", expected: true, msg: "qualityRouting exists" },
    { label: "Case A", field: "qrEnabled", expected: true, msg: "qualityRouting.enabled=true" },
    { label: "Case A", field: "qrDecision", expected: "allow_patch_first", msg: "qrDecision=allow_patch_first" },
    { label: "Case A", field: "patchFirstDegraded", expected: false, msg: "patchFirstDegraded=false (good artifact)" },
    { label: "Case A", field: "verificationEnabled", expected: true, msg: "verification.enabled=true" },
    { label: "Case A", field: "budgetEnabled", expected: true, msg: "budget.enabled=true" },
    // Case B: Warning downgrade
    { label: "Case B", field: "qrExists", expected: true, msg: "qualityRouting exists" },
    { label: "Case B", field: "qrSource", expected: "last_verification", msg: "qrSource=last_verification" },
    { label: "Case B", field: "qrDecision", expected: "prefer_full_rewrite", msg: "qrDecision=prefer_full_rewrite" },
    { label: "Case B", field: "patchFirstDegraded", expected: true, msg: "patchFirstDegraded=true (warning degrades)" },
    { label: "Case B", field: "verificationEnabled", expected: true, msg: "verification.enabled=true" },
    // Case C: Bad downgrade
    { label: "Case C", field: "qrExists", expected: true, msg: "qualityRouting exists" },
    { label: "Case C", field: "qrSource", expected: "last_verification", msg: "qrSource=last_verification" },
    { label: "Case C", field: "qrDecision", expected: "force_full_rewrite", msg: "qrDecision=force_full_rewrite" },
    { label: "Case C", field: "patchFirstDegraded", expected: true, msg: "patchFirstDegraded=true (bad artifact)" },
    { label: "Case C", field: "verificationEnabled", expected: true, msg: "verification.enabled=true" },
    // Case D: Security downgrade
    { label: "Case D", field: "qrExists", expected: true, msg: "qualityRouting exists" },
    { label: "Case D", field: "qrSource", expected: "last_verification", msg: "qrSource=last_verification" },
    { label: "Case D", field: "qrDecision", expected: "block_or_full_rewrite", msg: "qrDecision=block_or_full_rewrite" },
    { label: "Case D", field: "patchFirstDegraded", expected: true, msg: "patchFirstDegraded=true (security)" },
    { label: "Case D", field: "verificationEnabled", expected: true, msg: "verification.enabled=true" },
  ];

  // Build lookup: label → evidence object
  const lookup = {};
  for (const r of results) lookup[r.label] = r;

  for (const check of checks) {
    const ev = lookup[check.label];
    if (!ev) { console.log(`  ✗ [${check.label}] MISSING evidence`); allPassed = false; continue; }
    const val = ev[check.field];
    const ok = val === check.expected || (check.expected === null && val == null);
    if (ok) {
      console.log(`  ✓ [${check.label}] PASS: ${check.msg}`);
    } else {
      console.log(`  ✗ [${check.label}] FAIL: ${check.msg} (got: ${val}, expected: ${check.expected})`);
      allPassed = false;
      criticalFailures.push(`${check.label}.${check.field}: got ${val}, expected ${check.expected}`);
    }
  }

  // Safety: no timeouts
  for (const r of results) {
    if (r.timedOut) {
      console.log(`  ✗ [${r.label}] FAIL: timedOut`);
      allPassed = false;
    }
  }

  console.log(`\n=== S66P E2E Proof: ${allPassed ? "PASS ✅" : "FAIL ⚠️"} ===`);
  if (criticalFailures.length > 0) {
    console.log("\nCritical failures:");
    for (const f of criticalFailures) console.log(`  - ${f}`);
  }
  process.exit(allPassed ? 0 : 1);
}

main().catch((e) => {
  console.error("[s66p-proof] Fatal:", e.message);
  process.exit(1);
});
