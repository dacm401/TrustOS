"use client";
import { useState, useEffect, useCallback } from "react";
import {
  fetchPendingPermissions,
  fetchPermissionsByTask,
  approvePermission,
  denyPermission,
  fetchActiveWorkspaces,
  type PermissionRequest,
  type TaskWorkspace,
} from "@/lib/api";

// ── Badge helpers ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; bg: string; label: string }> = {
    pending:  { color: "var(--accent-yellow, #f59e0b)", bg: "rgba(245,158,11,0.1)",  label: "待审批" },
    approved: { color: "var(--accent-green)",           bg: "rgba(16,185,129,0.1)",  label: "已允许" },
    denied:   { color: "var(--accent-red, #ef4444)",    bg: "rgba(239,68,68,0.1)",   label: "已拒绝" },
    expired:  { color: "var(--text-muted)",             bg: "var(--bg-elevated)",    label: "已过期" },
  };
  const s = map[status] ?? map.expired;
  return (
    <span
      className="text-[10px] px-2 py-0.5 rounded-full font-medium"
      style={{ color: s.color, backgroundColor: s.bg }}
    >
      {s.label}
    </span>
  );
}

function SensitivityBadge({ level }: { level: string }) {
  const map: Record<string, { color: string; label: string }> = {
    BLOCKED:   { color: "var(--accent-red, #ef4444)",    label: "🚫 禁止" },
    IMPORTANT: { color: "var(--accent-yellow, #f59e0b)", label: "⚠️ 重要" },
    NECESSARY: { color: "var(--accent-green)",           label: "✅ 必要" },
  };
  const s = map[level] ?? { color: "var(--text-muted)", label: level };
  return (
    <span className="text-[10px] font-semibold" style={{ color: s.color }}>
      {s.label}
    </span>
  );
}

// ── Permission Card ──────────────────────────────────────────────────────────

