"use client";
import { useState, useEffect, useCallback } from "react";
import { getApiConfig } from "@/lib/api";

interface BetaUserStats {
  userId: string;
  totalSessions: number;
  feedback: { total: number; thumbsUp: number; thumbsDown: number; ratio: number };
  tasks: { total: number; completed: number; failed: number; cancelled: number; timedOut: number; avgDurationMs: number };
  tokens: { totalInput: number; totalOutput: number; estimatedCostUsd: number };
}

interface FeedbackEvent {
  eventType: string;
  createdAt: string;
  reason: string | null;
  queryPreview: string;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export default function BetaPanel({ userId }: { userId: string }) {
  const [stats, setStats] = useState<BetaUserStats | null>(null);
  const [feedback, setFeedback] = useState<FeedbackEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedbackFilter, setFeedbackFilter] = useState<string>("all");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { apiBase } = await getApiConfig();
      const headers = { "X-User-Id": userId };

      const [statsRes, feedbackRes] = await Promise.all([
        fetch(`${apiBase}/v1/beta/stats/${userId}`, { headers }),
        fetch(`${apiBase}/v1/beta/feedback/${userId}?limit=50`, { headers }),
      ]);

      if (!statsRes.ok) throw new Error(`Stats ${statsRes.status}`);
      if (!feedbackRes.ok) throw new Error(`Feedback ${feedbackRes.status}`);

      setStats(await statsRes.json());
      setFeedback((await feedbackRes.json()).events ?? []);
    } catch (e: any) {
      setError(e.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = feedbackFilter === "all"
    ? feedback
    : feedback.filter((f) => f.eventType === feedbackFilter);

  return (
    <div className="h-full overflow-y-auto" style={{ backgroundColor: "var(--bg-base)" }}>
      <div className="p-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
              🧪 Beta 数据面板
            </h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
              Private Beta 用户反馈与使用统计
            </p>
          </div>
          <button
            onClick={fetchData}
            className="w-8 h-8 flex items-center justify-center rounded-lg"
            style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)", color: "var(--text-muted)" }}
            title="刷新"
          >
            🔄
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 px-4 py-3 rounded-xl text-xs flex items-center gap-2" style={{ backgroundColor: "rgba(239,68,68,0.1)", color: "var(--accent-red)" }}>
            ⚠️ {error}
            <button onClick={fetchData} className="underline ml-auto">重试</button>
          </div>
        )}

        {/* Loading */}
        {loading && !stats && (
          <div className="grid grid-cols-3 gap-3 mb-5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-xl p-5 animate-pulse" style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}>
                <div className="h-8 w-20 rounded mb-2" style={{ backgroundColor: "var(--border-default)" }} />
                <div className="h-3 w-16 rounded" style={{ backgroundColor: "var(--border-subtle)" }} />
              </div>
            ))}
          </div>
        )}

        {stats && (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              <KpiCard label="总会话数" value={stats.totalSessions} color="var(--accent-blue)" />
              <KpiCard label="满意率" value={stats.feedback.ratio} unit="%" color={stats.feedback.ratio >= 70 ? "var(--accent-green)" : "var(--accent-orange)"} />
              <KpiCard label="总任务数" value={stats.tasks.total} color="var(--accent-purple)" />
            </div>

            {/* Feedback Detail */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              <KpiCard label="👍 好评" value={stats.feedback.thumbsUp} color="var(--accent-green)" />
              <KpiCard label="👎 差评" value={stats.feedback.thumbsDown} color="var(--accent-red)" />
              <KpiCard label="反馈总数" value={stats.feedback.total} color="var(--text-secondary)" />
            </div>

            {/* Task Status */}
            <div className="rounded-xl p-4 mb-5" style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}>
              <div className="text-xs font-medium mb-3" style={{ color: "var(--text-secondary)" }}>任务状态分布</div>
              <div className="flex items-center gap-4 text-xs">
                <StatusBadge label="完成" count={stats.tasks.completed} color="var(--accent-green)" />
                <StatusBadge label="失败" count={stats.tasks.failed} color="var(--accent-red)" />
                <StatusBadge label="取消" count={stats.tasks.cancelled} color="var(--text-muted)" />
                <StatusBadge label="超时" count={stats.tasks.timedOut} color="var(--accent-orange)" />
                <span className="ml-auto" style={{ color: "var(--text-muted)" }}>
                  平均耗时: {formatDuration(stats.tasks.avgDurationMs)}
                </span>
              </div>
            </div>

            {/* Token/Cost */}
            <div className="rounded-xl p-4 mb-5" style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}>
              <div className="text-xs font-medium mb-3" style={{ color: "var(--text-secondary)" }}>Token & 成本</div>
              <div className="flex items-center gap-6 text-xs">
                <span style={{ color: "var(--text-primary)" }}>
                  输入: <strong>{formatTokens(stats.tokens.totalInput)}</strong>
                </span>
                <span style={{ color: "var(--text-primary)" }}>
                  输出: <strong>{formatTokens(stats.tokens.totalOutput)}</strong>
                </span>
                <span style={{ color: "var(--text-primary)" }}>
                  总: <strong>{formatTokens(stats.tokens.totalInput + stats.tokens.totalOutput)}</strong>
                </span>
                <span className="ml-auto" style={{ color: "var(--accent-blue)" }}>
                  预估成本: <strong>${stats.tokens.estimatedCostUsd.toFixed(4)}</strong>
                </span>
              </div>
            </div>
          </>
        )}

        {/* Feedback Timeline */}
        <div className="rounded-xl p-4" style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}>
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>📝 反馈时间线</div>
            <div className="flex gap-1">
              {(["all", "thumbs_up", "thumbs_down"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFeedbackFilter(f)}
                  className="text-[10px] px-2 py-0.5 rounded-md transition-colors"
                  style={{
                    backgroundColor: feedbackFilter === f ? "var(--accent-blue)" : "var(--bg-elevated)",
                    color: feedbackFilter === f ? "white" : "var(--text-muted)",
                  }}
                >
                  {f === "all" ? "全部" : f === "thumbs_up" ? "👍 好评" : "👎 差评"}
                </button>
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="text-xs py-4 text-center" style={{ color: "var(--text-muted)" }}>
              暂无反馈数据
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((event, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-3 py-2 px-3 rounded-lg"
                  style={{ backgroundColor: "var(--bg-base)" }}
                >
                  <span className="text-sm mt-0.5">
                    {event.eventType === "thumbs_up" ? "👍" : "👎"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs truncate" style={{ color: "var(--text-primary)" }}>
                      {event.queryPreview || "(无预览)"}
                    </div>
                    {event.reason && (
                      <div className="text-[10px] mt-0.5" style={{ color: "var(--accent-red)" }}>
                        💬 {event.reason}
                      </div>
                    )}
                    <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                      {new Date(event.createdAt).toLocaleString("zh-CN")}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, unit, color }: { label: string; value: number | string; unit?: string; color: string }) {
  return (
    <div className="rounded-xl p-5 flex flex-col" style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}>
      <div className="text-3xl font-bold" style={{ color }}>
        {value}{unit && <span className="text-lg">{unit}</span>}
      </div>
      <div className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>{label}</div>
    </div>
  );
}

function StatusBadge({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
      <span style={{ color: "var(--text-secondary)" }}>{label}:</span>
      <strong style={{ color }}>{count}</strong>
    </span>
  );
}
