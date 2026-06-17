/**
 * S94P Benchmark — 真实任务质量评估
 *
 * 使用 mock=false 环境，对 12 条中文网页生成任务逐一运行，
 * 自动评分并输出结果。
 *
 * 评分维度：
 *   - keyword_coverage (1-5): 关键词覆盖度
 *   - html_validity (1-5): HTML 结构有效性
 *   - content_relevance (1-5): 内容相关性
 *   - code_executability (1-5): 代码可执行性
 *
 * 用法：
 *   TRUSTOS_E2E_MOCK_LLM=false npx tsx scripts/s94p-benchmark.ts
 */

import * as fs from "fs";
import * as path from "path";

const BASE_URL = process.env["TRUSTOS_BASE_URL"] ?? "http://localhost:3001";
const USER_ID = "s94p-bench-user";
const SESSION_ID = `s94p-bench-${Date.now()}`;

interface BenchmarkTask {
  id: string;
  input: string;
  expected_keywords: string[];
  min_keywords: number;
  quality_criteria: {
    keyword_coverage: number;
    html_validity: number;
    content_relevance: number;
    code_executability: number;
  };
}

interface BenchmarkResult {
  task_id: string;
  input: string;
  status: "success" | "timeout" | "error";
  duration_sec: number;
  output_length: number;
  keywords_found: string[];
  keywords_missing: string[];
  keyword_score: number;
  has_html: boolean;
  has_doctype: boolean;
  has_body: boolean;
  html_score: number;
  content_score: number;
  executability_score: number;
  overall_score: number;
  error?: string;
}

async function loadTasks(): Promise<BenchmarkTask[]> {
  const tasksPath = path.resolve("evaluation/tasks/webpage-generation-tasks.json");
  const raw = fs.readFileSync(tasksPath, "utf-8");
  return JSON.parse(raw);
}

async function sendMessage(message: string): Promise<{ content: string; events: any[]; cost: any }> {
  const body = {
    message,
    history: [],
    sessionId: `${SESSION_ID}-${Date.now()}`,
    stream: true,
  };

  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": USER_ID,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const text = await res.text();
  const lines = text.split("\n").filter((l) => l.startsWith("data: "));
  const events = lines.map((l) => {
    try {
      return JSON.parse(l.slice(6));
    } catch {
      return { raw: l.slice(6) };
    }
  });

  // Extract content from result/chunk events
  let content = "";
  let cost = null;
  for (const ev of events) {
    if (ev.type === "done") {
      cost = ev.cost || null;
    }
    if (ev.stream && ev.type !== "done" && ev.type !== "progress") {
      content += ev.stream;
    }
    if (ev.type === "result" && ev.stream) {
      content = ev.stream; // full result replaces incremental
    }
  }

  return { content, events, cost };
}

function scoreKeywords(content: string, expected: string[], minKeywords: number): {
  found: string[];
  missing: string[];
  score: number;
} {
  const lower = content.toLowerCase();
  const found: string[] = [];
  const missing: string[] = [];

  for (const kw of expected) {
    if (lower.includes(kw.toLowerCase())) {
      found.push(kw);
    } else {
      missing.push(kw);
    }
  }

  const ratio = expected.length > 0 ? found.length / expected.length : 1;
  const score = ratio >= 1 ? 5 : ratio >= 0.8 ? 4 : ratio >= 0.6 ? 3 : ratio >= 0.4 ? 2 : 1;
  return { found, missing, score };
}

function scoreHTML(content: string): { hasHtml: boolean; hasDoctype: boolean; hasBody: boolean; score: number } {
  const lower = content.toLowerCase();
  const hasHtml = lower.includes("<html") || lower.includes("<!doctype");
  const hasDoctype = lower.includes("<!doctype") || lower.includes("<!DOCTYPE");
  const hasBody = lower.includes("<body") && lower.includes("</body>");

  let score = 1;
  if (hasHtml) score = 3;
  if (hasHtml && hasBody) score = 4;
  if (hasDoctype && hasHtml && hasBody) score = 5;

  return { hasHtml, hasDoctype, hasBody, score };
}

