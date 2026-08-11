"use client";
import { useState } from "react";
import { useTasks } from "@/hooks/useQueries";
import { timeAgo } from "@/lib/utils";
import { TaskEvidenceView } from "./TaskEvidenceView";

interface TaskItem {
  task_id: string;
  title: string;
  mode: string;
  status: string;
  updated_at: string;
}

interface TaskPanelProps {
  userId: string;
  sessionId?: string;
  onTaskSelect?: (taskId: string) => void;
  selectedTaskId?: string | null;
}

const STATUS_DOT: Record<string, { color: string; label: string }> = {
  responding: { color: "var(--accent-green)", label: "活跃" },
  completed: { color: "var(--accent-blue)", label: "完成" },
  failed: { color: "var(--accent-red)", label: "失败" },
  paused: { color: "var(--accent-amber)", label: "暂停" },
  cancelled: { color: "var(--text-muted)", label: "取消" },
};

export function TaskPanel({ userId, sessionId, onTaskSelect, selectedTaskId: selectedTaskIdProp }: TaskPanelProps) {
  const { data, isLoading, error } = useTasks(userId, sessionId);
  const tasks: TaskItem[] = data?.tasks ?? [];

  // MWT-4A: internal selection state (falls back to parent-provided prop if present).
  const [internalSelected, setInternalSelected] = useState<string | null>(null);
  const selectedTaskId = selectedTaskIdProp ?? internalSelected;

  const handleSelect = (taskId: string) => {
    const next = selectedTaskId === taskId ? null : taskId;
    setInternalSelected(next);
    onTaskSelect?.(next ?? taskId);
  };

  if (selectedTaskId) {
    return (
      <div className="flex flex-col h-full">
        <div
          className="px-3 py-2 flex items-center justify-between flex-shrink-0"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <button
            onClick={() => handleSelect(selectedTaskId)}
            className="text-xs flex items-center gap-1 transition-opacity hover:opacity-80"
            style={{ color: "var(--text-secondary)" }}
            title="返回任务列表"
          >
            ← 返回任务列表
          </button>
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            {tasks.length} 个任务
          </span>
        </div>
        <div className="flex-1 min-h-0">
          <TaskEvidenceView taskId={selectedTaskId} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="px-3 py-2 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs">📋</span>
          <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            任务
          </span>
          {tasks.length > 0 && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: "var(--bg-elevated)", color: "var(--text-muted)" }}
            >
              {tasks.length}
            </span>
          )}
        </div>
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          点击查看证据 →
        </span>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="p-4 text-xs text-center animate-pulse flex flex-col items-center gap-1" style={{ color: "var(--text-muted)" }}>
            <span className="text-base">⏳</span>
            正在加载任务…
          </div>
        )}
        {error && (
          <div
            className="mx-3 my-2 px-3 py-2 rounded-lg text-xs flex items-start gap-1.5"
            style={{ backgroundColor: "rgba(239,68,68,0.1)", color: "var(--accent-red)" }}
          >
            <span className="flex-shrink-0">⚠️</span>
            <span className="break-words">任务加载失败：{error.message}</span>
          </div>
        )}
        {!isLoading && !error && tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-1.5 px-4 text-center">
            <span className="text-2xl">📋</span>
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>暂无任务</span>
            <span className="text-[10px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
              与当前会话关联的任务会出现在这里。<br />发送消息或运行 Worker 后自动出现。
            </span>
          </div>
        )}
        {tasks.map((task) => {
          const status = STATUS_DOT[task.status] ?? { color: "var(--text-muted)", label: task.status };
          const isSelected = selectedTaskId === task.task_id;
          return (
            <button
              key={task.task_id}
              onClick={() => onTaskSelect?.(task.task_id)}
              className="w-full text-left px-3 py-2.5 transition-all group"
              style={{
                backgroundColor: isSelected ? "var(--bg-overlay)" : "transparent",
                borderBottom: "1px solid var(--border-subtle)",
                borderLeft: isSelected ? "2px solid var(--accent-blue)" : "2px solid transparent",
              }}
              title={task.title || "(无标题)"}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <span
                  className="status-dot flex-shrink-0"
                  style={{ backgroundColor: status.color }}
                  title={status.label}
                />
                <span
                  className="text-xs font-medium truncate flex-1"
                  style={{ color: isSelected ? "var(--text-primary)" : "var(--text-secondary)" }}
                >
                  {task.title || "(无标题)"}
                </span>
                <span
                  className="text-[10px] flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ color: "var(--text-muted)" }}
                >
                  {timeAgo(task.updated_at)}
                </span>
              </div>
              <div className="flex items-center gap-2 ml-2">
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                  style={{
                    backgroundColor: isSelected
                      ? "var(--accent-blue-glow)"
                      : "var(--bg-elevated)",
                    color: isSelected ? "var(--text-accent)" : "var(--text-muted)",
                  }}
                >
                  {status.label}
                </span>
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {task.mode}
                </span>
                <span className="text-[10px] ml-auto" style={{ color: "var(--text-muted)" }}>
                  {timeAgo(task.updated_at)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
