"use client";
import { useState, useEffect, useCallback } from "react";
import { getApiConfig } from "@/lib/api";

// ── Types ───────────────────────────────────────────────────────────────────

interface HealthCheck {
  status: string;
  latencyMs?: number;
  detail?: string;
}

interface HealthData {
  status: string;
  timestamp: string;
  checks: Record<string, HealthCheck>;
}

interface UsageToday {
  date: string;
  activeUsers: number;
  sessions: number;
  tasks: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

interface TrendDay {
  day: string;
  sessions: number;
  tasks: number;
  costUsd: number;
}

interface TopUser {
  userId: string;
  tasks: number;
  costUsd: number;
}

interface UsageData {
  today: UsageToday;
  trend: TrendDay[];
  topUsers: TopUser[];
}

interface ErrorEvent {
  taskId: string;
  userId: string;
  sessionId: string;
  status: string;
  goal: string | null;
  durationSeconds: number;
  createdAt: string;
}

interface ErrorData {
  date: string;
  summary: Record<string, number>;
  recent: ErrorEvent[];
}

// S99P types
interface TriageInfo {
  status: string;
  severity: string;
  notes: { author: string; text: string; at: string }[];
  updated_at?: string;
  updated_by?: string;
}

interface FeedbackItem {
  id: string;
  decisionId: string;
  userId: string;
  eventType: string;
  signalLevel: number;
  source: string;
  triage: TriageInfo;
  reason: string | null;
  queryPreview: string | null;
  sessionId: string | null;
  modelUsed: string | null;
  costUsd: number | null;
  createdAt: string;
}

interface FeedbackListData {
  total: number;
  limit: number;
  offset: number;
  items: FeedbackItem[];
}

interface FeedbackDetailData extends FeedbackItem {
  decision: {
    queryPreview: string | null;
    intent: string | null;
    modelUsed: string | null;
    selectedModel: string | null;
    selectedRole: string | null;
    selectionReason: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    costUsd: number | null;
    latencyMs: number | null;
    didFallback: boolean | null;
    fallbackReason: string | null;
    feedbackType: string | null;
    feedbackScore: number | null;
  };
  session: {
    sessionId: string;
    userId: string;
    createdAt: string;
    updatedAt: string;
  } | null;
  relatedTasks: {
    taskId: string;
    title: string | null;
    status: string;
    goal: string | null;
    createdAt: string;
  }[];
}

interface DailySummary {
  date: string;
  users: { active: number };
  sessions: { total: number };
  tasks: { total: number; completed: number; failed: number; cancelled: number; timedOut: number };
  feedback: { total: number; thumbsUp: number; thumbsDown: number; satisfactionRatio: number; openTriage: number };
  cost: { totalUsd: number; inputTokens: number; outputTokens: number };
}

interface AlertItem {
  id: string;
  type: string;
  severity: string;
  title: string;
  detail: Record<string, unknown>;
  acknowledged: boolean;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
}

interface UserItem {
  userId: string;
  lastSeen: string;
  totalSessions: number;
  totalTasks: number;
  totalFeedback: number;
  totalCostUsd: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function statusColor(s: string): string {
  if (s === "ok" || s === "healthy" || s === "completed" || s === "resolved" || s === "active") return "#22c55e";
  if (s === "degraded" || s === "cancelled" || s === "investigating" || s === "paused" || s === "warning") return "#f59e0b";
  if (s === "open" || s === "wontfix") return "#8b5cf6";
  return "#ef4444";
}

function severityBadge(s: string): { bg: string; fg: string } {
  switch (s) {
    case "blocker": return { bg: "#7f1d1d", fg: "#fca5a5" };
    case "high": return { bg: "#7c2d12", fg: "#fdba74" };
    case "medium": return { bg: "#713f12", fg: "#fde047" };
    default: return { bg: "#1e293b", fg: "#94a3b8" };
  }
}

function eventTypeLabel(t: string): string {
  const map: Record<string, string> = {
    thumbs_up: "👍", thumbs_down: "👎", accepted: "✅",
    regenerated: "🔄", edited: "✏️", follow_up_doubt: "❓", follow_up_thanks: "🙏",
  };
  return map[t] || t;
}

type TabKey = "overview" | "feedback" | "dailyops" | "alerts" | "users";

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "feedback", label: "Feedback" },
  { key: "dailyops", label: "Daily Ops" },
  { key: "alerts", label: "Alerts" },
  { key: "users", label: "Users" },
];

