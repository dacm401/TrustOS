"use client";

import { useMemo, useState, useCallback } from "react";
import { useGatewayEvents } from "@/hooks/useQueries";
import type { GatewayEvent } from "@/lib/api";
import {
  assessEvents,
  computeControlRecommendation,
  computeRiskDistribution,
  getTraceKey,
  getTraceLabel,
  type ControlAction,
  type ControlRecommendation,
  type RiskLevel,
} from "@/lib/assess-utils";
import { buildEvidenceBundle } from "@/lib/evidence-bundle";

// ── Reviewer Explanation Panel ──────────────────────────────────────────────
// Provides plain-language explanations for risk, control dry-run, and evidence
// to make TrustOS governance output understandable to Private Beta reviewers.

function ReviewerExplanation() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: 12 }}>
      <button
        onClick={() => setOpen(!open)}
        className="text-xs font-medium transition-colors"
        style={{
          color: "var(--accent-blue)",
          cursor: "pointer",
          background: "none",
          border: "none",
          padding: 0,
        }}
      >
        {open ? "▾ " : "▸ "}解释说明 (Reviewer Guide)
      </button>
      {open && (
        <div
          className="mt-2 rounded-lg p-3 text-xs space-y-2"
          style={{
            backgroundColor: "rgba(59,130,246,0.04)",
            border: "1px solid rgba(59,130,246,0.12)",
            color: "var(--text-secondary)",
            lineHeight: 1.6,
          }}
        >
          <div>
            <strong style={{ color: "var(--text-primary)" }}>风险评估 (Risk Assessment)</strong>
            <br />
            基于治理信号自动评估。信号检测隐私泄露、操作异常和证据完整性。
            <br />
            <span style={{ color: RISK_EXPLANATION.low.fg }}>低风险</span> — 未检测到可疑信号
            {" · "}
            <span style={{ color: RISK_EXPLANATION.medium.fg }}>中风险</span> — 存在需关注的治理信号
            {" · "}
            <span style={{ color: RISK_EXPLANATION.high.fg }}>高风险</span> — 检测到隐私/安全敏感信号
          </div>
          <div>
            <strong style={{ color: "var(--text-primary)" }}>控制建议 (Dry-Run Control)</strong>
            <br />
            TrustOS 提供控制建议，但<span style={{ color: "var(--accent-green)", fontWeight: 600 }}>不实际拦截、修改或修复任何请求</span> (dry-run)。
            <br />
            通过 — 无治理信号触发 · 复核 — 建议人工检查 · 拦截 — 建议阻止（dry-run only，未实际拦截）
          </div>
          <div>
            <strong style={{ color: "var(--text-primary)" }}>证据导出 (Evidence Export)</strong>
            <br />
            证据包包含哈希值和元数据，<span style={{ fontWeight: 600 }}>不包含原始提示词、原始输出或原始模型响应</span>。
            导出为前端复制到剪贴板，TrustOS 后端不持久化证据包。
            哈希值可用于 reviewer 独立复核输出一致性。
          </div>
        </div>
      )}
    </div>
  );
}

// Risk explanation colors (same as RISK_COLORS but declared early for ReviewerExplanation)
const RISK_EXPLANATION: Record<RiskLevel, { fg: string }> = {
  none:   { fg: "#94a3b8" },
  low:    { fg: "#16a34a" },
  medium: { fg: "#ca8a04" },
  high:   { fg: "#dc2626" },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function truncateHash(hash?: string | null): string {
  if (!hash) return "—";
  return hash.length > 12 ? `${hash.slice(0, 6)}...${hash.slice(-6)}` : hash;
}

function formatEventType(type?: string | null): string {
  if (!type) return "未知";
  // Human-friendly labels
  const map: Record<string, string> = {
    model_call: "模型调用",
    tool_call: "工具调用",
    gateway_request: "网关请求",
    event: "事件",
    error: "错误",
    mcp_initialize: "MCP 初始化",
    mcp_proxy: "MCP 代理",
    mcp_tool_proxy: "MCP 工具代理",
    mcp_resource_proxy: "MCP 资源代理",
    mcp_prompt_proxy: "MCP 提示词代理",
  };
  return map[type] ?? type;
}

function formatTimestamp(ts?: string | null): string {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return ts;
  }
}

