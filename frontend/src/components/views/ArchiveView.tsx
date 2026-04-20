"use client";
import { useState, useEffect, useCallback } from "react";
import {
  fetchArchivesBySession,
  deleteArchive,
  updateArchiveStatus,
  type ArchiveEntry,
} from "@/lib/archive-api";

const STATUS_STYLES: Record<string, { bg: string; text: string; border: string; label: string }> = {
  pending:   { bg: "rgba(148,163,184,0.15)", text: "#94a3b8", border: "rgba(148,163,184,0.4)", label: "等待中" },
  running:   { bg: "rgba(59,130,246,0.15)", text: "#60a5fa", border: "rgba(59,130,246,0.4)", label: "执行中" },
  done:      { bg: "rgba(16,185,129,0.15)", text: "#34d399", border: "rgba(16,185,129,0.4)", label: "已完成" },
  failed:    { bg: "rgba(239,68,68,0.15)",  text: "#f87171", border: "rgba(239,68,68,0.4)",  label: "失败" },
  cancelled: { bg: "rgba(245,158,11,0.15)", text: "#fbbf24", border: "rgba(245,158,11,0.4)", label: "已取消" },
};

const ACTION_ICONS: Record<string, string> = {
  web_search: "🔍",
  execute: "⚡",
  code: "💻",
  reasoning: "🧠",
  clarify: "❓",
  default: "📋",
};

function getActionIcon(action: string): string {
  const key = Object.keys(ACTION_ICONS).find((k) => action.toLowerCase().includes(k));
  return key ? ACTION_ICONS[key] : ACTION_ICONS.default;
}

