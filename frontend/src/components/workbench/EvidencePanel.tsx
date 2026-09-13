"use client";
import { useState, useEffect } from "react";
import { fetchEvidence } from "@/lib/api";
// UI-IA-CONSOLIDATION 阶段 4：展示统一由共享组件承担，与任务详情页一致。
// 本地的 EvidenceItem / SOURCE_CONFIG 定义已删除（原先 lib/constants 里还有第三份）。
import {
  EvidenceList,
  type EvidenceItem,
} from "@/components/evidence/EvidenceList";

interface EvidencePanelProps {
  taskId: string | null;
  userId: string;
  /** MWT-1: 当前 Chat Session ID — 用于 Session Context 显示 */
  sessionId?: string;
}

export function EvidencePanel({ taskId, userId, sessionId }: EvidencePanelProps) {
  const [evidences, setEvidences] = useState<EvidenceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!taskId || !userId) { setEvidences([]); setError(null); return; }
    setLoading(true);
    setError(null);
    fetchEvidence(taskId, userId)
      .then((data) => setEvidences(data.evidences ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, userId]);

  const renderContent = () => (
    <>
      <div
        className="px-3 py-2 flex-shrink-0 flex items-center justify-between"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs">🔍</span>
          <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>证据</span>
        </div>
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{evidences.length} 条</span>
      </div>

      {/* MWT-1: Session Context Active 横幅 (task + session both active) */}
      {sessionId && (
        <div
          className="mx-3 mt-2 px-3 py-1.5 rounded text-xs flex items-center gap-2 shrink-0"
          style={{
            backgroundColor: "rgba(16,185,129,0.06)",
            border: "1px solid rgba(16,185,129,0.15)",
            color: "var(--accent-green)",
          }}
        >
          <span className="text-[10px]">📋</span>
          {/* UI-IA-CONSOLIDATION 阶段 3：原为英文 "Session Context Active" */}
          <span className="text-[10px] font-medium">会话上下文已启用</span>
          <span className="text-[10px] font-mono ml-auto truncate max-w-[120px]" style={{ opacity: 0.6 }}>
            {sessionId.slice(0, 8)}…
          </span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading && <div className="p-4 text-xs text-center animate-pulse" style={{ color: "var(--text-muted)" }}>加载中…</div>}
        {error && (
          <div className="mx-3 my-2 px-3 py-2 rounded-lg text-xs flex items-center gap-2" style={{ backgroundColor: "rgba(239,68,68,0.1)", color: "var(--accent-red)" }}>
            <span className="flex-1">⚠️ {error}</span>
            <button
              type="button"
              onClick={load}
              className="px-2 py-0.5 rounded text-[10px] font-medium"
              style={{ border: "1px solid rgba(239,68,68,0.4)", color: "var(--accent-red)" }}
            >
              重试
            </button>
          </div>
        )}
        {!loading && !error && evidences.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-1">
            <span className="text-xl">🔍</span>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>此任务暂无证据记录</span>
          </div>
        )}
        <EvidenceList
          evidences={evidences}
          showTime
          maxChars={200}
          divided
          emptyText=""
        />
      </div>
    </>
  );

  if (!taskId) {
    return (
      <div className="flex flex-col h-full">
        <div
          className="px-3 py-2 flex-shrink-0 flex items-center gap-2"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <span className="text-xs">🔍</span>
          <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>证据</span>
        </div>

        {/* MWT-1: Session Context Active 横幅 */}
        {sessionId && (
          <div
            className="mx-3 mt-3 px-3 py-2 rounded-lg text-xs flex items-center gap-2"
            style={{
              backgroundColor: "rgba(16,185,129,0.08)",
              border: "1px solid rgba(16,185,129,0.2)",
              color: "var(--accent-green)",
            }}
          >
            <span className="text-sm">📋</span>
            <div className="flex-1 min-w-0">
              <div className="font-medium">Session Context Active</div>
              <div className="text-[10px] font-mono truncate" style={{ opacity: 0.7 }}>
                {sessionId}
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-4">
          {sessionId ? (
            <>
              <p className="text-xs text-center leading-relaxed" style={{ color: "var(--text-muted)" }}>
                Chat Session 已激活，Gateway 事件会在发送消息时自动收集。
              </p>
              <p className="text-[10px] text-center leading-relaxed" style={{ color: "var(--text-muted)", opacity: 0.7 }}>
                选择一个任务查看该任务关联的证据记录，或在 Chat 中发送消息触发新的事件采集。
              </p>
            </>
          ) : (
            <>
              <span className="text-xl">🔍</span>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>先选择一个任务查看证据</span>
              <span className="text-[10px]" style={{ color: "var(--text-muted)", opacity: 0.7 }}>
                或启动 Chat 会话触发事件采集
              </span>
            </>
          )}
        </div>
      </div>
    );
  }

  return <div className="flex flex-col h-full">{renderContent()}</div>;
}
