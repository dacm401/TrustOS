"use client";

import GatewayStatusCard from "@/components/dashboard/GatewayStatusCard";
import EvidenceReportPanel from "@/components/dashboard/EvidenceReportPanel";
import { useGatewayEvents, useGatewayHealth, useGatewaySessions } from "@/hooks/useQueries";
import type { GatewaySession } from "@/lib/api";

export default function OverviewView() {
  const { data: eventsData } = useGatewayEvents({ limit: 1, page: 1 });
  const { data: healthData } = useGatewayHealth();
  const { data: sessionsData } = useGatewaySessions(10);

  const sessions = sessionsData?.sessions ?? [];
  const totalEvents = eventsData?.total ?? eventsData?.events_count;
  const pageCount = eventsData?.has_more != null ? eventsData.page : null;

  return (
    <div
      className="h-full overflow-y-auto"
      style={{ backgroundColor: "var(--bg-base)" }}
    >
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Page header */}
        <div>
          <h1
            className="text-xl font-semibold mb-1"
            style={{ color: "var(--text-primary)" }}
          >
            TrustOS Console
          </h1>
          <p
            className="text-sm"
            style={{ color: "var(--text-secondary)" }}
          >
            AI Gateway · Event Capture · Risk Assessment · Evidence Export · SQLite-backed (4C)
          </p>
        </div>

        {/* Quick stats row */}
        <div className="grid grid-cols-4 gap-4">
          <StatCard
            label="Total Events"
            value={totalEvents?.toLocaleString() ?? "—"}
            icon="📊"
          />
          <StatCard
            label="Gateway"
            value={healthData?.status ?? "—"}
            icon="🟢"
          />
          <StatCard
            label="Sessions"
            value={sessions.length > 0 ? sessions.length.toLocaleString() : "—"}
            icon="💬"
          />
          <StatCard
            label="Store"
            value={healthData?.index ?? "jsonl"}
            icon="🗄️"
          />
        </div>

        {/* Gateway Status */}
        <GatewayStatusCard />

        {/* Sessions Summary */}
        {sessions.length > 0 && (
          <div
            className="rounded-xl border p-6"
            style={{
              backgroundColor: "var(--bg-surface)",
              borderColor: "var(--border-subtle)",
            }}
          >
            <h3
              className="text-sm font-semibold mb-3"
              style={{ color: "var(--text-primary)" }}
            >
              💬 Recent Sessions (TRST-4C)
            </h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {sessions.map((s: GatewaySession) => (
                <div
                  key={s.session_id}
                  className="flex items-center justify-between py-2 px-3 rounded"
                  style={{
                    backgroundColor: "var(--bg-overlay)",
                    borderBottom: "1px solid var(--border-subtle)",
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-xs font-mono truncate"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {s.session_id.slice(0, 12)}...
                    </div>
                    <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                      {(s.agents ?? []).slice(0, 3).join(", ")}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs flex-shrink-0">
                    <span style={{ color: "var(--text-secondary)" }}>
                      {s.event_count} events
                    </span>
                    <span style={{ color: "var(--text-secondary)" }}>
                      {s.model_calls} calls
                    </span>
                    <span style={{ color: "var(--text-muted)" }}>
                      {(s.total_tokens ?? 0).toLocaleString()} tokens
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Evidence Report Summary */}
        <EvidenceReportPanel />

        {/* Privacy & Limitations */}
        <div
          className="rounded-xl border p-6"
          style={{
            backgroundColor: "var(--bg-surface)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <h3
            className="text-sm font-semibold mb-3"
            style={{ color: "var(--text-primary)" }}
          >
            🔒 Privacy & Performance
          </h3>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <InfoRow label="Raw content stored" value="No — hash only" />
            <InfoRow label="Streaming support" value="Validated (TRST-4B)" />
            <InfoRow label="Evidence export" value="HTML + Markdown" />
            <InfoRow label="Tamper evidence" value="SHA-256 hashes" />
            <InfoRow label="Event store" value="JSONL + SQLite (TRST-4C)" />
            <InfoRow label="Chat→Gateway" value="Integrated (TRST-F1)" />
            <InfoRow label="Cache speed" value="SQLite WAL (8MB cache)" />
            <InfoRow label="Auth model" value="Local diagnostic only" />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  muted,
}: {
  label: string;
  value: string;
  icon: string;
  muted?: boolean;
}) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{
        backgroundColor: "var(--bg-surface)",
        borderColor: "var(--border-subtle)",
      }}
    >
      <div className="text-lg mb-1">{icon}</div>
      <div
        className="text-lg font-bold"
        style={{ color: muted ? "var(--text-muted)" : "var(--text-primary)" }}
      >
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        {label}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex justify-between items-center py-1"
      style={{ borderBottom: "1px solid var(--border-subtle)" }}
    >
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span style={{ color: "var(--text-primary)" }}>{value}</span>
    </div>
  );
}
