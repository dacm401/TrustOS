"use client";
import { useState } from "react";
import { DecisionCard } from "./DecisionCard";
import { CodeBlock } from "./CodeBlock";
import { PreviewPane } from "./PreviewPane";
import { ActionBar } from "./ActionBar";
import { sendFeedback } from "@/lib/api";
import type { Decision } from "@/types/dashboard";

interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  decision?: Decision;
  userId?: string;
  /** O-002: 委托状态 — 告知用户慢模型正在后台处理 */
  delegation?: {
    status: "pending" | "completed" | "failed";
    slow_result?: string;
    error?: string;
  };
  /** Phase 2.0: 路由分层标识 */
  routingLayer?: "L0" | "L1" | "L2" | "L3";
}

// S93P: 路由分层标签产品化 — 隐藏 L0/L1/L2/L3 内部术语，改用进度描述
const LAYER_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  L0: { bg: "rgba(156,163,175,0.12)", text: "#9CA3AF", label: "即时响应" },
  L1: { bg: "rgba(59,130,246,0.12)", text: "#3B82F6", label: "智能分析" },
  L2: { bg: "rgba(139,92,246,0.12)", text: "#8B5CF6", label: "深度处理" },
  L3: { bg: "rgba(245,158,11,0.12)", text: "#F59E0B", label: "任务执行" },
};

function initials(name: string): string {
  return name.substring(0, 2).toUpperCase();
}

