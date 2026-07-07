"use client";

import { useEffect, useState } from "react";
import { fetchAgentSessionDetail, fetchSessionEvents } from "@/lib/api";
import type { AgentSession, SessionEvent } from "@/types/dashboard";

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

const EVENT_ICONS: Record<string, string> = {
  session_created: "🆕",
  session_started: "▶️",
  session_completed: "✅",
  session_failed: "❌",
  session_cancelled: "🚫",
  session_paused: "⏸️",
  session_resumed: "▶️",
  delegation_created: "📤",
  delegation_accepted: "✅",
  delegation_rejected: "🚫",
  delegation_failed: "❌",
  worker_assigned: "👷",
  worker_started: "🟢",
  worker_completed: "✅",
  worker_failed: "❌",
  worker_paused: "⏸️",
  worker_resumed: "▶️",
  permission_requested: "🔐",
  permission_granted: "✅",
  permission_denied: "🚫",
  permission_expired: "⏰",
  decision_made: "🧠",
  plan_created: "📋",
  plan_updated: "📝",
  plan_executed: "⚡",
  error_occurred: "⚠️",
  risk_assessment: "🔍",
  info_logged: "📌",
};

interface SessionDetailProps {
  userId: string;
  sessionId: string | null;
  refreshKey: number;
}

export function SessionDetail({ userId, sessionId, refreshKey }: SessionDetailProps) {
  const [session, setSession] = useState<AgentSession | null>(null);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch session detail
  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      setEvents([]);
      return;
    }

    let cancelled = false;
    setSessionLoading(true);
    setError(null);

    fetchAgentSessionDetail(sessionId, userId)
      .then((data) => {
        if (cancelled) return;
        setSession(data.session ?? null);
        setSessionLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setSessionLoading(false);
      });

    return () => { cancelled = true; };
  }, [userId, sessionId]);

  // Fetch session events
  useEffect(() => {
    if (!sessionId) {
      setEvents([]);
      return;
    }

    let cancelled = false;
    setEventsLoading(true);

    fetchSessionEvents(userId, sessionId, 200)
      .then((data) => {
        if (cancelled) return;
        const list: SessionEvent[] = data.events ?? [];
        // Sort by created_at desc (newest first)
        list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        setEvents(list);
        setEventsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setEventsLoading(false);
      });

    return () => { cancelled = true; };
  }, [userId, sessionId, refreshKey]);

  if (!sessionId) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full text-center px-4"
        style={{ backgroundColor: "var(--bg-surface)" }}
      >
        <span className="text-3xl mb-3">📂</span>
        <div className="text-sm font-medium mb-1" style={{ color: "var(--text-primary)" }}>
          Session Detail
        </div>
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>
          选中一个会话查看详情和事件
        </div>
      </div>
    );
  }

  if (sessionLoading) {
    return (
      <div className="flex items-center justify-center h-full" style={{ backgroundColor: "var(--bg-surface)" }}>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>加载中...</span>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="flex items-center justify-center h-full" style={{ backgroundColor: "var(--bg-surface)" }}>
        <span className="text-xs" style={{ color: "var(--text-error)" }}>{error || "Session 未找到"}</span>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ backgroundColor: "var(--bg-surface)", borderLeft: "1px solid var(--border-subtle)" }}
    >
      {/* Session summary header */}
      <div
        className="flex-shrink-0 px-4 py-3"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
            {session.title || "未命名"}
          </span>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0"
            style={{
              backgroundColor: session.status === "completed" ? "var(--bg-success)" :
                session.status === "failed" ? "var(--bg-error)" :
                "var(--bg-overlay)",
              color: session.status === "completed" ? "var(--text-success)" :
                session.status === "failed" ? "var(--text-error)" :
                "var(--text-muted)",
            }}
          >
            {STATUS_LABELS[session.status] ?? session.status}
          </span>
        </div>

        {session.goal && (
          <div className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>
            🎯 {session.goal}
          </div>
        )}

        <div className="flex gap-3 text-[10px]" style={{ color: "var(--text-muted)" }}>
          {session.risk_level && (
            <span>
              风险:{" "}
              <span style={{
                color: session.risk_level === "high" ? "var(--text-error)" :
                  session.risk_level === "medium" ? "var(--text-warning)" :
                  "var(--text-muted)"
              }}>
                {session.risk_level === "high" ? "高" : session.risk_level === "medium" ? "中" : "低"}
              </span>
            </span>
          )}
          <span>ID: {session.id.slice(0, 8)}...</span>
          <span>{new Date(session.created_at).toLocaleDateString()}</span>
        </div>

        {/* Delegation Contract summary */}
        {session.delegation_contract && Object.keys(session.delegation_contract).length > 0 && (
          <div
            className="mt-2 rounded p-2 text-[10px]"
            style={{ backgroundColor: "var(--bg-base)", color: "var(--text-muted)" }}
          >
            <div className="font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
              📜 Delegation Contract
            </div>
            {session.delegation_contract.allowed != null && (
              <div className="mb-0.5">✅ 允许: {String(session.delegation_contract.allowed)}</div>
            )}
            {session.delegation_contract.denied != null && (
              <div className="mb-0.5">🚫 禁止: {String(session.delegation_contract.denied)}</div>
            )}
            {session.delegation_contract.requiresApproval != null && (
              <div>🔐 需审批: {String(session.delegation_contract.requiresApproval)}</div>
            )}
          </div>
        )}
      </div>

      {/* Events timeline */}
      <div className="flex-1 overflow-y-auto">
        <div
          className="flex-shrink-0 px-4 py-2 text-[10px] font-semibold tracking-wide sticky top-0 z-10"
          style={{
            backgroundColor: "var(--bg-surface)",
            color: "var(--text-secondary)",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          事件时间线 ({events.length})
        </div>

        {eventsLoading && (
          <div className="flex items-center justify-center py-8 text-xs" style={{ color: "var(--text-muted)" }}>
            加载事件...
          </div>
        )}

        {!eventsLoading && events.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center px-4">
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              暂无事件
            </span>
          </div>
        )}

        {events.map((event) => (
          <div
            key={event.id}
            className="px-4 py-2"
            style={{ borderBottom: "1px solid var(--border-subtle)" }}
          >
            <div className="flex items-start gap-2">
              <span className="text-xs mt-0.5 flex-shrink-0">
                {EVENT_ICONS[event.type] ?? "📌"}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-medium" style={{ color: "var(--text-primary)" }}>
                    {event.type}
                  </span>
                  {event.visibility !== "session_timeline" && (
                    <span
                      className="text-[9px] px-1 py-0.5 rounded"
                      style={{
                        backgroundColor: event.visibility === "critical_alert" ? "var(--bg-error)" :
                          event.visibility === "approval_required" ? "var(--bg-warning)" :
                          "var(--bg-overlay)",
                        color: event.visibility === "critical_alert" ? "var(--text-error)" :
                          event.visibility === "approval_required" ? "var(--text-warning)" :
                          "var(--text-muted)",
                      }}
                    >
                      {event.visibility}
                    </span>
                  )}
                </div>
                <div className="text-[10px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
                  {event.summary}
                </div>
                <div className="text-[9px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                  {new Date(event.created_at).toLocaleTimeString()}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
