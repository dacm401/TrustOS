"use client";

// MWT-5R-UI-II — Audit Review entry surface.
//
// Renders the REAL human-review queue (GET /v1/human-review) plus the live
// event chain. No re-evaluation of signatures or provenance in the UI.
//
// 原「状态示例」fixture 卡片已下线（UI-IA-CONSOLIDATION 阶段 1）：它们是
// 硬编码假数据，与本页真实队列混排会让用户分不清真假。四种状态的含义现以
// 文字说明呈现（见页面底部「状态含义」）。
//
// Wired into the main sidebar as the "Audit" nav item (see app/page.tsx).

import { useEffect, useState } from "react";
import EventChainViewer from "@/components/dashboard/EventChainViewer";
import {
  fetchHumanReviews,
  type HumanReviewRequest,
} from "@/lib/api";
// RFC-002 菜单收敛：原独立「委托」视图（Manager↔Worker 分派会话与契约）
// 并入审计视图，作为第二个 tab，避免重复入口。
import ManagerView from "@/components/views/ManagerView";

const SEVERITY_TONE: Record<string, string> = {
  security: "var(--accent-red, #dc2626)",
  high: "var(--accent-amber, #d97706)",
  medium: "var(--text-secondary)",
  low: "var(--text-muted)",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "待处理",
  approved: "已批准",
  rejected: "已拒绝",
  needs_revision: "需修改",
  cancelled: "已取消",
};

interface AuditReviewSurfaceProps {
  /** Real event chain + assessment is pulled from the backend self-observation
   *  store (no gateway required) so the audit surface shows live activity. */
  sessionId?: string;
  userId?: string;
}

