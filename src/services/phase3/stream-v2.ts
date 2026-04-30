/**
 * Stream V2 - Thinking 状态可视化
 * 支持更细粒度的 thinking 状态展示，提升用户体验
 */

export type ThinkingState =
  | "idle"
  | "thinking"
  | "analyzing"
  | "routing"
  | "executing"
  | "planning"
  | "responding"
  | "completed"
  | "error";

export interface ThinkingStep {
  state: ThinkingState;
  message: string;
  timestamp: number;
}

export interface SSEThinkingEvent {
  type: "thinking";
  state: ThinkingState;
  content?: string;
  routing_layer?: string;
  timestamp: number;
}

export const THINKING_MESSAGES = {
  zh: {
    idle: "",
    thinking: "🤔 正在思考...",
    analyzing: "🔍 正在分析问题...",
    routing: "🧭 正在路由决策...",
    planning: "📋 正在规划任务...",
    executing: "⚙️ 正在执行...",
    responding: "💬 正在生成回复...",
    completed: "✅ 完成",
    error: "❌ 出错了",
  },
  en: {
    idle: "",
    thinking: "🤔 Thinking...",
    analyzing: "🔍 Analyzing...",
    routing: "🧭 Routing...",
    planning: "📋 Planning...",
    executing: "⚙️ Executing...",
    responding: "💬 Generating response...",
    completed: "✅ Done",
    error: "❌ Error",
  },
} as const;

export function getThinkingMessage(state: ThinkingState, lang: "zh" | "en"): string {
  return THINKING_MESSAGES[lang]?.[state] ?? THINKING_MESSAGES[lang === "en" ? "en" : "zh"][state];
}

export function createThinkingEvent(
  state: ThinkingState,
  lang: "zh" | "en",
  routingLayer?: string
): SSEThinkingEvent {
  return {
    type: "thinking",
    state,
    content: getThinkingMessage(state, lang),
    routing_layer: routingLayer,
    timestamp: Date.now(),
  };
}
