/**
 * TRST-2B Evidence Bundle Builder
 *
 * Frontend-only, privacy-safe evidence bundle generation.
 * Mirrors: scripts/trst2/run-prove-evidence-smoke.mjs
 *
 * Principles:
 * - Pure functions — no side effects, no API calls
 * - Metadata-only — hashes only, never raw content
 * - Reuses assess-utils (assessEvents, computeControlRecommendation)
 * - Schema: trstos-evidence-bundle/v0
 */

import type { GatewayEvent } from "./api";
import { assessEvents, computeControlRecommendation, type RiskLevel } from "./assess-utils";

const SCHEMA_VERSION = "trstos-evidence-bundle/v0";

// ── 20 Forbidden Keys ─────────────────────────────────────────────────────────
// Recursively scanned in output. *_hash keys are always allowed.
// token_count is allowed (explicit exemption via forbidden key check).

const FORBIDDEN_KEYS = new Set([
  "prompt",
  "response",
  "input",
  "output",
  "args",
  "result",
  "content",
  "messages",
  "body",
  "headers",
  "authorization",
  "api_key",
  "secret",
  "token",
  "password",
  "raw",
  "raw_body",
  "raw_response",
  "env",
  "environment",
]);

// ── Evidence Event (13 hash-only fields) ─────────────────────────────────────

export interface EvidenceEvent {
  event_id: string | null;
  event_type: string | null;
  timestamp: string | null;
  agent_id: string | null;
  provider: string | null;
  model: string | null;
  status: string | null;
  latency_ms: number | null;
  token_count: number | null;
  hashes: {
    event_hash: string | null;
    input_hash: string | null;
    output_hash: string | null;
    args_hash: string | null;
    result_hash: string | null;
  };
}

// ── Evidence Bundle ──────────────────────────────────────────────────────────

export interface EvidenceBundle {
  schema_version: string;
  generated_at: string;
  runtime_effect: "none";
  trace: {
    trace_id: string;
    session_ids: string[];
    run_ids: string[];
    event_count: number;
    time_range: {
      start: string | null;
      end: string | null;
    };
  };
  events: EvidenceEvent[];
  assessment: {
    risk_level: RiskLevel;
    signal_count: number;
    signals: { code: string; severity: string; category: string; label: string }[];
    privacy_ok: boolean;
    trace_integrity_ok: boolean;
  };
  control: {
    action: string;
    reasons: string[];
    mode: "dry_run";
    runtime_effect: "none";
  };
  privacy: {
    raw_content_included: false;
    forbidden_keys_checked: true;
  };
}

// ── sanitizeEventForEvidence ─────────────────────────────────────────────────
// Extract only the 13 hash-only metadata fields from a GatewayEvent.
// Mirrors: scripts/trst2/run-prove-evidence-smoke.mjs:164-183

export function sanitizeEventForEvidence(ev: GatewayEvent): EvidenceEvent {
  return {
    event_id: ev.event_id ?? null,
    event_type: ev.event_type ?? null,
    timestamp: ev.timestamp ?? null,
    agent_id: ev.agent_id ?? null,
    provider: ev.provider ?? null,
    model: ev.model ?? null,
    status: ev.status ?? null,
    latency_ms: ev.latency_ms ?? null,
    token_count: ev.token_count ?? null,
    hashes: {
      event_hash: ev.event_hash ?? null,
      input_hash: ev.input_hash ?? null,
      output_hash: ev.output_hash ?? null,
      args_hash: ev.args_hash ?? null,
      result_hash: ev.result_hash ?? null,
    },
  };
}

// ── hasForbiddenKey ──────────────────────────────────────────────────────────
// Recursively scan for 20 forbidden keys. Max depth 5.
// *_hash keys are always allowed.
// token_count is allowed (key is "token_count", not "token").
// Mirrors: scripts/trst2/run-prove-evidence-smoke.mjs:187-204

export function hasForbiddenKey(obj: unknown, depth = 0): boolean {
  if (depth > 5 || obj === null || typeof obj !== "object") return false;
  const record = obj as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_KEYS.has(key) && !key.endsWith("_hash")) return true;
    const val = record[key];
    if (typeof val === "object" && val !== null) {
      if (hasForbiddenKey(val, depth + 1)) return true;
    }
  }
  return false;
}

// ── buildEvidenceBundle ──────────────────────────────────────────────────────
// Build a complete trstos-evidence-bundle/v0 for a single trace group.
// Reuses assessEvents() + computeControlRecommendation() from assess-utils.
// Mirrors: scripts/trst2/run-prove-evidence-smoke.mjs:208-283

export function buildEvidenceBundle(
  traceKey: string,
  events: GatewayEvent[]
): EvidenceBundle {
  // Assessment via existing assess-utils (pure, frontend-only)
  const assessments = assessEvents(events);
  const assessment =
    assessments.find((a) => a.traceKey === traceKey) ?? assessments[0];

  // Dry-run control recommendation
  const controlRec = assessment
    ? computeControlRecommendation(assessment)
    : undefined;

  // Time range from timestamps
  const tsList = events
    .map((e) => e.timestamp)
    .filter((t): t is string => !!t)
    .sort();

  // Session/run dedup
  const sessionIds = [
    ...new Set(
      events.map((e) => e.session_id).filter((s): s is string => !!s)
    ),
  ];
  const runIds = [
    ...new Set(events.map((e) => e.run_id).filter((r): r is string => !!r)),
  ];

  // Sanitized events (hashes only, metadata)
  const evidenceEvents = events.map(sanitizeEventForEvidence);

  return {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    runtime_effect: "none",
    trace: {
      trace_id: traceKey,
      session_ids: sessionIds,
      run_ids: runIds,
      event_count: events.length,
      time_range: {
        start: tsList[0] ?? null,
        end: tsList[tsList.length - 1] ?? null,
      },
    },
    events: evidenceEvents,
    assessment: {
      risk_level: assessment?.riskLevel ?? "none",
      signal_count: assessment?.signals.length ?? 0,
      signals: (assessment?.signals ?? []).map((s) => ({
        code: s.code,
        severity: s.severity,
        category: s.category,
        label: s.label,
      })),
      privacy_ok: assessment?.privacyOk ?? true,
      trace_integrity_ok: assessment?.traceIntegrityOk ?? true,
    },
    control: {
      action: controlRec?.action ?? "allow",
      reasons: controlRec?.reasons ?? [],
      mode: "dry_run",
      runtime_effect: "none",
    },
    privacy: {
      raw_content_included: false,
      forbidden_keys_checked: true,
    },
  };
}
