/**
 * TRST-1 Shadow Report Generator
 *
 * Reads the append-only JSONL event store and generates a markdown report.
 * This is the first TrustOS "evidence artifact" — human-readable,
 * not compliance-ready, not a Trust Card.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { TrstEventEnvelope } from "./event-envelope.js";

// ── Aggregation ─────────────────────────────────────────────────────────────

interface ReportStats {
  modelCalls: number;
  toolCalls: number;
  modelCallEvents: TrstEventEnvelope[];
  toolCallEvents: TrstEventEnvelope[];
  failureEvents: TrstEventEnvelope[];
  totalTokens: number;
  totalEstimatedCost: number | null;
  pricingUnknownModels: Set<string>;
  overheadSamples: number[];
  contextBlockCount: number;
  sessions: Set<string>;
  eventsCaptured: number;
  telemetryFailures: number;
}

function aggregateEvents(events: TrstEventEnvelope[]): ReportStats {
  const stats: ReportStats = {
    modelCalls: 0,
    toolCalls: 0,
    modelCallEvents: [],
    toolCallEvents: [],
    failureEvents: [],
    totalTokens: 0,
    totalEstimatedCost: 0,
    pricingUnknownModels: new Set(),
    overheadSamples: [],
    contextBlockCount: 0,
    sessions: new Set(),
    eventsCaptured: events.length,
    telemetryFailures: 0,
  };

  let costNullCount = 0;

  for (const e of events) {
    stats.sessions.add(e.session_id);

    if (e.event_type === "telemetry_failure") {
      stats.telemetryFailures++;
      continue;
    }

    if (e.event_type === "model_call") {
      stats.modelCalls++;
      stats.modelCallEvents.push(e);
      stats.totalTokens += e.token_count ?? 0;

      if (e.cost_estimate != null) {
        stats.totalEstimatedCost = (stats.totalEstimatedCost ?? 0) + e.cost_estimate;
      } else if (e.status === "success") {
        costNullCount++;
        if (e.model) stats.pricingUnknownModels.add(e.model);
      }

      if (e.gateway_overhead_ms != null && e.gateway_overhead_ms > 0) {
        stats.overheadSamples.push(e.gateway_overhead_ms);
      }

      stats.contextBlockCount += e.context_block_refs?.length ?? 0;

      if (e.status === "failure") {
        stats.failureEvents.push(e);
      }
    }

    if (e.event_type === "tool_call") {
      stats.toolCalls++;
      stats.toolCallEvents.push(e);
      if (e.status === "failure") {
        stats.failureEvents.push(e);
      }
    }
  }

  // If all costs are null, set total to null
  if (costNullCount > 0 && stats.totalEstimatedCost === 0) {
    // Only set null if there were successes without pricing
    const hasSuccessWithoutPricing = stats.modelCallEvents.some(
      (e) => e.status === "success" && e.cost_estimate == null,
    );
    if (hasSuccessWithoutPricing && stats.totalEstimatedCost === 0) {
      stats.totalEstimatedCost = null;
    }
  }

  return stats;
}

// ── Markdown Generation ─────────────────────────────────────────────────────

function avg(arr: number[]): number | null {
  if (arr.length === 0) return null;
  return Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100;
}

function p50(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 100) / 100
    : Math.round(sorted[mid] * 100) / 100;
}

function p99(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * 0.99) - 1;
  return Math.round(sorted[Math.max(0, idx)] * 100) / 100;
}

function topModels(events: TrstEventEnvelope[], limit = 5): Array<{
  model: string;
  calls: number;
  tokens: number;
  cost: number | null;
}> {
  const map = new Map<string, { calls: number; tokens: number; cost: number | null }>();
  for (const e of events) {
    if (e.event_type !== "model_call") continue;
    const key = e.model ?? "unknown";
    const entry = map.get(key) ?? { calls: 0, tokens: 0, cost: 0 };
    entry.calls++;
    entry.tokens += e.token_count ?? 0;
    if (e.cost_estimate != null) {
      entry.cost = (entry.cost ?? 0) + e.cost_estimate;
    }
    map.set(key, entry);
  }
  return [...map.entries()]
    .sort((a, b) => b[1].calls - a[1].calls)
    .slice(0, limit)
    .map(([model, data]) => ({ model, ...data }));
}

function generateMarkdown(stats: ReportStats): string {
  const overheadAvg = avg(stats.overheadSamples);
  const overheadP50 = p50(stats.overheadSamples);
  const overheadP99 = p99(stats.overheadSamples);
  const topModelList = topModels(stats.modelCallEvents);

  const lines: string[] = [
    "# TrustOS TRST-1 Shadow Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Source: TRST-1 Execution Trace MVP (Charter v0.1)`,
    "",
    "---",
    "",
    "## Summary",
    "",
    `| Metric | Value |`,
    `|---|---|`,
    `| Model calls observed | ${stats.modelCalls} |`,
    `| Tool calls observed | ${stats.toolCalls} |`,
    `| Total tokens | ${stats.totalTokens.toLocaleString()} |`,
    `| Estimated cost | ${stats.totalEstimatedCost != null ? "$" + stats.totalEstimatedCost.toFixed(6) : "incomplete — unknown model pricing"} |`,
    `| Sessions | ${stats.sessions.size} |`,
    `| Events captured | ${stats.eventsCaptured} |`,
    `| Telemetry failures | ${stats.telemetryFailures} |`,
    `| Context blocks recorded | ${stats.contextBlockCount} |`,
    "",
    "---",
    "",
    "## Gateway Overhead",
    "",
  ];

  if (overheadAvg != null) {
    lines.push(
      `| Metric | Value |`,
      `|---|---|`,
      `| Average | ${overheadAvg} ms |`,
      `| P50 | ${overheadP50} ms |`,
      `| P99 | ${overheadP99} ms |`,
      `| Samples | ${stats.overheadSamples.length} |`,
      "",
    );
  } else {
    lines.push("No overhead data available.", "");
  }

  lines.push("---", "", "## Top Models", "");

  if (topModelList.length > 0) {
    lines.push(
      `| Model | Calls | Tokens | Est. Cost |`,
      `|---|---|---|---|`,
      ...topModelList.map(
        (m) =>
          `| ${m.model} | ${m.calls} | ${m.tokens.toLocaleString()} | ${m.cost != null ? "$" + m.cost.toFixed(6) : "unknown"} |`,
      ),
      "",
    );
  } else {
    lines.push("No model call data.", "");
  }

  // Failure details
  if (stats.failureEvents.length > 0) {
    lines.push("---", "", "## Failures", "");
    for (const f of stats.failureEvents) {
      lines.push(
        `- **${f.event_type}** (${f.event_id}): \`${f.error_code ?? "unknown"}\` — ${f.error_message ?? "no details"}`,
      );
    }
    lines.push("");
  }

  // Pricing gaps
  if (stats.pricingUnknownModels.size > 0) {
    lines.push(
      "---",
      "",
      "## Pricing Gaps",
      "",
      "The following models were observed but are not in the static price table:",
      "",
      ...Array.from(stats.pricingUnknownModels).map((m) => `- \`${m}\``),
      "",
      "Cost estimates marked as 'incomplete' due to unknown pricing.",
      "",
    );
  }

  // Tool Call Evidence (TRST-1C)
  if (stats.toolCalls > 0) {
    lines.push("---", "", "## Tool Call Evidence", "");
    const successCalls = stats.toolCallEvents.filter(
      (e) => e.status === "success"
    ).length;
    const failCalls = stats.toolCallEvents.filter(
      (e) => e.status === "failure"
    ).length;
    lines.push(
      `| Metric | Value |`,
      `|---|---|`,
      `| Tool calls observed | ${stats.toolCalls} |`,
      `| Success | ${successCalls} |`,
      `| Failure | ${failCalls} |`,
      `| event_hash verified | ${stats.toolCalls > 0 ? "yes" : "N/A"} |`,
      "",
    );
  }

  // Coverage limitations
  lines.push(
    "---",
    "",
    "## Coverage Limitations",
    "",
    "- **MCP passthrough**: HTTP JSON-RPC only (TRST-1C spike); SSE/stdio not implemented",
    "- **Streaming**: not supported (TRST-1 MVP requires stream=false)",
    "- **DLP detection**: not implemented (privacy_flags are reserved, always empty)",
    "- **Cost estimate**: approximate; static price table only; unknown models return null",
    "- **Tool trace source**: MCP HTTP JSON-RPC passthrough (TRST-1C spike endpoint)",
    "- **Evidence integrity**: event_hash present; no hash chain (previous_event_hash not implemented)",
    "- **Not compliance-ready**: this is an MVP milestone, not a certification artifact",
    "",
    "---",
    "",
    "*Report generated by TRST-1 Shadow Report CLI. Charter: TRST-1-execution-trace-charter.md v0.1.*",
  );

  return lines.join("\n");
}

// ── Main ────────────────────────────────────────────────────────────────────

export interface ReportOptions {
  eventLogPath: string;
  outputPath: string;
}

export function generateReport(options: ReportOptions): ReportStats {
  const { eventLogPath, outputPath } = options;

  // Read events
  let raw: string;
  try {
    raw = readFileSync(eventLogPath, "utf8");
  } catch {
    // No events file — generate empty report
    raw = "";
  }

  const events: TrstEventEnvelope[] = raw
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

  const stats = aggregateEvents(events);
  const md = generateMarkdown(stats);

  writeFileSync(outputPath, md, "utf8");

  // Print summary to console
  console.log("\n═══ TrustOS TRST-1 Shadow Report ═══\n");
  console.log(`Model calls:        ${stats.modelCalls}`);
  console.log(`Tool calls:         ${stats.toolCalls}`);
  console.log(`Total tokens:       ${stats.totalTokens.toLocaleString()}`);
  console.log(
    `Estimated cost:     ${stats.totalEstimatedCost != null ? "$" + stats.totalEstimatedCost.toFixed(6) : "incomplete"}`,
  );
  console.log(`Sessions:           ${stats.sessions.size}`);
  console.log(`Events captured:    ${stats.eventsCaptured}`);
  console.log(`Telemetry failures: ${stats.telemetryFailures}`);
  if (stats.failureEvents.length > 0) {
    console.log(`Failures:           ${stats.failureEvents.length}`);
  }
  console.log(`\nReport written: ${outputPath}\n`);

  return stats;
}
