/**
 * TRST-4G Production Ops Baseline — v0 readiness check (2026-08-20).
 *
 * Aggregates health + key config validation + event-store accessibility into a
 * single boot-time self-check so the Private Beta operator gets a go/no-go signal
 * before accepting traffic.
 *
 * Design (R6 guardrail): zero new dependency; reuses existing health/metrics
 * internals. Does NOT replace /health — it is a startup gate the launcher can call.
 */

import { query } from "../db/connection.js";
import { config } from "../config.js";
import { getStorePath } from "../services/trst1/jsonl-event-store.js";

export interface ReadinessComponent {
  name: string;
  ok: boolean;
  detail: string;
}

export interface ReadinessReport {
  ready: boolean;
  timestamp: string;
  checks: ReadinessComponent[];
}

async function checkDatabase(): Promise<ReadinessComponent> {
  try {
    const start = Date.now();
    await query("SELECT 1");
    return { name: "database", ok: true, detail: `responsive (${Date.now() - start}ms)` };
  } catch (e) {
    return { name: "database", ok: false, detail: (e as Error).message };
  }
}

function checkConfig(): ReadinessComponent {
  const issues: string[] = [];
  if (!config.openaiApiKey && !config.anthropicApiKey) {
    issues.push("no LLM provider key configured");
  }
  if (config.permission.dlpEnabled && !config.policyEnforcementMode) {
    issues.push("DLP enabled but enforcement mode unset");
  }
  if (issues.length > 0) {
    return { name: "config", ok: false, detail: issues.join("; ") };
  }
  return { name: "config", ok: true, detail: "required keys present" };
}

function checkEventStore(): ReadinessComponent {
  try {
    const path = getStorePath();
    return { name: "event_store", ok: true, detail: path ?? "in-memory" };
  } catch (e) {
    return { name: "event_store", ok: false, detail: (e as Error).message };
  }
}

/**
 * Run all readiness checks. Never throws — degrades to a `ready:false` report.
 */
export async function readinessCheck(): Promise<ReadinessReport> {
  const checks = await Promise.all([checkDatabase(), Promise.resolve(checkConfig()), Promise.resolve(checkEventStore())]);
  const ready = checks.every((c) => c.ok);
  return {
    ready,
    timestamp: new Date().toISOString(),
    checks,
  };
}