function formatLatency(ms?: number | null, oh?: number | null): string {
  const parts: string[] = [];
  if (ms != null) parts.push(`${ms.toFixed(0)}ms`);
  if (oh != null) parts.push(`+${oh.toFixed(0)}μs`);
  return parts.length > 0 ? parts.join(" ") : "—";
}

// ── Hash Indicators ─────────────────────────────────────────────────────────

function HashDot({ present }: { present: boolean }) {
  return (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full"
      style={{
        backgroundColor: present ? "var(--accent-green)" : "var(--text-muted)",
        opacity: present ? 1 : 0.35,
      }}
      title={present ? "hash present" : "no hash"}
    />
  );
}

// ── Badge ────────────────────────────────────────────────────────────────────

function EventTypeBadge({ type }: { type?: string | null }) {
  const label = formatEventType(type);
  const isModel = type === "model_call";
  const isTool = type === "tool_call";
  let bg = "rgba(100,116,139,0.12)";
  let fg = "#94a3b8";
  if (isModel) { bg = "rgba(59,130,246,0.12)"; fg = "#60a5fa"; }
  if (isTool)  { bg = "rgba(139,92,246,0.12)"; fg = "#a78bfa"; }

  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: bg, color: fg }}
    >
      {label}
    </span>
  );
}

function StatusBadge({ status }: { status?: string | null }) {
  const isOk = status === "ok" || status === "success" || status === "completed";
  const isErr = status === "error" || status === "failed";
  const label = status ?? "—";
  let bg = "rgba(100,116,139,0.12)";
  let fg = "#94a3b8";
  if (isOk)  { bg = "rgba(34,197,94,0.12)"; fg = "#16a34a"; }
  if (isErr) { bg = "rgba(239,68,68,0.12)"; fg = "#dc2626"; }

  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: bg, color: fg }}
    >
      {label}
    </span>
  );
}

// ── Risk Badge ────────────────────────────────────────────────────────────────

const RISK_COLORS: Record<RiskLevel, { bg: string; fg: string; label: string }> = {
  none:  { bg: "rgba(100,116,139,0.08)", fg: "#94a3b8", label: "—" },
  low:   { bg: "rgba(34,197,94,0.08)",  fg: "#16a34a", label: "低" },
  medium:{ bg: "rgba(234,179,8,0.10)",  fg: "#ca8a04", label: "中" },
  high:  { bg: "rgba(239,68,68,0.10)",  fg: "#dc2626", label: "高" },
};

const RISK_TOOLTIPS: Record<RiskLevel, string> = {
  none:   "无风险 — 未检测到治理信号",
  low:    "低风险 — 检测到低严重性操作/完整性信号",
  medium: "中风险 — 存在需 reviewer 关注的治理信号",
  high:   "高风险 — 检测到隐私泄漏/安全敏感信号",
};

function RiskBadge({ level, signalCount }: { level: RiskLevel; signalCount: number }) {
  const c = RISK_COLORS[level];
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: c.bg, color: c.fg }}
      title={signalCount > 0 ? `${signalCount} 个信号: ${RISK_TOOLTIPS[level]}` : RISK_TOOLTIPS[level]}
    >
      <span>{c.label}</span>
      {signalCount > 0 && (
        <span style={{ opacity: 0.7 }}>·{signalCount}</span>
      )}
    </span>
  );
}

// ── Dry-Run Control Badge ─────────────────────────────────────────────────────
// Control Discovery — label only, does NOT block or change runtime.

const CONTROL_LABELS: Record<ControlAction, { bg: string; fg: string; label: string }> = {
  allow:       { bg: "rgba(34,197,94,0.06)",  fg: "#16a34a", label: "通过" },
  review:      { bg: "rgba(234,179,8,0.08)",  fg: "#ca8a04", label: "复核" },
  would_block: { bg: "rgba(239,68,68,0.08)",  fg: "#dc2626", label: "拦截" },
};

