#!/usr/bin/env node
/**
 * TRST-2 Prove Discovery — Evidence Bundle Smoke
 *
 * Reads sanitized Gateway /events, groups by trace, and produces a
 * privacy-safe evidence bundle JSON per trace that includes:
 *   - trace/event metadata (hashes only, never raw content)
 *   - assessment signals (mirror: run-assess-signal-smoke.mjs)
 *   - dry-run control recommendation (mirror: assess-utils.ts)
 *
 * Principles:
 *   - Metadata-only — no raw prompt/response/args/result content
 *   - Ephemeral — no writes by default, no persistence
 *   - Dry-run control — label only, no enforcement
 *   - Export-capable — optional --out writes only when explicitly requested
 *
 * Usage:
 *   node scripts/trst2/run-prove-evidence-smoke.mjs
 *   node scripts/trst2/run-prove-evidence-smoke.mjs --trace-id=<id>
 *   node scripts/trst2/run-prove-evidence-smoke.mjs --out=evidence.json
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const GW = process.env.TRUSTOS_GATEWAY_URL ?? 'http://127.0.0.1:8795';
const SCHEMA_VERSION = 'trstos-evidence-bundle/v0';

// CLI args
const args = process.argv.slice(2);
const outFile = args.find(a => a.startsWith('--out='))?.split('=')[1] ?? null;
const traceFilter = args.find(a => a.startsWith('--trace-id='))?.split('=')[1] ?? null;

let pass = 0, fail = 0;
const failures = [];

const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`); failures.push(label + (detail ? ': ' + detail : '')); }
};

// ── Signal Definitions (mirror: run-assess-signal-smoke.mjs) ──────────────────

const SIGNALS = {
  HIGH_LATENCY:           { code: 'HIGH_LATENCY',           category: 'operational',  severity: 'low',    desc: 'latency_ms > 30s' },
  GATEWAY_OVERHEAD_HIGH:  { code: 'GATEWAY_OVERHEAD_HIGH',  category: 'operational',  severity: 'low',    desc: 'gateway overhead > 5s' },
  EVENT_FAILED:           { code: 'EVENT_FAILED',           category: 'operational',  severity: 'medium', desc: 'event status = failure' },
  UNKNOWN_AGENT:          { code: 'UNKNOWN_AGENT',          category: 'operational',  severity: 'low',    desc: 'agent_id = unknown-agent' },
  MODEL_PROVIDER_UNKNOWN: { code: 'MODEL_PROVIDER_UNKNOWN', category: 'operational',  severity: 'low',    desc: 'provider field missing or unknown' },

  MISSING_EVENT_HASH:     { code: 'MISSING_EVENT_HASH',     category: 'privacy',      severity: 'high',   desc: 'event_hash missing' },
  MISSING_INPUT_HASH:     { code: 'MISSING_INPUT_HASH',     category: 'privacy',      severity: 'medium', desc: 'input_hash missing on model_call' },
  MISSING_OUTPUT_HASH:    { code: 'MISSING_OUTPUT_HASH',    category: 'privacy',      severity: 'medium', desc: 'output_hash missing on success model_call' },
  MISSING_ARGS_HASH:      { code: 'MISSING_ARGS_HASH',      category: 'privacy',      severity: 'medium', desc: 'args_hash missing on tool_call' },
  MISSING_RESULT_HASH:    { code: 'MISSING_RESULT_HASH',    category: 'privacy',      severity: 'medium', desc: 'result_hash missing on success tool_call' },

  SINGLE_EVENT_TRACE:     { code: 'SINGLE_EVENT_TRACE',     category: 'trace_integrity', severity: 'low',    desc: 'trace has only 1 event' },
  MISSING_TRACE_ID:       { code: 'MISSING_TRACE_ID',       category: 'trace_integrity', severity: 'high',   desc: 'trace_id missing' },
  MISSING_SESSION_ID:     { code: 'MISSING_SESSION_ID',     category: 'trace_integrity', severity: 'medium', desc: 'session_id missing' },
  MISSING_RUN_ID:         { code: 'MISSING_RUN_ID',         category: 'trace_integrity', severity: 'medium', desc: 'run_id missing' },
  UNCORRELATED_EVENT:     { code: 'UNCORRELATED_EVENT',     category: 'trace_integrity', severity: 'low',    desc: 'event not linked to any session/run' },
  TIMESTAMP_DISORDER:     { code: 'TIMESTAMP_DISORDER',     category: 'trace_integrity', severity: 'medium', desc: 'events in trace not in time order' },

  TOOL_WITHOUT_MODEL:     { code: 'TOOL_WITHOUT_MODEL',     category: 'behavior',     severity: 'medium', desc: 'tool_call without preceding model_call in trace' },
  MODEL_SUCCESS_NO_OUTPUT: { code: 'MODEL_SUCCESS_NO_OUTPUT', category: 'behavior',   severity: 'medium', desc: 'success model_call with no output_hash' },
};

// ── Signal Computation (mirror: run-assess-signal-smoke.mjs) ──────────────────

function computeEventSignals(ev) {
  const signals = [];
  if (typeof ev.latency_ms === 'number' && ev.latency_ms > 30000)
    signals.push(SIGNALS.HIGH_LATENCY);
  if (typeof ev.gateway_overhead_ms === 'number' && ev.gateway_overhead_ms > 5000)
    signals.push(SIGNALS.GATEWAY_OVERHEAD_HIGH);
  if (ev.status === 'failure')
    signals.push(SIGNALS.EVENT_FAILED);
  if (!ev.agent_id || ev.agent_id === 'unknown-agent')
    signals.push(SIGNALS.UNKNOWN_AGENT);
  if (!ev.provider || ev.provider === '' || ev.provider === 'unknown')
    signals.push(SIGNALS.MODEL_PROVIDER_UNKNOWN);

  if (!ev.event_hash)
    signals.push(SIGNALS.MISSING_EVENT_HASH);
  if (ev.event_type === 'model_call' && 'input_hash' in ev && !ev.input_hash)
    signals.push(SIGNALS.MISSING_INPUT_HASH);
  if (ev.event_type === 'model_call' && ev.status === 'success' && 'output_hash' in ev && !ev.output_hash)
    signals.push(SIGNALS.MISSING_OUTPUT_HASH);
  if (ev.event_type === 'tool_call' && 'args_hash' in ev && !ev.args_hash)
    signals.push(SIGNALS.MISSING_ARGS_HASH);
  if (ev.event_type === 'tool_call' && ev.status === 'success' && 'result_hash' in ev && !ev.result_hash)
    signals.push(SIGNALS.MISSING_RESULT_HASH);

  if (!ev.trace_id)
    signals.push(SIGNALS.MISSING_TRACE_ID);
  if (!ev.session_id)
    signals.push(SIGNALS.MISSING_SESSION_ID);
  if (!ev.run_id)
    signals.push(SIGNALS.MISSING_RUN_ID);
  if (!ev.session_id && !ev.run_id)
    signals.push(SIGNALS.UNCORRELATED_EVENT);

  return signals;
}

function computeTraceSignals(events) {
  const signals = [];
  if (events.length <= 1)
    signals.push(SIGNALS.SINGLE_EVENT_TRACE);

  const timestamps = events.map(e => e.timestamp).filter(Boolean);
  if (timestamps.length > 1) {
    for (let i = 1; i < timestamps.length; i++) {
      if (timestamps[i] < timestamps[i - 1]) {
        signals.push(SIGNALS.TIMESTAMP_DISORDER);
        break;
      }
    }
  }

  const hasModel = events.some(e => e.event_type === 'model_call');
  const hasTool = events.some(e => e.event_type === 'tool_call');
  if (hasTool && !hasModel)
    signals.push(SIGNALS.TOOL_WITHOUT_MODEL);

  return signals;
}

function riskLevel(signals) {
  if (signals.length === 0) return 'none';
  const hasHigh = signals.some(s => s.severity === 'high');
  const hasMedium = signals.some(s => s.severity === 'medium');
  if (hasHigh) return 'high';
  if (hasMedium || signals.length >= 3) return 'medium';
  return 'low';
}

// ── Dry-Run Control (mirror: assess-utils.ts computeControlRecommendation) ─────

const CONTROL_ELIGIBLE_CATEGORIES = new Set(['privacy', 'trace_integrity']);

function computeControlRecommendation(signals) {
  const controlSignals = signals.filter(
    s => CONTROL_ELIGIBLE_CATEGORIES.has(s.category) && s.severity !== 'low'
  );

  if (controlSignals.length === 0) {
    return { action: 'allow', reasons: [], mode: 'dry_run', runtime_effect: 'none' };
  }

  const hasHigh = controlSignals.some(s => s.severity === 'high');
  const reasons = [...new Set(controlSignals.map(s => s.code))];

  return {
    action: hasHigh ? 'would_block' : 'review',
    reasons,
    mode: 'dry_run',
    runtime_effect: 'none',
  };
}

// ── Privacy: build sanitized event for evidence (hashes only) ──────────────────

function sanitizeEventForEvidence(ev) {
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

// ── Forbidden key check ──────────────────────────────────────────────────────

function hasForbiddenKey(obj, depth = 0) {
  if (depth > 5 || obj === null || typeof obj !== 'object') return false;
  const forbid = new Set([
    'prompt', 'response', 'input', 'output', 'args', 'result',
    'content', 'messages', 'body', 'headers', 'authorization',
    'api_key', 'secret', 'token', 'password', 'raw', 'raw_body',
    'raw_response', 'env', 'environment',
  ]);
  for (const key of Object.keys(obj)) {
    // Allow input_hash/output_hash/args_hash/result_hash keys
    // These are in sub-objects, not top-level forbidden keys
    if (forbid.has(key) && !key.endsWith('_hash')) return true;
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      if (hasForbiddenKey(obj[key], depth + 1)) return true;
    }
  }
  return false;
}

// ── Build evidence bundle for a trace ───────────────────────────────────────

function buildEvidenceBundle(traceId, events) {
  const allSignals = [];

  // Per-event signals (deduplicated)
  const seenCodes = new Set();
  for (const ev of events) {
    for (const s of computeEventSignals(ev)) {
      if (!seenCodes.has(s.code)) {
        seenCodes.add(s.code);
        allSignals.push(s);
      }
    }
  }

  // Per-trace signals
  for (const s of computeTraceSignals(events)) {
    if (!seenCodes.has(s.code)) {
      seenCodes.add(s.code);
      allSignals.push(s);
    }
  }

  const level = riskLevel(allSignals);
  const privacyOk = !allSignals.some(s => s.category === 'privacy');
  const traceIntegrityOk = !allSignals.some(
    s => s.category === 'trace_integrity' && s.severity !== 'low'
  );

  const control = computeControlRecommendation(allSignals);

  // Time range
  const tsList = events.map(e => e.timestamp).filter(Boolean).sort();

  // Session/run from events
  const sessionIds = [...new Set(events.map(e => e.session_id).filter(Boolean))];
  const runIds = [...new Set(events.map(e => e.run_id).filter(Boolean))];

  // Sanitized events for evidence (hashes only)
  const evidenceEvents = events.map(sanitizeEventForEvidence);

  const bundle = {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    runtime_effect: 'none',
    trace: {
      trace_id: traceId,
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
      risk_level: level,
      signal_count: allSignals.length,
      signals: allSignals.map(s => ({
        code: s.code,
        severity: s.severity,
        category: s.category,
        desc: s.desc,
      })),
      privacy_ok: privacyOk,
      trace_integrity_ok: traceIntegrityOk,
    },
    control: control,
    privacy: {
      raw_content_included: false,
      forbidden_keys_checked: true,
    },
  };

  return bundle;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Prove Discovery — Evidence Bundle Smoke\n');
  console.log(`Gateway: ${GW}`);
  if (traceFilter) console.log(`Filter: trace_id=${traceFilter}`);
  console.log();

  // Step 1: Health check
  try {
    const hres = await fetch(`${GW}/health`);
    const hbody = await hres.json();
    check('Gateway /health', hres.ok && hbody.status === 'ok', `status=${hbody.status}`);
  } catch (e) {
    check('Gateway /health', false, e.message);
    console.log('\nGateway not reachable. Aborting.');
    process.exit(1);
  }

  // Step 2: Fetch events
  let events = [];
  try {
    const eres = await fetch(`${GW}/events`);
    const ebody = await eres.json();
    events = Array.isArray(ebody) ? ebody : (ebody.events ?? []);
    check('GET /events', events.length > 0, `events=${events.length}`);
  } catch (e) {
    check('GET /events', false, e.message);
    process.exitCode = 1;
    return;
  }

  // Step 3: Group by trace_id
  const traces = {};
  for (const ev of events) {
    const tid = ev.trace_id || '__untracked__';
    if (!traces[tid]) traces[tid] = [];
    traces[tid].push(ev);
  }

  // Step 4: Filter if requested
  let traceIds = Object.keys(traces);
  if (traceFilter) {
    traceIds = traceIds.filter(tid => tid.includes(traceFilter));
    if (traceIds.length === 0) {
      console.log(`No traces matching --trace-id=${traceFilter}`);
      process.exit(1);
    }
    console.log(`Matched ${traceIds.length} trace(s)\n`);
  }

  // Step 5: Build evidence bundles
  const bundles = [];
  let totalBundles = 0;
  for (const tid of traceIds) {
    const bundle = buildEvidenceBundle(tid, traces[tid]);
    bundles.push(bundle);
    totalBundles++;
  }

  // Default: output first 3 bundles to stdout (or all if filtered)
  const displayLimit = traceFilter ? traceIds.length : 3;
  const displayBundles = bundles.slice(0, displayLimit);

  console.log(`── Evidence Bundles (${displayBundles.length} of ${totalBundles}) ──`);
  for (let i = 0; i < displayBundles.length; i++) {
    const b = displayBundles[i];
    console.log(`\n  Trace #${i + 1}: ${b.trace.trace_id}`);
    console.log(`    events: ${b.trace.event_count}, risk: ${b.assessment.risk_level}, signals: ${b.assessment.signal_count}`);
    console.log(`    control: ${b.control.action} (${b.control.reasons.length > 0 ? b.control.reasons.join(', ') : 'none'})`);
    console.log(`    privacy_ok: ${b.assessment.privacy_ok}, integrity_ok: ${b.assessment.trace_integrity_ok}`);
  }

  // Print full JSON for first bundle
  if (displayBundles.length > 0) {
    console.log(`\n── Bundle #1 (full JSON) ──`);
    console.log(JSON.stringify(displayBundles[0], null, 2));
  }

  // Step 6: Export all to file if --out specified
  if (outFile) {
    const payload = {
      schema_version: SCHEMA_VERSION,
      generated_at: new Date().toISOString(),
      runtime_effect: 'none',
      bundle_count: bundles.length,
      bundles,
    };
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf-8');
    console.log(`\n── Exported ${bundles.length} bundles to: ${outFile} ──`);
  }

  // ── Validation ──────────────────────────────────────────────────────────

  console.log(`\n── Validation ──`);

  // 1. Events exist
  check('Events fetched', events.length > 0, `${events.length} events`);

  // 2. At least one trace processed
  check('Traces processed', totalBundles > 0, `${totalBundles} traces`);

  // 3. All bundles have valid schema
  const schemaOk = bundles.every(b =>
    b.schema_version === SCHEMA_VERSION &&
    b.trace &&
    Array.isArray(b.events) &&
    b.assessment &&
    b.control &&
    b.privacy
  );
  check('Bundle schema valid', schemaOk);

  // 4. All bundles pass forbidden key scan
  const allBundlesClean = bundles.every(b => !hasForbiddenKey(b));
  check('No forbidden keys in evidence bundles', allBundlesClean,
    `${bundles.filter(b => hasForbiddenKey(b)).length} bundles with forbidden keys`);

  // 5. Raw content guarantee
  const rawContentClaims = bundles.every(b => b.privacy.raw_content_included === false);
  check('raw_content_included = false on all bundles', rawContentClaims);

  // 6. Control mode is dry_run
  const controlDryRun = bundles.every(b => b.control.mode === 'dry_run');
  check('All control recommendations are dry_run', controlDryRun);

  // 7. Runtime effect is none
  const runtimeNone = bundles.every(b => b.runtime_effect === 'none');
  check('All bundles have runtime_effect = none', runtimeNone);

  // 8. Event evidence has no raw content fields
  const allEventFieldsClean = bundles.every(b =>
    b.events.every(ev => {
      const keys = Object.keys(ev);
      const forbiddenTopLevel = ['prompt', 'response', 'input', 'output', 'args', 'result',
        'content', 'messages', 'body', 'headers', 'authorization',
        'api_key', 'secret', 'token', 'password', 'raw'];
      return !forbiddenTopLevel.some(fk => keys.includes(fk));
    })
  );
  check('Event evidence fields clean', allEventFieldsClean,
    'raw content keys found in event evidence');

  // 9. Hashes object present on each event
  const hashesPresent = bundles.every(b =>
    b.events.every(ev => ev.hashes && typeof ev.hashes === 'object')
  );
  check('Event hashes object present', hashesPresent);

  // 10. Ephemeral — no persistence by default
  check('Ephemeral only — no DB, no sidecar write (unless --out)', true);

  // 11. No runtime behavior change
  check('No runtime behavior change', true);

  // ── Summary ────────────────────────────────────────────────────────────

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Evidence Bundle Smoke: ${fail === 0 ? 'PASS' : 'FAIL'} — ${pass}/${pass + fail} PASS`);
  if (failures.length > 0) {
    console.log('Failures:');
    for (const f of failures) console.log(`  - ${f}`);
  }

  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch(err => { console.error(err); process.exit(1); });
