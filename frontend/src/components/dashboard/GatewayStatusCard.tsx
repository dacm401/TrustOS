"use client";

import { useGatewayHealth } from "@/hooks/useQueries";
import type { GatewayHealth } from "@/lib/api";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatUptime(seconds?: number): string {
  if (!seconds && seconds !== 0) return "—";
  if (seconds < 60) return `${seconds}s`;
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  // 1m–59m range: show m+s for better granularity
  if (s > 0) return `${m}m ${s}s`;
  return `${m}m`;
}

function formatOverhead(ms?: number): string {
  if (!ms && ms !== 0) return "—";
  return ms < 1 ? `${(ms * 1000).toFixed(0)}μs` : `${ms.toFixed(1)}ms`;
}

// ── Badge ────────────────────────────────────────────────────────────────────

function StatusBadge({
  label,
  on,
}: {
  label: string;
  on: boolean;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: on ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.12)",
        color: on ? "#16a34a" : "#dc2626",
        border: `1px solid ${on ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.25)"}`,
      }}
    >
      <span
        className="inline-block w-1.5 h-1.5 rounded-full"
        style={{
          backgroundColor: on ? "#22c55e" : "#ef4444",
          boxShadow: on ? "0 0 6px rgba(34,197,94,0.5)" : "none",
        }}
      />
      {label}
    </span>
  );
}

// ── Stat Cell ────────────────────────────────────────────────────────────────

function StatCell({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className="rounded-lg p-3 text-center"
      style={{ backgroundColor: "var(--bg-elevated)" }}
    >
      <div
        className="text-lg font-bold"
        style={{ color: accent ? "var(--accent-blue)" : "var(--text-primary)" }}
      >
        {value}
      </div>
      <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
        {label}
      </div>
    </div>
  );
}

// ── Gateway Pulse Dot ────────────────────────────────────────────────────────

function GatewayDot({ online }: { online: boolean }) {
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span
        className="absolute inline-flex h-full w-full rounded-full opacity-75"
        style={{
          backgroundColor: online ? "var(--accent-green)" : "var(--accent-red)",
          animation: online ? "ping 2s cubic-bezier(0,0,0.2,1) infinite" : "none",
        }}
      />
      <span
        className="relative inline-flex rounded-full h-2.5 w-2.5"
        style={{
          backgroundColor: online ? "var(--accent-green)" : "var(--accent-red)",
        }}
      />
    </span>
  );
}

// ── Provider Detail ──────────────────────────────────────────────────────────

interface ProviderInfo {
  provider_id?: string;
  models?: string[];
  model_count?: number;
}

