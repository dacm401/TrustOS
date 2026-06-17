"use client";

import { useState, useEffect } from "react";
import { fetchObservability, type ObservabilitySummary } from "@/lib/api";

interface ObservabilityPanelProps {
  userId: string;
}

export function ObservabilityPanel({ userId }: ObservabilityPanelProps) {
  const [data, setData] = useState<ObservabilitySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await fetchObservability(userId);
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [userId]);

  if (loading) {
    return (
      <div className="rounded-xl p-6" style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}>
        <div className="animate-pulse space-y-3">
          <div className="h-4 w-32 rounded" style={{ backgroundColor: "var(--bg-elevated)" }} />
          <div className="h-20 rounded" style={{ backgroundColor: "var(--bg-elevated)" }} />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl p-6" style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}>
        <p className="text-xs" style={{ color: "var(--accent-red)" }}>⚠️ 无法加载可观测性数据</p>
      </div>
    );
  }

  const { summary, cost, sessions, health } = data;
  const successRateColor =
    summary.success_rate_pct >= 95 ? "var(--accent-green)" :
    summary.success_rate_pct >= 80 ? "var(--accent-amber)" : "var(--accent-red)";
  const healthColor =
    health.overall === "healthy" ? "var(--accent-green)" :
    health.overall === "degraded" ? "var(--accent-amber)" : "var(--accent-red)";

  return (
    <div className="rounded-xl p-6" style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}>
      <h3 className="text-sm font-medium mb-4" style={{ color: "var(--text-primary)" }}>
        📊 系统可观测性
      </h3>

      {/* Health Status */}
      <div className="flex items-center gap-2 mb-4">
        <span
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: healthColor }}
        />
        <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
          系统状态：
        </span>
        <span className="text-xs" style={{ color: healthColor }}>
          {health.overall === "healthy" ? "健康" : health.overall === "degraded" ? "降级" : "异常"}
        </span>
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          (DB: {health.database === "healthy" ? "✓" : "✗"} | LLM: {health.llm_api === "healthy" ? "✓" : "✗"})
        </span>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="rounded-lg p-3" style={{ backgroundColor: "var(--bg-elevated)" }}>
          <p className="text-[10px] mb-1" style={{ color: "var(--text-muted)" }}>24h 请求</p>
          <p className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            {summary.total_requests_24h}
          </p>
        </div>
        <div className="rounded-lg p-3" style={{ backgroundColor: "var(--bg-elevated)" }}>
          <p className="text-[10px] mb-1" style={{ color: "var(--text-muted)" }}>成功率</p>
          <p className="text-lg font-semibold" style={{ color: successRateColor }}>
            {summary.success_rate_pct.toFixed(1)}%
          </p>
        </div>
        <div className="rounded-lg p-3" style={{ backgroundColor: "var(--bg-elevated)" }}>
          <p className="text-[10px] mb-1" style={{ color: "var(--text-muted)" }}>P95 延迟</p>
          <p className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            {summary.p95_duration_sec.toFixed(1)}s
          </p>
        </div>
      </div>

      {/* Cost & Tokens */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="rounded-lg p-3" style={{ backgroundColor: "var(--bg-elevated)" }}>
          <p className="text-[10px] mb-1" style={{ color: "var(--text-muted)" }}>今日成本</p>
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            ${cost.today_cost_usd.toFixed(4)}
          </p>
        </div>
        <div className="rounded-lg p-3" style={{ backgroundColor: "var(--bg-elevated)" }}>
          <p className="text-[10px] mb-1" style={{ color: "var(--text-muted)" }}>输入 Tokens</p>
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {(cost.today_input_tokens / 1000).toFixed(1)}K
          </p>
        </div>
        <div className="rounded-lg p-3" style={{ backgroundColor: "var(--bg-elevated)" }}>
          <p className="text-[10px] mb-1" style={{ color: "var(--text-muted)" }}>活跃会话</p>
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {sessions.active_24h}
          </p>
        </div>
      </div>

      {/* Failure Breakdown */}
      {summary.failure_count_24h > 0 && (
        <div className="rounded-lg p-3" style={{ backgroundColor: "rgba(239,68,68,0.08)" }}>
          <p className="text-[10px] mb-1" style={{ color: "var(--accent-red)" }}>
            ⚠️ 失败 {summary.failure_count_24h} 次 · 取消 {summary.cancelled_count_24h} 次
          </p>
          <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            平均耗时 {summary.avg_duration_sec.toFixed(1)}s
          </p>
        </div>
      )}
    </div>
  );
}