function relativeTime(dateStr: string): string {
  if (!dateStr) return "—";
  const now = Date.now();
  const diff = now - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return "刚刚";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

function ArchiveCard({ entry, onDelete, onStatusChange }: {
  entry: ArchiveEntry;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, status: ArchiveEntry["status"]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const statusStyle = STATUS_STYLES[entry.status] ?? STATUS_STYLES.pending;

  const canDelete = ["done", "failed", "cancelled"].includes(entry.status);

  const handleDelete = () => {
    if (!window.confirm(`确定删除任务档案「${entry.command.task.slice(0, 30)}...」？`)) return;
    onDelete(entry.id);
  };

  return (
    <div
      className="rounded-xl transition-all duration-150 cursor-pointer"
      style={{
        backgroundColor: hovered ? "var(--bg-elevated)" : "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => setExpanded((v) => !v)}
    >
      {/* Card header */}
      <div className="flex items-start gap-3 p-4">
        {/* Action icon */}
        <span className="text-2xl flex-shrink-0 mt-0.5">
          {getActionIcon(entry.command.action)}
        </span>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Task title */}
          <div className="text-sm font-medium leading-snug mb-1.5" style={{ color: "var(--text-primary)" }}>
            {entry.command.task.length > 80
              ? entry.command.task.slice(0, 80) + "…"
              : entry.command.task}
          </div>

          {/* Meta row */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Status badge */}
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium flex-shrink-0"
              style={{
                backgroundColor: statusStyle.bg,
                color: statusStyle.text,
                border: `1px solid ${statusStyle.border}`,
              }}
            >
              {statusStyle.label}
            </span>

            {/* Action badge */}
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium"
              style={{
                backgroundColor: "rgba(99,102,241,0.12)",
                color: "#a5b4fc",
                border: "1px solid rgba(99,102,241,0.3)",
              }}
            >
              {entry.command.action}
            </span>

            {/* User input preview */}
            {entry.user_input && (
              <span
                className="text-[10px] truncate max-w-[200px]"
                style={{ color: "var(--text-muted)" }}
              >
                💬 {entry.user_input.slice(0, 40)}{entry.user_input.length > 40 ? "…" : ""}
              </span>
            )}

            {/* Time */}
            <span className="text-[10px] ml-auto" style={{ color: "var(--text-muted)" }}>
              {relativeTime(entry.created_at)}
            </span>
          </div>
        </div>

        {/* Expand arrow */}
        <span
          className="text-xs flex-shrink-0 transition-transform duration-200"
          style={{ color: "var(--text-muted)", transform: expanded ? "rotate(180deg)" : "none" }}
        >
          ▼
        </span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div
          className="px-4 pb-4 pt-0"
          onClick={(e) => e.stopPropagation()}
          style={{ borderTop: "1px solid var(--border-subtle)" }}
        >
          {/* Observations */}
          {entry.observations.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] font-medium mb-1.5" style={{ color: "var(--text-muted)" }}>
                📡 观察记录 ({entry.observations.length})
              </div>
              <div className="space-y-1.5">
                {entry.observations.map((obs, i) => (
                  <div
                    key={i}
                    className="text-xs p-2 rounded-lg"
                    style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-secondary)" }}
                  >
                    <span className="text-[10px] mr-2" style={{ color: "var(--text-muted)" }}>
                      {relativeTime(new Date(obs.timestamp).toISOString())}
                    </span>
                    {obs.observation}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Execution result */}
          {entry.execution && (
            <div className="mt-3">
              <div className="text-[10px] font-medium mb-1.5" style={{ color: "var(--text-muted)" }}>
                ⚙️ 执行结果
              </div>
              <div
                className="text-xs p-2 rounded-lg"
                style={{
                  backgroundColor:
                    entry.execution.status === "done"
                      ? "rgba(16,185,129,0.08)"
                      : "rgba(239,68,68,0.08)",
                  color: "var(--text-secondary)",
                }}
              >
                <div className="mb-1">
                  <span className="font-medium">状态：</span>
                  {entry.execution.status}
                </div>
                {entry.execution.result && (
                  <div className="mb-1">
                    <span className="font-medium">结果：</span>
                    {entry.execution.result.slice(0, 200)}
                    {entry.execution.result.length > 200 ? "…" : ""}
                  </div>
                )}
                {entry.execution.errors && entry.execution.errors.length > 0 && (
                  <div style={{ color: "#f87171" }}>
                    <span className="font-medium">错误：</span>
                    {entry.execution.errors.join("; ")}
                  </div>
                )}
                {entry.execution.deviations && entry.execution.deviations.length > 0 && (
                  <div style={{ color: "#fbbf24" }}>
                    <span className="font-medium">偏差：</span>
                    {entry.execution.deviations.join("; ")}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Constraints */}
          {entry.constraints.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] font-medium mb-1" style={{ color: "var(--text-muted)" }}>
                🔒 约束条件
              </div>
              <div className="flex flex-wrap gap-1">
                {entry.constraints.map((c, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 rounded-md text-[10px]"
                    style={{
                      backgroundColor: "rgba(245,158,11,0.1)",
                      color: "#fcd34d",
                      border: "1px solid rgba(245,158,11,0.3)",
                    }}
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="mt-3 flex items-center gap-2 justify-end">
            {/* Status change (for pending/running) */}
            {["pending", "running"].includes(entry.status) && (
              <button
                onClick={() => {
                  const next = entry.status === "pending" ? "running" : "done";
                  onStatusChange(entry.id, next as ArchiveEntry["status"]);
                }}
                className="px-3 py-1 rounded-lg text-xs font-medium transition-opacity hover:opacity-80"
                style={{
                  backgroundColor: "rgba(59,130,246,0.2)",
                  color: "#60a5fa",
                  border: "1px solid rgba(59,130,246,0.4)",
                }}
              >
                {entry.status === "pending" ? "▶ 改为执行中" : "✓ 标记完成"}
              </button>
            )}

            {/* Delete */}
            {canDelete && (
              <button
                onClick={handleDelete}
                className="px-3 py-1 rounded-lg text-xs font-medium transition-opacity hover:opacity-80"
                style={{
                  backgroundColor: "rgba(239,68,68,0.1)",
                  color: "#f87171",
                  border: "1px solid rgba(239,68,68,0.3)",
                }}
              >
                🗑 删除
              </button>
            )}
          </div>

          {/* Metadata footer */}
          <div className="mt-2 text-[9px] flex gap-4" style={{ color: "var(--text-muted)" }}>
            <span>Session: {entry.session_id.slice(0, 12)}…</span>
            <span>Turn: #{entry.turn_id}</span>
            <span>Created: {new Date(entry.created_at).toLocaleString("zh-CN")}</span>
          </div>
        </div>
      )}
    </div>
  );
}

interface ArchiveViewProps {
  /** 当前选中的 session，用于加载该 session 的档案 */
  sessionId: string;
  userId: string;
  onSessionArchiveCount?: (count: number) => void;
}

export default function ArchiveView({ sessionId, userId, onSessionArchiveCount }: ArchiveViewProps) {
  const [archives, setArchives] = useState<ArchiveEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ArchiveEntry["status"] | "all">("all");

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchArchivesBySession(sessionId, userId);
      setArchives(data.entries);
      onSessionArchiveCount?.(data.count);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [sessionId, userId, onSessionArchiveCount]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async (id: string) => {
    try {
      await deleteArchive(id, userId);
      setArchives((prev) => prev.filter((a) => a.id !== id));
      onSessionArchiveCount?.(archives.length - 1);
    } catch (e: any) {
      window.alert(`删除失败：${e.message}`);
    }
  };

  const handleStatusChange = async (id: string, status: ArchiveEntry["status"]) => {
    try {
      await updateArchiveStatus(id, userId, status);
      setArchives((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
    } catch (e: any) {
      window.alert(`更新状态失败：${e.message}`);
    }
  };

  const filtered = filter === "all" ? archives : archives.filter((a) => a.status === filter);

  const counts = {
    all: archives.length,
    pending: archives.filter((a) => a.status === "pending").length,
    running: archives.filter((a) => a.status === "running").length,
    done: archives.filter((a) => a.status === "done").length,
    failed: archives.filter((a) => a.status === "failed").length,
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-5 pt-4 pb-2">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
              📦 任务档案
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
              {sessionId ? `Session: ${sessionId.slice(0, 16)}…` : "请从 Chat 选择一个 Session"}
            </p>
          </div>
          <button
            onClick={load}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80"
            style={{
              backgroundColor: "var(--bg-overlay)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            🔄 刷新
          </button>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1.5">
          {([
            ["all", "全部"],
            ["pending", `等待 ${counts.pending > 0 ? `(${counts.pending})` : ""}`],
            ["running", `执行中 ${counts.running > 0 ? `(${counts.running})` : ""}`],
            ["done", `完成 ${counts.done > 0 ? `(${counts.done})` : ""}`],
            ["failed", `失败 ${counts.failed > 0 ? `(${counts.failed})` : ""}`],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className="px-2.5 py-1 rounded-lg text-xs font-medium transition-all"
              style={{
                backgroundColor: filter === key ? "var(--accent-blue)" : "transparent",
                color: filter === key ? "#fff" : "var(--text-muted)",
                border: `1px solid ${filter === key ? "var(--accent-blue)" : "var(--border-subtle)"}`,
                opacity: filter === key ? 1 : 0.75,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 pb-4">
        {!sessionId ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <span className="text-4xl mb-3">💬</span>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              请先在左侧 Chat 选择一个对话 Session
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              Archive 会显示该 Session 下的所有任务档案
            </p>
          </div>
        ) : loading ? (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "var(--accent-blue)", borderTopColor: "transparent" }} />
            <p className="text-xs mt-3" style={{ color: "var(--text-muted)" }}>加载中…</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <span className="text-2xl mb-2">⚠️</span>
            <p className="text-xs" style={{ color: "#f87171" }}>{error}</p>
            <button
              onClick={load}
              className="mt-2 px-3 py-1 rounded-lg text-xs"
              style={{ backgroundColor: "rgba(239,68,68,0.1)", color: "#f87171" }}
            >
              重试
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <span className="text-4xl mb-3">📭</span>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {filter === "all" ? "暂无档案记录" : `没有「${filter}」状态的档案`}
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              在 Chat 中发起任务后，档案会自动生成
            </p>
          </div>
        ) : (
          <div className="space-y-2 pt-1">
            {filtered.map((entry) => (
              <ArchiveCard
                key={entry.id}
                entry={entry}
                onDelete={handleDelete}
                onStatusChange={handleStatusChange}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
