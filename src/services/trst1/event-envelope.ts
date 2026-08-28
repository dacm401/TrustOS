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
  | "telemetry_failure"
  | "mcp_initialize"
  | "mcp_proxy"
  | "mcp_tool_proxy"
  | "mcp_resource_proxy"
  | "mcp_prompt_proxy";

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

  // ── Request mode (reserved OS primitive; runtime-populated, e.g. "streaming") ──
  // Type declaration alignment only — already written by Gateway at runtime.
  // ADDITIVE ONLY: no removal/redefinition per schema evolution policy.
  request_mode?: string;

  // ── MWT-3B1: Task correlation (nullable by design) ──
  /**
   * Nullable task correlation ID. Manager-assigned or caller-provided.
   * Gateway NEVER creates task_id — it only observes and attaches it from a
   * trusted X-TrustOS-Task-Id header. Pre-task / unassigned events = null.
   *
   * Wire format: snake_case `task_id`. NEVER `taskId`.
   */
  task_id: string | null;

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
  /**
   * SHA-256 of this event (canonical JSON, sorted keys).
   * Proves: this single event was not modified.
   */
  event_hash?: string;
  /**
   * Hash-chain link: event_hash of the immediately preceding event.
   * Genesis event (first in a store) has prev_hash = null.
   *
   * Together with event_hash this forms a tamper-evident chain:
   * - event_hash proves a single event is unmodified
   * - prev_hash proves NO event was deleted or reordered
   *
   * Previously the store only had per-event hashes, which could not detect
   * deletion of an entire event from the middle of the log.
   */
  prev_hash?: string | null;
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

/**
 * MWT-3B1: Extract a valid task_id from a trusted request header context.
 *
 * Rules (PM R2/R3):
 * - missing header → null
 * - empty/whitespace-only header → null (never a valid task_id)
 * - present non-empty trimmed string → that value
 *
 * Gateway MUST NOT generate, infer, or default task_id. This function only
 * normalizes a caller-supplied trusted value; it never fabricates one.
 */
export function extractTaskId(rawTaskId: string | undefined | null): string | null {
  if (rawTaskId === undefined || rawTaskId === null) return null;
  const trimmed = rawTaskId.trim();
  if (trimmed.length === 0) return null;
  return trimmed;
}
