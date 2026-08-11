/**
 * TRST-4A Smoke Test — Evidence Report Generator
 * Run: npx tsx scripts/trst4/run-evidence-report-smoke.ts
 */
import { generateEvidenceReport } from "../../src/services/trst1/evidence-report.js";
import { writeFileSync } from "node:fs";

const eventLogPath = ".trustos/events.jsonl";

console.log("=== TRST-4A Evidence Report Smoke Test ===\n");
console.log(`Event log: ${eventLogPath}\n`);

const report = generateEvidenceReport({ eventLogPath });

console.log("✅ Report generated successfully\n");
console.log(`Event count: ${report.eventCount}`);
console.log(`Generated at: ${report.generatedAt}`);
console.log(`HTML size: ${report.html.length.toLocaleString()} chars`);
console.log(`MD size: ${report.markdown.length.toLocaleString()} chars\n`);

console.log("--- Stats ---");
const s = report.stats;
console.log(`Model calls: ${s.modelCalls}`);
console.log(`Tool calls: ${s.toolCalls}`);
console.log(`Total tokens: ${s.totalTokens.toLocaleString()}`);
console.log(`Est. cost: $${s.totalEstimatedCost?.toFixed(6) ?? "unknown"}`);
console.log(`Failures: ${s.failureEvents}`);
console.log(`Telemetry failures: ${s.telemetryFailures}`);
console.log(`Sessions: ${s.sessions}`);
console.log(`Hash coverage: ${s.modelCalls > 0 ? Math.round(s.modelsWithOutputHash / s.modelCalls * 100) : 100}%`);
console.log(`Control: allow=${s.controlDecisions.allow}, warn=${s.controlDecisions.warn}, block=${s.controlDecisions.block}, unknown=${s.controlDecisions.unknown}`);
console.log(`Time range: ${s.timeRange.first} → ${s.timeRange.last}`);
console.log(`Top models: ${s.topModels.slice(0, 3).map(m => `${m.model}(${m.calls})`).join(", ")}\n`);

// Write HTML to a temp file for verification
writeFileSync(".trustos/_trst4a-smoke-test.html", report.html, "utf-8");
console.log("✅ HTML report written to .trustos/_trst4a-smoke-test.html\n");

// Verify HTML is valid (basic checks)
const validations = [
  { name: "DOCTYPE html", pass: report.html.includes("<!DOCTYPE html>") },
  { name: "<title> tag", pass: report.html.includes("<title>TrustOS Evidence Report") },
  { name: "CSS <style> block", pass: report.html.includes("<style>") },
  { name: "Executive Summary section", pass: report.html.includes("Executive Summary") },
  { name: "Evidence Integrity section", pass: report.html.includes("Evidence Integrity") },
  { name: "Control Decisions section", pass: report.html.includes("Control Decisions") },
  { name: "Recent Activity Timeline", pass: report.html.includes("Recent Activity Timeline") },
  { name: "How to Verify guide", pass: report.html.includes("How to Verify This Report") },
  { name: "Privacy section", pass: report.html.includes("Privacy") },
  { name: "Known Limitations", pass: report.html.includes("Known Limitations") },
  { name: "No raw content leakage", pass: !/{"model_call"|"tool_call"/.test(report.html) },
  { name: "Hash present in report", pass: /[a-f0-9]{16}/.test(report.html) },
  { name: "Shadow Mode badge", pass: report.html.includes("Shadow Mode") },
  { name: "Markdown report present", pass: report.markdown.length > 100 },
];

const passed = validations.filter(v => v.pass);
const failed = validations.filter(v => !v.pass);

console.log("--- Validation ---");
for (const v of validations) {
  console.log(`${v.pass ? "✅" : "❌"} ${v.name}`);
}

console.log(`\nResults: ${passed.length}/${validations.length} PASS, ${failed.length} FAIL\n`);

if (failed.length > 0) {
  console.error("❌ SOME VALIDATIONS FAILED");
  process.exit(1);
} else {
  console.log("✅ ALL VALIDATIONS PASSED — TRST-4A Evidence Report Generator working\n");
}
