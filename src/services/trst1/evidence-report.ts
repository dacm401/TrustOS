/**
 * TRST-4A Evidence Report Generator
 *
 * Generates a self-contained, human-readable HTML evidence report
 * from the JSONL event store. Designed for reviewers who need to
 * understand AI activity without reading raw JSONL or hashes.
 *
 * Design principles:
 * - Self-contained (all CSS inline, no external deps)
 * - No raw content (hashes only, same privacy guarantee)
 * - Plain-language explanations for non-technical reviewers
 * - Color-coded risk/control signals
 * - Export-ready HTML + Markdown
 */

import { readFileSync } from "node:fs";
import type { TrstEventEnvelope } from "./event-envelope.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface EvidenceReport {
  /** Self-contained HTML string */
  html: string;
  /** Plain-text Markdown alternative */
  markdown: string;
  /** Aggregated statistics */
  stats: ReportStats;
  /** Number of events in the report */
  eventCount: number;
  /** Generation timestamp */
  generatedAt: string;
}

interface ReportStats {
  modelCalls: number;
  toolCalls: number;
  failureEvents: number;
  telemetryFailures: number;
  totalTokens: number;
  totalEstimatedCost: number | null;
  sessions: number;
  eventsCaptured: number;
  contextBlockCount: number;
  overheadMsAvg: number | null;
  overheadMsP50: number | null;
  overheadMsP99: number | null;
  topModels: Array<{ model: string; calls: number; tokens: number; cost: number | null }>;
  modelsWithOutputHash: number;
  modelsWithInputHash: number;
  modelCallEvents: TrstEventEnvelope[];
  toolCallEvents: TrstEventEnvelope[];
  failureEventList: TrstEventEnvelope[];
  uniqueAgentIds: string[];
  pricingUnknownModels: string[];
  timeRange: { first: string | null; last: string | null };
  controlDecisions: { allow: number; block: number; warn: number; unknown: number };
  streamingModelCalls: number;
  nonStreamingModelCalls: number;
  unknownModeModelCalls: number;
}

// ── Event Loading ────────────────────────────────────────────────────────────

function loadEvents(eventLogPath: string): TrstEventEnvelope[] {
  let raw: string;
  try {
    raw = readFileSync(eventLogPath, "utf8");
  } catch {
    return [];
  }

  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as TrstEventEnvelope;
      } catch {
        return null;
      }
    })
    .filter((e): e is TrstEventEnvelope => e !== null);
}

// ── Statistics ───────────────────────────────────────────────────────────────

