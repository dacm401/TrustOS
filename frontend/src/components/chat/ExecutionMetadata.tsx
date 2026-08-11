"use client";
import { useState } from "react";
import type { UsageInfo, ExecutionProgress } from "@/types/dashboard";

// ── Props ──────────────────────────────────────────────────────────────────────

interface ExecutionMetadataProps {
  /** S101I: Worker execution token/cost usage */
  usage?: UsageInfo;
  /** S101I/S101P: Raw terminal summary from worker execution */
  terminalSummary?: unknown;
  /** S101P: Execution progress persisted on the message */
  executionProgress?: ExecutionProgress;
  /** MWT-1: Current session ID for Trust correlation display */
  sessionId?: string;
  /** MWT-2 TODO: Trust trace ID from Gateway observation — data not yet available.
   *  Will be wired when Worker lifecycle events emit per-execution trace_id.
   *  Prop defined for forward compatibility; currently always undefined. */
  traceId?: string;
  /** MWT-1: Number of Gateway events captured for this session */
  eventsCaptured?: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * S101P: Format terminalSummary for human-readable display.
 *
 * Priority:
 *   1. string → use directly
 *   2. object → extract summary/message/status/outcome/result fields
 *   3. object → compact key-value pairs
 *   4. fallback → JSON (should rarely happen)
 */
export function formatTerminalSummary(raw: unknown): { title: string; detail?: string } {
  if (!raw) return { title: "" };
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return { title: trimmed.length > 80 ? trimmed.substring(0, 77) + "…" : trimmed, detail: trimmed.length > 80 ? trimmed : undefined };
  }
  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    // Priority extraction
    const extracted = obj.summary || obj.message || obj.status || obj.outcome || obj.result;
    if (typeof extracted === "string" && extracted.trim()) {
      const s = extracted.trim();
      return { title: s.length > 80 ? s.substring(0, 77) + "…" : s, detail: s.length > 80 ? s : undefined };
    }
    // Fallback: compact key-value
    const pairs = Object.entries(obj)
      .filter(([, v]) => v !== null && v !== undefined)
      .slice(0, 3)
      .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
      .join(" · ");
    const full = JSON.stringify(obj, null, 2);
    return { title: pairs || full.substring(0, 80), detail: full };
  }
  return { title: String(raw).substring(0, 80) };
}

// ── Component ──────────────────────────────────────────────────────────────────

/**
 * S101P Phase B: Shared execution metadata renderer.
 *
 * Displays worker execution visibility data (usage, terminalSummary, executionProgress)
 * in a compact format. Used by both MessageBubble (ChatInterface) and ManagerConversation.
 *
 * Returns null when all props are empty — safe to unconditionally render.
 */
