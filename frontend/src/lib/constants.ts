export const TYPE_CONFIG: Record<string, { icon: string; color: string }> = {
  planning:     { icon: "🧠", color: "var(--accent-purple)" },
  classification:{ icon: "🏷️", color: "var(--text-accent)" },
  routing:      { icon: "🔀", color: "var(--accent-blue)" },
  response:     { icon: "💬", color: "var(--accent-green)" },
  step:         { icon: "⚙️", color: "var(--accent-amber)" },
  error:        { icon: "❌", color: "var(--accent-red)" },
};

export const SOURCE_CONFIG: Record<string, { icon: string; label: string; bg: string; color: string }> = {
  web_search:   { icon: "🔍", label: "搜索", bg: "rgba(59,130,246,0.1)",  color: "var(--text-accent)" },
  http_request: { icon: "🌐", label: "HTTP", bg: "rgba(139,92,246,0.1)", color: "var(--accent-purple)" },
  manual:       { icon: "✍️", label: "手动", bg: "rgba(16,185,129,0.1)", color: "var(--accent-green)" },
};