export function AuditReviewSurface({ sessionId, userId }: AuditReviewSurfaceProps = {}) {
  // ── Real human-review queue (backend-persisted) ──
  const [reviews, setReviews] = useState<HumanReviewRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"review" | "delegation">("review");

  const load = () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    fetchHumanReviews(userId, { limit: 50 })
      .then((d) => setReviews(d.requests ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return (
    <div className="h-full overflow-y-auto p-6" data-testid="audit-review-surface">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1
            className="text-xl font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            🔍 Audit Review
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
            人工审核队列与事件链，均为后端真实数据。
          </p>
          </div>

          {/* RFC-002 菜单收敛：委托会话并入审计，作为第二个 tab */}
          <div className="flex gap-2 mb-4">
          {([["review", "📋 人工审核队列"], ["delegation", "🤖 委托会话"]] as const).map(([k, lbl]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className="px-3 py-1 rounded-lg text-xs transition-colors"
              style={{
                backgroundColor: tab === k ? "var(--bg-overlay)" : "transparent",
                color: tab === k ? "var(--text-accent)" : "var(--text-muted)",
                border: `1px solid ${tab === k ? "var(--border-default)" : "var(--border-subtle)"}`,
              }}
            >
              {lbl}
            </button>
          ))}
          </div>

          {tab === "review" && (
          <>
        <div
          className="rounded-xl border p-4"
          style={{
            backgroundColor: "var(--bg-surface)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <div className="flex items-center justify-between mb-3">
            <h2
              className="text-base font-semibold"
              style={{ color: "var(--text-primary)" }}
            >
              📋 人工审核队列（真实）
            </h2>
            <button
              type="button"
              onClick={load}
              className="px-2 py-0.5 rounded text-[10px]"
              style={{ border: "1px solid var(--border-subtle)", color: "var(--text-secondary)" }}
            >
              刷新
            </button>
          </div>

          {loading && (
            <p className="text-xs animate-pulse" style={{ color: "var(--text-muted)" }}>
              加载中…
            </p>
          )}

          {error && (
            <div
              className="px-3 py-2 rounded text-xs"
              style={{ backgroundColor: "rgba(239,68,68,0.1)", color: "var(--accent-red)" }}
            >
              ⚠️ {error}
            </div>
          )}

          {!loading && !error && reviews.length === 0 && (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              暂无人工审核请求。当任务以 <code>human_review</code> 终态结束时会出现在这里。
            </p>
          )}

          {reviews.length > 0 && (
            <div className="vlist space-y-2">
              {reviews.map((r) => (
                <div
                  key={r.id}
                  className="rounded-lg border p-3 text-xs"
                  style={{ borderColor: "var(--border-subtle)" }}
                  data-testid="human-review-item"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="font-medium"
                      style={{ color: SEVERITY_TONE[r.severity] ?? "var(--text-secondary)" }}
                    >
                      [{r.severity}]
                    </span>
                    <span style={{ color: "var(--text-primary)" }}>
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                    <span className="font-mono text-[10px]" style={{ color: "var(--text-muted)" }}>
                      {r.id.slice(0, 8)}…
                    </span>
                    <span className="ml-auto font-mono text-[10px]" style={{ color: "var(--text-muted)" }}>
                      task {r.taskId.slice(0, 8)}… · cycle {r.cycleIndex}
                    </span>
                  </div>
                  <div className="mt-1" style={{ color: "var(--text-secondary)" }}>
                    原因：{r.reasonCode} · 标准 {r.audit.criteriaCount} 项 ·
                    阻塞 {r.audit.blockingIssues} 项
                    {r.audit.hasSecurityIssue ? " · ⚠️ 含安全问题" : ""}
                  </div>
                  {r.resolution && (
                    <div className="mt-1" style={{ color: "var(--text-secondary)" }}>
                      处置：{r.resolution.action}
                      {r.resolution.resolvedBy ? ` by ${r.resolution.resolvedBy}` : ""}
                      {r.resolution.note ? ` — ${r.resolution.note}` : ""}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Honest legend — what each tone means, stated up front */}
        <div
          className="rounded-xl border p-4 text-xs space-y-1"
          style={{
            backgroundColor: "var(--bg-surface)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <p style={{ color: "var(--text-primary)" }} className="font-semibold mb-1">
            Status legend
          </p>
          <p style={{ color: "var(--text-secondary)" }}>
            <span className="font-medium" style={{ color: "var(--accent-emerald, #059669)" }}>
              Verified
            </span>{" "}
            — signed approval cryptographically confirmed against the evidence.
          </p>
          <p style={{ color: "var(--text-secondary)" }}>
            <span className="font-medium" style={{ color: "var(--accent-amber, #d97706)" }}>
              Warning
            </span>{" "}
            — legacy / unsigned or unverified record; historical note only, not a trusted attestation.
          </p>
          <p style={{ color: "var(--text-secondary)" }}>
            <span className="font-medium" style={{ color: "var(--accent-red, #dc2626)" }}>
              Danger
            </span>{" "}
            — mismatch: target or fingerprint divergence detected. Do not trust.
          </p>
          <p style={{ color: "var(--text-secondary)" }}>
            <span className="font-medium" style={{ color: "var(--text-muted)" }}>
              Neutral
            </span>{" "}
            — insufficient data to form a review. Reported honestly, not assumed safe.
          </p>
        </div>

        {/*
          原「🧪 状态示例（非真实记录）」区块已下线（UI-IA-CONSOLIDATION 阶段 1）。

          它是 4 张硬编码 fixture 卡片，页面自己标注「不代表系统中的真实审批」，
          却与下方真实的审核队列（GET /v1/human-review）混在同一页。用户很难
          分清哪些是真数据、哪些是示意图 —— 对以「诚实」为卖点的审计视图，
          这种混淆尤其有害。

          四种状态色的说明已保留为下方「状态含义」文字说明（纯文本，非卡片），
          既传达同样的信息，又不会被误认为真实记录。
        */}

        {/* P1-B: real event chain + server-side assessment (live data, no gateway) */}
        <div className="pt-4 border-t" style={{ borderColor: "var(--border-subtle)" }}>
          <h2
            className="text-base font-semibold mb-3"
            style={{ color: "var(--text-primary)" }}
          >
            🔗 Live Event Chain & Assessment
          </h2>
          <EventChainViewer sessionId={sessionId} userId={userId} />
        </div>
          </>
          )}

      {tab === "delegation" && (
        <div className="h-[72vh] rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-subtle)" }}>
          <ManagerView userId={userId ?? ""} />
        </div>
      )}
      </div>
    </div>
  );
}
