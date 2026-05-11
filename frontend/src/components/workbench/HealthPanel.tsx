"use client";
import { useHealth } from "@/hooks/useQueries";

const STATUS_BADGE: Record<string, { bg: string; text: string; dot: string }> = {
  ok: { bg: "rgba(16,185,129,0.1)", text: "var(--accent-green)", dot: "var(--accent-green)" },
  degraded: { bg: "rgba(245,158,11,0.1)", text: "var(--accent-amber)", dot: "var(--accent-amber)" },
  error: { bg: "rgba(239,68,68,0.1)", text: "var(--accent-red)", dot: "var(--accent-red)" },
};

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function latencyColor(ms: number | null): string {
  if (ms === null) return "var(--text-muted)";
  if (ms > 500) return "var(--accent-red)";
  if (ms > 100) return "var(--accent-amber)";
  return "var(--accent-green)";
}

export function HealthPanel() {
  const { data: health, isLoading, error } = useHealth();
  const badge = health ? STATUS_BADGE[health.status] ?? STATUS_BADGE.degraded : null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="px-3 py-2 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs">💚</span>
          <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            健康
          </span>
        </div>
        {health && (
          <div className="flex items-center gap-2">
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              {formatUptime(health.uptime_seconds)}
            </span>
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>uptime</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {isLoading && !health && (
          <div className="text-xs text-center py-4 animate-pulse" style={{ color: "var(--text-muted)" }}>
            加载中…
          </div>
        )}
        {error && !health && (
          <div
            className="text-xs px-3 py-2 rounded-lg"
            style={{ backgroundColor: "rgba(239,68,68,0.1)", color: "var(--accent-red)" }}
          >
            ⚠️ {error.message}
          </div>
        )}

        {health && (
          <div className="space-y-3">
            {/* Overall status badge */}
            <div
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
              style={{ backgroundColor: badge!.bg }}
            >
              <span
                className="status-dot animate-pulse-dot"
                style={{ backgroundColor: badge!.dot }}
              />
              <span className="text-sm font-semibold" style={{ color: badge!.text }}>
                {health.status === "ok" ? "运行正常" : health.status === "degraded" ? "部分降级" : "异常"}
              </span>
              <span className="ml-auto text-[10px]" style={{ color: "var(--text-muted)" }}>
                v{health.version}
              </span>
            </div>

            {/* Services */}
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--text-muted)" }}>
                服务状态
              </div>
              <div
                className="rounded-xl px-3 py-2 space-y-1"
                style={{ backgroundColor: "var(--bg-elevated)" }}
              >
                {/* DB */}
                <div className="flex items-center justify-between py-1">
                  <span className="text-xs" style={{ color: "var(--text-secondary)" }}>数据库</span>
                  <div className="flex items-center gap-1.5">
                    {health.services.database.status === "ok" ? (
                      <>
                        <span className="status-dot" style={{ backgroundColor: "var(--accent-green)" }} />
                        <span className="text-xs font-mono" style={{ color: latencyColor(health.services.database.latency_ms) }}>
                          {health.services.database.latency_ms !== null
                            ? `${health.services.database.latency_ms}ms`
                            : "正常"}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="status-dot" style={{ backgroundColor: "var(--accent-red)" }} />
                        <span className="text-xs" style={{ color: "var(--accent-red)" }}>❌ 异常</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Model router */}
                <div className="flex items-center justify-between py-1">
                  <span className="text-xs" style={{ color: "var(--text-secondary)" }}>模型路由</span>
                  <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {health.services.model_router.providers.length > 0
                      ? health.services.model_router.providers.join(", ")
                      : "未配置"}
                  </span>
                </div>

                {/* Web search */}
                <div className="flex items-center justify-between py-1">
                  <span className="text-xs" style={{ color: "var(--text-secondary)" }}>网络搜索</span>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{
                      backgroundColor: health.services.web_search.status === "configured"
                        ? "rgba(16,185,129,0.1)"
                        : "var(--bg-overlay)",
                      color: health.services.web_search.status === "configured"
                        ? "var(--accent-green)"
                        : "var(--text-muted)",
                    }}
                  >
                    {health.services.web_search.status === "configured" ? "已配置" : "未配置"}
                  </span>
                </div>
              </div>
            </div>

            {/* Stats */}
            {health.stats && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--text-muted)" }}>
                  统计数据
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { label: "总任务", value: health.stats.tasks_total },
                    { label: "活跃", value: health.stats.tasks_active },
                    { label: "记忆", value: health.stats.memory_entries },
                    { label: "证据", value: health.stats.evidence_total },
                  ].map(({ label, value }) => (
                    <div
                      key={label}
                      className="rounded-xl px-3 py-2 text-center"
                      style={{ backgroundColor: "var(--bg-elevated)" }}
                    >
                      <div className="text-lg font-bold animate-count-up" style={{ color: "var(--text-primary)" }}>
                        {value ?? "—"}
                      </div>
                      <div className="text-[9px]" style={{ color: "var(--text-muted)" }}>{label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!health.stats && (
              <div className="text-xs text-center" style={{ color: "var(--text-muted)" }}>
                统计数据暂不可用（数据库未连接）
              </div>
            )}

            {/* Timestamp */}
            <div className="text-center">
              <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>
                {new Date(health.timestamp).toLocaleTimeString()}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