function scoreContent(content: string, input: string): number {
  // Extract key nouns from input and check if they appear in content
  const inputWords = input
    .replace(/[，。！？、；：""''（）《》【】\s,\.!\?;:'"()\[\]{}]/g, " ")
    .split(" ")
    .filter((w) => w.length >= 2);

  const contentLower = content.toLowerCase();
  let matches = 0;
  for (const w of inputWords) {
    if (contentLower.includes(w.toLowerCase())) matches++;
  }

  const ratio = inputWords.length > 0 ? matches / inputWords.length : 1;
  return ratio >= 0.8 ? 5 : ratio >= 0.6 ? 4 : ratio >= 0.4 ? 3 : ratio >= 0.2 ? 2 : 1;
}

function scoreExecutability(content: string): number {
  // Check for JavaScript functionality, interactivity indicators
  const hasScript = content.toLowerCase().includes("<script");
  const hasEvent = /onclick|onchange|oninput|addEventListener/.test(content);
  const hasInteractive = hasScript || hasEvent;
  const hasCSS = content.toLowerCase().includes("<style") || content.includes("style=");

  if (hasInteractive && hasCSS) return 5;
  if (hasInteractive || hasCSS) return 4;
  if (content.includes("function") || content.includes("const ") || content.includes("let ")) return 3;
  return 2;
}

async function runBenchmark() {
  console.log("=".repeat(60));
  console.log("  S94P Benchmark — 真实任务质量评估");
  console.log("=".repeat(60));
  console.log(`  Base URL: ${BASE_URL}`);
  console.log(`  User: ${USER_ID}`);
  console.log(`  Session: ${SESSION_ID}`);
  console.log("");

  const tasks = await loadTasks();
  console.log(`  加载 ${tasks.length} 个任务\n`);

  const results: BenchmarkResult[] = [];
  let passed = 0;
  let failed = 0;
  let totalScore = 0;

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    console.log(`  [${i + 1}/${tasks.length}] ${task.id}: ${task.input.slice(0, 50)}...`);

    const startTime = Date.now();
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("TIMEOUT")), 180_000)
      );

      const { content, events, cost } = await Promise.race([
        sendMessage(task.input),
        timeoutPromise,
      ]);

      const durationSec = (Date.now() - startTime) / 1000;

      // Score
      const kw = scoreKeywords(content, task.expected_keywords, task.min_keywords);
      const html = scoreHTML(content);
      const contentScore = scoreContent(content, task.input);
      const execScore = scoreExecutability(content);

      const overall =
        (kw.score + html.score + contentScore + execScore) / 4;

      const result: BenchmarkResult = {
        task_id: task.id,
        input: task.input,
        status: "success",
        duration_sec: Math.round(durationSec * 10) / 10,
        output_length: content.length,
        keywords_found: kw.found,
        keywords_missing: kw.missing,
        keyword_score: kw.score,
        has_html: html.hasHtml,
        has_doctype: html.hasDoctype,
        has_body: html.hasBody,
        html_score: html.score,
        content_score: contentScore,
        executability_score: execScore,
        overall_score: Math.round(overall * 10) / 10,
      };

      results.push(result);
      totalScore += overall;

      if (overall >= 3.5) {
        passed++;
        console.log(`    ✅ ${overall.toFixed(1)}/5 | ${durationSec.toFixed(1)}s | ${content.length} chars | KW: ${kw.found.length}/${task.expected_keywords.length}`);
      } else {
        failed++;
        console.log(`    ⚠️ ${overall.toFixed(1)}/5 | ${durationSec.toFixed(1)}s | ${content.length} chars | KW: ${kw.found.length}/${task.expected_keywords.length} | Missing: ${kw.missing.join(", ")}`);
      }

      // Log cost if available
      if (cost) {
        console.log(`       Cost: ${cost.estimated_cost_usd != null ? "$" + cost.estimated_cost_usd.toFixed(4) : "N/A"} | Tokens: ${cost.input_tokens}+${cost.output_tokens}`);
      }
    } catch (e: any) {
      const durationSec = (Date.now() - startTime) / 1000;
      const isTimeout = e.message === "TIMEOUT";

      results.push({
        task_id: task.id,
        input: task.input,
        status: isTimeout ? "timeout" : "error",
        duration_sec: Math.round(durationSec * 10) / 10,
        output_length: 0,
        keywords_found: [],
        keywords_missing: task.expected_keywords,
        keyword_score: 0,
        has_html: false,
        has_doctype: false,
        has_body: false,
        html_score: 0,
        content_score: 0,
        executability_score: 0,
        overall_score: 0,
        error: e.message,
      });

      failed++;
      console.log(`    ❌ ${isTimeout ? "TIMEOUT" : "ERROR"}: ${e.message}`);
    }
  }

  // Summary
  const avgScore = results.length > 0 ? totalScore / results.length : 0;
  const avgDuration = results
    .filter((r) => r.status === "success")
    .reduce((sum, r) => sum + r.duration_sec, 0) /
    (passed || 1);

  console.log("\n" + "=".repeat(60));
  console.log("  Benchmark Results Summary");
  console.log("=".repeat(60));
  console.log(`  Total: ${tasks.length} | Passed (≥3.5): ${passed} | Failed: ${failed}`);
  console.log(`  Average Score: ${(avgScore).toFixed(2)}/5`);
  console.log(`  Average Duration: ${avgDuration.toFixed(1)}s`);
  console.log(`  Pass Rate: ${((passed / tasks.length) * 100).toFixed(1)}%`);

  // Dimension breakdown
  const avgKW = results.reduce((s, r) => s + r.keyword_score, 0) / results.length;
  const avgHTML = results.reduce((s, r) => s + r.html_score, 0) / results.length;
  const avgContent = results.reduce((s, r) => s + r.content_score, 0) / results.length;
  const avgExec = results.reduce((s, r) => s + r.executability_score, 0) / results.length;

  console.log(`\n  Dimension Scores:`);
  console.log(`    Keyword Coverage:     ${avgKW.toFixed(2)}/5`);
  console.log(`    HTML Validity:        ${avgHTML.toFixed(2)}/5`);
  console.log(`    Content Relevance:    ${avgContent.toFixed(2)}/5`);
  console.log(`    Code Executability:   ${avgExec.toFixed(2)}/5`);

  // Write report
  const report = {
    timestamp: new Date().toISOString(),
    base_url: BASE_URL,
    total_tasks: tasks.length,
    passed,
    failed,
    average_score: Math.round(avgScore * 100) / 100,
    average_duration_sec: Math.round(avgDuration * 10) / 10,
    pass_rate_pct: Math.round((passed / tasks.length) * 1000) / 10,
    dimension_scores: {
      keyword_coverage: Math.round(avgKW * 100) / 100,
      html_validity: Math.round(avgHTML * 100) / 100,
      content_relevance: Math.round(avgContent * 100) / 100,
      code_executability: Math.round(avgExec * 100) / 100,
    },
    results,
  };

  const reportPath = "docs/sprints/S94P-benchmark-results.json";
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n  Report saved: ${reportPath}`);

  // Exit code: 0 if pass rate >= 70%, 1 otherwise
  const passRate = passed / tasks.length;
  process.exit(passRate >= 0.7 ? 0 : 1);
}

runBenchmark().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
