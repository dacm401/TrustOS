"use client";
import { useState } from "react";

interface PreviewPaneProps {
  /** HTML content to preview in a sandboxed iframe */
  htmlContent: string;
  /** S93P: Whether the preview is currently visible */
  visible?: boolean;
}

/**
 * S93P: 预览窗格 — 使用 sandbox iframe 安全渲染生成的 HTML。
 * 仅渲染 HTML/CSS/JS 内容，阻止表单提交和导航。
 */
export function PreviewPane({ htmlContent, visible = true }: PreviewPaneProps) {
  const [showPreview, setShowPreview] = useState(visible);
  const [previewKey, setPreviewKey] = useState(0);

  if (!showPreview) return null;

  // Build a complete HTML document if the content doesn't have <html> tag
  const fullHtml = htmlContent.includes("<html") || htmlContent.includes("<!DOCTYPE")
    ? htmlContent
    : `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.tailwindcss.com"><\/script>
</head>
<body>
  <div id="root">${htmlContent}</div>
</body>
</html>`;

  const blobUrl = URL.createObjectURL(
    new Blob([fullHtml], { type: "text/html;charset=utf-8" })
  );

  const handleRefresh = () => {
    setPreviewKey((k) => k + 1);
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
        <span className="text-[10px] font-medium" style={{ color: "var(--text-muted)" }}>
          预览
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            className="text-[10px] px-2 py-0.5 rounded transition-colors"
            style={{ color: "var(--text-muted)" }}
            title="刷新预览"
          >
            ↻ 刷新
          </button>
          <button
            onClick={() => setShowPreview(false)}
            className="text-[10px] px-2 py-0.5 rounded transition-colors"
            style={{ color: "var(--text-muted)" }}
          >
            ✕ 关闭
          </button>
        </div>
      </div>
      {/* Preview iframe */}
      <div className="w-full" style={{ height: "400px" }}>
        <iframe
          key={previewKey}
          src={blobUrl}
          className="w-full h-full border-0"
          sandbox="allow-scripts"
          title="Preview"
          style={{ backgroundColor: "white" }}
        />
      </div>
    </div>
  );
}
