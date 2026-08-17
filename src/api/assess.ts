/**
 * MWT-22 / TRST-4D — Backend Assessment API.
 *
 * POST /v1/assess
 *   Body: { events: AssessmentEvent[], includeControl?: boolean }
 *   Returns metadata-only risk assessment (no raw content, no persistence).
 *
 * This is the server-side counterpart of the frontend assess-utils computation.
 * Assessment is Observe → Correlate → label risk. It is NOT control/enforcement
 * (control is dry-run label only, per the engine contract).
 */

import { Hono } from "hono";
import {
  assessEvents,
  computeRiskDistribution,
  computeControlRecommendation,
  getTraceLabel,
  type AssessmentEvent,
} from "../services/assessment/assess-engine.js";

export const assessRouter = new Hono();

assessRouter.post("/", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  const { events, includeControl } = (body ?? {}) as {
    events?: unknown;
    includeControl?: boolean;
  };

  if (!Array.isArray(events)) {
    return c.json({ error: "events must be an array" }, 400);
  }

  // Coerce to AssessmentEvent; ignore obviously malformed entries gracefully.
  const str = (v: unknown): string | null =>
    typeof v === "string" ? v : v == null ? null : String(v);
  const normalized: AssessmentEvent[] = events.map((e) => {
    const rec = (e ?? {}) as Record<string, unknown>;
    return {
      trace_id: str(rec.trace_id),
      session_id: str(rec.session_id),
      agent_id: str(rec.agent_id),
      provider: str(rec.provider),
      event_type: str(rec.event_type),
      status: str(rec.status),
      event_hash: str(rec.event_hash),
      input_hash: str(rec.input_hash),
      output_hash: str(rec.output_hash),
      args_hash: str(rec.args_hash),
      result_hash: str(rec.result_hash),
      timestamp: str(rec.timestamp),
      latency_ms: typeof rec.latency_ms === "number" ? rec.latency_ms : null,
    };
  });

  const assessments = assessEvents(normalized);
  const distribution = computeRiskDistribution(assessments);

  const withControl = includeControl === true;
  const control = withControl
    ? assessments.map((a) => ({
        traceKey: a.traceKey,
        traceLabel: getTraceLabel(a.traceKey),
        recommendation: computeControlRecommendation(a),
      }))
    : undefined;

  return c.json({
    assessments: assessments.map((a) => ({
      traceKey: a.traceKey,
      traceLabel: getTraceLabel(a.traceKey),
      eventCount: a.eventCount,
      riskLevel: a.riskLevel,
      privacyOk: a.privacyOk,
      traceIntegrityOk: a.traceIntegrityOk,
      signals: a.signals,
    })),
    distribution,
    control,
    meta: {
      eventCount: normalized.length,
      traceCount: assessments.length,
      mode: "assess_only",
    },
  });
});
