/**
 * Assessment Engine — backend implementation of the metadata-only risk signal
 * computation (MWT-22 / TRST-4D).
 *
 * This mirrors frontend/src/lib/assess-utils.ts so the assessment logic lives
 * on the server and is no longer computed in the browser. It is a pure,
 * read-only, privacy-safe computation:
 *
 * - Metadata-only — never inspects raw prompt/response content
 * - Privacy-safe — only checks hash *presence*, never content
 * - Ephemeral — no writes, no persistence, no enforcement
 * - Assess = Observe → Correlate → label risk. Not Control.
 *
 * Input type AssessmentEvent is intentionally decoupled from the frontend
 * GatewayEvent type to keep the backend free of frontend dependencies.
 */

// ── Signal definitions ────────────────────────────────────────────────────────

export interface AssessSignalDef {
  code: string;
  label: string;
  severity: "low" | "medium" | "high";
  category: "privacy" | "operational" | "trace_integrity" | "behavior";
}

export const SIGNALS: Record<string, AssessSignalDef> = {
  // Privacy / evidence integrity
  MISSING_EVENT_HASH: { code: "MISSING_EVENT_HASH", label: "缺少事件哈希", severity: "high", category: "privacy" },
  MISSING_INPUT_HASH: { code: "MISSING_INPUT_HASH", label: "缺少输入哈希", severity: "medium", category: "privacy" },
  MISSING_OUTPUT_HASH: { code: "MISSING_OUTPUT_HASH", label: "缺少输出哈希", severity: "medium", category: "privacy" },
  MISSING_ARGS_HASH: { code: "MISSING_ARGS_HASH", label: "缺少参数哈希", severity: "medium", category: "privacy" },
  MISSING_RESULT_HASH: { code: "MISSING_RESULT_HASH", label: "缺少结果哈希", severity: "medium", category: "privacy" },

  // Operational
  UNKNOWN_AGENT: { code: "UNKNOWN_AGENT", label: "未知 Agent", severity: "low", category: "operational" },
  HIGH_LATENCY: { code: "HIGH_LATENCY", label: "高延迟", severity: "low", category: "operational" },
  MODEL_PROVIDER_UNKNOWN: { code: "MODEL_PROVIDER_UNKNOWN", label: "未知模型提供商", severity: "low", category: "operational" },

  // Trace integrity
  SINGLE_EVENT_TRACE: { code: "SINGLE_EVENT_TRACE", label: "单事件 Trace", severity: "low", category: "trace_integrity" },
  TIMESTAMP_DISORDER: { code: "TIMESTAMP_DISORDER", label: "时间戳乱序", severity: "high", category: "trace_integrity" },
  TOOL_WITHOUT_MODEL: { code: "TOOL_WITHOUT_MODEL", label: "工具调用缺少模型调用", severity: "medium", category: "trace_integrity" },
  MISSING_TRACE_ID: { code: "MISSING_TRACE_ID", label: "缺少 Trace 关联", severity: "medium", category: "trace_integrity" },

  // ── 2026-08-28 新增：把 Event Backbone 的哈希链能力接入评估 ──
  // 全部基于元数据（hash 指针关系），不触碰任何 raw content，
  // 不引入 DLP / 语义检测 —— 符合 TRST-0.3 冻结护栏。
  CHAIN_BREAK: {
    code: "CHAIN_BREAK",
    label: "证据链断裂",
    severity: "high",
    category: "trace_integrity",
  },
  CHAIN_GENESIS_UNEXPECTED: {
    code: "CHAIN_GENESIS_UNEXPECTED",
    label: "非首条事件却无前驱哈希",
    severity: "high",
    category: "trace_integrity",
  },
  // 行为 / 运行异常（元数据可观测，无需读取内容）
  REPEATED_FAILURE: { code: "REPEATED_FAILURE", label: "重复失败", severity: "medium", category: "behavior" },
  RUNAWAY_TRACE: { code: "RUNAWAY_TRACE", label: "事件数异常（疑似失控循环）", severity: "medium", category: "behavior" },
  UNMEASURED_LATENCY: { code: "UNMEASURED_LATENCY", label: "未记录延迟", severity: "low", category: "operational" },
} as const;

export type RiskLevel = "none" | "low" | "medium" | "high";

// ── Input event shape (metadata only) ─────────────────────────────────────────

export interface AssessmentEvent {
  trace_id?: string | null;
  session_id?: string | null;
  agent_id?: string | null;
  provider?: string | null;
  event_type?: string | null;
  status?: string | null;
  event_hash?: string | null;
  /** Hash-chain predecessor pointer (null/undefined only for the genesis event). */
  prev_hash?: string | null;
  input_hash?: string | null;
  output_hash?: string | null;
  args_hash?: string | null;
  result_hash?: string | null;
  timestamp?: string | null;
  latency_ms?: number | null;
  error_code?: string | null;
}

// ── Per-trace assessment result ───────────────────────────────────────────────

