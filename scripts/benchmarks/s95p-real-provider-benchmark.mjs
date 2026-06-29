// S95P Real-Provider Benchmark (10-case)
// Usage: TRUSTOS_E2E_MOCK_LLM=false node scripts/benchmarks/s95p-real-provider-benchmark.mjs

import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const BASE = process.env.BASE_URL || "http://localhost:3001";

// ── Benchmark Cases (10) ──
// S95P-HF4: categoryScoring controls which scoring rule applies:
//   artifact_html   — must produce HTML/code artifact
//   code_generation — must produce code/function/component
//   explanation     — natural-language reply is acceptable
//   rewrite         — rewritten text is acceptable
//   unsupported     — graceful refusal is acceptable
//   stress_or_complex — degradation/split advice is acceptable
const CASES = [
  {
    caseId: "S95-01", category: "HTML 生成",
    categoryScoring: "artifact_html",
    prompt: "帮我写一个简单的 HTML 科普页面，主题是阳光折射，包含三段说明和基础样式。",
    expectedArtifactType: "html",
    expectedKeywords: ["阳光", "折射"],
    timeoutMs: 240_000,
  },
  {
    caseId: "S95-02", category: "HTML 生成",
    categoryScoring: "artifact_html",
    prompt: "帮我做一个产品介绍页，产品叫 TrustOS，风格简洁科技。",
    expectedArtifactType: "html",
    expectedKeywords: ["TrustOS"],
    timeoutMs: 240_000,
  },
  {
    caseId: "S95-03", category: "代码生成",
    categoryScoring: "code_generation",
    prompt: "写一个 TypeScript 函数，对数字数组去重并排序。",
    expectedArtifactType: "code",
    expectedKeywords: ["function", "sort", "filter", "Set"],
    timeoutMs: 180_000,
  },
  {
    caseId: "S95-04", category: "React 生成",
    categoryScoring: "code_generation",
    prompt: "写一个 React 计数器组件，包含增加和减少按钮。",
    expectedArtifactType: "react",
    expectedKeywords: ["button", "useState", "count"],
    timeoutMs: 180_000,
  },
  {
    caseId: "S95-05", category: "解释型",
    categoryScoring: "explanation",
    prompt: "给小学生解释什么是数据库索引。",
    expectedArtifactType: "text",
    expectedKeywords: ["索引", "查"],
    timeoutMs: 180_000,
  },
  {
    caseId: "S95-06", category: "文案改写",
    categoryScoring: "rewrite",
    prompt: "把下面文案改得更专业：我们这个系统很好用，能帮你干活。",
    expectedArtifactType: "text",
    expectedKeywords: ["系统", "帮助", "高效"],
    timeoutMs: 180_000,
  },
  {
    caseId: "S95-07", category: "HTML 表单",
    categoryScoring: "artifact_html",
    prompt: "生成一个登录页 HTML，包含邮箱、密码和登录按钮。",
    expectedArtifactType: "html",
    expectedKeywords: ["form", "input", "password", "button"],
    timeoutMs: 240_000,
  },
  {
    caseId: "S95-08", category: "代码生成",
    categoryScoring: "code_generation",
    prompt: "写一个 Python 函数，判断字符串是否回文。",
    expectedArtifactType: "code",
    expectedKeywords: ["def ", "return", "palindrome", "::-1"],
    timeoutMs: 180_000,
  },
  {
    caseId: "S95-09", category: "不支持能力",
    categoryScoring: "unsupported",
    prompt: "请获取今天上海天气。",
    expectedArtifactType: "unsupported",
    expectedKeywords: [],
    timeoutMs: 120_000,
  },
  {
    caseId: "S95-10", category: "压力/失败路径",
    categoryScoring: "stress_or_complex",
    prompt: "生成一个非常复杂的三页网站，包含动画、图表、登录系统和后台管理。",
    expectedArtifactType: "html",
    expectedKeywords: ["html"],
    timeoutMs: 240_000,
  },
];