function PermissionCard({
  req,
  onApprove,
  onDeny,
}: {
  req: PermissionRequest;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const isPending = req.status === "pending";

  const handle = async (action: "approve" | "deny") => {
    setLoading(true);
    try {
      if (action === "approve") await onApprove(req.id);
      else await onDeny(req.id);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="rounded-xl p-4 mb-3 transition-all"
      style={{
        backgroundColor: "var(--bg-surface)",
        border: isPending
          ? "1px solid rgba(245,158,11,0.4)"
          : "1px solid var(--border-subtle)",
      }}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
              🔑 {req.field_name}
            </span>
            <StatusBadge status={req.status} />
          </div>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            Worker: <span style={{ color: "var(--text-secondary)" }}>{req.worker_id}</span>
            {" · "}
            Task: <span style={{ color: "var(--text-secondary)" }}>{req.task_id.slice(0, 8)}…</span>
          </div>
        </div>

        {/* Action buttons — only when pending */}
        {isPending && (
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={() => handle("approve")}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{
                backgroundColor: "rgba(16,185,129,0.15)",
                color: "var(--accent-green)",
                border: "1px solid rgba(16,185,129,0.3)",
              }}
            >
              {loading ? "…" : "允许"}
            </button>
            <button
              onClick={() => handle("deny")}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{
                backgroundColor: "rgba(239,68,68,0.1)",
                color: "var(--accent-red, #ef4444)",
                border: "1px solid rgba(239,68,68,0.2)",
              }}
            >
              {loading ? "…" : "拒绝"}
            </button>
          </div>
        )}
      </div>

      {/* Purpose */}
      <div
        className="text-xs rounded-lg px-3 py-2 mb-2 leading-relaxed"
        style={{ backgroundColor: "var(--bg-elevated)", color: "var(--text-secondary)" }}
      >
        <span style={{ color: "var(--text-muted)" }}>用途：</span>
        {req.purpose}
      </div>

      {/* Preview + meta */}
      <div className="flex items-center gap-3 flex-wrap">
        {req.value_preview && (
          <span className="text-[10px] px-2 py-0.5 rounded font-mono" style={{ backgroundColor: "var(--bg-elevated)", color: "var(--text-muted)" }}>
            预览：{req.value_preview}
          </span>
        )}
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          {new Date(req.created_at).toLocaleString("zh-CN")}
        </span>
        {req.resolved_at && (
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            处理：{new Date(req.resolved_at).toLocaleString("zh-CN")}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Workspace Card ───────────────────────────────────────────────────────────

function WorkspaceCard({ ws }: { ws: TaskWorkspace }) {
  const [expanded, setExpanded] = useState(false);
  const outputKeys = Object.keys(ws.shared_outputs ?? {});

  return (
    <div
      className="rounded-xl p-4 mb-3"
      style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
            🗂️ {ws.objective}
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
            Task {ws.task_id.slice(0, 8)}… · {new Date(ws.updated_at).toLocaleString("zh-CN")}
          </div>
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs px-2 py-1 rounded-lg flex-shrink-0"
          style={{ color: "var(--text-muted)", backgroundColor: "var(--bg-elevated)" }}
        >
          {expanded ? "收起" : "展开"}
        </button>
      </div>

      {/* Constraints */}
      {ws.constraints && ws.constraints.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {ws.constraints.map((c, i) => (
            <span
              key={i}
              className="text-[10px] px-2 py-0.5 rounded-full"
              style={{ backgroundColor: "rgba(59,130,246,0.1)", color: "var(--accent-blue)" }}
            >
              {c}
            </span>
          ))}
        </div>
      )}

      {/* Outputs summary */}
      <div className="text-[10px] mb-1" style={{ color: "var(--text-muted)" }}>
        {outputKeys.length === 0
          ? "暂无 Worker 产出"
          : `${outputKeys.length} 个 Worker 产出：${outputKeys.join("、")}`}
      </div>

      {/* Expanded: raw JSON outputs */}
      {expanded && outputKeys.length > 0 && (
        <div className="mt-2 space-y-2">
          {outputKeys.map((key) => (
            <div
              key={key}
              className="rounded-lg p-2"
              style={{ backgroundColor: "var(--bg-elevated)" }}
            >
              <div className="text-[10px] font-semibold mb-1" style={{ color: "var(--accent-blue)" }}>
                {key}
              </div>
              <pre
                className="text-[10px] leading-relaxed whitespace-pre-wrap break-all"
                style={{ color: "var(--text-secondary)" }}
              >
                {JSON.stringify(ws.shared_outputs[key], null, 2)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main View ────────────────────────────────────────────────────────────────

type Tab = "pending" | "history" | "workspaces";

interface PermissionsViewProps {
  userId: string;
}

export default function PermissionsView({ userId }: PermissionsViewProps) {
  const [tab, setTab] = useState<Tab>("pending");
  const [pendingReqs, setPendingReqs] = useState<PermissionRequest[]>([]);
  const [historyReqs, setHistoryReqs] = useState<PermissionRequest[]>([]);
  const [workspaces, setWorkspaces] = useState<TaskWorkspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pendRes, wsRes] = await Promise.all([
        fetchPendingPermissions(userId),
        fetchActiveWorkspaces(userId),
      ]);
      setPendingReqs(pendRes.requests ?? []);
      setWorkspaces(wsRes.workspaces ?? []);
    } catch (e: any) {
      setError(e.message ?? "加载失败");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
    // Poll pending every 8s
    const iv = setInterval(() => {
      fetchPendingPermissions(userId)
        .then((r) => setPendingReqs(r.requests ?? []))
        .catch(() => {});
    }, 8000);
    return () => clearInterval(iv);
  }, [userId, load]);

  const handleApprove = async (id: string) => {
    await approvePermission(id, userId);
    await load();
  };

  const handleDeny = async (id: string) => {
    await denyPermission(id, userId);
    await load();
  };

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "pending",    label: "待审批", badge: pendingReqs.length },
    { id: "history",    label: "历史记录" },
    { id: "workspaces", label: "共享工作区", badge: workspaces.length },
  ];

  return (
    <div className="h-full overflow-y-auto" style={{ backgroundColor: "var(--bg-base)" }}>
      <div className="p-6 max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
              🔐 权限中心
            </h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
              Worker 信息访问授权 · 共享任务工作区
            </p>
          </div>
          <button
            onClick={load}
            className="w-8 h-8 flex items-center justify-center rounded-lg"
            style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)", color: "var(--text-muted)" }}
            title="刷新"
          >
            🔄
          </button>
        </div>

        {/* Error */}
        {error && (
          <div
            className="mb-4 px-4 py-3 rounded-xl text-xs flex items-center gap-2"
            style={{ backgroundColor: "rgba(239,68,68,0.1)", color: "var(--accent-red, #ef4444)" }}
          >
            ⚠️ {error}
            <button onClick={load} className="underline ml-auto">重试</button>
          </div>
        )}

        {/* Pending alert banner */}
        {!loading && pendingReqs.length > 0 && (
          <div
            className="mb-4 px-4 py-3 rounded-xl text-xs flex items-center gap-2"
            style={{
              backgroundColor: "rgba(245,158,11,0.12)",
              border: "1px solid rgba(245,158,11,0.3)",
              color: "#f59e0b",
            }}
          >
            <span className="text-sm">🔔</span>
            <span>有 <strong>{pendingReqs.length}</strong> 条 Worker 权限请求等待你的审批</span>
            <button
              onClick={() => setTab("pending")}
              className="ml-auto underline font-medium"
            >
              立即处理
            </button>
          </div>
        )}

        {/* Tab bar */}
        <div
          className="flex rounded-xl mb-5 p-1"
          style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all"
              style={{
                backgroundColor: tab === t.id ? "var(--bg-overlay)" : "transparent",
                color: tab === t.id ? "var(--text-primary)" : "var(--text-muted)",
              }}
            >
              {t.label}
              {t.badge !== undefined && t.badge > 0 && (
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded-full font-bold min-w-[18px] text-center"
                  style={{
                    backgroundColor: t.id === "pending" ? "#f59e0b" : "var(--accent-blue)",
                    color: "white",
                  }}
                >
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="rounded-xl p-4 animate-pulse"
                style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)", height: 88 }}
              />
            ))}
          </div>
        )}

        {/* Tab content */}
        {!loading && (
          <>
            {/* Pending */}
            {tab === "pending" && (
              <div>
                {pendingReqs.length === 0 ? (
                  <div
                    className="text-center py-16 rounded-xl"
                    style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
                  >
                    <div className="text-3xl mb-2">✅</div>
                    <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
                      暂无待审批请求
                    </div>
                    <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                      Worker 信息访问请求会在这里出现
                    </div>
                  </div>
                ) : (
                  pendingReqs.map((r) => (
                    <PermissionCard key={r.id} req={r} onApprove={handleApprove} onDeny={handleDeny} />
                  ))
                )}
              </div>
            )}

            {/* History */}
            {tab === "history" && (
              <div>
                {historyReqs.length === 0 ? (
                  <div
                    className="text-center py-16 rounded-xl"
                    style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
                  >
                    <div className="text-3xl mb-2">📋</div>
                    <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
                      暂无历史记录
                    </div>
                  </div>
                ) : (
                  historyReqs.map((r) => (
                    <PermissionCard key={r.id} req={r} onApprove={handleApprove} onDeny={handleDeny} />
                  ))
                )}
              </div>
            )}

            {/* Workspaces */}
            {tab === "workspaces" && (
              <div>
                {/* Info banner */}
                <div
                  className="mb-4 px-4 py-3 rounded-xl text-xs"
                  style={{ backgroundColor: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)", color: "var(--accent-blue)" }}
                >
                  共享工作区是 Manager 为多 Worker 协作任务创建的信息隔离空间，Worker 只能看到已脱敏的任务上下文。
                </div>
                {workspaces.length === 0 ? (
                  <div
                    className="text-center py-16 rounded-xl"
                    style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
                  >
                    <div className="text-3xl mb-2">🗂️</div>
                    <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
                      暂无活跃工作区
                    </div>
                    <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                      多 Worker 协作任务启动后，工作区会在这里显示
                    </div>
                  </div>
                ) : (
                  workspaces.map((ws) => <WorkspaceCard key={ws.id} ws={ws} />)
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
