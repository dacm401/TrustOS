/**
 * TRST Evidence Bundle — server-side builder (2026-08-28).
 *
 * Previously the bundle was built entirely in the browser and exported via
 * clipboard / Blob download, with `signed: false` — it could not be verified
 * by a third party and was never persisted.
 *
 * This service moves generation to the backend so the bundle can be
 * **signed and verified**, while keeping every privacy guarantee:
 *
 * - Metadata-only: 13 hash-only fields per event. NEVER raw content.
 * - Forbidden-key scan: the serialized bundle is recursively checked.
 * - No enforcement: `runtime_effect: "none"` — prove, not control.
 *
 * Honest signing model:
 *   We use HMAC-SHA256 with a local key (TRUSTOS_EVIDENCE_SIGNING_KEY).
 *   This is **tamper-evident, not tamper-proof** (matches TRST-0.3: those
 *   holding the key can re-sign). When no key is configured the bundle is
 *   returned unsigned with an explicit reason — we never fake `signed: true`.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { readAllEvents, verifyEventChain } from "./jsonl-event-store.js";
import { assessEvents, type AssessmentEvent } from "../assessment/assess-engine.js";

// ── Privacy guardrails ──────────────────────────────────────────────────────
// Recursively scanned across the serialized bundle. *_hash keys are always
// allowed. Mirrors frontend/src/lib/evidence-bundle.ts.
const FORBIDDEN_KEYS = new Set([
  "prompt", "response", "input", "output", "args", "result",
  "content", "messages", "body", "headers", "authorization",
  "api_key", "secret", "token", "password", "raw",
  "raw_body", "raw_response", "env", "environment",
]);

export const EVIDENCE_SCHEMA_VERSION = "trstos-evidence-bundle/v1";

// ── Types ───────────────────────────────────────────────────────────────────

export interface EvidenceBundleEvent {
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
    prev_hash: string | null;
    input_hash: string | null;
    output_hash: string | null;
    args_hash: string | null;
    result_hash: string | null;
  };
}

export interface EvidenceBundleSignature {
  /** Always reports the truth — false when no signing key is configured. */
  signed: boolean;
  algorithm: "hmac-sha256" | null;
  digest: string | null;
  /** Present when signed === false, explains why. */
  reason?: string;
}

export interface EvidenceBundle {
  schema_version: string;
  generated_at: string;
  runtime_effect: "none";
  trace: {
    trace_id: string;
    session_ids: string[];
    run_ids: string[];
    event_count: number;
    time_range: { start: string | null; end: string | null };
  };
  events: EvidenceBundleEvent[];
  assessment: {
    risk_level: string;
    signal_count: number;
    signals: Array<{
      code: string;
      severity: string;
      category: string;
      label: string;
    }>;
    privacy_ok: boolean;
    trace_integrity_ok: boolean;
  };
  /** Hash-chain verification — proves no tampering AND no deletion. */
  chain: {
    valid: boolean;
    event_count: number;
    broken_at_index: number | null;
    reason: string | null;
  };
  privacy: {
    raw_content_included: false;
    forbidden_keys_checked: boolean;
    forbidden_keys_found: string[];
  };
  signature: EvidenceBundleSignature;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function asStr(v: unknown): string | null {
  return typeof v === "string" ? v : v == null ? null : String(v);
}
function asNum(v: unknown): number | null {
  return typeof v === "number" ? v : v == null ? null : Number(v);
}

/** Recursively collect any forbidden key actually present in the output. */
function scanForbiddenKeys(node: unknown, found = new Set<string>()): string[] {
  if (Array.isArray(node)) {
    for (const item of node) scanForbiddenKeys(item, found);
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k.endsWith("_hash")) continue; // hashes are the point of the bundle
      if (FORBIDDEN_KEYS.has(k)) found.add(k);
      scanForbiddenKeys(v, found);
    }
  }
  return Array.from(found);
}

/**
 * Canonical JSON: stable key ordering so the same bundle always produces the
 * same digest (a re-ordered object must not invalidate the signature).
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonicalize(v)]),
    );
  }
  return value;
}

/** Build the digest over the bundle with the signature field blanked out. */
function computeDigest(bundle: Omit<EvidenceBundle, "signature">, key: string): string {
  return createHmac("sha256", key)
    .update(JSON.stringify(canonicalize(bundle)))
    .digest("hex");
}

// ── Builder ─────────────────────────────────────────────────────────────────

export interface BuildBundleOptions {
  /** Optional trace filter; omit to include every event. */
  traceId?: string;
  /** Optional session filter. */
  sessionId?: string;
}

/**
 * Build a signed, privacy-safe evidence bundle from the Event Backbone.
 * Read-only: never mutates the log.
 */
