"use client";

// MWT-5R-UI-II — Audit Review entry surface.
//
// Pure presentation: consumes deterministic ApprovalReviewReplay fixtures and
// renders one ApprovalReviewPanel per state. NO backend / API / DB dependency,
// NO re-evaluation of signatures or provenance in the UI. The panel only
// displays the artifact's honest conclusion tone.
//
// This is the smallest reachable product surface for the audit review panel —
// wired into the main sidebar as the "Audit" nav item (see app/page.tsx).

import { useEffect, useState } from "react";
import ApprovalReviewPanel from "@/components/audit/ApprovalReviewPanel";
import EventChainViewer from "@/components/dashboard/EventChainViewer";
import {
  fetchHumanReviews,
  type HumanReviewRequest,
} from "@/lib/api";
import {
  approvedVerified,
  mismatch,
  legacyUnsigned,
  unavailable,
} from "@/components/audit/__fixtures__/approval-reviews";

// These fixtures are STATUS-TONE DEMOS only — they are NOT real records.
// Real approvals come from GET /v1/human-review (rendered below).
const SAMPLES = [
  approvedVerified,
  mismatch,
  legacyUnsigned,
  unavailable,
] as const;

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
            人工审核队列（后端真实数据） + 审批签名验证状态示例。
          </p>
        </div>

        {/* ── Real human-review queue ── */}
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
            <div className="space-y-2">
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

        {/* Status-tone demos — explicitly labelled as examples, not real records */}
        <div className="pt-4 border-t" style={{ borderColor: "var(--border-subtle)" }}>
          <h2
            className="text-base font-semibold mb-1"
            style={{ color: "var(--text-primary)" }}
          >
            🧪 状态示例（非真实记录）
          </h2>
          <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
            以下 4 张卡片为确定性的状态示意，仅用于演示四种诚实状态色，
            不代表系统中的真实审批。
          </p>
          <div className="space-y-6">
            {SAMPLES.map((review) => (
              <ApprovalReviewPanel key={review.review_id} review={review} />
            ))}
          </div>
        </div>

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
      </div>
    </div>
  );
}
