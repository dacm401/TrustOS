"use client";

import { useEffect, useState } from 'react';

type ThinkingState = "idle" | "thinking" | "analyzing" | "routing" | "planning" | "executing" | "responding" | "completed" | "error";

interface ThinkingIndicatorProps {
  state: ThinkingState;
  message?: string;
  className?: string;
}

const THINKING_CONFIG: Record<ThinkingState, { emoji: string; color: string; label: string }> = {
  idle: { emoji: "", color: "transparent", label: "" },
  thinking: { emoji: "🤔", color: "var(--accent-purple)", label: "思考中" },
  analyzing: { emoji: "🔍", color: "var(--accent-blue)", label: "分析中" },
  routing: { emoji: "🧭", color: "var(--accent-purple)", label: "路由决策" },
  planning: { emoji: "📋", color: "var(--accent-blue)", label: "任务规划" },
  executing: { emoji: "⚙️", color: "var(--accent-blue)", label: "执行中" },
  responding: { emoji: "💬", color: "var(--accent-green)", label: "生成回复" },
  completed: { emoji: "✅", color: "var(--accent-green)", label: "完成" },
  error: { emoji: "❌", color: "var(--accent-red)", label: "错误" },
};

function ThinkingDots({ color }: { color: string }) {
  const [dots, setDots] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev + 1) % 4);
    }, 300);
    return () => clearInterval(interval);
  }, []);

  return (
    <span style={{ color }} className="font-mono">
      {".".repeat(dots)}
    </span>
  );
}

export function ThinkingIndicator({ state, message, className = "" }: ThinkingIndicatorProps) {
  const config = THINKING_CONFIG[state] || THINKING_CONFIG.idle;

  if (state === "idle") return null;

  return (
    <div className={`flex items-center gap-2 py-2 ${className}`}>
      <span className="text-base">{config.emoji}</span>
      <span style={{ color: config.color }} className="text-sm">
        {message || config.label}
      </span>
      {state !== "completed" && state !== "error" && (
        <ThinkingDots color={config.color} />
      )}
    </div>
  );
}