export function MessageBubble({ role, content, decision, userId = "dev-user", delegation, routingLayer }: MessageBubbleProps) {
  const isUser = role === "user";
  const [feedbackGiven, setFeedbackGiven] = useState<string | null>(null);
  const [showReasonInput, setShowReasonInput] = useState(false);
  const [feedbackReason, setFeedbackReason] = useState("");

  const handleFeedback = async (type: "thumbs_up" | "thumbs_down") => {
    if (decision?.id && !feedbackGiven) {
      if (type === "thumbs_down") {
        setShowReasonInput(true);
        return;
      }
      await sendFeedback(decision.id, type, userId);
      setFeedbackGiven(type);
    }
  };

  const submitThumbsDown = async () => {
    if (decision?.id) {
      await sendFeedback(decision.id, "thumbs_down", userId, feedbackReason.trim() || undefined);
      setFeedbackGiven("thumbs_down");
      setShowReasonInput(false);
    }
  };

  const cancelReasonInput = () => {
    setShowReasonInput(false);
    setFeedbackReason("");
  };

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      <div className={`max-w-[72%] ${isUser ? "items-end" : "items-start"} flex flex-col`}>
        {/* Avatar row */}
        <div className={`flex items-center gap-1.5 mb-1.5 ${isUser ? "flex-row-reverse" : ""}`}>
          {isUser ? (
            <>
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                style={{
                  backgroundColor: "var(--accent-blue)",
                  color: "white",
                }}
              >
                {initials(userId)}
              </div>
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>你</span>
            </>
          ) : (
            <>
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-xs flex-shrink-0"
                style={{
                  backgroundColor: "var(--bg-overlay)",
                  color: "var(--accent-blue)",
                }}
              >
                ◈
              </div>
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>TrustOS</span>
            </>
          )}
        </div>

        {/* Message bubble */}
        <div
          className="px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap animate-fade-in-up"
          style={
            isUser
              ? {
                  backgroundColor: "var(--accent-blue)",
                  color: "white",
                  borderRadius: "18px 4px 18px 18px",
                }
              : {
                  backgroundColor: "var(--bg-elevated)",
                  border: "1px solid var(--border-default)",
                  color: "var(--text-primary)",
                  borderRadius: "4px 18px 18px 18px",
                }
          }
        >
          {content}
        </div>

        {/* S93P: 检测代码/HTML 内容，自动展示 CodeBlock + PreviewPane */}
        {!isUser && (
          <ResultDisplay content={content} />
        )}

        {/* S93P: AI 消息操作按钮（复制/重新生成/继续修改） */}
        {/* S97P: Extract cost from decision for ActionBar display */}
        {!isUser && content && !isUser && (() => {
          const exec = decision && "execution" in decision ? decision.execution : undefined;
          const cost = exec ? {
            input_tokens: exec.input_tokens,
            output_tokens: exec.output_tokens,
            estimated_cost_usd: exec.total_cost_usd,
          } : undefined;
          return (
            <ActionBar
              content={content}
              isArtifact={content.includes("import React") || content.includes("export default") || content.includes("function ")}
              cost={cost ?? null}
            />
          );
        })()}

        {/* AI: Decision card + metadata */}
        {!isUser && (decision || routingLayer) && (
          <>
            {decision && <DecisionCard decision={decision} />}
            {/* AI metadata: model + tokens + latency + routing layer */}
            {(decision?.execution || routingLayer) && (
              <div
                className="flex items-center gap-3 mt-1 px-1 flex-wrap"
                style={{ color: "var(--text-muted)" }}
              >
                {decision?.execution?.model_used && (
                  <span className="text-[10px] font-mono">
                    {decision.execution.model_used}
                  </span>
                )}
                {/* S93P: 路由分层 badge — 只显示产品化标签，隐藏内部 L0/L1/L2/L3 */}
                {routingLayer && LAYER_COLORS[routingLayer] && (
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded font-medium"
                    style={{
                      backgroundColor: LAYER_COLORS[routingLayer].bg,
                      color: LAYER_COLORS[routingLayer].text,
                    }}
                  >
                    {LAYER_COLORS[routingLayer].label}
                  </span>
                )}
                {decision?.execution && (
                  <>
                    <span className="text-[10px]">
                      {(decision.execution.input_tokens ?? 0) + (decision.execution.output_tokens ?? 0)} tokens
                    </span>
                    {decision.execution.latency_ms && (
                      <span className="text-[10px]">{decision.execution.latency_ms}ms</span>
                    )}
                    {decision.execution.total_cost_usd !== undefined && (
                      <span className="text-[10px]" style={{ color: "var(--accent-green)" }}>
                        ${decision.execution.total_cost_usd.toFixed(4)}
                      </span>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}

        {/* O-002: 委托状态指示器 */}
        {delegation && role === "assistant" && (
          <div className="mt-2 px-2 py-1.5 rounded-lg text-[10px] animate-fade-in"
            style={{
              backgroundColor: delegation.status === "completed"
                ? "rgba(16,185,129,0.1)"
                : delegation.status === "failed"
                ? "rgba(239,68,68,0.1)"
                : "rgba(59,130,246,0.08)",
              border: `1px solid ${delegation.status === "completed"
                ? "rgba(16,185,129,0.25)"
                : delegation.status === "failed"
                ? "rgba(239,68,68,0.25)"
                : "rgba(59,130,246,0.2)"}`,
              color: delegation.status === "completed"
                ? "var(--accent-green)"
                : delegation.status === "failed"
                ? "var(--accent-red)"
                : "var(--accent-blue)",
            }}
          >
            {delegation.status === "pending" && (
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: "var(--accent-blue)" }} />
                <span>正在为您处理中…</span>
              </div>
            )}
            {delegation.status === "completed" && (
              <div className="flex items-center gap-1.5">
                <span>✓</span>
                <span>处理完成，可刷新查看</span>
              </div>
            )}
            {delegation.status === "failed" && (
              <div className="flex items-center gap-1.5">
                <span>⚠️</span>
                <span>处理失败，请重试</span>
              </div>
            )}
          </div>
        )}

        {/* AI: Feedback buttons */}
        {!isUser && decision && (
          <div className={`flex items-center gap-2 mt-1.5 ${isUser ? "" : "ml-1"}`}>
            <button
              onClick={() => handleFeedback("thumbs_up")}
              className="text-sm transition-all rounded p-1"
              style={{
                opacity:
                  feedbackGiven === "thumbs_up"
                    ? 1
                    : feedbackGiven
                    ? 0.25
                    : 0.45,
                transform: feedbackGiven === "thumbs_up" ? "scale(1.15)" : "scale(1)",
                color: feedbackGiven === "thumbs_up" ? "var(--accent-green)" : "var(--text-muted)",
              }}
              title="有帮助"
            >
              👍
            </button>
            <button
              onClick={() => handleFeedback("thumbs_down")}
              className="text-sm transition-all rounded p-1"
              style={{
                opacity:
                  feedbackGiven === "thumbs_down"
                    ? 1
                    : feedbackGiven
                    ? 0.25
                    : 0.45,
                transform: feedbackGiven === "thumbs_down" ? "scale(1.15)" : "scale(1)",
                color: feedbackGiven === "thumbs_down" ? "var(--accent-red)" : "var(--text-muted)",
              }}
              title="没帮助"
            >
              👎
            </button>
            {feedbackGiven && (
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                {feedbackGiven === "thumbs_up" ? "✓ 已记录" : "✓ 已记录，下次改进"}
              </span>
            )}
          </div>
        )}

        {/* S97P: Thumbs-down reason input */}
        {showReasonInput && (
          <div className="ml-1 mt-2 p-3 rounded-lg border" style={{
            borderColor: "var(--border-color)",
            backgroundColor: "var(--bg-secondary)",
            maxWidth: "280px",
          }}>
            <p className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>
              方便告诉我们哪里可以改进吗？（可选）
            </p>
            <textarea
              className="w-full text-sm p-2 rounded border resize-none focus:outline-none"
              style={{
                borderColor: "var(--border-color)",
                backgroundColor: "var(--bg-primary)",
                color: "var(--text-primary)",
                minHeight: "48px",
              }}
              placeholder="例如：回答不准确、格式不对..."
              maxLength={200}
              value={feedbackReason}
              onChange={(e) => setFeedbackReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submitThumbsDown();
                }
              }}
              autoFocus
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                {feedbackReason.length}/200
              </span>
              <div className="flex gap-2">
                <button
                  onClick={cancelReasonInput}
                  className="text-xs px-2 py-1 rounded transition-colors"
                  style={{ color: "var(--text-muted)" }}
                >
                  跳过
                </button>
                <button
                  onClick={submitThumbsDown}
                  className="text-xs px-3 py-1 rounded transition-colors"
                  style={{
                    backgroundColor: "var(--accent-red)",
                    color: "white",
                  }}
                >
                  提交
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * S93P: ResultDisplay — 智能检测内容类型并展示代码块/预览。
 * 如果 content 包含 React 组件代码（import/export/function），展示 CodeBlock + PreviewPane。
 * 如果 content 包含 HTML 标签，展示 PreviewPane。
 * 否则不额外展示（普通文本消息）。
 */
function ResultDisplay({ content }: { content: string }) {
  // 检测是否是 React/TSX 代码
  const isReactCode =
    content.includes("import React") ||
    (content.includes("import ") && content.includes("from ")) ||
    content.includes("export default function") ||
    content.includes("export function") ||
    (content.includes("function ") && content.includes("return ("));

  // 检测是否包含 HTML 结构
  const hasHtml = content.includes("</") && (content.includes("<div") || content.includes("<main") || content.includes("<section") || content.includes("<html"));

  // 提取纯 HTML 用于预览
  const extractHtml = (code: string): string => {
    // 如果是 React 组件，尝试提取 JSX return 部分
    if (code.includes("return (")) {
      const returnMatch = code.match(/return\s*\(\s*([\s\S]*?)\s*\)\s*;?\s*\}/);
      if (returnMatch) return returnMatch[1];
    }
    return code;
  };

  if (isReactCode || hasHtml) {
    return (
      <>
        <CodeBlock code={content} language={isReactCode ? "tsx" : "html"} />
        <PreviewPane htmlContent={extractHtml(content)} />
      </>
    );
  }

  return null;
}
