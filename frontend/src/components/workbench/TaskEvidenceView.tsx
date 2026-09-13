// MWT-4A — TaskEvidenceView (frontend-only, read-only projection).
//
// 原 MWT-5 的 advisory approval dry-run 已下线：它不发后端请求、只触发一次
// jsonl 下载，是一个「看起来能用」的假审批，与产品可信定位冲突。
// 详见 docs/product/UI-IA-CONSOLIDATION.md 阶段 1。
"use client";

import { useState } from "react";
import { useTaskEvidence } from "@/hooks/useTaskEvidence";
import { downloadEvidenceExport } from "@/lib/api";
import { buildTaskEvidenceExport } from "@/lib/evidence-export";
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
  const [copied, setCopied] = useState(false);

  // 任务 ID 对用户无意义，只显示前 8 位；完整值提供复制，供排查时贴给开发者。
  async function copyTaskId() {
    try {
      await navigator.clipboard.writeText(taskId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

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

  return (
    <div className="flex flex-col h-full">
      <div
        className="px-3 py-2 flex items-center gap-1.5 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <span className="text-xs">⚡</span>
        {/*
          UI-IA-CONSOLIDATION 阶段 4：原名「任务证据」已改为「调用明细」。

          原因：本视图的数据源是 Gateway **事件流**（调用了哪个模型、多少 token、
          耗时多少、是否命中缓存），而 /v1/evidence 返回的「证据」是另一回事
          （信息来自哪个来源、相关度多少、正文是什么）。

          两者完全不同，却都叫「证据」——加上主区任务详情里还有第三个同名入口，
          用户完全无法区分。改名后：
            · 证据       = AI 给出的信息来自哪里（/v1/evidence）
            · 调用明细   = 系统为此做了哪些模型调用（Gateway 事件流）
        */}
        <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
          调用明细
        </span>
        <button
          type="button"
          onClick={copyTaskId}
          className="text-[10px] px-1 py-0.5 rounded"
          style={{ color: "var(--text-muted)" }}
          title={`点击复制完整任务 ID：${taskId}`}
        >
          #{taskId.slice(0, 8)}{copied ? " ✓" : ""}
        </button>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting || events.length === 0}
          className="ml-auto text-[10px] px-2 py-0.5 rounded border disabled:opacity-40"
          style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
          title="导出当前已加载的证据快照（JSON，含完整性 seal）。注意：这是本页面已加载的数据，不是服务端完整副本。"
        >
          {exporting ? "导出中…" : "导出快照"}
        </button>
      </div>

      {/*
        原「建议性审批（不阻塞）」面板已下线（ADR: UI-IA-CONSOLIDATION 阶段 1）。

        它是一个纯前端 dry-run：buildApprovalRecordAsync() 在浏览器本地算一条
        hash 记录，然后触发一次 approvals-{taskId}.jsonl 下载 —— 不发任何后端
        请求，服务端无记录、刷新即失。用户会以为审批已提交，实际只是下载了
        一个文件。

        对本产品这是硬伤：卖点是可追溯与诚实，界面上却有一个「看起来能用」
        的假审批。真实审批需后端持久化 + 审批人身份 + 待处理队列，
        超出 UI 整合范围，Boss 已决定暂不立项，故直接下线而非做真。
      */}
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
              正在加载调用明细…
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