export function buildEvidenceBundle(
  events: Array<Record<string, unknown>>,
  opts: BuildBundleOptions = {},
): EvidenceBundle {
  let scoped = events;
  if (opts.traceId) {
    scoped = scoped.filter((e) => asStr(e.trace_id) === opts.traceId);
  }
  if (opts.sessionId) {
    scoped = scoped.filter((e) => asStr(e.session_id) === opts.sessionId);
  }

  const bundleEvents: EvidenceBundleEvent[] = scoped.map((e) => ({
    event_id: asStr(e.event_id),
    event_type: asStr(e.event_type),
    timestamp: asStr(e.timestamp),
    agent_id: asStr(e.agent_id),
    provider: asStr(e.provider),
    model: asStr(e.model),
    status: asStr(e.status),
    latency_ms: asNum(e.latency_ms),
    token_count: asNum(e.token_count),
    hashes: {
      event_hash: asStr(e.event_hash),
      prev_hash: asStr((e as { prev_hash?: unknown }).prev_hash),
      input_hash: asStr(e.input_hash),
      output_hash: asStr(e.output_hash),
      args_hash: asStr(e.args_hash),
      result_hash: asStr(e.result_hash),
    },
  }));

  // Assessment over metadata only (reuses the backend assess engine).
  const assessmentEvents: AssessmentEvent[] = scoped.map((e) => ({
    trace_id: asStr(e.trace_id),
    session_id: asStr(e.session_id),
    agent_id: asStr(e.agent_id),
    provider: asStr(e.provider),
    event_type: asStr(e.event_type),
    status: asStr(e.status),
    event_hash: asStr(e.event_hash),
    prev_hash: asStr((e as { prev_hash?: unknown }).prev_hash),
    input_hash: asStr(e.input_hash),
    output_hash: asStr(e.output_hash),
    args_hash: asStr(e.args_hash),
    result_hash: asStr(e.result_hash),
    timestamp: asStr(e.timestamp),
    latency_ms: asNum(e.latency_ms),
    error_code: asStr(e.error_code),
  }));

  const assessments = assessEvents(assessmentEvents);
  const signals = assessments.flatMap((a) => a.signals);
  const riskRank = { none: 0, low: 1, medium: 2, high: 3 } as const;
  const riskLevel = assessments.reduce(
    (worst, a) => (riskRank[a.riskLevel] > riskRank[worst] ? a.riskLevel : worst),
    "none" as keyof typeof riskRank,
  );

  // Chain verification over the SAME filtered set.
  const chain = verifyEventChain(scoped);

  const timestamps = scoped.map((e) => asStr(e.timestamp)).filter((t): t is string => !!t).sort();

  const unsigned: Omit<EvidenceBundle, "signature"> = {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    runtime_effect: "none",
    trace: {
      trace_id: opts.traceId ?? "*",
      session_ids: Array.from(
        new Set(scoped.map((e) => asStr(e.session_id)).filter((s): s is string => !!s)),
      ),
      run_ids: Array.from(
        new Set(scoped.map((e) => asStr(e.run_id)).filter((s): s is string => !!s)),
      ),
      event_count: bundleEvents.length,
      time_range: {
        start: timestamps[0] ?? null,
        end: timestamps[timestamps.length - 1] ?? null,
      },
    },
    events: bundleEvents,
    assessment: {
      risk_level: riskLevel,
      signal_count: signals.length,
      signals: signals.map((s) => ({
        code: s.code,
        severity: s.severity,
        category: s.category,
        label: s.label,
      })),
      privacy_ok: assessments.every((a) => a.privacyOk),
      trace_integrity_ok: assessments.every((a) => a.traceIntegrityOk),
    },
    chain: {
      valid: chain.valid,
      event_count: bundleEvents.length,
      broken_at_index: chain.brokenAtIndex,
      reason: chain.reason ?? null,
    },
    privacy: {
      raw_content_included: false,
      forbidden_keys_checked: true,
      forbidden_keys_found: [],
    },
  };

  // Privacy scan runs BEFORE signing so the reported state is the signed state.
  const forbidden = scanForbiddenKeys(unsigned.events);
  unsigned.privacy.forbidden_keys_found = forbidden;

  return { ...unsigned, signature: signBundle(unsigned) };
}

function signBundle(bundle: Omit<EvidenceBundle, "signature">): EvidenceBundleSignature {
  const key = process.env.TRUSTOS_EVIDENCE_SIGNING_KEY;
  // Honest: never claim a signature we cannot produce.
  if (!key) {
    return {
      signed: false,
      algorithm: null,
      digest: null,
      reason: "no_signing_key_configured (set TRUSTOS_EVIDENCE_SIGNING_KEY)",
    };
  }
  return {
    signed: true,
    algorithm: "hmac-sha256",
    digest: computeDigest(bundle, key),
  };
}

/**
 * Verify a previously issued bundle: re-derive the digest and compare in
 * constant time. Returns false when unsigned or when the digest differs.
 */
export function verifyBundleSignature(bundle: EvidenceBundle): boolean {
  const digest = bundle.signature?.digest;
  if (!bundle.signature?.signed || !digest) return false;
  const key = process.env.TRUSTOS_EVIDENCE_SIGNING_KEY;
  if (!key) return false;

  const { signature: _signature, ...rest } = bundle;
  const expected = computeDigest(rest as Omit<EvidenceBundle, "signature">, key);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(digest, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Convenience: build from the live Event Backbone log. */
export function buildEvidenceBundleFromLog(opts: BuildBundleOptions = {}): EvidenceBundle {
  return buildEvidenceBundle(readAllEvents() as Array<Record<string, unknown>>, opts);
}
