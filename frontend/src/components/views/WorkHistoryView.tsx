"use client";

// RFC-002 Phase 2: unified work-history / audit timeline.
// Shows a single merged feed across conversation_turns (original text),
// manager_messages (Manager's processed prompt), task_commands (brief sent to
// worker) and task_worker_results (worker result), with full-text search.

import { useState, useEffect, useCallback } from "react";
import { fetchWorkHistory, type WorkHistoryItem, type WorkHistoryResponse } from "@/lib/api";
import { useDebounce } from "@/lib/useDebounce";

const TYPE_LABEL: Record<string, string> = {
  message: "对话原文",
  manager_prompt: "Manager 加工",
  dispatch: "派发任务",
  result: "Worker 结果",
  archive: "任务归档",
};

const TYPE_COLOR: Record<string, string> = {
  message: "var(--accent-blue)",
  manager_prompt: "#a855f7",
  dispatch: "#f59e0b",
  result: "#10b981",
  archive: "#64748b",
};

const TYPE_FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "message", label: "对话原文" },
  { key: "manager_prompt", label: "Manager 加工" },
  { key: "dispatch", label: "派发任务" },
  { key: "result", label: "Worker 结果" },
  { key: "archive", label: "任务归档" },
];

function shortId(id: string | null): string {
  return id ? id.slice(0, 8) : "";
}

export function WorkHistoryView({ userId }: { userId: string }) {
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [items, setItems] = useState<WorkHistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 5F2 前端流畅度: 搜索输入防抖，避免每次按键都整页 refetch。
  const debouncedQ = useDebounce(q, 300);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res: WorkHistoryResponse = await fetchWorkHistory(userId, {
        q: debouncedQ || undefined,
        limit: 100,
        offset: 0,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (e: any) {
      setError(e?.message ?? "加载失败");
    } finally {
      setLoading(false);
    }
  }, [userId, debouncedQ]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = typeFilter === "all" ? items : items.filter((it) => it.type === typeFilter);

  return (
    <div className="h-full overflow-auto p-4">
      <div className="flex items-center gap-2 mb-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="全文搜索工作历史（原文 / Manager 加工 / 派发任务 / 结果）…"
          className="flex-1 px-3 py-2 rounded-lg text-sm"
          style={{
            backgroundColor: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            color: "var(--text-primary)",
          }}
        />
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {total} 条
        </span>
      </div>

      {/* Type filter chips (RFC-002 菜单收敛：归档并入此处作为子视图) */}
      <div className="flex flex-wrap gap-1 mb-3">
        {TYPE_FILTERS.map((f) => {
          const active = typeFilter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setTypeFilter(f.key)}
              className="px-2 py-0.5 rounded-full text-[10px] transition-colors"
              style={{
                backgroundColor: active ? "var(--bg-overlay)" : "transparent",
                color: active ? "var(--text-accent)" : "var(--text-muted)",
                border: `1px solid ${active ? "var(--border-default)" : "var(--border-subtle)"}`,
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="text-xs mb-2" style={{ color: "#ef4444" }}>
          {error}
        </div>
      )}
      {loading && (
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>
          加载中…
        </div>
      )}

      <div className="vlist flex flex-col gap-2">
        {filtered.map((it) => (
          <div
            key={`${it.type}-${it.id}`}
            className="rounded-lg p-3"
            style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
          >
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span
                className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ backgroundColor: TYPE_COLOR[it.type] ?? "var(--accent-blue)", color: "white" }}
              >
                {TYPE_LABEL[it.type] ?? it.type}
              </span>
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                {new Date(it.created_at).toLocaleString()}
              </span>
              {it.session_id && (
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  会话 {shortId(it.session_id)}
                </span>
              )}
              {it.task_id && (
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  任务 {shortId(it.task_id)}
                </span>
              )}
              {it.status && (
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  [{it.status}]
                </span>
              )}
            </div>

            <div className="text-xs whitespace-pre-wrap" style={{ color: "var(--text-primary)" }}>
              {it.type === "message" || it.type === "manager_prompt" || it.type === "archive" ? (
                it.content ?? ""
              ) : it.type === "dispatch" ? (
                <pre className="text-[11px] overflow-auto max-h-48">
                  {JSON.stringify(it.payload_json, null, 2)}
                </pre>
              ) : it.summary ? (
                it.summary
              ) : (
                <pre className="text-[11px] overflow-auto max-h-48">
                  {JSON.stringify(it.result_json, null, 2)}
                </pre>
              )}
            </div>
          </div>
        ))}
        {!loading && filtered.length === 0 && (
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            {typeFilter === "all"
              ? "暂无记录。在对话里委派任务后，这里会串起「原文 → Manager 加工 → 派发任务 → 结果 → 归档」。"
              : "该类型下暂无记录。"}
          </div>
        )}
      </div>
    </div>
  );
}