export interface TraceAssessment {
  traceKey: string;
  eventCount: number;
  signals: AssessSignalDef[];
  riskLevel: RiskLevel;
  privacyOk: boolean;
  traceIntegrityOk: boolean;
}

// ── Event-level signal checks ─────────────────────────────────────────────────

function isMissingHash(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/**
 * Verify hash-chain linkage across an ordered event sequence, using ONLY the
 * hash pointer metadata (no raw content is read — no DLP, per TRST-0.3).
 *
 * Rules:
 *   - events[0] must be a genesis event (prev_hash === null)
 *   - events[i].prev_hash must equal events[i-1].event_hash
 *
 * Catches what per-event hashing cannot: DELETION. If a middle event is
 * removed, the surviving successor no longer links to its predecessor.
 *
 * Events without any event_hash are skipped (pre-chain legacy data) — those
 * are already reported by MISSING_EVENT_HASH rather than counted as breaks.
 */
function verifyChainLinkage(events: AssessmentEvent[]): {
  broken: boolean;
  unexpectedGenesis: boolean;
} {
  const chained = events.filter((e) => !!e.event_hash);
  if (chained.length === 0) return { broken: false, unexpectedGenesis: false };

  // First chained event must be genesis (no predecessor).
  let unexpectedGenesis = false;
  if (chained[0].prev_hash !== null && chained[0].prev_hash !== undefined) {
    unexpectedGenesis = true;
  }

  for (let i = 1; i < chained.length; i++) {
    const prev = chained[i - 1];
    const cur = chained[i];

    // A non-first event with no predecessor is a distinct anomaly:
    // it suggests the log was truncated or two chains were spliced,
    // rather than a simple hash mismatch. Report it as such.
    if (cur.prev_hash === null || cur.prev_hash === undefined) {
      unexpectedGenesis = true;
      continue;
    }
    if (cur.prev_hash !== prev.event_hash) {
      return { broken: true, unexpectedGenesis };
    }
  }
  return { broken: false, unexpectedGenesis };
}

function computeEventSignals(ev: AssessmentEvent): AssessSignalDef[] {
  const sigs: AssessSignalDef[] = [];

  // Operational
  if (!ev.agent_id || ev.agent_id === "unknown-agent") {
    sigs.push(SIGNALS.UNKNOWN_AGENT);
  }
  if (!ev.provider || ev.provider === "") {
    sigs.push(SIGNALS.MODEL_PROVIDER_UNKNOWN);
  }

  // Privacy — hash presence
  if (!ev.event_hash) {
    sigs.push(SIGNALS.MISSING_EVENT_HASH);
  }
  if (ev.event_type === "model_call" && isMissingHash(ev.input_hash)) {
    sigs.push(SIGNALS.MISSING_INPUT_HASH);
  }
  if (ev.event_type === "model_call" && ev.status === "success" && isMissingHash(ev.output_hash)) {
    sigs.push(SIGNALS.MISSING_OUTPUT_HASH);
  }
  if (ev.event_type === "tool_call" && isMissingHash(ev.args_hash)) {
    sigs.push(SIGNALS.MISSING_ARGS_HASH);
  }
  if (ev.event_type === "tool_call" && ev.status === "success" && isMissingHash(ev.result_hash)) {
    sigs.push(SIGNALS.MISSING_RESULT_HASH);
  }

  return sigs;
}

// ── Trace-level signals ───────────────────────────────────────────────────────

function computeTraceSignals(events: AssessmentEvent[]): AssessSignalDef[] {
  const sigs: AssessSignalDef[] = [];

  // Deduplicate event-level signals
  const eventSignals = new Set<string>();
  for (const ev of events) {
    const s = computeEventSignals(ev);
    for (const sig of s) {
      if (!eventSignals.has(sig.code)) {
        eventSignals.add(sig.code);
        sigs.push(sig);
      }
    }
  }

  // Single event trace
  if (events.length === 1) {
    sigs.push(SIGNALS.SINGLE_EVENT_TRACE);
  }

  // Timestamp disorder
  const timestamps = events
    .map((e) => e.timestamp)
    .filter((t): t is string => !!t)
    .sort();
  if (timestamps.length >= 2) {
    for (let i = 1; i < timestamps.length; i++) {
      if (timestamps[i] < timestamps[i - 1]) {
        sigs.push(SIGNALS.TIMESTAMP_DISORDER);
        break;
      }
    }
  }

  // High latency per event
  const maxLatency = Math.max(...events.map((e) => Number(e.latency_ms ?? 0)));
  if (maxLatency > 30000) {
    sigs.push(SIGNALS.HIGH_LATENCY);
  }

  // ── Hash-chain integrity (metadata pointer checks only) ──
  // Detects both tampering AND deletion, which per-event hashing cannot.
  const chainCheck = verifyChainLinkage(events);
  if (chainCheck.broken) {
    sigs.push(SIGNALS.CHAIN_BREAK);
  }
  if (chainCheck.unexpectedGenesis) {
    sigs.push(SIGNALS.CHAIN_GENESIS_UNEXPECTED);
  }

  // ── Behavioral / operational anomalies ──
  const failureCount = events.filter((e) => e.status === "failure").length;
  if (failureCount >= 2) {
    sigs.push(SIGNALS.REPEATED_FAILURE);
  }
  if (events.length > 50) {
    sigs.push(SIGNALS.RUNAWAY_TRACE);
  }
  // A completed event that reports 0 latency was never actually measured.
  if (
    events.some(
      (e) => e.status === "success" && (e.latency_ms === 0 || e.latency_ms === null),
    )
  ) {
    sigs.push(SIGNALS.UNMEASURED_LATENCY);
  }
  if (events.every((e) => !e.trace_id)) {
    sigs.push(SIGNALS.MISSING_TRACE_ID);
  }

  // Tool without model
  if (events.some((e) => e.event_type === "tool_call")) {
    const hasModel = events.some((e) => e.event_type === "model_call");
    if (!hasModel) {
      sigs.push(SIGNALS.TOOL_WITHOUT_MODEL);
    }
  }

  return sigs;
}

// ── Risk level derivation ─────────────────────────────────────────────────────

export function deriveRiskLevel(signals: AssessSignalDef[]): RiskLevel {
  if (signals.length === 0) return "none";
  if (signals.some((s) => s.severity === "high")) return "high";
  if (signals.some((s) => s.severity === "medium")) return "medium";
  return "low";
}

// ── Trace key helpers ─────────────────────────────────────────────────────────

export function getTraceKey(ev: AssessmentEvent): string {
  if (ev.trace_id) return `trace:${ev.trace_id}`;
  if (ev.session_id) return `session:${ev.session_id}`;
  return "ungrouped";
}

export function getTraceLabel(key: string): string {
  if (key.startsWith("trace:")) return key.slice(6);
  if (key.startsWith("session:")) return `会话 ${key.slice(8)}`;
  return "未分组";
}

// ── Main assessment entry ─────────────────────────────────────────────────────

export function assessEvents(events: AssessmentEvent[]): TraceAssessment[] {
  const groups = new Map<string, AssessmentEvent[]>();
  for (const ev of events) {
    const k = getTraceKey(ev);
    const arr = groups.get(k);
    if (arr) arr.push(ev);
    else groups.set(k, [ev]);
  }

  const results: TraceAssessment[] = [];
  for (const [key, groupEvents] of groups) {
    const signals = computeTraceSignals(groupEvents);
    const riskLevel = deriveRiskLevel(signals);

    results.push({
      traceKey: key,
      eventCount: groupEvents.length,
      signals,
      riskLevel,
      privacyOk: !signals.some((s) => s.category === "privacy"),
      traceIntegrityOk: !signals.some((s) => s.category === "trace_integrity"),
    });
  }

  return results;
}

// ── Aggregate distribution ────────────────────────────────────────────────────

export interface RiskDistribution {
  none: number;
  low: number;
  medium: number;
  high: number;
}

export function computeRiskDistribution(assessments: TraceAssessment[]): RiskDistribution {
  const dist: RiskDistribution = { none: 0, low: 0, medium: 0, high: 0 };
  for (const a of assessments) {
    dist[a.riskLevel]++;
  }
  return dist;
}

// ── Dry-Run Control ──────────────────────────────────────────────────────────
// Control Discovery Phase — dry-run only, no enforcement, no runtime impact.
//
// Control model:
//   allow       → no control-relevant (privacy/trace_integrity) signals at medium+
//   review      → at least one medium severity privacy/trace_integrity signal
//   would_block → at least one high severity privacy/trace_integrity signal
//                 (label only — does NOT block, does NOT change runtime)
//
// Excluded from control decisions:
//   - operational signals (HIGH_LATENCY, UNKNOWN_AGENT, MODEL_PROVIDER_UNKNOWN)
//   - behavior signals
//   - single_event_trace (trace_integrity but low severity = informational)
//   - raw content signals (none exist — design constraint)

export type ControlAction = "allow" | "review" | "would_block";

export interface ControlRecommendation {
  action: ControlAction;
  reasons: string[];
  mode: "dry_run";
  runtimeEffect: "none";
}

const CONTROL_ELIGIBLE_CATEGORIES = new Set(["privacy", "trace_integrity"]);

export function computeControlRecommendation(
  assessment: TraceAssessment
): ControlRecommendation {
  const controlSignals = assessment.signals.filter(
    (s) =>
      CONTROL_ELIGIBLE_CATEGORIES.has(s.category) &&
      s.severity !== "low"
  );

  if (controlSignals.length === 0) {
    return {
      action: "allow",
      reasons: [],
      mode: "dry_run",
      runtimeEffect: "none",
    };
  }

  const hasHigh = controlSignals.some((s) => s.severity === "high");
  const reasons = [...new Set(controlSignals.map((s) => s.code))];

  return {
    action: hasHigh ? "would_block" : "review",
    reasons,
    mode: "dry_run",
    runtimeEffect: "none",
  };
}