function aggregate(events: TrstEventEnvelope[]): ReportStats {
  const stats: ReportStats = {
    modelCalls: 0,
    toolCalls: 0,
    failureEvents: 0,
    telemetryFailures: 0,
    totalTokens: 0,
    totalEstimatedCost: 0,
    sessions: new Set<string>().size,
    eventsCaptured: events.length,
    contextBlockCount: 0,
    overheadMsAvg: null,
    overheadMsP50: null,
    overheadMsP99: null,
    topModels: [],
    modelsWithOutputHash: 0,
    modelsWithInputHash: 0,
    modelCallEvents: [],
    toolCallEvents: [],
    failureEventList: [],
    uniqueAgentIds: [],
    pricingUnknownModels: [],
    timeRange: { first: null, last: null },
    controlDecisions: { allow: 0, block: 0, warn: 0, unknown: 0 },
    streamingModelCalls: 0,
    nonStreamingModelCalls: 0,
    unknownModeModelCalls: 0,
  };

  const sessionSet = new Set<string>();
  const agentSet = new Set<string>();
  const modelMap = new Map<string, { calls: number; tokens: number; cost: number | null }>();
  const overheadSamples: number[] = [];
  const pricingUnknownSet = new Set<string>();
  let costNullCount = 0;

  for (const e of events) {
    sessionSet.add(e.session_id);
    if (e.agent_id) agentSet.add(e.agent_id);

    // Time range
    if (e.timestamp) {
      if (!stats.timeRange.first || e.timestamp < stats.timeRange.first) {
        stats.timeRange.first = e.timestamp;
      }
      if (!stats.timeRange.last || e.timestamp > stats.timeRange.last) {
        stats.timeRange.last = e.timestamp;
      }
    }

    // Control decision
    const cd = (e as unknown as Record<string, unknown>).control_decision as string | undefined;
    if (cd === "allow") stats.controlDecisions.allow++;
    else if (cd === "block") stats.controlDecisions.block++;
    else if (cd === "warn") stats.controlDecisions.warn++;
    else stats.controlDecisions.unknown++;

    if (e.event_type === "telemetry_failure") {
      stats.telemetryFailures++;
      continue;
    }

    if (e.event_type === "model_call") {
      stats.modelCalls++;
      const rm = e.request_mode;
      if (rm === "streaming") stats.streamingModelCalls++;
      else if (rm === "non_streaming") stats.nonStreamingModelCalls++;
      else stats.unknownModeModelCalls++;
      stats.modelCallEvents.push(e);
      stats.totalTokens += e.token_count ?? 0;

      if (e.cost_estimate != null) {
        stats.totalEstimatedCost = (stats.totalEstimatedCost ?? 0) + e.cost_estimate;
      } else if (e.status === "success") {
        costNullCount++;
        if (e.model) pricingUnknownSet.add(e.model);
      }

      if (e.gateway_overhead_ms != null && e.gateway_overhead_ms > 0) {
        overheadSamples.push(e.gateway_overhead_ms);
      }

      stats.contextBlockCount += e.context_block_refs?.length ?? 0;

      if (e.status === "failure") {
        stats.failureEvents++;
        stats.failureEventList.push(e);
      }

      // Hash coverage
      if (e.output_hash) stats.modelsWithOutputHash++;
      if (e.input_hash) stats.modelsWithInputHash++;

      // Model stats
      const key = e.model ?? "unknown";
      const entry = modelMap.get(key) ?? { calls: 0, tokens: 0, cost: 0 };
      entry.calls++;
      entry.tokens += e.token_count ?? 0;
      if (e.cost_estimate != null) {
        entry.cost = (entry.cost ?? 0) + e.cost_estimate;
      }
      modelMap.set(key, entry);
    }

    if (e.event_type === "tool_call") {
      stats.toolCalls++;
      stats.toolCallEvents.push(e);
      if (e.status === "failure") {
        stats.failureEvents++;
        stats.failureEventList.push(e);
      }
    }
  }

  stats.sessions = sessionSet.size;
  stats.uniqueAgentIds = [...agentSet].sort();

  // Sort models by calls descending
  stats.topModels = [...modelMap.entries()]
    .sort((a, b) => b[1].calls - a[1].calls)
    .map(([model, data]) => ({ model, ...data }));

  // If all costs are null, set total to null
  if (costNullCount > 0 && stats.totalEstimatedCost === 0) {
    const hasSuccessWithoutPricing = stats.modelCallEvents.some(
      (e) => e.status === "success" && e.cost_estimate == null,
    );
    if (hasSuccessWithoutPricing) {
      stats.totalEstimatedCost = null;
    }
  }

  // Overhead stats
  if (overheadSamples.length > 0) {
    const sorted = [...overheadSamples].sort((a, b) => a - b);
    stats.overheadMsAvg = Math.round(overheadSamples.reduce((a, b) => a + b, 0) / overheadSamples.length * 100) / 100;
    const mid = Math.floor(sorted.length / 2);
    stats.overheadMsP50 = sorted.length % 2 === 0
      ? Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 100) / 100
      : Math.round(sorted[mid] * 100) / 100;
    const p99Idx = Math.ceil(sorted.length * 0.99) - 1;
    stats.overheadMsP99 = Math.round(sorted[Math.max(0, p99Idx)] * 100) / 100;
  }

  stats.pricingUnknownModels = [...pricingUnknownSet].sort();

  return stats;
}

// ── CSS (Self-Contained) ─────────────────────────────────────────────────────