export function ExecutionMetadata({ usage, terminalSummary, executionProgress, sessionId, traceId, eventsCaptured }: ExecutionMetadataProps) {
  const [summaryExpanded, setSummaryExpanded] = useState(false);

  const hasContext = !!(sessionId || traceId || (eventsCaptured !== undefined && eventsCaptured > 0));

  // Nothing to render
  if (!usage && !terminalSummary && !executionProgress && !hasContext) return null;

  return (
    <>
      {/* MWT-1: Session / Trust context header */}
      {hasContext && (
        <div className="flex items-center gap-2 mt-1 px-1 flex-wrap" style={{ color: "var(--text-muted)" }}>
          {sessionId && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.03)" }}>
              sess:{sessionId.slice(0, 8)}…
            </span>
          )}
          {traceId && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(59,130,246,0.06)", color: "var(--accent-blue)" }}>
              trace:{traceId.slice(0, 8)}…
            </span>
          )}
          {eventsCaptured !== undefined && eventsCaptured > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(16,185,129,0.06)", color: "var(--accent-green)" }}>
              📊 {eventsCaptured} events
            </span>
          )}
        </div>
      )}

      {/* Usage: model + token breakdown + cost */}
      {usage && (
        <div className="flex items-center gap-3 mt-1 px-1 flex-wrap" style={{ color: "var(--text-muted)" }}>
          <span className="text-[10px] font-mono">{usage.cost.model}</span>
          <span className="text-[10px]">
            {usage.tokens.input}↑ {usage.tokens.output}↓ {usage.tokens.total}Σ
          </span>
          {usage.cost.estimated_usd !== undefined && (
            <span className="text-[10px]" style={{ color: "var(--accent-green)" }}>
              ${usage.cost.estimated_usd.toFixed(4)}
            </span>
          )}
        </div>
      )}

      {/* Terminal summary: expandable pill */}
      {terminalSummary && (() => {
        const formatted = formatTerminalSummary(terminalSummary);
        if (!formatted.title) return null;
        const hasDetail = !!formatted.detail;
        return (
          <div className="mt-1">
            <div
              className={`px-2 py-1 rounded text-[10px] inline-flex items-center gap-1 ${hasDetail ? "cursor-pointer hover:opacity-80" : ""}`}
              style={{
                backgroundColor: "rgba(139,92,246,0.06)",
                color: "var(--text-muted)",
                maxWidth: summaryExpanded ? "100%" : "320px",
              }}
              onClick={hasDetail ? () => setSummaryExpanded(!summaryExpanded) : undefined}
              title={hasDetail ? undefined : formatted.title}
            >
              <span className="flex-shrink-0">📋</span>
              <span
                style={{
                  overflow: summaryExpanded ? "visible" : "hidden",
                  textOverflow: summaryExpanded ? "clip" : "ellipsis",
                  whiteSpace: summaryExpanded ? "normal" : "nowrap",
                }}
              >
                {summaryExpanded && formatted.detail ? formatted.detail : formatted.title}
              </span>
              {hasDetail && (
                <span className="flex-shrink-0 opacity-50">{summaryExpanded ? "▲" : "▼"}</span>
              )}
            </div>
          </div>
        );
      })()}

      {/* Execution progress: compact status line */}
      {executionProgress && (
        <div className="mt-1 px-2 py-0.5 rounded text-[10px] flex items-center gap-1.5"
          style={{
            backgroundColor: executionProgress.status === "completed"
              ? "rgba(16,185,129,0.06)"
              : executionProgress.status === "error"
                ? "rgba(239,68,68,0.06)"
                : executionProgress.status === "cancelled"
                  ? "rgba(245,158,11,0.06)"
                  : "rgba(59,130,246,0.06)",
            color: "var(--text-muted)",
          }}
        >
          <span>{
            executionProgress.status === "completed" ? "✅"
              : executionProgress.status === "error" ? "❌"
              : executionProgress.status === "cancelled" ? "⏹️"
              : "⚙️"
          }</span>
          <span>{
            executionProgress.status === "completed" ? "已完成"
              : executionProgress.status === "error" ? "失败"
              : executionProgress.status === "cancelled" ? "已取消"
              : "执行中"
          }</span>
          {executionProgress.workerStatus && executionProgress.workerStatus.maxCycles && (
            <>
              <span>·</span>
              <span style={{
                color: executionProgress.workerStatus.completedCycles >= executionProgress.workerStatus.maxCycles
                  ? "var(--accent-green)" : "var(--accent-blue)",
              }}>
                Cycle {executionProgress.workerStatus.completedCycles}/{executionProgress.workerStatus.maxCycles}
              </span>
            </>
          )}
          {executionProgress.workerStatus && !executionProgress.workerStatus.maxCycles && executionProgress.workerStatus.completedCycles > 0 && (
            <>
              <span>·</span>
              <span>Cycles: {executionProgress.workerStatus.completedCycles}</span>
            </>
          )}
          {executionProgress.message && !executionProgress.workerStatus && (
            <>
              <span>·</span>
              <span>{executionProgress.message}</span>
            </>
          )}
          {/* MWT-2: Show terminalStatus badge (strict enum — more precise than currentState) */}
          {executionProgress.workerStatus?.terminalStatus && executionProgress.workerStatus.terminalStatus !== "success" && (
            <>
              <span>·</span>
              <span style={{
                color: executionProgress.workerStatus.terminalStatus === "cancelled" ? "var(--accent-amber)"
                  : executionProgress.workerStatus.terminalStatus === "timeout" ? "var(--accent-orange)"
                  : executionProgress.workerStatus.terminalStatus === "max_cycles_exceeded" ? "var(--accent-orange)"
                  : "var(--accent-red)",
              }}>
                {executionProgress.workerStatus.terminalStatus === "cancelled" ? "Cancelled"
                  : executionProgress.workerStatus.terminalStatus === "timeout" ? "Timed Out"
                  : executionProgress.workerStatus.terminalStatus === "max_cycles_exceeded" ? "Max Cycles"
                  : executionProgress.workerStatus.terminalStatus === "error" ? "Error"
                  : executionProgress.workerStatus.terminalStatus}
              </span>
            </>
          )}
        </div>
      )}
      {/* MWT-2: Extra detail — cancellation reason */}
      {executionProgress?.workerStatus?.reason && (
        <div className="mt-0.5 px-2 text-[10px]" style={{ color: "var(--text-muted)" }}>
          Reason: {executionProgress.workerStatus.reason}
        </div>
      )}
      {/* MWT-2: Extra detail — error stage + message */}
      {executionProgress?.workerStatus?.errorStage && (
        <div className="mt-0.5 px-2 text-[10px]" style={{ color: "var(--accent-red)" }}>
          Error in {executionProgress.workerStatus.errorStage}: {executionProgress.workerStatus.errorMessage ?? "Unknown error"}
        </div>
      )}
    </>
  );
}