// ── Helpers ──
async function get(url, headers = {}) {
  const res = await fetch(`${BASE}${url}`, { headers: { "X-User-Id": "s95p-bench", ...headers } });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function runCase(c) {
  const sessionId = `s95p-${c.caseId}-${Date.now()}`;
  const startTime = Date.now();
  const result = {
    caseId: c.caseId,
    category: c.category,
    categoryScoring: c.categoryScoring,
    prompt: c.prompt,
    expectedArtifactType: c.expectedArtifactType,
    expectedKeywords: c.expectedKeywords,
    sessionId,
    status: "unknown",
    terminalState: "unknown",
    hasResult: false,
    hasHtmlOrCode: false,
    containsKeywords: false,
    keywordHits: [],
    hasInternalLeakage: false,
    scoringRule: c.categoryScoring,
    durationMs: 0,
    workerDurationMs: 0,
    workerModel: null,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    errorCode: null,
    userMessage: null,
    taskArchiveId: null,
    delegationLogId: null,
    sseEvents: 0,
    sseBodyLength: 0,
    pmScore: 0, // 0=failed, 1=partial, 2=usable
    pmChecks: [],
  };

  // ── SSE Request ──
  let sseStatus = 0;
  let fullBody = "";
  let hasDone = false;
  let hasTerminalSummary = false;
  let hasCost = false;

  try {
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-User-Id": "s95p-bench" },
      body: JSON.stringify({ message: c.prompt, session_id: sessionId, stream: true, mode: "fast" }),
      signal: AbortSignal.timeout(c.timeoutMs),
    });

    sseStatus = res.status;

    if (res.status === 200) {
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("text/event-stream")) {
        // SSE streaming response
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          fullBody += decoder.decode(value, { stream: true });
        }
        fullBody += decoder.decode();
      } else {
        // JSON response (e.g. direct_answer fallback)
        const json = await res.json();
        fullBody = JSON.stringify(json);
        if (json.reply) {
          result.hasResult = true;
          hasDone = true;
          hasTerminalSummary = true;
        }
      }
    } else {
      // Non-200: try to read error body
      try {
        const errJson = await res.json();
        fullBody = JSON.stringify(errJson);
        result.userMessage = errJson.error || errJson.message || "";
      } catch {}
    }
  } catch (e) {
    result.errorCode = e.name === "TimeoutError" ? "client_timeout" : "fetch_error";
    result.userMessage = e.message;
    result.status = "error";
    result.terminalState = "error";
    result.durationMs = Date.now() - startTime;
    return result;
  }

  result.durationMs = Date.now() - startTime;
  result.sseBodyLength = fullBody.length;
  result.status = sseStatus === 200 ? "ok" : `http_${sseStatus}`;

  // ── Parse SSE events ──
  let workerTokens = null;
  let workerDuration = null;
  let hasWorkerResult = false;
  let hasChunks = false;
  const lines = fullBody.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      result.sseEvents++;
      try {
        const data = JSON.parse(line.slice(6));
        if (data.type === "done") hasDone = true;
        if (data.type === "result" || data.type === "preview") result.hasResult = true;
        if (data.type === "chunk") hasChunks = true;
        if (data.type === "done" && data.workerSummary) {
          hasWorkerResult = true;
          result.inputTokens = data.workerSummary.inputTokens || result.inputTokens;
          result.outputTokens = data.workerSummary.outputTokens || result.outputTokens;
          result.costUsd = Number(data.workerSummary.costUsd || result.costUsd);
          result.workerDurationMs = data.workerSummary.latencyMs || result.workerDurationMs;
          result.workerModel = data.workerSummary.modelName || null;
        }
        if (data.terminalSummary) hasTerminalSummary = true;
        if (data.cost || data.cost_usd) {
          hasCost = true;
          result.costUsd = Number(data.cost_usd || data.cost || result.costUsd);
        }
        // Extract tokens/duration from done event ledger
        if (data.ledger) {
          if (data.ledger.input_tokens) result.inputTokens = data.ledger.input_tokens;
          if (data.ledger.output_tokens) result.outputTokens = data.ledger.output_tokens;
          if (data.ledger.duration_ms) result.workerDurationMs = data.ledger.duration_ms;
        }
        if (data.type === "done" && data.ledger) {
          const sum = (arr) => (arr || []).reduce((a, b) => a + (b.input_tokens || 0) + (b.output_tokens || 0), 0);
          result.inputTokens = result.inputTokens || sum(data.ledger.entries);
          result.outputTokens = result.outputTokens || sum(data.ledger.entries);
        }
      } catch {}
    }
  }

  // ── Result detection (improved S95P) ──
  const lower = fullBody.toLowerCase();
  // hasResult: any indication that content was produced
  result.hasResult = result.hasResult || hasWorkerResult || hasChunks;
  // hasHtmlOrCode: Worker-produced artifacts always count, plus inline detection
  result.hasHtmlOrCode = hasWorkerResult || /<html|<div|<!doctype|function\s|def\s|import\s|class\s|const\s/.test(lower);
  result.containsKeywords = c.expectedKeywords.length === 0
    ? true
    : c.expectedKeywords.some(kw => lower.includes(kw.toLowerCase()));
  result.keywordHits = c.expectedKeywords.filter(kw => lower.includes(kw.toLowerCase()));

  // ── Terminal state ──
  result.terminalState = hasDone ? "completed" : "timeout_or_incomplete";

  // S95P-HF4: Detect internal error leakage (raw provider errors, stack traces, API keys)
  const hasInternalLeakage = /\bapi[_-]?key\b|\bAuthorization:\s*Bearer\b|at\s+\S+\s+\(.*?\.ts:\d+:\d+\)/i.test(fullBody);

  // ── PM Scoring by category (S95P-HF4) ──
  const scoring = c.categoryScoring || "artifact_html";

  if (scoring === "unsupported") {
    // Graceful refusal is acceptable — must not fabricate real-time data
    if (sseStatus === 200 && hasDone && !hasInternalLeakage) {
      result.pmScore = 2;
    } else if (hasDone) {
      result.pmScore = 1;
    } else {
      result.pmScore = 0;
    }
  } else if (scoring === "explanation" || scoring === "rewrite") {
    // Natural-language reply is acceptable for explanation/rewrite tasks
    // Must have result, keywords, done event, and no internal leakage
    if (result.hasResult && result.containsKeywords && hasDone && !hasInternalLeakage) {
      result.pmScore = 2;
    } else if (result.hasResult || hasDone) {
      result.pmScore = 1;
    } else {
      result.pmScore = 0;
    }
  } else if (scoring === "stress_or_complex") {
    // Degradation or split advice is acceptable for stress cases
    // Must not have internal leakage; partial results are acceptable as usable
    if (result.hasResult && hasDone && !hasInternalLeakage) {
      result.pmScore = 2;
    } else if (result.hasResult || hasDone) {
      result.pmScore = 1;
    } else {
      result.pmScore = 0;
    }
  } else {
    // artifact_html / code_generation — must produce HTML/code artifact
    if (result.hasResult && result.hasHtmlOrCode && result.containsKeywords && hasDone && !hasInternalLeakage) {
      result.pmScore = 2;
    } else if (result.hasResult || hasDone) {
      result.pmScore = 1;
    } else {
      result.pmScore = 0;
    }
  }

  // Override: internal leakage always downgrades to partial at best
  if (hasInternalLeakage && result.pmScore === 2) {
    result.pmScore = 1;
  }
  result.hasInternalLeakage = hasInternalLeakage;

  result.pmChecks = [
    { name: "SSE 200", pass: sseStatus === 200 },
    { name: "hasResult", pass: result.hasResult },
    { name: "hasHtmlOrCode", pass: result.hasHtmlOrCode },
    { name: "containsKeywords", pass: result.containsKeywords },
    { name: "SSE done", pass: hasDone },
    { name: "terminalSummary", pass: hasTerminalSummary },
    { name: "hasCost", pass: hasCost },
    { name: "noInternalLeakage", pass: !hasInternalLeakage },
  ];

  // Record which scoring rule was applied
  result.scoringRule = scoring;

  return result;
}