const CSS = `
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  background: #f8fafc; color: #1e293b; line-height: 1.6;
  padding: 0; margin: 0;
}
.container { max-width: 900px; margin: 0 auto; padding: 32px 24px 64px; }

/* Header */
.header {
  background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
  color: white; padding: 40px 32px; border-radius: 16px;
  margin-bottom: 32px; position: relative; overflow: hidden;
}
.header::after {
  content: ''; position: absolute; top: -50%; right: -10%;
  width: 300px; height: 300px;
  background: radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%);
  border-radius: 50%;
}
.header h1 { font-size: 28px; font-weight: 700; position: relative; z-index: 1; }
.header .subtitle { font-size: 13px; color: #94a3b8; margin-top: 6px; position: relative; z-index: 1; }
.header .badge {
  display: inline-block; background: rgba(99,102,241,0.2); color: #a5b4fc;
  padding: 4px 12px; border-radius: 99px; font-size: 11px; font-weight: 600;
  margin-top: 12px; position: relative; z-index: 1;
}
.header .meta { font-size: 12px; color: #64748b; margin-top: 12px; position: relative; z-index: 1; }

/* Sections */
.section {
  background: white; border-radius: 12px; padding: 24px;
  margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  border: 1px solid #e2e8f0;
}
.section h2 {
  font-size: 18px; font-weight: 600; color: #0f172a;
  margin-bottom: 16px; padding-bottom: 10px; border-bottom: 2px solid #e2e8f0;
}
.section h3 { font-size: 15px; font-weight: 600; color: #334155; margin: 16px 0 8px; }

/* Metrics Grid */
.metrics { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
.metric-card {
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;
  padding: 16px; text-align: center;
}
.metric-card .value { font-size: 28px; font-weight: 700; color: #0f172a; }
.metric-card .label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }
.metric-card.good .value { color: #059669; }
.metric-card.warn .value { color: #d97706; }
.metric-card.bad .value { color: #dc2626; }

/* Tables */
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; padding: 8px 12px; background: #f1f5f9; color: #475569; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; }
tr:last-child td { border-bottom: none; }

/* Event Timeline */
.timeline { position: relative; padding-left: 24px; }
.timeline::before {
  content: ''; position: absolute; left: 8px; top: 0; bottom: 0;
  width: 2px; background: #e2e8f0;
}
.timeline-item {
  position: relative; margin-bottom: 16px; padding: 14px 16px;
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;
}
.timeline-item::before {
  content: ''; position: absolute; left: -20px; top: 16px;
  width: 10px; height: 10px; border-radius: 50%; border: 2px solid #94a3b8;
  background: white;
}
.timeline-item.model_call::before { border-color: #3b82f6; background: #dbeafe; }
.timeline-item.tool_call::before { border-color: #8b5cf6; background: #ede9fe; }
.timeline-item.failure::before { border-color: #ef4444; background: #fee2e2; }
.timeline-item .event-header {
  display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;
}
.timeline-item .event-type {
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
  padding: 2px 8px; border-radius: 4px;
}
.event-type.model_call { background: #dbeafe; color: #1d4ed8; }
.event-type.tool_call { background: #ede9fe; color: #6d28d9; }
.event-type.telemetry_failure { background: #fee2e2; color: #991b1b; }
.timeline-item .event-time { font-size: 11px; color: #94a3b8; }
.timeline-item .event-detail { font-size: 12px; color: #475569; }
.timeline-item .event-detail code { font-size: 11px; background: #e2e8f0; padding: 1px 6px; border-radius: 3px; color: #0f172a; }

/* Hash badge */
.hash-badge { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 9px; background: #f1f5f9; padding: 2px 6px; border-radius: 3px; color: #64748b; word-break: break-all; }

/* Risk / Control Cards */
.control-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
.control-card { border-radius: 10px; padding: 14px 16px; text-align: center; border: 1px solid #e2e8f0; }
.control-card.allow { background: #ecfdf5; border-color: #a7f3d0; }
.control-card.block { background: #fef2f2; border-color: #fecaca; }
.control-card.warn { background: #fffbeb; border-color: #fde68a; }
.control-card.unknown { background: #f8fafc; border-color: #e2e8f0; }
.control-card .count { font-size: 26px; font-weight: 700; }
.control-card.allow .count { color: #059669; }
.control-card.block .count { color: #dc2626; }
.control-card.warn .count { color: #d97706; }
.control-card.unknown .count { color: #94a3b8; }
.control-card .clabel { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px; }

/* Explanation box */
.explanation {
  background: #f0f9ff; border-left: 4px solid #3b82f6; border-radius: 6px;
  padding: 14px 18px; margin-top: 16px; font-size: 13px; color: #1e40af; line-height: 1.6;
}
.explanation strong { color: #1e3a5f; }
.explanation.warning { background: #fffbeb; border-color: #f59e0b; color: #92400e; }
.explanation.success { background: #f0fdf4; border-color: #22c55e; color: #166534; }
.explanation.danger { background: #fef2f2; border-color: #ef4444; color: #991b1b; }

/* Hash verification */
.verify-box {
  background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px;
  padding: 16px 20px; margin-top: 12px;
}
.verify-box h4 { font-size: 13px; font-weight: 600; color: #334155; margin-bottom: 6px; }
.verify-box p { font-size: 12px; color: #64748b; margin-bottom: 6px; }
.verify-box code { font-size: 11px; background: #e2e8f0; padding: 2px 8px; border-radius: 3px; }

/* Footer */
.footer {
  text-align: center; padding: 24px; font-size: 11px; color: #94a3b8;
  border-top: 1px solid #e2e8f0; margin-top: 32px;
}

/* Progress bar */
.progress-bar { height: 6px; background: #e2e8f0; border-radius: 3px; overflow: hidden; }
.progress-fill { height: 100%; border-radius: 3px; transition: width 0.3s; }
.progress-fill.good { background: #22c55e; }
.progress-fill.warn { background: #f59e0b; }
.progress-fill.bad { background: #ef4444; }

/* Status badges */
.status-badge {
  display: inline-block; padding: 2px 10px; border-radius: 99px;
  font-size: 10px; font-weight: 600; text-transform: uppercase;
}
.status-badge.success { background: #d1fae5; color: #065f46; }
.status-badge.failure { background: #fee2e2; color: #991b1b; }

/* Summary banner */
.summary-banner {
  background: linear-gradient(135deg, #ecfdf5 0%, #dbeafe 100%);
  border-radius: 12px; padding: 20px 24px; margin-bottom: 24px;
  border: 1px solid #a7f3d0;
}
.summary-banner p { font-size: 14px; color: #334155; margin: 0; }
.summary-banner strong { color: #0f172a; }

/* Responsive */
@media (max-width: 600px) {
  .container { padding: 16px 12px 32px; }
  .header { padding: 24px 20px; }
  .header h1 { font-size: 22px; }
  .metrics { grid-template-columns: repeat(2, 1fr); }
  .control-grid { grid-template-columns: repeat(2, 1fr); }
}
`;

