"use client";

interface ActionBarProps {
  /** S93P: 消息内容，用于复制 */
  content: string;
  /** S93P: 是否显示为代码/artifact 结果（影响按钮文案） */
  isArtifact?: boolean;
  /** S93P: 重新生成回调 */
  onRegenerate?: () => void;
  /** S93P: 继续修改回调 */
  onContinueEdit?: () => void;
}

/**
 * S93P: 操作按钮栏 — 复制/重新生成/继续修改。
 * 显示在 AI 消息底部，提供产品化的结果操作。
 */
export function ActionBar({ content, isArtifact = false, onRegenerate, onContinueEdit }: ActionBarProps) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = content;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
  };

  return (
    <div className="flex items-center gap-1 mt-2">
      <button
        onClick={handleCopy}
        className="text-[10px] px-2 py-1 rounded transition-colors flex items-center gap-1"
        style={{
          color: "var(--text-muted)",
          backgroundColor: "var(--bg-elevated)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <span>📋</span>
        <span>复制</span>
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
    </div>
  );
}
