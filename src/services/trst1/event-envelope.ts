/**
 * TRST-1 Event Envelope — Unified event schema for all mediated calls.
 *
 * Aligned with TRST-1 Execution Trace MVP Charter v0.1 §3.3.
 * Every field in this schema is a reserved OS primitive — empty fields in
 * TRST-1 indicate future enforcement/governance capability, not missing data.
 *
 * Schema evolution: ADDITIVE ONLY. Existing fields are never removed or redefined.
 */

import { createHash } from "node:crypto";

// ── Event Type ──────────────────────────────────────────────────────────────

export type TrstEventType =
  | "model_call"
  | "tool_call"
  | "session_lifecycle"
  | "telemetry_failure";

export type TrstEventStatus = "success" | "failure";

// ── Context Block (Lite) ───────────────────────────────────────────────────

export interface ContextBlockMeta {
  block_id: string;
  role: string;
  source_type: "chat_message";
  approx_tokens: number;
  content_hash: string;
  privacy_flags: string[];
}

// ── Main Event Envelope ────────────────────────────────────────────────────

export interface TrstEventEnvelope {
  // ── Identity ──
  event_id: string;
  event_type: TrstEventType;
  timestamp: string; // ISO 8601
  trace_id: string;
  parent_event_id?: string;

  // ── Attribution ──
  actor_id?: string;
  agent_id?: string;
  session_id: string;
  run_id: string;
  project_id: string;

  // ── Source / Destination ──
  source?: string;
  destination?: string;
  resource_type: "model" | "tool";
  resource_ref?: string;

  // ── Model-specific ──
  model?: string;
  provider?: string;
  tool_name?: string;

  // ── Content Hashes ──
  context_block_refs?: string[];
  input_hash?: string;
  output_hash?: string;
  args_hash?: string;
  result_hash?: string;

  // ── Metrics ──
  token_count?: number;
  cost_estimate?: number | null;
  latency_ms: number;
  gateway_overhead_ms?: number;

  // ── Privacy / Classification (reserved, manually supplied or empty) ──
  privacy_flags: string[];
  data_classification?: string;

  // ── Future governance ──
  policy_decision_ref?: string;
  capability_ref?: string;
  approval_ref?: string;
  artifact_refs?: string[];

  // ── Outcome ──
  status: TrstEventStatus;
  error_code?: string;
  error_message?: string;

  // ── Evidence Integrity ──
  event_hash?: string;
}

// ── Factory ─────────────────────────────────────────────────────────────────

let _eventCounter = 0;

export function createEventId(): string {
  _eventCounter++;
  const ts = Date.now().toString(36);
  const seq = _eventCounter.toString(36).padStart(4, "0");
  const rand = Math.random().toString(36).slice(2, 8);
  return `evt_${ts}_${seq}_${rand}`;
}

export function computeEventHash(event: Omit<TrstEventEnvelope, "event_hash">): string {
  // Canonical JSON: sorted keys, no whitespace
  const canonical = JSON.stringify(event, Object.keys(event).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

export function sealEvent(event: Omit<TrstEventEnvelope, "event_hash">): TrstEventEnvelope {
  const event_hash = computeEventHash(event);
  return { ...event, event_hash };
}
