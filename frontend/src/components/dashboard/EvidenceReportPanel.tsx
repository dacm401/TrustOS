"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  fetchGatewayReport,
  fetchGatewayReportSummary,
  type ReportSummary,
} from "@/lib/api";

export default function EvidenceReportPanel() {
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [reportHtml, setReportHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"summary" | "report">("summary");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const loadSummary = useCallback(async () => {
    try {
      const data = await fetchGatewayReportSummary();
      setSummary(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load report summary");
      setSummary(null);
    }
  }, []);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchGatewayReport("html");
      const html = await res.text();
      setReportHtml(html);
      setError(null);
    } catch (e) {
      if (summary) {
        // If summary loaded but report failed, still show summary
        setError("Report HTML load failed, showing summary instead. Gateway may not have started recently.");
      } else {
        setError(e instanceof Error ? e.message : "Failed to load report");
      }
    } finally {
      setLoading(false);
    }
  }, [summary]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    if (summary && !reportHtml) {
      loadReport();
    }
  }, [summary, reportHtml, loadReport]);

  const handleDownload = async (format: "download" | "md") => {
    try {
      const res = await fetchGatewayReport(format);
      const blob = await res.blob();
      const ext = format === "md" ? ".md" : ".html";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `trustos-evidence-report${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    }
  };

  const handleRefresh = () => {
    setReportHtml(null);
    setSummary(null);
    setLoading(true);
    setError(null);
    loadSummary();
  };

  const formatCost = (cost: number | null): string => {
    if (cost === null) return "Unknown";
    return `$${cost.toFixed(6)}`;
  };

  const iframeBlobUrl = reportHtml
    ? URL.createObjectURL(new Blob([reportHtml], { type: "text/html" }))
    : null;

  // Cleanup blob URL
  useEffect(() => {
    return () => {
      if (iframeBlobUrl) URL.revokeObjectURL(iframeBlobUrl);
    };
  }, [iframeBlobUrl]);

  return (
    <section className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-lg">📋</span>
          <div>
            <h2 className="font-semibold text-gray-800 text-sm">Evidence Report</h2>
            <p className="text-xs text-gray-400">TRST-4A Human-Readable AI Activity Evidence</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode(viewMode === "summary" ? "report" : "summary")}
            className="text-xs bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition-colors text-gray-600"
          >
            {viewMode === "summary" ? "查看全文" : "查看摘要"}
          </button>
          <button
            onClick={() => handleDownload("download")}
            className="text-xs bg-blue-50 hover:bg-blue-100 text-blue-600 px-3 py-1.5 rounded-lg transition-colors"
          >
            📥 HTML
          </button>
          <button
            onClick={() => handleDownload("md")}
            className="text-xs bg-gray-50 hover:bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg transition-colors"
          >
            📝 MD
          </button>
          <button
            onClick={handleRefresh}
            className="text-xs bg-gray-50 hover:bg-gray-100 text-gray-500 px-3 py-1.5 rounded-lg transition-colors"
          >
            🔄 刷新
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-5">
        {error && !summary && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
            <strong>Unable to load report:</strong> {error}
            <p className="mt-1 text-amber-600 text-xs">
              Make sure the TrustOS Gateway is running (npm run trst1:gateway).
              The Evidence Report reads from the gateway&apos;s live event log.
            </p>
          </div>
        )}

        {loading && !reportHtml && (
          <div className="flex items-center justify-center py-16">
            <div className="text-center">
              <div className="w-6 h-6 border-3 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <div className="text-gray-400 text-sm">Generating evidence report...</div>
            </div>
          </div>
        )}

        {/* Summary View */}
        {summary && viewMode === "summary" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MetricCard label="Model Calls" value={String(summary.stats.model_calls)} />
              <MetricCard label="Tool Calls" value={String(summary.stats.tool_calls)} />
              <MetricCard
                label="Hash Coverage"
                value={`${summary.stats.hash_coverage_pct}%`}
                good={summary.stats.hash_coverage_pct >= 90}
                warn={summary.stats.hash_coverage_pct < 90 && summary.stats.hash_coverage_pct >= 50}
                bad={summary.stats.hash_coverage_pct < 50}
              />
              <MetricCard
                label="Failures"
                value={String(summary.stats.failure_count ?? summary.stats.failure_events ?? 0)}
                good={(summary.stats.failure_count ?? summary.stats.failure_events ?? 0) === 0}
                warn={(summary.stats.failure_count ?? summary.stats.failure_events ?? 0) > 0}
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MetricCard label="Total Tokens" value={summary.stats.total_tokens.toLocaleString()} />
              <MetricCard label="Est. Cost" value={formatCost(summary.stats.estimated_cost)} />
              <MetricCard label="Sessions" value={String(summary.stats.sessions ?? summary.stats.unique_sessions ?? 0)} />
              <MetricCard label="Total Events" value={String(summary.event_count)} />
            </div>

            {summary.stats.control_decisions && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <ControlCard
                label="Allowed"
                count={summary.stats.control_decisions.allow ?? 0}
                color="green"
              />
              <ControlCard
                label="Warnings"
                count={summary.stats.control_decisions.warn ?? 0}
                color="amber"
              />
              <ControlCard
                label="Blocked"
                count={summary.stats.control_decisions.block ?? 0}
                color="red"
              />
              <ControlCard
                label="No Decision"
                count={summary.stats.control_decisions?.unknown ?? 0}
                color="gray"
              />
            </div>
            )}

            {(summary.stats.top_models?.length ?? 0) > 0 && (
              <div className="mt-3">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Top Models
                </h3>
                <div className="space-y-1.5">
                  {summary.stats.top_models?.slice(0, 3).map((m) => (
                    <div
                      key={m.model}
                      className="flex items-center justify-between text-xs bg-gray-50 rounded-lg px-3 py-2"
                    >
                      <code className="text-gray-700">{m.model}</code>
                      <div className="flex items-center gap-3">
                        <span className="text-gray-400">{m.calls} calls</span>
                        <span className="text-gray-500">{m.tokens.toLocaleString()} tokens</span>
                        <span className="text-gray-600 font-mono">
                          {formatCost(m.cost)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-800">
              <strong>Shadow Mode:</strong> All control decisions are recommendations only.
              No AI requests were actually blocked or modified by TrustOS.
              {(summary.stats.control_decisions?.block ?? 0) > 0 && (
                <span className="text-red-700">
                  {" "}{summary.stats.control_decisions?.block ?? 0} event(s) flagged for review.
                </span>
              )}
            </div>

            <div className="text-xs text-gray-400">
              Generated: {summary.generated_at ? new Date(summary.generated_at).toLocaleString() : "N/A"}
            </div>
          </div>
        )}

        {/* Full Report View (iframe) */}
        {viewMode === "report" && reportHtml && (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <iframe
              ref={iframeRef}
              src={iframeBlobUrl ?? undefined}
              title="Evidence Report"
              sandbox="allow-same-origin"
              className="w-full"
              style={{ height: "600px", border: "none" }}
            />
          </div>
        )}
      </div>
    </section>
  );
}

/* ── Sub-Components ────────────────────────────────────────────────────────── */

function MetricCard({
  label,
  value,
  good,
  warn,
  bad,
}: {
  label: string;
  value: string;
  good?: boolean;
  warn?: boolean;
  bad?: boolean;
}) {
  const colorClass = bad
    ? "text-red-600"
    : warn
      ? "text-amber-600"
      : good
        ? "text-emerald-600"
        : "text-gray-700";
  return (
    <div className="bg-gray-50 rounded-lg p-3 text-center border border-gray-100">
      <div className={`text-lg font-bold ${colorClass}`}>{value}</div>
      <div className="text-xs text-gray-400 mt-0.5">{label}</div>
    </div>
  );
}

function ControlCard({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: "green" | "amber" | "red" | "gray";
}) {
  const bgMap = {
    green: "bg-emerald-50 border-emerald-200",
    amber: "bg-amber-50 border-amber-200",
    red: "bg-red-50 border-red-200",
    gray: "bg-gray-50 border-gray-200",
  };
  const textMap = {
    green: "text-emerald-700",
    amber: "text-amber-700",
    red: "text-red-700",
    gray: "text-gray-500",
  };
  return (
    <div className={`rounded-lg p-3 text-center border ${bgMap[color]}`}>
      <div className={`text-lg font-bold ${textMap[color]}`}>{count}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}