function ControlBadge({ recommendation }: { recommendation: ControlRecommendation }) {
  const c = CONTROL_LABELS[recommendation.action];
  const base = recommendation.reasons.length > 0
    ? `理由: ${recommendation.reasons.join(", ")}。`
    : "";
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: c.bg, color: c.fg, border: `1px solid ${c.fg}20` }}
      title={`${base}Dry-run: TrustOS 未实际拦截、修改或修复任何请求。`}
    >
      <span>{c.label}</span>
      <span style={{ opacity: 0.5, fontSize: "0.65rem" }}>dry-run</span>
    </span>
  );
}

// ── Single Event Row ─────────────────────────────────────────────────────────

function EventRow({ event }: { event: GatewayEvent }) {
  const hasInputHash = !!event.input_hash;
  const hasOutputHash = !!event.output_hash;
  const hasArgsHash = !!event.args_hash;
  const hasResultHash = !!event.result_hash;

  return (
    <div
      className="rounded-lg p-3"
      style={{
        backgroundColor: "var(--bg-elevated)",
        border: "1px solid var(--border-subtle)",
      }}
    >
      {/* Top row: type + status + timestamp */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <EventTypeBadge type={event.event_type} />
          <StatusBadge status={event.status} />
        </div>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {formatTimestamp(event.timestamp)}
        </span>
      </div>

      {/* Metadata row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
        {event.provider && (
          <span style={{ color: "var(--text-secondary)" }}>
            <span style={{ color: "var(--text-muted)" }}>provider:</span> {event.provider}
          </span>
        )}
        {event.model && (
          <span style={{ color: "var(--text-secondary)" }}>
            <span style={{ color: "var(--text-muted)" }}>model:</span> {event.model}
          </span>
        )}
        {event.tool_name && (
          <span style={{ color: "var(--text-secondary)" }}>
            <span style={{ color: "var(--text-muted)" }}>tool:</span> {event.tool_name}
          </span>
        )}
        {event.resource_ref && (
          <span style={{ color: "var(--text-secondary)" }}>
            <span style={{ color: "var(--text-muted)" }}>ref:</span> {event.resource_ref}
          </span>
        )}
      </div>

      {/* Hash row */}
      <div className="flex items-center gap-2 mt-1.5">
        <span className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
          {truncateHash(event.event_hash)}
        </span>
        {/* Hash presence dots */}
        <span className="flex items-center gap-1" title="input / output / args / result hashes">
          <HashDot present={hasInputHash} />
          <HashDot present={hasOutputHash} />
          <HashDot present={hasArgsHash} />
          <HashDot present={hasResultHash} />
        </span>
        {/* Latency */}
        {(event.latency_ms != null || event.gateway_overhead_ms != null) && (
          <span className="text-xs ml-auto" style={{ color: "var(--text-muted)" }}>
            {formatLatency(event.latency_ms, event.gateway_overhead_ms)}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Group Header ─────────────────────────────────────────────────────────────

function GroupHeader({
  label,
  count,
  riskLevel,
  signalCount,
  controlAction,
  onExport,
  exportStatus,
}: {
  label: string;
  count: number;
  riskLevel?: RiskLevel;
  signalCount?: number;
  controlAction?: ControlRecommendation;
  onExport?: () => void;
  exportStatus?: string | null;
}) {
  return (
    <div
      className="flex items-center justify-between rounded-lg px-3 py-2"
      style={{
        backgroundColor: "rgba(59,130,246,0.06)",
        border: "1px solid rgba(59,130,246,0.15)",
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="text-xs font-semibold font-mono"
          style={{ color: "var(--accent-blue)" }}
        >
          {label}
        </span>
        {riskLevel && riskLevel !== "none" && (
          <RiskBadge level={riskLevel} signalCount={signalCount ?? 0} />
        )}
        {controlAction && (
          <ControlBadge recommendation={controlAction} />
        )}
      </div>
      <div className="flex items-center gap-2">
        {onExport && (
          <button
            onClick={onExport}
            className="text-xs rounded px-2 py-0.5 font-medium transition-colors"
            style={{
              backgroundColor: "rgba(100,116,139,0.10)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-subtle)",
              cursor: "pointer",
            }}
            title="生成隐私安全证据包 (哈希+元数据，不含原始内容)，复制到剪贴板。TrustOS 后端不持久化证据包。"
          >
            Export Evidence (dry-run)
          </button>
        )}
        {exportStatus && (
          <span
            className="text-xs"
            style={{
              color: exportStatus.startsWith("Evidence copied")
                ? "var(--accent-green)"
                : "var(--text-muted)",
            }}
          >
            {exportStatus}
          </span>
        )}
        <span
          className="text-xs rounded-full px-2 py-0.5"
          style={{
            backgroundColor: "rgba(59,130,246,0.15)",
            color: "var(--accent-blue)",
          }}
        >
          {count} 事件
        </span>
      </div>
    </div>
  );
}

// ── EventChainViewer ─────────────────────────────────────────────────────────

export default function EventChainViewer() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError } = useGatewayEvents({ page, limit: 20 });
  const cardStyle = {
    backgroundColor: "var(--bg-surface)",
    border: "1px solid var(--border-subtle)",
    boxShadow: "0 0 20px rgba(59,130,246,0.05)",
  };

  // ── Loading ──────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="rounded-xl p-5 animate-pulse" style={cardStyle}>
        <div className="flex items-center gap-2 mb-4">
          <div
            className="h-4 w-40 rounded"
            style={{ backgroundColor: "var(--bg-elevated)" }}
          />
        </div>
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-16 rounded-lg"
              style={{ backgroundColor: "var(--bg-elevated)" }}
            />
          ))}
        </div>
      </div>
    );
  }

  // ── Error / Offline ───────────────────────────────────────────────────────
  if (isError || !data || data.status !== "ok") {
    return (
      <div className="rounded-xl p-5" style={cardStyle}>
        <h3
          className="text-sm font-semibold mb-2"
          style={{ color: "var(--text-primary)" }}
        >
          事件链
        </h3>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          网关离线 — 无法加载事件链
        </p>
      </div>
    );
  }

  // ── Empty ─────────────────────────────────────────────────────────────────
  if (!data.events || data.events.length === 0) {
    return (
      <div className="rounded-xl p-5" style={cardStyle}>
        <h3
          className="text-sm font-semibold mb-2"
          style={{ color: "var(--text-primary)" }}
        >
          事件链
        </h3>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          暂无审计事件
        </p>
      </div>
    );
  }

  // ── Group events ──────────────────────────────────────────────────────────

  const groupEntries = useMemo(() => {
    const groups = new Map<string, GatewayEvent[]>();
    for (const e of data.events) {
      const k = getTraceKey(e);
      const arr = groups.get(k);
      if (arr) arr.push(e);
      else groups.set(k, [e]);
    }
    return Array.from(groups.entries());
  }, [data.events]);

  // ── Compute assessments ───────────────────────────────────────────────────
  // Ephemeral: derived from sanitized /events, no writes, no enforcement.
  const { assessments, dist } = useMemo(() => {
    const a = assessEvents(data.events);
    const d = computeRiskDistribution(a);
    return { assessments: a, dist: d };
  }, [data.events]);

  const assessmentByKey = useMemo(() => {
    const m = new Map<string, (typeof assessments)[number]>();
    for (const a of assessments) m.set(a.traceKey, a);
    return m;
  }, [assessments]);

  // ── Compute dry-run control recommendations ────────────────────────────
  // Control Discovery — label only, does NOT block, does NOT change runtime.
  const controlByKey = useMemo(() => {
    const m = new Map<string, ControlRecommendation>();
    for (const a of assessments) {
      m.set(a.traceKey, computeControlRecommendation(a));
    }
    return m;
  }, [assessments]);

  // Control distribution for footer
  const controlDist = useMemo(() => {
    let allow = 0, review = 0, wouldBlock = 0;
    for (const c of controlByKey.values()) {
      if (c.action === "allow") allow++;
      else if (c.action === "review") review++;
      else if (c.action === "would_block") wouldBlock++;
    }
    return { allow, review, wouldBlock };
  }, [controlByKey]);

  // ── Evidence Export ────────────────────────────────────────────────────────
  // Copy-only, frontend-only, privacy-safe evidence bundle per trace group.

  const [exportStatus, setExportStatus] = useState<Record<string, string>>({});

  const handleExport = useCallback(
    async (groupKey: string, events: GatewayEvent[]) => {
      try {
        const bundle = buildEvidenceBundle(groupKey, events);
        const json = JSON.stringify(bundle, null, 2);
        await navigator.clipboard.writeText(json);
        const ass = assessmentByKey.get(groupKey);
        const riskLabel = ass?.riskLevel ?? "none";
        setExportStatus((prev) => ({
          ...prev,
          [groupKey]: `Evidence copied (privacy-safe, copy-only) — ${events.length} events, risk ${riskLabel}`,
        }));
      } catch {
        setExportStatus((prev) => ({
          ...prev,
          [groupKey]: "Evidence export failed",
        }));
      }
      // Clear status after 3s
      setTimeout(() => {
        setExportStatus((prev) => {
          const next = { ...prev };
          delete next[groupKey];
          return next;
        });
      }, 3000);
    },
    [assessmentByKey]
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="rounded-xl p-5" style={cardStyle}>
      <div className="flex items-center justify-between mb-4">
        <h3
          className="text-sm font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          事件链
        </h3>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          第{page}页 · {data.total ?? data.events_count} 事件
        </span>
      </div>

      <ReviewerExplanation />

      <div className="space-y-4">
        {groupEntries.map(([groupKey, events]) => {
          const ass = assessmentByKey.get(groupKey);
          const ctrl = controlByKey.get(groupKey);
          return (
            <div key={groupKey} className="space-y-2">
              <GroupHeader
                label={getTraceLabel(groupKey)}
                count={events.length}
                riskLevel={ass?.riskLevel}
                signalCount={ass?.signals.length}
                controlAction={ctrl}
                onExport={() => handleExport(groupKey, events)}
                exportStatus={exportStatus[groupKey] ?? null}
              />
              {events.map((event, idx) => (
                <EventRow
                  key={event.event_id ?? `${groupKey}-${idx}`}
                  event={event}
                />
              ))}
            </div>
          );
        })}
      </div>

      {/* Summary footer with risk + control distribution */}
      <div
        className="mt-4 pt-3 flex items-center gap-4 text-xs flex-wrap"
        style={{
          borderTop: "1px solid var(--border-subtle)",
          color: "var(--text-muted)",
        }}
      >
        <span>{groupEntries.length} 个分组</span>
        <span>{data.total ?? data.events_count} 个总事件</span>
        {data.has_more && (
          <button
            onClick={() => setPage(p => p + 1)}
            className="px-3 py-1 rounded"
            style={{ background: "var(--accent)", color: "#fff", cursor: "pointer", border: "none", fontSize: "0.75rem" }}
          >
            加载更多 (第{page + 1}页)
          </button>
        )}
        {(dist.low > 0 || dist.medium > 0 || dist.high > 0) && (
          <span className="flex items-center gap-1.5">
            风险:
            {dist.high > 0 && <span style={{ color: RISK_COLORS.high.fg }}>高 {dist.high}</span>}
            {dist.medium > 0 && <span style={{ color: RISK_COLORS.medium.fg }}>中 {dist.medium}</span>}
            {dist.low > 0 && <span style={{ color: RISK_COLORS.low.fg }}>低 {dist.low}</span>}
          </span>
        )}
        {(controlDist.review > 0 || controlDist.wouldBlock > 0) && (
          <span className="flex items-center gap-1.5">
            控制(dry-run):
            {controlDist.wouldBlock > 0 && <span style={{ color: CONTROL_LABELS.would_block.fg }}>拦截 {controlDist.wouldBlock}</span>}
            {controlDist.review > 0 && <span style={{ color: CONTROL_LABELS.review.fg }}>复核 {controlDist.review}</span>}
            {controlDist.allow > 0 && <span style={{ color: CONTROL_LABELS.allow.fg }}>通过 {controlDist.allow}</span>}
          </span>
        )}
        <span>mode: {data.mode ?? "—"}</span>
      </div>
    </div>
  );
}
