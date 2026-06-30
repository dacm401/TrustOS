"use client";
import { useState, useEffect, useCallback } from "react";
import { getApiConfig } from "@/lib/api";

interface HealthCheck {
  status: string;
  latencyMs?: number;
  detail?: string;
}

interface HealthData {
  status: string;
  timestamp: string;
  checks: Record<string, HealthCheck>;
}

interface UsageToday {
  date: string;
  activeUsers: number;
  sessions: number;
  tasks: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

interface TrendDay {
  day: string;
  sessions: number;
  tasks: number;
  costUsd: number;
}

interface TopUser {
  userId: string;
  tasks: number;
  costUsd: number;
}

interface UsageData {
  today: UsageToday;
  trend: TrendDay[];
  topUsers: TopUser[];
}

interface ErrorEvent {
  taskId: string;
  userId: string;
  sessionId: string;
  status: string;
  errorMessage: string | null;
  durationSeconds: number;
  createdAt: string;
}

interface ErrorData {
  date: string;
  summary: Record<string, number>;
  recent: ErrorEvent[];
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function statusColor(s: string): string {
  if (s === "ok" || s === "healthy" || s === "completed") return "#22c55e";
  if (s === "degraded" || s === "cancelled") return "#f59e0b";
  return "#ef4444";
}

export default function AdminPanel({ adminKey }: { adminKey: string }) {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [errors, setErrors] = useState<ErrorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { apiBase } = await getApiConfig();
      const headers = { "X-Admin-Key": adminKey };

      const [healthRes, usageRes, errorsRes] = await Promise.all([
        fetch(`${apiBase}/v1/admin/health`, { headers }),
        fetch(`${apiBase}/v1/admin/usage`, { headers }),
        fetch(`${apiBase}/v1/admin/errors`, { headers }),
      ]);

      if (!healthRes.ok) throw new Error(`Health ${healthRes.status}: ${await healthRes.text()}`);
      if (!usageRes.ok) throw new Error(`Usage ${usageRes.status}`);
      if (!errorsRes.ok) throw new Error(`Errors ${errorsRes.status}`);

      setHealth(await healthRes.json());
      setUsage(await usageRes.json());
      setErrors(await errorsRes.json());
    } catch (e: any) {
      setError(e.message || "Admin API 加载失败");
    } finally {
      setLoading(false);
    }
  }, [adminKey]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000); // auto-refresh every 30s
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading && !health) {
    return (
      <div className="flex items-center justify-center h-full" style={{ color: "var(--text-muted)" }}>
        Loading admin data...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8" style={{ color: "var(--text-muted)" }}>
        <div className="text-red-400">⚠ {error}</div>
        <button
          onClick={fetchData}
          className="px-4 py-2 rounded text-sm"
          style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-primary)" }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6" style={{ backgroundColor: "var(--bg-base)" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
          Admin Dashboard
        </h2>
        <button
          onClick={fetchData}
          className="px-3 py-1.5 rounded text-xs"
          style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-secondary)" }}
        >
          Refresh
        </button>
      </div>

      {/* Health Section */}
      <section className="mb-6">
        <h3 className="text-sm font-medium mb-3" style={{ color: "var(--text-secondary)" }}>
          System Health
        </h3>
        {health && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 mb-3">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: statusColor(health.status) }}
              />
              <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                {health.status.toUpperCase()}
              </span>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                {new Date(health.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {Object.entries(health.checks).map(([name, check]) => (
                <div
                  key={name}
                  className="p-3 rounded-lg"
                  style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: statusColor(check.status) }}
                    />
                    <span className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                      {name}
                    </span>
                  </div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {check.latencyMs != null ? `${check.latencyMs}ms` : check.detail ?? check.status}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Usage Section */}
      <section className="mb-6">
        <h3 className="text-sm font-medium mb-3" style={{ color: "var(--text-secondary)" }}>
          Today&apos;s Usage
        </h3>
        {usage && (
          <>
            <div className="grid grid-cols-5 gap-3 mb-4">
              {[
                { label: "Active Users", value: usage.today.activeUsers },
                { label: "Sessions", value: usage.today.sessions },
                { label: "Tasks", value: usage.today.tasks },
                { label: "Tokens", value: formatTokens(usage.today.inputTokens + usage.today.outputTokens) },
                { label: "Cost", value: `$${usage.today.costUsd.toFixed(4)}` },
              ].map((item) => (
                <div
                  key={item.label}
                  className="p-3 rounded-lg text-center"
                  style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
                >
                  <div className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
                    {item.value}
                  </div>
                  <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                    {item.label}
                  </div>
                </div>
              ))}
            </div>

            {/* Top Users */}
            {usage.topUsers.length > 0 && (
              <div>
                <div className="text-xs font-medium mb-2" style={{ color: "var(--text-muted)" }}>
                  Top Users by Cost
                </div>
                <div className="space-y-1">
                  {usage.topUsers.slice(0, 5).map((u) => (
                    <div
                      key={u.userId}
                      className="flex items-center justify-between px-3 py-2 rounded text-xs"
                      style={{ backgroundColor: "var(--bg-surface)" }}
                    >
                      <span style={{ color: "var(--text-primary)" }}>{u.userId}</span>
                      <span style={{ color: "var(--text-muted)" }}>
                        {u.tasks} tasks · ${u.costUsd.toFixed(4)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* Errors Section */}
      <section className="mb-6">
        <h3 className="text-sm font-medium mb-3" style={{ color: "var(--text-secondary)" }}>
          Today&apos;s Errors
        </h3>
        {errors && (
          <>
            {/* Error summary */}
            {Object.keys(errors.summary).length > 0 && (
              <div className="flex gap-3 mb-4">
                {Object.entries(errors.summary).map(([status, count]) => (
                  <div
                    key={status}
                    className="px-3 py-1.5 rounded-full text-xs"
                    style={{
                      backgroundColor: "var(--bg-surface)",
                      border: `1px solid ${statusColor(status)}`,
                      color: "var(--text-primary)",
                    }}
                  >
                    {status}: {count}
                  </div>
                ))}
              </div>
            )}
            {Object.keys(errors.summary).length === 0 && (
              <div className="text-xs" style={{ color: "#22c55e" }}>
                No errors today
              </div>
            )}

            {/* Recent errors */}
            {errors.recent.length > 0 && (
              <div className="space-y-2 mt-3">
                {errors.recent.slice(0, 10).map((ev) => (
                  <div
                    key={ev.taskId}
                    className="p-3 rounded-lg text-xs"
                    style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono" style={{ color: "var(--text-muted)" }}>
                        {ev.taskId?.slice(0, 8)}...
                      </span>
                      <span style={{ color: statusColor(ev.status) }}>{ev.status}</span>
                    </div>
                    {ev.errorMessage && (
                      <div className="text-red-400/80 truncate">{ev.errorMessage}</div>
                    )}
                    <div className="flex items-center justify-between mt-1" style={{ color: "var(--text-muted)" }}>
                      <span>User: {ev.userId?.slice(0, 12)}</span>
                      <span>{ev.durationSeconds?.toFixed(1)}s · {new Date(ev.createdAt).toLocaleTimeString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