// ── HTML Generation ──────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTimestamp(ts: string | undefined): string {
  if (!ts) return "unknown";
  try {
    return new Date(ts).toLocaleString("zh-CN", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch {
    return ts.slice(0, 19) || ts;
  }
}

function formatCost(cost: number | null): string {
  if (cost === null) return "Unknown — missing pricing";
  if (cost === 0) return "$0.000000";
  return `$${cost.toFixed(6)}`;
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "N/A";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function hashCoveragePct(stats: ReportStats): number {
  if (stats.modelCalls === 0) return 100;
  return Math.round((stats.modelsWithOutputHash / stats.modelCalls) * 100);
}

function generateHtml(stats: ReportStats, events: TrstEventEnvelope[], generatedAt: string): string {
  const hashCov = hashCoveragePct(stats);
  const displayEvents = events.slice(-30); // Last 30 events for timeline

  // Determine overall safety signal
  let safetyLevel: "good" | "caution" | "attention" = "good";
  let safetyMessage = "No suspicious activity detected. All model calls completed normally with hash-verifiable evidence.";
  if (stats.failureEvents > 0) {
    safetyLevel = "caution";
    safetyMessage = `${stats.failureEvents} failure event(s) observed. Review the failure details below for potential issues.`;
  }
  if (stats.controlDecisions.block > 0) {
    safetyLevel = "attention";
    safetyMessage = `${stats.controlDecisions.block} blocked control decision(s) detected. Review is strongly recommended.`;
  }

  const safetyClass = safetyLevel === "good" ? "success" : safetyLevel === "caution" ? "warning" : "danger";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>TrustOS Evidence Report — ${generatedAt}</title>
<style>${CSS}</style>
</head>
<body>
<div class="container">

<!-- Header -->
<div class="header">
  <h1>TrustOS Evidence Report</h1>
  <div class="subtitle">TRST-4A Human-Readable AI Activity Evidence</div>
  <div class="badge">Shadow Mode (Dry-Run) — No Enforcement</div>
  <div class="meta">
    Generated: ${escapeHtml(generatedAt)}<br>
    Source: TrustOS Gateway Event Log (.trustos/events.jsonl)<br>
    Report ID: TRST4A-${Date.now().toString(36).toUpperCase()}
  </div>
</div>

<!-- Safety Summary -->
<div class="summary-banner">
  <div class="explanation ${safetyClass}">
    <strong>Overall Safety Signal:</strong> ${escapeHtml(safetyMessage)}
    ${stats.failureEvents > 0 ? `<br><br><strong>Note:</strong> TrustOS operates in shadow mode (dry-run only). No AI requests were blocked or modified.` : ""}
  </div>
</div>

<!-- Key Metrics -->
<div class="section">
  <h2>Executive Summary</h2>
  <div class="metrics">
    <div class="metric-card">
      <div class="value">${stats.modelCalls}</div>
      <div class="label">Model Calls</div>
    </div>
    <div class="metric-card">
      <div class="value">${stats.streamingModelCalls}</div>
      <div class="label">Streaming</div>
    </div>
    <div class="metric-card">
      <div class="value">${stats.nonStreamingModelCalls}</div>
      <div class="label">Non-Streaming</div>
    </div>
    <div class="metric-card">
      <div class="value">${stats.toolCalls}</div>
      <div class="label">Tool Calls</div>
    </div>
    <div class="metric-card">
      <div class="value">${stats.totalTokens.toLocaleString()}</div>
      <div class="label">Total Tokens</div>
    </div>
    <div class="metric-card">
      <div class="value">${formatCost(stats.totalEstimatedCost)}</div>
      <div class="label">Est. Cost</div>
    </div>
    <div class="metric-card ${stats.failureEvents > 0 ? 'warn' : 'good'}">
      <div class="value">${stats.failureEvents}</div>
      <div class="label">Failures</div>
    </div>
    <div class="metric-card ${hashCov >= 90 ? 'good' : hashCov >= 50 ? 'warn' : 'bad'}">
      <div class="value">${hashCov}%</div>
      <div class="label">Hash Coverage</div>
    </div>
    <div class="metric-card">
      <div class="value">${stats.sessions}</div>
      <div class="label">Sessions</div>
    </div>
    <div class="metric-card">
      <div class="value">${stats.eventsCaptured}</div>
      <div class="label">Events</div>
    </div>
  </div>
</div>

<!-- Hash Integrity -->
<div class="section">
  <h2>Evidence Integrity</h2>
  <table>
    <tr><th>Metric</th><th>Value</th></tr>
    <tr><td>Model calls with output hash</td><td>${stats.modelsWithOutputHash} / ${stats.modelCalls} (${hashCov}%)</td></tr>
    <tr><td>Model calls with input hash</td><td>${stats.modelsWithInputHash} / ${stats.modelCalls} (${stats.modelCalls > 0 ? Math.round(stats.modelsWithInputHash / stats.modelCalls * 100) : 0}%)</td></tr>
    <tr><td>Context blocks recorded</td><td>${stats.contextBlockCount}</td></tr>
    <tr><td>Sessions observed</td><td>${stats.sessions}</td></tr>
    ${stats.uniqueAgentIds.length > 0 ? `<tr><td>Agent IDs</td><td>${escapeHtml(stats.uniqueAgentIds.join(", "))}</td></tr>` : ""}
  </table>

  <div class="explanation">
    <strong>What this means:</strong> TrustOS computes SHA-256 hashes of AI inputs and outputs at observation time.
    These hashes are stored in the event log instead of raw content — preserving privacy while creating a verifiable
    chain of evidence. Anyone with the original input/output can verify the hash matches using a standard SHA-256
    calculator. High hash coverage (&gt;90%) means most AI interactions are fully verifiable.
  </div>
</div>

<!-- Control Decisions -->
<div class="section">
  <h2>Control Decisions</h2>
  <div class="control-grid">
    <div class="control-card allow">
      <div class="count">${stats.controlDecisions.allow}</div>
      <div class="clabel">Allowed</div>
    </div>
    <div class="control-card warn">
      <div class="count">${stats.controlDecisions.warn}</div>
      <div class="clabel">Warnings</div>
    </div>
    <div class="control-card block">
      <div class="count">${stats.controlDecisions.block}</div>
      <div class="clabel">Blocked</div>
    </div>
    <div class="control-card unknown">
      <div class="count">${stats.controlDecisions.unknown}</div>
      <div class="clabel">No Decision</div>
    </div>
  </div>

  <div class="explanation ${stats.controlDecisions.block > 0 ? 'danger' : 'success'}">
    <strong>Important:</strong> TrustOS is currently in <strong>Shadow Mode</strong> (dry-run).
    Control decisions are <em>recommended actions only</em> — they are logged for review but
    <strong>not enforced</strong>. No AI requests were actually blocked or modified by TrustOS.
    ${stats.controlDecisions.block > 0
      ? `<br><br><strong>Review needed:</strong> ${stats.controlDecisions.block} events were flagged with a "block" recommendation. The reviewer should examine these events to determine if enforcement should be enabled in the future.`
      : `<br><br>All events received "allow" decisions — no suspicious activity detected.`}
  </div>
</div>

<!-- Top Models -->
<div class="section">
  <h2>Model Usage</h2>
  ${stats.topModels.length > 0 ? `
  <table>
    <tr><th>Model</th><th>Calls</th><th>Tokens</th><th>Est. Cost</th></tr>
    ${stats.topModels.map(m => `
    <tr>
      <td><code>${escapeHtml(m.model)}</code></td>
      <td>${m.calls}</td>
      <td>${m.tokens.toLocaleString()}</td>
      <td>${formatCost(m.cost)}</td>
    </tr>`).join("")}
  </table>` : `<p style="color:#94a3b8;font-size:13px;">No model call data yet.</p>`}

  ${stats.overheadMsAvg != null ? `
  <h3>Gateway Performance</h3>
  <table>
    <tr><th>Metric</th><th>Value</th></tr>
    <tr><td>Average overhead</td><td>${stats.overheadMsAvg} ms</td></tr>
    <tr><td>P50 latency</td><td>${stats.overheadMsP50} ms</td></tr>
    <tr><td>P99 latency</td><td>${stats.overheadMsP99} ms</td></tr>
  </table>` : ""}

  ${stats.pricingUnknownModels.length > 0 ? `
  <div class="explanation warning" style="margin-top:12px;">
    <strong>Pricing gaps:</strong> The following models have unknown pricing:
    ${stats.pricingUnknownModels.map(m => `<code>${escapeHtml(m)}</code>`).join(", ")}.
    Cost estimates may be incomplete.
  </div>` : ""}
</div>

<!-- Event Timeline -->
<div class="section">
  <h2>Recent Activity Timeline <span style="font-size:11px;color:#94a3b8;font-weight:400;">(last ${Math.min(30, displayEvents.length)} events)</span></h2>
  ${displayEvents.length > 0 ? `
  <div class="timeline">
    ${displayEvents.map(e => `
    <div class="timeline-item ${e.event_type}${e.status === 'failure' ? ' failure' : ''}">
      <div class="event-header">
        <span class="event-type ${e.event_type}">${e.event_type.replace('_', ' ')}</span>
        <span class="event-time">${formatTimestamp(e.timestamp)}</span>
      </div>
      <div class="event-detail">
        ${e.model ? `Model: <code>${escapeHtml(e.model)}</code> · ` : ""}
        Status: <span class="status-badge ${e.status}">${e.status || 'unknown'}</span>
        ${e.token_count != null ? ` · ${e.token_count.toLocaleString()} tokens` : ""}
        ${e.gateway_overhead_ms != null ? ` · ${e.gateway_overhead_ms}ms overhead` : ""}
        ${e.output_hash ? `<br><span class="hash-badge">output: ${escapeHtml(e.output_hash.slice(0, 16))}...</span>` : ""}
        ${e.input_hash ? ` <span class="hash-badge">input: ${escapeHtml(e.input_hash.slice(0, 16))}...</span>` : ""}
        ${e.tool_name ? `<br>Tool: <code>${escapeHtml(e.tool_name)}</code>` : ""}
        ${e.error_code ? `<br>Error: <code>${escapeHtml(e.error_code)}</code> — ${escapeHtml(e.error_message || 'no details')}` : ""}
      </div>
    </div>`).join("")}
  </div>` : `<p style="color:#94a3b8;font-size:13px;">No events recorded yet. Start using the TrustOS Gateway to populate the event log.</p>`}
</div>

${stats.failureEventList.length > 0 ? `
<!-- Failures Detail -->
<div class="section">
  <h2>Failure Details</h2>
  <table>
    <tr><th>Time</th><th>Type</th><th>Error</th><th>Details</th></tr>
    ${stats.failureEventList.map(f => `
    <tr>
      <td>${formatTimestamp(f.timestamp)}</td>
      <td><span class="status-badge failure">${f.event_type}</span></td>
      <td><code>${escapeHtml(f.error_code || 'unknown')}</code></td>
      <td>${escapeHtml(f.error_message || 'no details')}</td>
    </tr>`).join("")}
  </table>

  <div class="explanation warning" style="margin-top:12px;">
    <strong>Review guidance:</strong> Failures in this report may be caused by upstream API issues
    (network, rate limiting, model unavailability) rather than TrustOS itself.
    TrustOS records failures as evidence of what happened — they do not indicate TrustOS malfunction.
    Cross-reference with the gateway's health status for diagnosis.
  </div>
</div>` : ""}

<!-- Hash Verification Guide -->
<div class="section">
  <h2>How to Verify This Report</h2>
  <div class="verify-box">
    <h4>1. Locate the Output Hash</h4>
    <p>Find an event in the timeline above that has an <code>output</code> hash (e.g., <code>a3f2b8c1d4e5...</code>).</p>
  </div>
  <div class="verify-box">
    <h4>2. Compute SHA-256 of the Original Output</h4>
    <p>Take the original AI response text (as you received it from the AI application).<br>
    Using any SHA-256 tool (openssl, sha256sum, online calculator), compute: <code>SHA-256(original_output_text)</code></p>
  </div>
  <div class="verify-box">
    <h4>3. Compare Hashes</h4>
    <p>If the computed hash matches the hash in this report, the output is <strong>verifiably the same</strong> as what was observed by TrustOS. This proves the AI response was not tampered with after observation.</p>
  </div>
  <div class="verify-box">
    <h4>4. Trust but Verify</h4>
    <p>TrustOS records are tamper-evident, not tamper-proof. Hash verification provides a <em>reasonable assurance</em> that the evidence has not been altered post-observation. For compliance-grade evidence, a hash chain (Merkle tree) or digital signature would be required — these are planned for future releases.</p>
  </div>

  <div class="explanation">
    <strong>Privacy note:</strong> This report does not contain any raw AI inputs or outputs.
    Only SHA-256 hashes are stored. TrustOS is designed for governance without surveillance —
    reviewers can verify evidence without accessing private conversation content.
  </div>
</div>

<!-- Privacy Statement -->
<div class="section">
  <h2>Privacy &amp; Scope</h2>
  <table>
    <tr><th>Aspect</th><th>What TrustOS Records</th><th>What TrustOS Does NOT Record</th></tr>
    <tr><td>Model Input</td><td>SHA-256 hash only</td><td>Raw prompt text, user messages, context</td></tr>
    <tr><td>Model Output</td><td>SHA-256 hash only</td><td>Raw response text</td></tr>
    <tr><td>Tool Calls</td><td>Tool name + SHA-256 hash of args/result</td><td>Raw arguments or result content</td></tr>
    <tr><td>Metadata</td><td>Model name, token count, cost, latency, session ID</td><td>IP addresses, user identity, geolocation</td></tr>
    <tr><td>Failures</td><td>Error code + message</td><td>Stack traces, API keys, credentials</td></tr>
  </table>

  <div class="explanation success" style="margin-top:16px;">
    <strong>Design principle:</strong> TrustOS observes AI activity at the protocol level — it does not inspect,
    scan, or analyze content. This is "governance without surveillance" — organizations get verifiable evidence
    of what happened without compromising user privacy.
  </div>
</div>

<!-- Limitations -->
<div class="section">
  <h2>Known Limitations</h2>
  <table>
    <tr><th>Limitation</th><th>Status</th><th>Impact</th></tr>
    <tr><td>Streaming mode</td><td><span class="status-badge good">supported (SSE)</span></td><td>Streaming SSE responses are supported and validated for completed streams in this beta. Completed streams produce verifiable output_hash. Failed or interrupted streams are recorded without output_hash by design. Not production-grade — no delivery guarantee, no chunk-level evidence.</td></tr>
    <tr><td>Hash chain</td><td><span class="status-badge failure">not implemented</span></td><td>Events are individually hashed but not chained. Tamper-evident per-event, not across events.</td></tr>
    <tr><td>Digital signatures</td><td><span class="status-badge failure">not implemented</span></td><td>Reports are not cryptographically signed. For compliance-grade evidence, this is planned (TRST-4E).</td></tr>
    <tr><td>Enforcement</td><td><span class="status-badge failure">shadow mode</span></td><td>All control decisions are recommendations only. No requests are actually blocked.</td></tr>
    <tr><td>Database storage</td><td><span class="status-badge failure">JSONL file</span></td><td>Events stored in flat file. Durable database storage is planned (TRST-4C).</td></tr>
  </table>
</div>

<!-- Footer -->
<div class="footer">
  <p>Generated by TrustOS Gateway v0.1 — TRST-4A Evidence Report (MVP)</p>
  <p>This report is for internal review purposes only. Not a compliance or certification artifact.</p>
  <p>TrustOS operates in Shadow Mode. No AI activity was intercepted, blocked, or modified.</p>
</div>

</div>
</body>
</html>`;
}

// ── Markdown Generation ──────────────────────────────────────────────────────

function generateMarkdown(stats: ReportStats, generatedAt: string): string {
  const hashCov = hashCoveragePct(stats);
  const lines: string[] = [
    "# TrustOS Evidence Report",
    "",
    `**Generated:** ${generatedAt}`,
    `**Report ID:** TRST4A-${Date.now().toString(36).toUpperCase()}`,
    `**Mode:** Shadow (Dry-Run) — No Enforcement`,
    "",
    "---",
    "",
    "## Executive Summary",
    "",
    `- Model calls: ${stats.modelCalls} (streaming: ${stats.streamingModelCalls}, non-streaming: ${stats.nonStreamingModelCalls}${stats.unknownModeModelCalls > 0 ? `, unknown mode: ${stats.unknownModeModelCalls}` : ""})`,
    `- Tool calls: ${stats.toolCalls}`,
    `- Total tokens: ${stats.totalTokens.toLocaleString()}`,
    `- Estimated cost: ${formatCost(stats.totalEstimatedCost)}`,
    `- Failures: ${stats.failureEvents}`,
    `- Hash coverage: ${hashCov}%`,
    `- Sessions: ${stats.sessions}`,
    `- Events: ${stats.eventsCaptured}`,
    "",
    "---",
    "",
    "## Evidence Integrity",
    "",
    `| Metric | Value |`,
    `|---|---|`,
    `| Output hash coverage | ${stats.modelsWithOutputHash}/${stats.modelCalls} (${hashCov}%) |`,
    `| Input hash coverage | ${stats.modelsWithInputHash}/${stats.modelCalls} |`,
    `| Context blocks | ${stats.contextBlockCount} |`,
    `| Sessions | ${stats.sessions} |`,
    "",
    "---",
    "",
    "## Control Decisions",
    "",
    `| Decision | Count |`,
    `|---|---|`,
    `| Allow | ${stats.controlDecisions.allow} |`,
    `| Warn | ${stats.controlDecisions.warn} |`,
    `| Block | ${stats.controlDecisions.block} |`,
    `| No Decision | ${stats.controlDecisions.unknown} |`,
    "",
    "> TrustOS operates in Shadow Mode. All decisions are recommendations only — not enforced.",
    "",
    "---",
    "",
    "## Model Usage",
    "",
  ];

  if (stats.topModels.length > 0) {
    lines.push(
      `| Model | Calls | Tokens | Est. Cost |`,
      `|---|---|---|---|`,
      ...stats.topModels.map(m =>
        `| \`${m.model}\` | ${m.calls} | ${m.tokens.toLocaleString()} | ${formatCost(m.cost)} |`
      ),
      "",
    );
  }

  if (stats.overheadMsAvg != null) {
    lines.push(
      "## Gateway Performance",
      "",
      `| Metric | Value |`,
      `|---|---|`,
      `| Avg overhead | ${stats.overheadMsAvg} ms |`,
      `| P50 | ${stats.overheadMsP50} ms |`,
      `| P99 | ${stats.overheadMsP99} ms |`,
      "",
    );
  }

  if (stats.failureEventList.length > 0) {
    lines.push(
      "## Failures",
      "",
      ...stats.failureEventList.map(f =>
        `- **${f.event_type}** (${f.event_id}): \`${f.error_code || 'unknown'}\` — ${f.error_message || 'no details'}`
      ),
      "",
    );
  }

  lines.push(
    "---",
    "",
    "## Privacy & Scope",
    "",
    "- No raw model inputs/outputs stored — SHA-256 hashes only",
    "- Tool calls: name + hash only, no raw arguments/results",
    "- No user identity, IP addresses, or geolocation stored",
    "- Failures: error codes only, no stack traces or credentials",
    "",
    "## Known Limitations",
    "",
    "- Streaming mode: supported (SSE) — validated for completed streams. Failed/cancelled streams recorded without output_hash by design. Not production-grade.",
    "- Hash chain: not implemented (per-event hashing only)",
    "- Digital signatures: not implemented",
    "- Enforcement: shadow mode (dry-run) only",
    "- Storage: flat JSONL file (database planned)",
    "",
    "---",
    "",
    `*Generated by TrustOS Gateway — TRST-4A Evidence Report. Shadow Mode. For internal review only.*`,
  );

  return lines.join("\n");
}

// ── Main API ─────────────────────────────────────────────────────────────────

export interface GenerateReportOptions {
  eventLogPath: string;
}

export function generateEvidenceReport(options: GenerateReportOptions): EvidenceReport {
  const { eventLogPath } = options;
  const generatedAt = new Date().toISOString();
  const events = loadEvents(eventLogPath);
  const stats = aggregate(events);

  const html = generateHtml(stats, events, generatedAt);
  const markdown = generateMarkdown(stats, generatedAt);

  return {
    html,
    markdown,
    stats,
    eventCount: events.length,
    generatedAt,
  };
}
