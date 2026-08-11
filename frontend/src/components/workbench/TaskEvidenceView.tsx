// MWT-4A — TaskEvidenceView (frontend-only, read-only projection).
// MWT-5 — advisory approval dry-run action (client-only, non-blocking).
"use client";

import { useState } from "react";
import { useTaskEvidence } from "@/hooks/useTaskEvidence";
import { downloadEvidenceExport } from "@/lib/api";
import { buildTaskEvidenceExport } from "@/lib/evidence-export";
import {
  buildApprovalRecordAsync,
  toJsonlLine,
  type ApprovalDecision,
  type ApprovalRecord,
} from "@/lib/approval-record";
import type { GatewayEvent } from "@/lib/api";

function formatCost(cost: number | null): string {
  if (cost === null) return "—";
  if (cost === 0) return "$0.00";
  return `$${cost.toFixed(6)}`;
}

// Privacy-safe metadata fields shown in detail block. Raw content excluded by design.
const SAFE_META_KEYS = [
  "event_type",
  "status",
  "model",
  "provider",
  "agent_id",
  "session_id",
  "request_mode",
  "token_count",
  "input_tokens",
  "output_tokens",
  "cost_estimate",
  "latency_ms",
  "gateway_overhead_ms",
  "control_decision",
  "error_code",
  "error_message",
  "event_hash",
  "input_hash",
  "output_hash",
];

// Friendly labels for the privacy-safe metadata keys (raw content excluded by design).
const META_LABELS: Record<string, string> = {
  event_type: "事件类型",
  status: "状态",
  model: "模型",
  provider: "提供方",
  agent_id: "Agent",
  session_id: "会话",
  request_mode: "请求模式",
  token_count: "Token 数",
  input_tokens: "输入 Token",
  output_tokens: "输出 Token",
  cost_estimate: "预估成本",
  latency_ms: "延迟 (ms)",
  gateway_overhead_ms: "网关开销 (ms)",
  control_decision: "控制决策",
  error_code: "错误码",
  error_message: "错误信息",
  event_hash: "Event Hash",
  input_hash: "Input Hash",
  output_hash: "Output Hash",
};

// Hash-like fields get truncated display + full value in tooltip to reduce visual noise.
const HASH_KEYS = new Set(["event_hash", "input_hash", "output_hash"]);

function MetaValue({ k, v }: { k: string; v: string }) {
  const isHash = HASH_KEYS.has(k);
  const display = isHash && v.length > 16 ? `${v.slice(0, 10)}…${v.slice(-4)}` : v;
  return (
    <span className="truncate font-mono" style={{ color: "var(--text-secondary)" }} title={v}>
      {display}
    </span>
  );
}

