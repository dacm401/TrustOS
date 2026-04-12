"use client";
import { useState, useEffect } from "react";
import { fetchDecision } from "@/lib/api";

interface DecisionData {
  decision: {
    routing?: {
      selected_model?: string;
      selected_role?: string;
      fast_score?: number;
      slow_score?: number;
      confidence?: number;
      selection_reason?: string;
    };
    execution?: {
      model_used?: string;
      exec_input_tokens?: number;
      exec_output_tokens?: number;
      total_cost_usd?: number;
      latency_ms?: number;
      did_fallback?: boolean;
    };
    context?: {
      context_original_tokens?: number;
      context_compressed_tokens?: number;
      compression_ratio?: number;
    };
    intent?: string;
    complexity_score?: number;
  };
}

interface DebugPanelProps {
  taskId: string | null;
  userId: string;
}

export function DebugPanel({ taskId, userId }: DebugPanelProps) {
  const [data, setData] = useState<DecisionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!taskId) {
      setData(null);
      setNotFound(false);
      return;
    }
    setLoading(true);
    setError(null);
    setNotFound(false);
    fetchDecision(taskId, userId)
      .then((res) => {
        // 404 → not found, but not an error
        if (res.error && String(res.status) === "404") {
          setNotFound(true);
        } else {
          setData(res as DecisionData);
        }
      })
      .catch((e: Error) => {
        // network/server error
        setError(e.message);
      })
      .finally(() => setLoading(false));
  }, [taskId, userId]);

  if (!taskId) {
    return (
      <div className="flex flex-col h-full">
        <div
          className="px-3 py-2 flex-shrink-0 flex items-center gap-2"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <span className="text-xs">🔧</span>
          <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            调试
          </span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <span className="text-2xl">🔧</span>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            发送消息后查看调试信息
          </span>
        </div>
      </div>
    );
  }

  const d = data?.decision;

  return (
    <div className="flex flex-col h-full">
      <div
        className="px-3 py-2 flex-shrink-0 flex items-center justify-between"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs">🔧</span>
          <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            调试
          </span>
        </div>
        {d?.execution && (
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            {d.execution.latency_ms ? `${d.execution.latency_ms}ms` : ""}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {loading && (
          <div className="space-y-3 animate-pulse">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 rounded-lg" style={{ backgroundColor: "var(--bg-elevated)" }} />
            ))}
          </div>
        )}

        {error && (
          <div className="px-2 py-2 rounded-lg text-xs" style={{ backgroundColor: "rgba(239,68,68,0.1)", color: "var(--accent-red)" }}>
            ⚠️ {error}
          </div>
        )}

        {notFound && !loading && (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <span className="text-xl">🔧</span>
            <span className="text-xs text-center" style={{ color: "var(--text-muted)" }}>
              此任务暂无决策数据
            </span>
          </div>
        )}

        {d && !loading && (
          <div className="space-y-3">
            {/* Intent & Complexity */}
            {d.intent !== undefined && (
              <div className="rounded-lg p-2.5" style={{ backgroundColor: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
                <div className="text-[10px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--text-muted)" }}>
                  意图分析
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="text-[10px] px-2 py-0.5 rounded font-medium"
                    style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-accent)" }}
                  >
                    {d.intent}
                  </span>
                  {d.complexity_score !== undefined && (
                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                      复杂度 {d.complexity_score}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Routing */}
            {d.routing && (
              <div className="rounded-lg p-2.5" style={{ backgroundColor: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
                <div className="text-[10px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--text-muted)" }}>
                  路由决策
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[10px] px-2 py-0.5 rounded font-medium"
                      style={{ backgroundColor: "rgba(59,130,246,0.15)", color: "var(--accent-blue)" }}
                    >
                      {d.routing.selected_model?.split("/").pop() ?? d.routing.selected_model ?? "—"}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-muted)" }}>
                      {d.routing.selected_role === "fast" ? "⚡ 快速" : "🧠 深度"}
                    </span>
                  </div>
                  {d.routing.confidence !== undefined && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>置信度</span>
                        <span className="text-[10px] font-medium" style={{ color: "var(--accent-blue)" }}>
                          {(d.routing.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: "var(--border-subtle)" }}>
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${(d.routing.confidence * 100).toFixed(0)}%`, backgroundColor: "var(--accent-blue)" }}
                        />
                      </div>
                    </div>
                  )}
                  {d.routing.fast_score !== undefined && d.routing.slow_score !== undefined && (
                    <div className="flex items-center gap-3 text-[10px]">
                      <span style={{ color: "var(--accent-amber)" }}>⚡ {(d.routing.fast_score ?? 0).toFixed(2)}</span>
                      <span style={{ color: "var(--text-muted)" }}>/</span>
                      <span style={{ color: "var(--accent-purple)" }}>🧠 {(d.routing.slow_score ?? 0).toFixed(2)}</span>
                    </div>
                  )}
                  {d.routing.selection_reason && (
                    <p className="text-[10px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
                      {d.routing.selection_reason}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Token / Cost */}
            {d.execution && (
              <div className="rounded-lg p-2.5" style={{ backgroundColor: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
                <div className="text-[10px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--text-muted)" }}>
                  执行统计
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: "Prompt", value: d.execution.exec_input_tokens, color: "var(--accent-amber)" },
                    { label: "Completion", value: d.execution.exec_output_tokens, color: "var(--accent-green)" },
                    { label: "Total", value: (d.execution.exec_input_tokens ?? 0) + (d.execution.exec_output_tokens ?? 0), color: "var(--text-accent)" },
                  ].map((stat) => (
                    <div key={stat.label} className="text-center">
                      <div className="text-sm font-bold font-mono" style={{ color: stat.color }}>
                        {stat.value !== undefined ? stat.value.toLocaleString() : "—"}
                      </div>
                      <div className="text-[9px]" style={{ color: "var(--text-muted)" }}>{stat.label}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 pt-2" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>费用</span>
                    <span className="text-[10px] font-mono" style={{ color: "var(--accent-green)" }}>
                      ${(d.execution.total_cost_usd ?? 0).toFixed(6)}
                    </span>
                  </div>
                  {d.execution.total_cost_usd !== undefined && (
                    <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ backgroundColor: "var(--border-subtle)" }}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          background: "linear-gradient(90deg, var(--accent-green) 0%, var(--accent-amber) 60%, var(--accent-red) 100%)",
                          width: `${Math.min(100, (d.execution.total_cost_usd ?? 0) * 100000)}%`,
                          minWidth: d.execution.total_cost_usd ? "2px" : "0",
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Context compression */}
            {d.context && (d.context.compression_ratio ?? 0) > 0 && (
              <div className="rounded-lg p-2.5" style={{ backgroundColor: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
                <div className="text-[10px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--text-muted)" }}>
                  上下文压缩
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                    {d.context.context_original_tokens ?? 0}
                  </span>
                  <span style={{ color: "var(--text-muted)" }}>→</span>
                  <span className="text-xs font-mono font-bold" style={{ color: "var(--accent-green)" }}>
                    {d.context.context_compressed_tokens ?? 0}
                  </span>
                  <span
                    className="ml-auto text-[10px] px-1.5 py-0.5 rounded font-medium"
                    style={{ backgroundColor: "rgba(16,185,129,0.15)", color: "var(--accent-green)" }}
                  >
                    省 {Math.round((d.context.compression_ratio ?? 0) * 100)}%
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
