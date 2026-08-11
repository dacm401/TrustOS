// MWT-4A — Task Evidence aggregation (frontend-only, pure function).
// Extracted from useTaskEvidence so the projection logic is unit-testable
// without a live Gateway. No I/O, no React, no backend dependency.
import type { GatewayEvent } from "@/lib/api";
import type { TaskEvidenceState, TaskEvidenceSummary } from "@/types/task-evidence";

export const EMPTY_SUMMARY: TaskEvidenceSummary = {
  event_count: 0,
  total_input_tokens: 0,
  total_output_tokens: 0,
  total_tokens: 0,
  total_cost: null,
  control: { allow: 0, deny: 0, unknown: 0 },
};

/**
 * Aggregate seeded GatewayEvents into a TaskEvidenceSummary.
 * - Tokens summed from numeric input/output_tokens (missing → 0).
 * - Cost summed from numeric cost_estimate only when present.
 * - Control counts use explicit control_decision ONLY; no inference from error_code.
 */
export function aggregateTaskEvidence(events: GatewayEvent[]): TaskEvidenceSummary {
  const summary: TaskEvidenceSummary = {
    event_count: events.length,
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_tokens: 0,
    total_cost: null,
    control: { allow: 0, deny: 0, unknown: 0 },
  };

  let costAcc = 0;
  let hasCost = false;

  for (const e of events) {
    const input = typeof e.input_tokens === "number" ? e.input_tokens : 0;
    const output = typeof e.output_tokens === "number" ? e.output_tokens : 0;
    summary.total_input_tokens += input;
    summary.total_output_tokens += output;
    summary.total_tokens += input + output;

    const cost = typeof e.cost_estimate === "number" ? e.cost_estimate : null;
    if (cost !== null) {
      costAcc += cost;
      hasCost = true;
    }

    // Control: explicit control_decision ONLY. No inference from error_code.
    const decision = typeof e.control_decision === "string" ? e.control_decision.toLowerCase() : "";
    if (decision === "allow") summary.control.allow += 1;
    else if (decision === "deny" || decision === "block") summary.control.deny += 1;
    else summary.control.unknown += 1;
  }

  summary.total_cost = hasCost ? costAcc : null;
  return summary;
}

/**
 * Sort events by timestamp ascending (stable string compare; empty timestamp sorts first).
 * Used by the hook before aggregation so the timeline is ordered.
 */
export function sortEventsByTimestamp(events: GatewayEvent[]): GatewayEvent[] {
  return [...events].sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? ""));
}

/** Build the full TaskEvidenceState for a given event set (used by deterministic smoke). */
export function buildTaskEvidenceState(events: GatewayEvent[]): TaskEvidenceState {
  const ordered = sortEventsByTimestamp(events);
  return {
    loading: false,
    error: null,
    events: ordered,
    summary: aggregateTaskEvidence(ordered),
  };
}