function EventRow({ event }: { event: GatewayEvent }) {
  const [open, setOpen] = useState(false);
  const meta = SAFE_META_KEYS.filter((k) => event[k] !== undefined && event[k] !== null).map(
    (k) => [k, String(event[k])] as const
  );
  const decision = typeof event.control_decision === "string" ? event.control_decision : "";
  const decisionLower = decision.toLowerCase();
  const decisionColor =
    decisionLower === "allow"
      ? "var(--accent-green)"
      : decisionLower === "deny" || decisionLower === "block"
      ? "var(--accent-red)"
      : "var(--text-muted)";

  return (
    <div
      className="rounded-lg border px-3 py-2 transition-colors hover:border-opacity-60"
      style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 text-left"
        title={open ? "收起详情" : "展开详情"}
      >
        <span className="text-xs flex-shrink-0" style={{ color: "var(--text-secondary)" }}>
          {open ? "▾" : "▸"}
        </span>
        <span className="text-xs font-medium truncate flex-1" style={{ color: "var(--text-primary)" }}>
          {event.event_type}
        </span>
        <span className="text-[10px] flex-shrink-0" style={{ color: "var(--text-muted)" }}>
          {event.timestamp}
        </span>
        {decision && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0"
            style={{ backgroundColor: "var(--bg-elevated)", color: decisionColor }}
          >
            {decision}
          </span>
        )}
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-1 gap-1">
          {meta.map(([k, v]) => (
            <div key={k} className="flex gap-2 text-[10px]">
              <span className="w-28 flex-shrink-0" style={{ color: "var(--text-muted)" }}>
                {META_LABELS[k] ?? k}
              </span>
              <MetaValue k={k} v={v} />
            </div>
          ))}
          {meta.length === 0 && (
            <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              无附加元数据
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TaskEvidenceView({ taskId }: { taskId: string }) {
  const { loading, error, events, summary } = useTaskEvidence(taskId);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // MWT-5 — advisory approval dry-run (client-only, non-blocking).
  const [approverId, setApproverId] = useState("");
  const [decision, setDecision] = useState<ApprovalDecision>("approved");
  const [note, setNote] = useState("");
  const [recording, setRecording] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [lastRecord, setLastRecord] = useState<ApprovalRecord | null>(null);

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      const artifact = await buildTaskEvidenceExport(events as GatewayEvent[], taskId);
      downloadEvidenceExport(taskId, artifact);
    } catch (err: unknown) {
      setExportError(err instanceof Error ? err.message : "导出失败");
    } finally {
      setExporting(false);
    }
  }

  // MWT-5 (D5 O1: advisory only). Builds an ApprovalRecord and downloads it as a
  // JSONL sidecar line. Never blocks export or any downstream action. No backend call.
  async function handleApprove() {
    setRecording(true);
    setApprovalError(null);
    try {
      const record = await buildApprovalRecordAsync({
        approver_id: approverId.trim() || "anonymous-reviewer",
        target_ref: taskId,
        decision,
        note: note.trim() || undefined,
        ts: new Date().toISOString(),
        prev_hash: lastRecord ? lastRecord.record_hash : "",
        seq: lastRecord ? lastRecord.seq + 1 : 1,
      });
      // Append to a client-side approvals.jsonl download (sidecar, frontend-only).
      const line = toJsonlLine(record);
      const blob = new Blob([line + "\n"], { type: "application/x-ndjson" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `approvals-${taskId}.jsonl`;
      a.click();
      URL.revokeObjectURL(url);
      setLastRecord(record);
    } catch (err: unknown) {
      setApprovalError(err instanceof Error ? err.message : "审批记录失败");
    } finally {
      setRecording(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div
        className="px-3 py-2 flex items-center gap-1.5 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <span className="text-xs">🔍</span>
        <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
          任务证据
        </span>
        <span className="text-[10px] truncate" style={{ color: "var(--text-muted)" }} title={taskId}>
          · {taskId}
        </span>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting || events.length === 0}
          className="ml-auto text-[10px] px-2 py-0.5 rounded border disabled:opacity-40"
          style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
          title="导出可审计证据包（确定性 + 完整性 seal）"
        >
          {exporting ? "导出中…" : "导出"}
        </button>
      </div>

      {/* MWT-5 — advisory approval dry-run panel (non-blocking, client-only). */}
      <div
        className="px-3 py-2 flex-shrink-0 space-y-2"
        style={{ borderBottom: "1px solid var(--border-subtle)", backgroundColor: "var(--bg-surface)" }}
      >
        <div className="flex items-center gap-1.5">
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            建议性审批（不阻塞）
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            value={approverId}
            onChange={(e) => setApproverId(e.target.value)}
            placeholder="审批人 ID（可选）"
            className="text-[10px] px-1.5 py-0.5 rounded border w-32"
            style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--bg-base)", color: "var(--text-primary)" }}
          />
          <select
            value={decision}
            onChange={(e) => setDecision(e.target.value as ApprovalDecision)}
            className="text-[10px] px-1 py-0.5 rounded border"
            style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--bg-base)", color: "var(--text-primary)" }}
          >
            <option value="approved">approved</option>
            <option value="rejected">rejected</option>
            <option value="noted">noted</option>
          </select>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="备注（可选）"
            className="text-[10px] px-1.5 py-0.5 rounded border flex-1 min-w-[80px]"
            style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--bg-base)", color: "var(--text-primary)" }}
          />
          <button
            type="button"
            onClick={handleApprove}
            disabled={recording}
            className="text-[10px] px-2 py-0.5 rounded border disabled:opacity-40"
            style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
            title="记录建议性审批（下载 approvals.jsonl 侧车，不阻塞任何操作）"
          >
            {recording ? "记录中…" : "记录审批"}
          </button>
        </div>
        {approvalError && (
          <div className="text-[10px]" style={{ color: "var(--accent-red)" }}>
            ⚠️ {approvalError}
          </div>
        )}
        {lastRecord && (
          <div className="text-[10px] truncate" style={{ color: "var(--text-muted)" }} title={lastRecord.record_hash}>
            已记录 #{lastRecord.seq} · {lastRecord.decision} · {lastRecord.record_hash.slice(0, 12)}…
          </div>
        )}
      </div>
      {exportError && (
        <div
          className="px-3 py-1.5 text-[10px]"
          style={{ backgroundColor: "rgba(239,68,68,0.1)", color: "var(--accent-red)" }}
        >
          ⚠️ {exportError}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {loading && (
          <div className="flex flex-col items-center gap-1 py-8 text-center">
            <span className="text-base animate-pulse">⏳</span>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              正在加载任务证据…
            </span>
          </div>
        )}
        {error && (
          <div
            className="px-3 py-2 rounded-lg text-xs flex items-start gap-1.5"
            style={{ backgroundColor: "rgba(239,68,68,0.1)", color: "var(--accent-red)" }}
          >
            <span className="flex-shrink-0">⚠️</span>
            <span className="break-words">证据加载失败：{error}</span>
          </div>
        )}
        {!loading && !error && events.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-center px-4">
            <span className="text-xl">🗂️</span>
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
              该任务暂无关联事件
            </span>
            <span className="text-[10px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
              证据来自经 task_id 关联的 Gateway 事件。<br />任务运行产生事件后将显示在这里。
            </span>
          </div>
        )}

        {!loading && !error && events.length > 0 && (
          <>
            {/* Summary card */}
            <div
              className="grid grid-cols-2 gap-x-3 gap-y-2.5 rounded-lg border p-3"
              style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}
            >
              <SummaryCell label="事件数" value={String(summary.event_count)} />
              <SummaryCell label="总成本" value={formatCost(summary.total_cost)} />
              <SummaryCell label="总 Token" value={String(summary.total_tokens)} />
              <SummaryCell
                label="输入 / 输出 Token"
                value={`${summary.total_input_tokens} / ${summary.total_output_tokens}`}
              />
              <SummaryCell
                label="控制决策"
                value={`允许 ${summary.control.allow} · 拒绝 ${summary.control.deny} · 未知 ${summary.control.unknown}`}
              />
            </div>

            {/* Timeline */}
            <div className="space-y-2">
              <div
                className="text-[10px] px-0.5 pt-1"
                style={{ color: "var(--text-muted)" }}
              >
                事件时间线 · {events.length} 条（按时间升序）
              </div>
              {events.map((e) => (
                <EventRow key={e.event_id} event={e} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] mb-0.5" style={{ color: "var(--text-muted)" }}>
        {label}
      </div>
      <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        {value}
      </div>
    </div>
  );
}