// ── Sub-components ──────────────────────────────────────────────────────────

function OverviewTab({
  health, usage, errors, loading, onRefresh,
}: {
  health: HealthData | null;
  usage: UsageData | null;
  errors: ErrorData | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <div>
      {/* Health Section */}
      <section className="mb-6">
        <h3 className="text-sm font-medium mb-3" style={{ color: "var(--text-secondary)" }}>
          System Health
        </h3>
        {health && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: statusColor(health.status) }} />
              <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{health.status.toUpperCase()}</span>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>{new Date(health.timestamp).toLocaleTimeString()}</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {Object.entries(health.checks).map(([name, check]) => (
                <div key={name} className="p-3 rounded-lg" style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusColor(check.status) }} />
                    <span className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>{name}</span>
                  </div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {check.latencyMs != null ? `${check.latencyMs}ms` : check.detail ?? check.status}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Usage Section */}
      <section className="mb-6">
        <h3 className="text-sm font-medium mb-3" style={{ color: "var(--text-secondary)" }}>Today&apos;s Usage</h3>
        {usage && (
          <>
            <div className="grid grid-cols-5 gap-3 mb-4">
              {[
                { label: "Active Users", value: usage.today.activeUsers },
                { label: "Sessions", value: usage.today.sessions },
                { label: "Tasks", value: usage.today.tasks },
                { label: "Tokens", value: formatTokens(usage.today.inputTokens + usage.today.outputTokens) },
                { label: "Cost", value: `$${usage.today.costUsd.toFixed(4)}` },
              ].map((item) => (
                <div key={item.label} className="p-3 rounded-lg text-center" style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}>
                  <div className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>{item.value}</div>
                  <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{item.label}</div>
                </div>
              ))}
            </div>
            {usage.topUsers.length > 0 && (
              <div>
                <div className="text-xs font-medium mb-2" style={{ color: "var(--text-muted)" }}>Top Users by Cost</div>
                <div className="space-y-1">
                  {usage.topUsers.slice(0, 5).map((u) => (
                    <div key={u.userId} className="flex items-center justify-between px-3 py-2 rounded text-xs" style={{ backgroundColor: "var(--bg-surface)" }}>
                      <span style={{ color: "var(--text-primary)" }}>{u.userId}</span>
                      <span style={{ color: "var(--text-muted)" }}>{u.tasks} tasks · ${u.costUsd.toFixed(4)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* Errors Section */}
      <section className="mb-6">
        <h3 className="text-sm font-medium mb-3" style={{ color: "var(--text-secondary)" }}>Today&apos;s Errors</h3>
        {errors && (
          <>
            {Object.keys(errors.summary).length > 0 ? (
              <div className="flex gap-3 mb-4">
                {Object.entries(errors.summary).map(([status, count]) => (
                  <div key={status} className="px-3 py-1.5 rounded-full text-xs" style={{ backgroundColor: "var(--bg-surface)", border: `1px solid ${statusColor(status)}`, color: "var(--text-primary)" }}>
                    {status}: {count}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs" style={{ color: "#22c55e" }}>No errors today</div>
            )}
            {errors.recent.length > 0 && (
              <div className="space-y-2 mt-3">
                {errors.recent.slice(0, 10).map((ev) => (
                  <div key={ev.taskId} className="p-3 rounded-lg text-xs" style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono" style={{ color: "var(--text-muted)" }}>{ev.taskId?.slice(0, 8)}...</span>
                      <span style={{ color: statusColor(ev.status) }}>{ev.status}</span>
                    </div>
                    {ev.goal && <div className="text-red-400/80 truncate">{ev.goal.slice(0, 200)}</div>}
                    <div className="flex items-center justify-between mt-1" style={{ color: "var(--text-muted)" }}>
                      <span>User: {ev.userId?.slice(0, 12)}</span>
                      <span>{ev.durationSeconds?.toFixed(1)}s · {new Date(ev.createdAt).toLocaleTimeString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function FeedbackTab({ adminKey }: { adminKey: string }) {
  const [list, setList] = useState<FeedbackListData | null>(null);
  const [detail, setDetail] = useState<FeedbackDetailData | null>(null);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSeverity, setFilterSeverity] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const { apiBase } = { apiBase: "http://localhost:3001" };

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set("status", filterStatus);
      if (filterSeverity) params.set("severity", filterSeverity);
      params.set("limit", "50");

      const res = await fetch(`${apiBase}/v1/admin/feedback?${params.toString()}`, {
        headers: { "X-Admin-Key": adminKey },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setList(await res.json());
    } catch (e: any) {
      setError(e.message || "Failed to load feedback");
    } finally {
      setLoading(false);
    }
  }, [adminKey, filterStatus, filterSeverity]);

  const fetchDetail = async (id: string) => {
    try {
      const res = await fetch(`${apiBase}/v1/admin/feedback/${id}`, {
        headers: { "X-Admin-Key": adminKey },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDetail(await res.json());
    } catch (e: any) {
      setError(e.message);
    }
  };

  const updateTriage = async (id: string, field: string, value: string) => {
    try {
      const body: Record<string, string> = {};
      body[field] = value;
      const res = await fetch(`${apiBase}/v1/admin/feedback/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Admin-Key": adminKey },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchList();
      if (detail?.id === id) await fetchDetail(id);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const addNote = async (id: string) => {
    if (!noteText.trim()) return;
    try {
      const res = await fetch(`${apiBase}/v1/admin/feedback/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Admin-Key": adminKey },
        body: JSON.stringify({ add_note: noteText.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNoteText("");
      setEditingId(null);
      await fetchList();
      if (detail?.id === id) await fetchDetail(id);
    } catch (e: any) {
      setError(e.message);
    }
  };

  useEffect(() => { fetchList(); }, [fetchList]);

  return (
    <div>
      {/* Filters */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
          className="px-2 py-1 rounded text-xs" style={{ backgroundColor: "var(--bg-surface)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)" }}>
          <option value="">All Status</option>
          <option value="open">Open</option>
          <option value="investigating">Investigating</option>
          <option value="resolved">Resolved</option>
          <option value="wontfix">Won&apos;t Fix</option>
        </select>
        <select value={filterSeverity} onChange={(e) => setFilterSeverity(e.target.value)}
          className="px-2 py-1 rounded text-xs" style={{ backgroundColor: "var(--bg-surface)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)" }}>
          <option value="">All Severity</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="blocker">Blocker</option>
        </select>
        <button onClick={fetchList} className="px-3 py-1 rounded text-xs" style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-secondary)" }}>
          Refresh
        </button>
      </div>

      {error && <div className="text-red-400 text-xs mb-3">{error}</div>}

      {/* Detail view */}
      {detail && (
        <div className="mb-4 p-4 rounded-lg" style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Feedback Detail</span>
            <button onClick={() => setDetail(null)} className="text-xs" style={{ color: "var(--text-muted)" }}>✕</button>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs mb-3">
            <div>
              <span style={{ color: "var(--text-muted)" }}>Event: </span>
              <span style={{ color: "var(--text-primary)" }}>{eventTypeLabel(detail.eventType)} {detail.eventType}</span>
            </div>
            <div>
              <span style={{ color: "var(--text-muted)" }}>User: </span>
              <span className="font-mono" style={{ color: "var(--text-primary)" }}>{detail.userId}</span>
            </div>
            {detail.reason && (
              <div className="col-span-2">
                <span style={{ color: "var(--text-muted)" }}>Reason: </span>
                <span style={{ color: "#fca5a5" }}>{detail.reason}</span>
              </div>
            )}
            {detail.decision.queryPreview && (
              <div className="col-span-2">
                <span style={{ color: "var(--text-muted)" }}>Query: </span>
                <span style={{ color: "var(--text-primary)" }}>{detail.decision.queryPreview}</span>
              </div>
            )}
            <div>
              <span style={{ color: "var(--text-muted)" }}>Model: </span>
              <span style={{ color: "var(--text-primary)" }}>{detail.decision.modelUsed || "-"}</span>
            </div>
            <div>
              <span style={{ color: "var(--text-muted)" }}>Cost: </span>
              <span style={{ color: "var(--text-primary)" }}>
                {detail.decision.costUsd != null ? `$${detail.decision.costUsd.toFixed(6)}` : "-"}
              </span>
            </div>
          </div>

          {/* Triage editor */}
          <div className="flex gap-2 mb-3 flex-wrap items-center">
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>Triage:</span>
            <select value={detail.triage.status} onChange={(e) => updateTriage(detail.id, "triage_status", e.target.value)}
              className="px-2 py-1 rounded text-xs" style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)" }}>
              <option value="open">Open</option>
              <option value="investigating">Investigating</option>
              <option value="resolved">Resolved</option>
              <option value="wontfix">Won&apos;t Fix</option>
            </select>
            <select value={detail.triage.severity} onChange={(e) => updateTriage(detail.id, "severity", e.target.value)}
              className="px-2 py-1 rounded text-xs" style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)" }}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="blocker">Blocker</option>
            </select>
          </div>

          {/* Notes */}
          {detail.triage.notes && detail.triage.notes.length > 0 && (
            <div className="mb-3">
              <div className="text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>Notes:</div>
              {detail.triage.notes.map((n, i) => (
                <div key={i} className="text-xs mb-1 px-2 py-1 rounded" style={{ backgroundColor: "var(--bg-overlay)" }}>
                  <span style={{ color: "#60a5fa" }}>{n.author}</span>
                  <span style={{ color: "var(--text-muted)" }}> · {new Date(n.at).toLocaleString()}</span>
                  <div style={{ color: "var(--text-primary)" }}>{n.text}</div>
                </div>
              ))}
            </div>
          )}

          {/* Add note */}
          <div className="flex gap-2">
            <input value={noteText} onChange={(e) => setNoteText(e.target.value)}
              placeholder="Add triage note..."
              className="flex-1 px-2 py-1 rounded text-xs"
              style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)" }}
              onKeyDown={(e) => { if (e.key === "Enter") addNote(detail.id); }}
            />
            <button onClick={() => addNote(detail.id)}
              className="px-3 py-1 rounded text-xs" style={{ backgroundColor: "#2563eb", color: "white" }}>
              Add
            </button>
          </div>

          {/* Related tasks */}
          {detail.relatedTasks.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>Related Tasks ({detail.session?.sessionId?.slice(0, 8)}...):</div>
              {detail.relatedTasks.slice(0, 5).map((t) => (
                <div key={t.taskId} className="text-xs px-2 py-1 rounded mb-1" style={{ backgroundColor: "var(--bg-overlay)" }}>
                  <span style={{ color: statusColor(t.status) }}>●</span>
                  <span className="font-mono ml-1" style={{ color: "var(--text-muted)" }}>{t.taskId?.slice(0, 8)}</span>
                  <span className="ml-2" style={{ color: "var(--text-primary)" }}>{t.goal?.slice(0, 100) || t.title || "(no goal)"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Feedback list */}
      {list && (
        <div>
          <div className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>{list.total} feedback events</div>
          <div className="space-y-1">
            {list.items.map((fb) => {
              const sev = severityBadge(fb.triage?.severity || "low");
              return (
                <div key={fb.id}
                  onClick={() => fetchDetail(fb.id)}
                  className="p-2 rounded cursor-pointer text-xs flex items-center gap-2 hover:opacity-80"
                  style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}>
                  <span>{eventTypeLabel(fb.eventType)}</span>
                  <span className="font-mono" style={{ color: "var(--text-muted)" }}>{fb.userId?.slice(0, 10)}...</span>
                  <span className="flex-1 truncate" style={{ color: "var(--text-primary)" }}>{fb.reason || fb.queryPreview || "(no detail)"}</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px]" style={{ backgroundColor: sev.bg, color: sev.fg }}>
                    {fb.triage?.severity || "low"}
                  </span>
                  <span style={{ color: statusColor(fb.triage?.status || "open"), fontSize: "10px" }}>
                    {fb.triage?.status || "open"}
                  </span>
                  <span style={{ color: "var(--text-muted)", fontSize: "10px" }}>
                    {new Date(fb.createdAt).toLocaleDateString()}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function DailyOpsTab({ adminKey }: { adminKey: string }) {
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const apiBase = "http://localhost:3001";

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = { "X-Admin-Key": adminKey };
      const res = await fetch(`${apiBase}/v1/admin/daily-summary`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSummary(await res.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [adminKey]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <div className="text-xs" style={{ color: "var(--text-muted)" }}>Loading...</div>;
  if (error) return <div className="text-red-400 text-xs">{error}</div>;
  if (!summary) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
          Daily Summary — {summary.date}
        </h3>
        <button onClick={fetchData} className="px-3 py-1 rounded text-xs" style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-secondary)" }}>
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[
          { label: "Active Users", value: summary.users.active },
          { label: "Sessions", value: summary.sessions.total },
          { label: "Tasks", value: `${summary.tasks.completed}/${summary.tasks.total}` },
          { label: "Cost", value: `$${summary.cost.totalUsd.toFixed(4)}` },
        ].map((item) => (
          <div key={item.label} className="p-3 rounded-lg text-center" style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}>
            <div className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>{item.value}</div>
            <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{item.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Feedback summary */}
        <div className="p-3 rounded-lg" style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}>
          <div className="text-xs font-medium mb-2" style={{ color: "var(--text-muted)" }}>Feedback</div>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span style={{ color: "var(--text-muted)" }}>👍 Thumbs Up</span>
              <span style={{ color: "#22c55e" }}>{summary.feedback.thumbsUp}</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: "var(--text-muted)" }}>👎 Thumbs Down</span>
              <span style={{ color: "#ef4444" }}>{summary.feedback.thumbsDown}</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: "var(--text-muted)" }}>Satisfaction</span>
              <span style={{ color: "var(--text-primary)" }}>{summary.feedback.satisfactionRatio}%</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: "var(--text-muted)" }}>Open Triage</span>
              <span style={{ color: "#8b5cf6" }}>{summary.feedback.openTriage}</span>
            </div>
          </div>
        </div>

        {/* Task breakdown */}
        <div className="p-3 rounded-lg" style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}>
          <div className="text-xs font-medium mb-2" style={{ color: "var(--text-muted)" }}>Tasks</div>
          <div className="space-y-1 text-xs">
            {[
              { label: "Completed", value: summary.tasks.completed, color: "#22c55e" },
              { label: "Failed", value: summary.tasks.failed, color: "#ef4444" },
              { label: "Cancelled", value: summary.tasks.cancelled, color: "#f59e0b" },
              { label: "Timed Out", value: summary.tasks.timedOut, color: "#ef4444" },
            ].map((t) => (
              <div key={t.label} className="flex justify-between">
                <span style={{ color: "var(--text-muted)" }}>{t.label}</span>
                <span style={{ color: t.color }}>{t.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Cost */}
      <div className="mt-4 p-3 rounded-lg" style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}>
        <div className="text-xs font-medium mb-2" style={{ color: "var(--text-muted)" }}>Cost & Tokens</div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <div style={{ color: "var(--text-muted)" }}>Total Cost</div>
            <div className="font-bold" style={{ color: "var(--text-primary)" }}>${summary.cost.totalUsd.toFixed(6)}</div>
          </div>
          <div>
            <div style={{ color: "var(--text-muted)" }}>Input Tokens</div>
            <div style={{ color: "var(--text-primary)" }}>{formatTokens(summary.cost.inputTokens)}</div>
          </div>
          <div>
            <div style={{ color: "var(--text-muted)" }}>Output Tokens</div>
            <div style={{ color: "var(--text-primary)" }}>{formatTokens(summary.cost.outputTokens)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AlertsTab({ adminKey }: { adminKey: string }) {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const apiBase = "http://localhost:3001";

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/v1/admin/alerts?limit=50`, {
        headers: { "X-Admin-Key": adminKey },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAlerts(data.items || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [adminKey]);

  const ackAlert = async (id: string) => {
    try {
      await fetch(`${apiBase}/v1/admin/alerts/${id}/ack`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Admin-Key": adminKey },
        body: JSON.stringify({}),
      });
      await fetchAlerts();
    } catch (e: any) {
      setError(e.message);
    }
  };

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

  if (loading) return <div className="text-xs" style={{ color: "var(--text-muted)" }}>Loading...</div>;
  if (error) return <div className="text-red-400 text-xs">{error}</div>;

  const unackCount = alerts.filter((a) => !a.acknowledged).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
          Alerts {unackCount > 0 && <span style={{ color: "#ef4444" }}>({unackCount} unacknowledged)</span>}
        </h3>
        <button onClick={fetchAlerts} className="px-3 py-1 rounded text-xs" style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-secondary)" }}>
          Refresh
        </button>
      </div>

      {alerts.length === 0 ? (
        <div className="text-xs" style={{ color: "#22c55e" }}>No alerts</div>
      ) : (
        <div className="space-y-2">
          {alerts.map((a) => (
            <div key={a.id} className="p-3 rounded-lg text-xs" style={{
              backgroundColor: "var(--bg-surface)",
              border: `1px solid ${a.severity === "critical" ? "#ef4444" : "var(--border-subtle)"}`,
              opacity: a.acknowledged ? 0.6 : 1,
            }}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span style={{ color: a.severity === "critical" ? "#ef4444" : "#f59e0b" }}>
                    {a.severity === "critical" ? "🔴" : "🟡"}
                  </span>
                  <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{a.title}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-1.5 py-0.5 rounded text-[10px]" style={{
                    backgroundColor: a.type === "high_cost" ? "#7c2d12" : a.type === "error_spike" ? "#7f1d1d" : "#713f12",
                    color: a.type === "high_cost" ? "#fdba74" : a.type === "error_spike" ? "#fca5a5" : "#fde047",
                  }}>
                    {a.type}
                  </span>
                  {!a.acknowledged && (
                    <button onClick={() => ackAlert(a.id)}
                      className="px-2 py-0.5 rounded text-[10px]" style={{ backgroundColor: "#2563eb", color: "white" }}>
                      Ack
                    </button>
                  )}
                </div>
              </div>
              <div style={{ color: "var(--text-muted)" }}>
                {new Date(a.createdAt).toLocaleString()}
                {a.acknowledgedBy && ` · Ack by ${a.acknowledgedBy}`}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UsersTab({ adminKey }: { adminKey: string }) {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const apiBase = "http://localhost:3001";

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/v1/admin/users?limit=100`, {
        headers: { "X-Admin-Key": adminKey },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setUsers(data.items || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [adminKey]);

  const exportCsv = (type: string) => {
    window.open(`${apiBase}/v1/admin/export?type=${type}`, "_blank");
  };

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  if (loading) return <div className="text-xs" style={{ color: "var(--text-muted)" }}>Loading...</div>;
  if (error) return <div className="text-red-400 text-xs">{error}</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
          Beta Users ({users.length})
        </h3>
        <div className="flex gap-2">
          <button onClick={() => exportCsv("users")} className="px-2 py-1 rounded text-xs" style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-secondary)" }}>
            Export CSV
          </button>
          <button onClick={fetchUsers} className="px-3 py-1 rounded text-xs" style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-secondary)" }}>
            Refresh
          </button>
        </div>
      </div>

      <div className="space-y-1">
        {users.map((u) => (
          <div key={u.userId} className="p-2 rounded text-xs flex items-center gap-3" style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}>
            <span className="font-mono" style={{ color: "var(--text-primary)", minWidth: "120px" }}>{u.userId?.slice(0, 16)}...</span>
            <span style={{ color: "var(--text-muted)" }}>{u.totalSessions} sessions</span>
            <span style={{ color: "var(--text-muted)" }}>{u.totalTasks} tasks</span>
            <span style={{ color: "var(--text-muted)" }}>{u.totalFeedback} feedback</span>
            <span className="flex-1" />
            <span style={{ color: "#f59e0b" }}>${u.totalCostUsd.toFixed(4)}</span>
            <span style={{ color: "var(--text-muted)", fontSize: "10px" }}>
              Last: {new Date(u.lastSeen).toLocaleDateString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function AdminPanel({ adminKey }: { adminKey: string }) {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");

  // Overview data
  const [health, setHealth] = useState<HealthData | null>(null);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [errors, setErrors] = useState<ErrorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const apiBase = "http://localhost:3001";

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const headers = { "X-Admin-Key": adminKey };
      const [healthRes, usageRes, errorsRes] = await Promise.all([
        fetch(`${apiBase}/v1/admin/health`, { headers }),
        fetch(`${apiBase}/v1/admin/usage`, { headers }),
        fetch(`${apiBase}/v1/admin/errors`, { headers }),
      ]);
      if (!healthRes.ok) throw new Error(`Health ${healthRes.status}`);
      if (!usageRes.ok) throw new Error(`Usage ${usageRes.status}`);
      if (!errorsRes.ok) throw new Error(`Errors ${errorsRes.status}`);
      setHealth(await healthRes.json());
      setUsage(await usageRes.json());
      setErrors(await errorsRes.json());
    } catch (e: any) {
      setFetchError(e.message || "Admin API load failed");
    } finally {
      setLoading(false);
    }
  }, [adminKey]);

  useEffect(() => {
    if (activeTab === "overview") {
      fetchOverview();
      const interval = setInterval(fetchOverview, 30_000);
      return () => clearInterval(interval);
    }
  }, [activeTab, fetchOverview]);

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: "var(--bg-base)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "var(--border-subtle)" }}>
        <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>Admin Dashboard</h2>
        {activeTab === "overview" && (
          <button onClick={fetchOverview} className="px-3 py-1.5 rounded text-xs" style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-secondary)" }}>
            Refresh
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-0 px-6 border-b" style={{ borderColor: "var(--border-subtle)" }}>
        {TABS.map((tab) => (
          <button key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="px-4 py-2 text-xs font-medium transition-colors"
            style={{
              color: activeTab === tab.key ? "var(--text-primary)" : "var(--text-muted)",
              borderBottom: activeTab === tab.key ? "2px solid #3b82f6" : "2px solid transparent",
            }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === "overview" && (
          <>
            {loading && !health && (
              <div className="flex items-center justify-center h-full" style={{ color: "var(--text-muted)" }}>
                Loading admin data...
              </div>
            )}
            {fetchError && (
              <div className="flex flex-col items-center justify-center gap-4 p-8" style={{ color: "var(--text-muted)" }}>
                <div className="text-red-400">⚠ {fetchError}</div>
                <button onClick={fetchOverview} className="px-4 py-2 rounded text-sm" style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-primary)" }}>
                  Retry
                </button>
              </div>
            )}
            {!fetchError && <OverviewTab health={health} usage={usage} errors={errors} loading={loading} onRefresh={fetchOverview} />}
          </>
        )}
        {activeTab === "feedback" && <FeedbackTab adminKey={adminKey} />}
        {activeTab === "dailyops" && <DailyOpsTab adminKey={adminKey} />}
        {activeTab === "alerts" && <AlertsTab adminKey={adminKey} />}
        {activeTab === "users" && <UsersTab adminKey={adminKey} />}
      </div>
    </div>
  );
}
