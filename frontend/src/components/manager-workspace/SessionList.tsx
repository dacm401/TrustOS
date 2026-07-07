"use client";

import { useEffect, useState } from "react";
import { fetchAgentSessions } from "@/lib/api";
import type { AgentSession } from "@/types/dashboard";

const STATUS_LABELS: Record<string, string> = {
  planning: "规划中",
  delegated: "已委托",
  running: "执行中",
  waiting_approval: "等待审批",
  paused: "已暂停",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  rolled_back: "已回滚",
};

const STATUS_DOT: Record<string, string> = {
  planning: "⚪",
  delegated: "🔵",
  running: "🟢",
  waiting_approval: "🟡",
  paused: "⏸️",
  completed: "✅",
  failed: "🔴",
  cancelled: "❌",
  rolled_back: "↩️",
};

interface SessionListProps {
  userId: string;
  selectedSessionId: string | null;
  onSelectSession: (id: string) => void;
  refreshKey: number;
}

export function SessionList({
  userId,
  selectedSessionId,
  onSelectSession,
  refreshKey,
}: SessionListProps) {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchAgentSessions(userId, { limit: 50 })
      .then((data) => {
        if (cancelled) return;
        const list: AgentSession[] = data.sessions ?? [];
        // Sort: active first, then by created_at desc
        list.sort((a, b) => {
          const aActive = !["completed", "failed", "cancelled", "rolled_back"].includes(a.status);
          const bActive = !["completed", "failed", "cancelled", "rolled_back"].includes(b.status);
          if (aActive !== bActive) return aActive ? -1 : 1;
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });
        setSessions(list);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [userId, refreshKey]);

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ backgroundColor: "var(--bg-surface)", borderRight: "1px solid var(--border-subtle)" }}
    >
      {/* Header */}
      <div
        className="flex-shrink-0 px-3 py-3 flex items-center justify-between"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <span className="text-xs font-semibold tracking-wide" style={{ color: "var(--text-secondary)" }}>
          任务会话
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-muted)" }}>
          {sessions.length}
        </span>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-8 text-xs" style={{ color: "var(--text-muted)" }}>
            加载中...
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center py-8 text-xs px-3" style={{ color: "var(--text-error)" }}>
            {error}
          </div>
        )}

        {!loading && !error && sessions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 px-3 text-center">
            <span className="text-2xl mb-2">📋</span>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              暂无任务会话
            </span>
            <span className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>
              输入委托任务开始
            </span>
          </div>
        )}

        {sessions.map((session) => {
          const isSelected = session.id === selectedSessionId;
          const isActive = !["completed", "failed", "cancelled", "rolled_back"].includes(session.status);
          return (
            <button
              key={session.id}
              onClick={() => onSelectSession(session.id)}
              className="w-full text-left px-3 py-2.5 transition-colors border-l-2"
              style={{
                backgroundColor: isSelected ? "var(--bg-overlay)" : "transparent",
                borderLeftColor: isSelected ? "var(--accent-blue)" : "transparent",
              }}
            >
              <div className="flex items-start gap-2">
                <span className="text-xs mt-0.5 flex-shrink-0">{STATUS_DOT[session.status] ?? "⚪"}</span>
                <div className="flex-1 min-w-0">
                  <div
                    className="text-xs font-medium truncate"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {session.title || "未命名任务"}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                      {STATUS_LABELS[session.status] ?? session.status}
                    </span>
                    {session.risk_level && session.risk_level !== "low" && (
                      <span
                        className="text-[10px] px-1 py-0.5 rounded"
                        style={{
                          backgroundColor: session.risk_level === "high" ? "var(--bg-error)" : "var(--bg-warning)",
                          color: session.risk_level === "high" ? "var(--text-error)" : "var(--text-warning)",
                        }}
                      >
                        {session.risk_level === "high" ? "高风险" : session.risk_level === "medium" ? "中风险" : ""}
                      </span>
                    )}
                  </div>
                </div>
                {isActive && (
                  <span
                    className="text-[10px] px-1 py-0.5 rounded flex-shrink-0"
                    style={{ backgroundColor: "var(--bg-accent)", color: "var(--text-accent)" }}
                  >
                    进行中
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