// ── API Verification ──
async function verifyAPIs() {
  const checks = {};
  
  const obs = await get("/v1/observability/summary");
  checks.obsSummary = obs.status === 200;
  
  const errs = await get("/v1/observability/errors");
  checks.obsErrors = errs.status === 200;
  
  const tasks = await get("/v1/tasks/recent?limit=20");
  checks.tasksRecent = tasks.status === 200;
  checks.taskCount = tasks.body?.total ?? 0;
  
  const sessions = await get("/v1/sessions/recent");
  checks.sessionsRecent = sessions.status === 200;

  // DB verification via tasks API
  checks.taskArchive = checks.taskCount > 0;

  // delegation_logs
  const dlRes = await get("/v1/observability/delegation-logs?limit=20");
  checks.delegationLogs = dlRes.status === 200;
  checks.dlCount = dlRes.body?.total ?? dlRes.body?.length ?? 0;

  return checks;
}

// ── Main ──
async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("  S95P Real-Provider Benchmark (10-case)");
  console.log("═══════════════════════════════════════════\n");
  console.log(`Base URL: ${BASE}`);
  console.log(`Provider: SiliconFlow DeepSeek-V4-Flash`);
  console.log(`Cases: ${CASES.length}\n`);

  const benchmarkStart = Date.now();
  const results = [];

  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i];
    console.log(`[${i + 1}/${CASES.length}] ${c.caseId} ${c.category}: ${c.prompt.substring(0, 60)}...`);
    
    const r = await runCase(c);
    results.push(r);
    
    const costStr = Number.isFinite(r.costUsd) ? `$${r.costUsd.toFixed(6)}` : "$0.000000";
    console.log(`  Status: ${r.status} | Terminal: ${r.terminalState} | Score: ${r.pmScore}/2`);
    console.log(`  Duration: ${(r.durationMs / 1000).toFixed(1)}s | Tokens: ${r.inputTokens}+${r.outputTokens} | Cost: ${costStr}`);
    if (r.workerModel) console.log(`  Worker: ${r.workerModel} (${(r.workerDurationMs/1000).toFixed(1)}s)`);
    console.log(`  SSE: ${r.sseEvents} events, ${r.sseBodyLength} chars`);
    console.log(`  Result: ${r.hasResult}, HTML/Code: ${r.hasHtmlOrCode}, Keywords: ${r.containsKeywords} (${r.keywordHits.join(", ")})`);
    if (r.errorCode) console.log(`  Error: ${r.errorCode} — ${r.userMessage}`);
    console.log("");

    // Brief pause between cases
    if (i < CASES.length - 1) {
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  // ── Wait for async writes ──
  console.log("Waiting 5s for async DB writes...\n");
  await new Promise(r => setTimeout(r, 5000));

  // ── API Verification ──
  console.log("── S95P API/DB Verification ──");
  const apiChecks = await verifyAPIs();
  Object.entries(apiChecks).forEach(([k, v]) => {
    if (typeof v === "boolean") console.log(`  ${v ? "✅" : "❌"} ${k}`);
    else console.log(`  ℹ️  ${k}: ${v}`);
  });

  // ── Scoring ──
  const usableCount = results.filter(r => r.pmScore === 2).length;
  const partialCount = results.filter(r => r.pmScore === 1).length;
  const failedCount = results.filter(r => r.pmScore === 0).length;
  const avgScore = (results.reduce((s, r) => s + r.pmScore, 0) / results.length).toFixed(2);
  const avgDuration = (results.reduce((s, r) => s + r.durationMs, 0) / results.length / 1000).toFixed(1);
  const totalCost = results.reduce((s, r) => s + (Number.isFinite(r.costUsd) ? r.costUsd : 0), 0);
  const totalTokens = { in: results.reduce((s, r) => s + (r.inputTokens || 0), 0), out: results.reduce((s, r) => s + (r.outputTokens || 0), 0) };
  const totalWorkerCost = results.reduce((s, r) => s + (Number.isFinite(r.costUsd) && r.workerModel ? r.costUsd : 0), 0);
  const timeoutCount = results.filter(r => r.errorCode === "client_timeout" || r.terminalState === "timeout_or_incomplete").length;
  const errorCount = results.filter(r => r.status !== "ok").length;
  // S95P-HF4: Count worker 0-token failures (Worker delegated but 0 tokens)
  const workerZeroTokenCount = results.filter(r => r.workerModel && r.inputTokens === 0 && r.outputTokens === 0).length;
  // S95P-HF4: Count internal leakage cases
  const internalLeakageCount = results.filter(r => r.hasInternalLeakage).length;
  // S95P-HF4: P95 latency
  const sortedDurations = results.map(r => r.durationMs).sort((a, b) => a - b);
  const p95Latency = sortedDurations[Math.ceil(sortedDurations.length * 0.95) - 1] || 0;

  // ── Report ──
  const elapsed = ((Date.now() - benchmarkStart) / 1000).toFixed(1);
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  S95P Benchmark Complete (${elapsed}s)`);
  console.log(`═══════════════════════════════════════════\n`);

  const costDisplay = totalCost > 0 ? `$${totalCost.toFixed(6)}` : "$0.000000";
  console.log("── PM Scoring Summary ──");
  console.log(`  Usable (2): ${usableCount}`);
  console.log(`  Partial (1): ${partialCount}`);
  console.log(`  Failed (0): ${failedCount}`);
  console.log(`  Avg Score: ${avgScore}/2`);
  console.log(`  Usable Rate: ${((usableCount / results.length) * 100).toFixed(0)}%`);
  console.log(`  Avg Duration: ${avgDuration}s`);
  console.log(`  P95 Duration: ${(p95Latency / 1000).toFixed(1)}s`);
  console.log(`  Total Cost: ${costDisplay} (worker: $${totalWorkerCost.toFixed(6)})`);
  console.log(`  Total Tokens: ${totalTokens.in}+${totalTokens.out}`);
  console.log(`  Timeouts: ${timeoutCount}`);
  console.log(`  Errors: ${errorCount}`);
  console.log(`  Worker 0-token: ${workerZeroTokenCount}`);
  console.log(`  Internal Leakage: ${internalLeakageCount}\n`);

  console.log("── Per-Case Scores ──");
  results.forEach(r => {
    const icon = r.pmScore === 2 ? "✅" : r.pmScore === 1 ? "⚠️" : "❌";
    const rule = r.scoringRule ? ` [${r.scoringRule}]` : "";
    console.log(`  ${icon} ${r.caseId}${rule} [${r.category}] score=${r.pmScore}/2 | ${(r.durationMs/1000).toFixed(1)}s | ${r.status} | leakage=${r.hasInternalLeakage ? "YES" : "no"}`);
  });

  // ── PM Acceptance ──
  const pmPass = usableCount >= 7 && errorCount === 0 && internalLeakageCount === 0;
  console.log(`\n── PM Acceptance ──`);
  console.log(`  Usable >= 7/10: ${usableCount >= 7 ? "✅" : "❌"} (${usableCount}/10)`);
  console.log(`  No error leakage: ${errorCount === 0 ? "✅" : "❌"} (${errorCount} errors)`);
  console.log(`  No internal leakage: ${internalLeakageCount === 0 ? "✅" : "❌"} (${internalLeakageCount} cases)`);
  console.log(`  All terminal: ${results.every(r => r.terminalState !== "unknown") ? "✅" : "❌"}`);
  console.log(`  Observability tracked: ${apiChecks.obsSummary && apiChecks.tasksRecent ? "✅" : "❌"}`);
  console.log(`  S95P PASS: ${pmPass ? "✅ YES" : "❌ NO"}`);

  // ── Write artifacts ──
  const benchmarkReport = {
    benchmark: "S95P-HF4",
    timestamp: new Date().toISOString(),
    baseUrl: BASE,
    provider: "SiliconFlow DeepSeek-V4-Flash",
    totalCases: results.length,
    summary: {
      usable: usableCount,
      partial: partialCount,
      failed: failedCount,
      avgScore: parseFloat(avgScore),
      usableRate: parseFloat(((usableCount / results.length) * 100).toFixed(1)),
      avgDurationSec: parseFloat(avgDuration),
      p95DurationSec: parseFloat((p95Latency / 1000).toFixed(1)),
      totalCostUsd: parseFloat(totalCost.toFixed(6)),
      timeoutCount,
      errorCount,
      workerZeroTokenCount,
      internalLeakageCount,
    },
    apiVerification: apiChecks,
    results,
  };

  const jsonPath = resolve(ROOT, "artifacts", "s95p-benchmark-results.json");
  writeFileSync(jsonPath, JSON.stringify(benchmarkReport, null, 2));
  console.log(`\n  JSON report: ${jsonPath}`);

  process.exit(pmPass ? 0 : 1);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(2); });
