"use client";

import { useState } from "react";

interface ActionBarProps {
  /** S93P: 消息内容，用于复制 */
  content: string;
  /** S93P: 是否显示为代码/artifact 结果（影响按钮文案） */
  isArtifact?: boolean;
  /** S93P: 重新生成回调 */
  onRegenerate?: () => void;
  /** S93P: 继续修改回调 */
  onContinueEdit?: () => void;
  /** S94P: 重试回调（复用原始 prompt） */
  onRetry?: () => void;
  /** S94P: 成本信息 */
  cost?: {
    input_tokens?: number;
    output_tokens?: number;
    estimated_cost_usd?: number | null;
  } | null;
}

/**
 * S93P + S94P: 操作按钮栏 — 复制/重新生成/重试/继续修改 + 成本显示。
 */
export function ActionBar({
  content,
  isArtifact = false,
  onRegenerate,
  onContinueEdit,
  onRetry,
  cost,
}: ActionBarProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = content;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex items-center gap-1 mt-2 flex-wrap">
      <button
        onClick={handleCopy}
        className="text-[10px] px-2 py-1 rounded transition-colors flex items-center gap-1"
        style={{
          color: copied ? "var(--accent-green)" : "var(--text-muted)",
          backgroundColor: "var(--bg-elevated)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <span>{copied ? "✅" : "📋"}</span>
        <span>{copied ? "已复制" : "复制"}</span>
      </button>
      {onRegenerate && (
        <button
          onClick={onRegenerate}
          className="text-[10px] px-2 py-1 rounded transition-colors flex items-center gap-1"
          style={{
            color: "var(--text-muted)",
            backgroundColor: "var(--bg-elevated)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <span>🔄</span>
          <span>重新生成</span>
        </button>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-[10px] px-2 py-1 rounded transition-colors flex items-center gap-1"
          style={{
            color: "var(--text-muted)",
            backgroundColor: "var(--bg-elevated)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <span>🔁</span>
          <span>重试</span>
        </button>
      )}
      {onContinueEdit && (
        <button
          onClick={onContinueEdit}
          className="text-[10px] px-2 py-1 rounded transition-colors flex items-center gap-1"
          style={{
            color: "var(--text-muted)",
            backgroundColor: "var(--bg-elevated)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <span>✏️</span>
          <span>继续修改</span>
        </button>
      )}
      {/* S94P: Cost display */}
      {cost && (
        <span className="text-[10px] ml-auto" style={{ color: "var(--text-muted)" }}>
          {(cost.input_tokens ?? 0) + (cost.output_tokens ?? 0)} tokens
          {cost.estimated_cost_usd != null && (
            <> · ${cost.estimated_cost_usd.toFixed(4)}</>
          )}
        </span>
      )}
    </div>
  );
}
