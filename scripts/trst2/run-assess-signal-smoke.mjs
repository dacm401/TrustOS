#!/usr/bin/env node
/**
 * TRST-2 Assess Discovery — Risk Signal Smoke
 *
 * Reads sanitized Gateway /events, derives privacy-safe risk signals
 * from metadata only (no raw content), and reports per-trace/per-session
 * assessment summaries.
 *
 * Assessment model: Ephemeral derived (no persistence, no schema).
 *
 * Usage:  node scripts/trst2/run-assess-signal-smoke.mjs
 */

const GW = process.env.TRUSTOS_GATEWAY_URL ?? 'http://127.0.0.1:8795';
let pass = 0, fail = 0;
const failures = [];

const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`); failures.push(label + (detail ? ': ' + detail : '')); }
};

// ── Signal Definitions ───────────────────────────────────────────────

const SIGNALS = {
  // Operational
  HIGH_LATENCY:           { code: 'HIGH_LATENCY',           category: 'operational',  severity: 'low',    desc: 'latency_ms > 30s' },
  GATEWAY_OVERHEAD_HIGH:  { code: 'GATEWAY_OVERHEAD_HIGH',  category: 'operational',  severity: 'low',    desc: 'gateway overhead > 5s' },
  EVENT_FAILED:           { code: 'EVENT_FAILED',           category: 'operational',  severity: 'medium', desc: 'event status = failure' },
  UNKNOWN_AGENT:          { code: 'UNKNOWN_AGENT',          category: 'operational',  severity: 'low',    desc: 'agent_id = unknown-agent' },
  MODEL_PROVIDER_UNKNOWN: { code: 'MODEL_PROVIDER_UNKNOWN', category: 'operational',  severity: 'low',    desc: 'provider field missing or unknown' },

  // Privacy / Sanitization
  MISSING_EVENT_HASH:     { code: 'MISSING_EVENT_HASH',     category: 'privacy',      severity: 'high',   desc: 'event_hash missing' },
  MISSING_INPUT_HASH:     { code: 'MISSING_INPUT_HASH',     category: 'privacy',      severity: 'medium', desc: 'input_hash missing on model_call' },
  MISSING_OUTPUT_HASH:    { code: 'MISSING_OUTPUT_HASH',    category: 'privacy',      severity: 'medium', desc: 'output_hash missing on success model_call' },
  MISSING_ARGS_HASH:      { code: 'MISSING_ARGS_HASH',      category: 'privacy',      severity: 'medium', desc: 'args_hash missing on tool_call' },
  MISSING_RESULT_HASH:    { code: 'MISSING_RESULT_HASH',    category: 'privacy',      severity: 'medium', desc: 'result_hash missing on success tool_call' },

  // Trace Integrity
  SINGLE_EVENT_TRACE:     { code: 'SINGLE_EVENT_TRACE',     category: 'trace_integrity', severity: 'low',    desc: 'trace has only 1 event' },
  MISSING_TRACE_ID:       { code: 'MISSING_TRACE_ID',       category: 'trace_integrity', severity: 'high',   desc: 'trace_id missing' },
  MISSING_SESSION_ID:     { code: 'MISSING_SESSION_ID',     category: 'trace_integrity', severity: 'medium', desc: 'session_id missing' },
  MISSING_RUN_ID:         { code: 'MISSING_RUN_ID',         category: 'trace_integrity', severity: 'medium', desc: 'run_id missing' },
  UNCORRELATED_EVENT:     { code: 'UNCORRELATED_EVENT',     category: 'trace_integrity', severity: 'low',    desc: 'event not linked to any session/run' },
  TIMESTAMP_DISORDER:     { code: 'TIMESTAMP_DISORDER',     category: 'trace_integrity', severity: 'medium', desc: 'events in trace not in time order' },

  // Model / Tool Behavior
  TOOL_WITHOUT_MODEL:     { code: 'TOOL_WITHOUT_MODEL',     category: 'behavior',     severity: 'medium', desc: 'tool_call without preceding model_call in trace' },
  MODEL_SUCCESS_NO_OUTPUT: { code: 'MODEL_SUCCESS_NO_OUTPUT', category: 'behavior',    severity: 'medium', desc: 'success model_call with no output_hash' },
};

// ── Signal Computation ───────────────────────────────────────────────

function computeEventSignals(ev) {
  const signals = [];

  // Operational
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

  // Privacy — hash presence checks
  // Use 'key' in ev to distinguish "field absent from schema" vs "present but null/empty".
  // If Gateway never emits the hash field, we do NOT flag a missing hash (that is a
  // schema-level decision, not a per-event integrity violation).
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

  // Trace Integrity
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

  // Timestamp disorder check
  const timestamps = events.map(e => e.timestamp).filter(Boolean);
  if (timestamps.length > 1) {
    for (let i = 1; i < timestamps.length; i++) {
      if (timestamps[i] < timestamps[i - 1]) {
        signals.push(SIGNALS.TIMESTAMP_DISORDER);
        break;
      }
    }
  }

  // Tool without model check
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

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log('Assess Discovery — Risk Signal Smoke\n');
  console.log(`Gateway: ${GW}\n`);

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

  // Step 4: Compute per-event and per-trace signals
  const assessments = [];
  let totalSignals = 0;
  const categoryTotals = { operational: 0, privacy: 0, trace_integrity: 0, behavior: 0 };

  for (const [tid, tEvents] of Object.entries(traces)) {
    // Per-event signals
    const eventAssessments = tEvents.map(ev => ({
      event_id: ev.event_id,
      event_type: ev.event_type,
      signals: computeEventSignals(ev),
    }));

    // Per-trace signals
    const traceSignals = computeTraceSignals(tEvents);

    // Merge all signals
    const allSignals = [...new Map(
      eventAssessments.flatMap(ea => ea.signals).concat(traceSignals).map(s => [s.code, s])
    ).values()];

    const level = riskLevel(allSignals);

    // Count by category
    for (const s of allSignals) {
      totalSignals++;
      categoryTotals[s.category] = (categoryTotals[s.category] || 0) + 1;
    }

    const hasModelCall = tEvents.some(e => e.event_type === 'model_call');
    const hasToolCall = tEvents.some(e => e.event_type === 'tool_call');
    const hasFailure = tEvents.some(e => e.status === 'failure');
    const latencies = tEvents.map(e => e.latency_ms).filter(n => typeof n === 'number');

    assessments.push({
      trace_id: tid === '__untracked__' ? null : tid,
      risk_level: level,
      signal_count: allSignals.length,
      signals: allSignals.map(s => ({ code: s.code, category: s.category, severity: s.severity, desc: s.desc })),
      summary: {
        event_count: tEvents.length,
        has_model_call: hasModelCall,
        has_tool_call: hasToolCall,
        has_failure: hasFailure,
        session_ids: [...new Set(tEvents.map(e => e.session_id).filter(Boolean))],
        run_ids: [...new Set(tEvents.map(e => e.run_id).filter(Boolean))],
        max_latency_ms: latencies.length ? Math.max(...latencies) : null,
        avg_latency_ms: latencies.length ? Math.round(latencies.reduce((a,b) => a + b, 0) / latencies.length) : null,
      },
    });
  }

  // Risk distribution
  const riskCounts = {};
  for (const a of assessments) {
    riskCounts[a.risk_level] = (riskCounts[a.risk_level] || 0) + 1;
  }

  // Step 5: Session-level aggregation
  const sessions = {};
  for (const ev of events) {
    const sid = ev.session_id || '__unsessioned__';
    if (!sessions[sid]) sessions[sid] = [];
    sessions[sid].push(ev);
  }

  const sessionSummaries = [];
  for (const [sid, sEvents] of Object.entries(sessions)) {
    const totalTokens = sEvents.reduce((sum, e) => sum + (e.token_count || 0), 0);
    const totalCost = sEvents.reduce((sum, e) => sum + (e.cost_estimate || 0), 0);
    const totalLatency = sEvents.reduce((sum, e) => sum + (e.latency_ms || 0), 0);
    const failureCount = sEvents.filter(e => e.status === 'failure').length;

    sessionSummaries.push({
      session_id: sid === '__unsessioned__' ? null : sid,
      event_count: sEvents.length,
      trace_count: new Set(sEvents.map(e => e.trace_id).filter(Boolean)).size,
      total_tokens: totalTokens,
      total_cost_usd: totalCost,
      total_latency_ms: totalLatency,
      failure_count: failureCount,
      failure_rate: sEvents.length ? failureCount / sEvents.length : 0,
    });
  }

  // ── Report ─────────────────────────────────────────────────────────

  console.log(`\n── Assessment Summary ──`);
  console.log(`Total events:       ${events.length}`);
  console.log(`Total traces:       ${Object.keys(traces).length}`);
  console.log(`Total sessions:     ${Object.keys(sessions).length}`);
  console.log(`Total signals:      ${totalSignals}`);
  console.log(`Risk distribution:  none=${riskCounts.none ?? 0} low=${riskCounts.low ?? 0} medium=${riskCounts.medium ?? 0} high=${riskCounts.high ?? 0}`);

  console.log(`\n── Signal Categories ──`);
  for (const [cat, count] of Object.entries(categoryTotals)) {
    console.log(`  ${cat}: ${count}`);
  }

  // Top 5 signals
  const signalCounts = {};
  for (const a of assessments)
    for (const s of a.signals)
      signalCounts[s.code] = (signalCounts[s.code] || 0) + 1;
  const topSignals = Object.entries(signalCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  console.log(`\n── Top Signals ──`);
  for (const [code, count] of topSignals)
    console.log(`  ${code}: ${count}`);

  // High-risk traces
  const highRisk = assessments.filter(a => a.risk_level === 'high');
  if (highRisk.length > 0) {
    console.log(`\n── High Risk Traces ──`);
    for (const a of highRisk)
      console.log(`  ${a.trace_id}: ${a.signals.map(s => s.code).join(', ')}`);
  } else {
    console.log(`\n── High Risk Traces: none ──`);
  }

  // Session stats
  console.log(`\n── Session-Level ──`);
  for (const ss of sessionSummaries.slice(0, 5)) {
    console.log(`  ${ss.session_id?.slice(0, 8) ?? 'none'}... events=${ss.event_count} traces=${ss.trace_count} tokens=${ss.total_tokens} cost=$${ss.total_cost_usd.toFixed(6)} failure=${ss.failure_count}`);
  }
  if (sessionSummaries.length > 5)
    console.log(`  ... and ${sessionSummaries.length - 5} more sessions`);

  // Validation checks
  console.log(`\n── Validation ──`);
  check('Events returned', events.length > 0, `count=${events.length}`);
  check('All events have event_hash', events.every(e => e.event_hash), `${events.filter(e => !e.event_hash).length} missing`);
  check('All events have trace_id', events.every(e => e.trace_id), `${events.filter(e => !e.trace_id).length} missing`);
  check('All events have session_id', events.every(e => e.session_id), `${events.filter(e => !e.session_id).length} missing`);
  check('All events have run_id', events.every(e => e.run_id), `${events.filter(e => !e.run_id).length} missing`);
  check('No raw content keys exposed', !events.some(e => hasForbiddenKey(e)), 'all clean');
  check('Risk assessment computed per trace', assessments.length === Object.keys(traces).length);
  check('Session aggregation computed', sessionSummaries.length === Object.keys(sessions).length);
  check('Signal categories present', Object.values(categoryTotals).some(c => c > 0), 'at least one signal');
  check('Ephemeral only — no persistence', true, 'no DB, no file write');

  // ── Output JSON for downstream ──
  console.log(`\n── Assessment JSON (first 3 traces) ──`);
  console.log(JSON.stringify(assessments.slice(0, 3), null, 2));

  // ── Summary ──
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Risk Signal Smoke: ${fail === 0 ? 'PASS' : 'FAIL'} — ${pass}/${pass + fail} PASS`);
  if (failures.length > 0) {
    console.log('Failures:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exitCode = fail === 0 ? 0 : 1;
}

// Forbidden key check (same as other smoke scripts)
function hasForbiddenKey(obj, depth = 0) {
  if (depth > 5 || obj === null || typeof obj !== 'object') return false;
  const forbid = new Set([
    'prompt', 'response', 'input', 'output', 'args', 'result',
    'content', 'messages', 'body', 'headers', 'authorization',
    'api_key', 'secret', 'token', 'password', 'raw', 'raw_body',
    'raw_response', 'env', 'environment',
  ]);
  for (const key of Object.keys(obj)) {
    if (forbid.has(key)) return true;
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      if (hasForbiddenKey(obj[key], depth + 1)) return true;
    }
  }
  return false;
}

main().catch(err => { console.error(err); process.exit(1); });