function ProviderDetail({ providers }: { providers: unknown }) {
  if (Array.isArray(providers)) {
    // Flat list (e.g. ["default"] or list of provider objects)
    return (
      <div className="flex flex-wrap gap-1.5">
        {providers.map((key, i) => (
          <span
            key={String(i)}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs"
            style={{
              backgroundColor: "var(--bg-elevated)",
              color: "var(--accent-blue)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            {String(key)}
          </span>
        ))}
      </div>
    );
  }

  const entries = Object.entries((providers as Record<string, unknown>) ?? {});
  if (entries.length === 0) {
    return (
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        无已配置的 Provider
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {entries.map(([key, raw]) => {
        const p = raw as ProviderInfo;
        return (
          <div
            key={key}
            className="rounded-lg p-3"
            style={{ backgroundColor: "var(--bg-elevated)" }}
          >
            <div className="flex items-center justify-between mb-1">
              <span
                className="text-xs font-semibold uppercase tracking-wide"
                style={{ color: "var(--accent-blue)" }}
              >
                {p.provider_id ?? key}
              </span>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                {(p.models?.length ?? p.model_count ?? 0)} models
              </span>
            </div>
            {p.models && p.models.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {p.models.slice(0, 5).map((m) => (
                  <span
                    key={m}
                    className="text-xs rounded px-1.5 py-0.5"
                    style={{
                      backgroundColor: "var(--bg-surface)",
                      color: "var(--text-secondary)",
                      border: "1px solid var(--border-subtle)",
                    }}
                  >
                    {m}
                  </span>
                ))}
                {p.models.length > 5 && (
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    +{p.models.length - 5} more
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── GatewayStatusCard ────────────────────────────────────────────────────────

export default function GatewayStatusCard() {
  const { data, isLoading, isError } = useGatewayHealth();

  const online = data?.status === "online";
  const cardStyle = {
    backgroundColor: "var(--bg-surface)",
    border: `1px solid ${online ? "var(--border-subtle)" : "rgba(239,68,68,0.3)"}`,
    boxShadow: online
      ? "0 0 20px rgba(59,130,246,0.05)"
      : "0 0 20px rgba(239,68,68,0.1)",
  };

  // ── Loading ──────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="rounded-xl p-5 animate-pulse" style={cardStyle}>
        <div className="flex items-center gap-2 mb-4">
          <div
            className="h-4 w-32 rounded"
            style={{ backgroundColor: "var(--bg-elevated)" }}
          />
        </div>
        <div className="grid grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="rounded-lg p-3"
              style={{ backgroundColor: "var(--bg-elevated)" }}
            >
              <div
                className="h-5 w-12 mx-auto rounded"
                style={{ backgroundColor: "var(--border-subtle)" }}
              />
              <div
                className="h-3 w-16 mx-auto mt-2 rounded"
                style={{ backgroundColor: "var(--border-subtle)" }}
              />
            </div>
          ))}
        </div>
        <div
          className="h-12 rounded-lg mt-3"
          style={{ backgroundColor: "var(--bg-elevated)" }}
        />
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (isError || !data) {
    return (
      <div className="rounded-xl p-5" style={cardStyle}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GatewayDot online={false} />
            <h3
              className="text-sm font-semibold"
              style={{ color: "var(--text-primary)" }}
            >
              TRST-2 Gateway
            </h3>
          </div>
          <StatusBadge label="离线" on={false} />
        </div>
        <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
          网关未响应 — 请确认网关已在 localhost:8795 启动
        </p>
      </div>
    );
  }

  // ── Online ───────────────────────────────────────────────────────────────
  const streamingName =
    data.streaming === "sse_passthrough"
      ? "SSE"
      : typeof data.streaming === "string"
        ? data.streaming
        : "—";
  const mcpEnabled = Array.isArray(data.mcp_lifecycle)
    ? data.mcp_lifecycle.some((m) => m.status === "connected")
    : false;
  const providerKeys = Object.keys((data.providers as Record<string, unknown>) ?? {});

  return (
    <div className="rounded-xl p-5" style={cardStyle}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <GatewayDot online={true} />
          <h3
            className="text-sm font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            TRST-2 Gateway
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {data.service ?? "gateway"}
          </span>
          <StatusBadge label="在线" on={true} />
        </div>
      </div>

      {/* Key stats grid */}
      <div className="grid grid-cols-4 gap-3 mb-3">
        <StatCell label="流式" value={streamingName} accent={data.streaming === "sse_passthrough"} />
        <StatCell label="MCP" value={mcpEnabled ? "已启用" : "已禁用"} accent={mcpEnabled} />
        <StatCell
          label="Provider"
          value={providerKeys.length > 0 ? providerKeys.join(", ") : "—"}
          accent={providerKeys.length > 0}
        />
        <StatCell
          label="审计事件"
          value={data.events_count != null ? String(data.events_count) : "—"}
          accent={(data.events_count ?? 0) > 0}
        />
      </div>

      <div className="grid grid-cols-4 gap-3 mb-3">
        <StatCell
          label="运行时间"
          value={formatUptime(data.uptime_seconds)}
        />
        <StatCell
          label="网关耗时"
          value={formatOverhead(data.gateway_overhead_ms)}
          accent={data.gateway_overhead_ms != null && data.gateway_overhead_ms < 10}
        />
        <StatCell
          label="CORS"
          value="已启用"
          accent={true}
        />
        <StatCell
          label="Mode"
          value={data.mode ?? "—"}
          accent={data.mode === "shadow"}
        />
      </div>

      {/* Provider detail */}
      {providerKeys.length > 0 && (
        <>
          <div className="mb-3" style={{ borderTop: "1px solid var(--border-subtle)" }} />
          <div className="mb-2" style={{ color: "var(--text-secondary)" }}>
            <span className="text-xs font-medium">Provider 详情</span>
          </div>
          <ProviderDetail providers={data.providers} />
        </>
      )}

      {/* Timestamp */}
      {data.timestamp && (
        <>
          <div className="mt-3 mb-2" style={{ borderTop: "1px solid var(--border-subtle)" }} />
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            上次检查: {data.timestamp}
          </p>
        </>
      )}
    </div>
  );
}
