"use client";
import { useState } from "react";

interface CodeBlockProps {
  code: string;
  language?: string;
  /** S93P: 是否显示复制按钮 */
  showCopy?: boolean;
}

/**
 * S93P: 代码块组件 — 支持语法高亮占位和复制功能。
 * 当前版本使用简单的 pre/code 渲染，后续可集成 Prism/Shiki 做真实高亮。
 */
export function CodeBlock({ code, language = "tsx", showCopy = true }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for non-HTTPS contexts
      const textarea = document.createElement("textarea");
      textarea.value = code;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      className="rounded-xl overflow-hidden my-2"
      style={{
        border: "1px solid var(--border-default)",
        backgroundColor: "var(--bg-surface)",
      }}
    >
      {/* Header bar */}
      <div
        className="flex items-center justify-between px-3 py-1.5"
        style={{
          backgroundColor: "var(--bg-elevated)",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
          {language}
        </span>
        {showCopy && (
          <button
            onClick={handleCopy}
            className="text-[10px] px-2 py-0.5 rounded transition-colors"
            style={{
              color: copied ? "var(--accent-green)" : "var(--text-muted)",
              backgroundColor: copied ? "rgba(16,185,129,0.1)" : "transparent",
            }}
          >
            {copied ? "✓ 已复制" : "复制代码"}
          </button>
        )}
      </div>
      {/* Code content */}
      <pre
        className="p-3 overflow-x-auto text-xs leading-relaxed"
        style={{
          color: "var(--text-primary)",
          backgroundColor: "var(--bg-surface)",
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}
