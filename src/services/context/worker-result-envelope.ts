/**
 * Context Boundary V1 — WorkerResultEnvelope
 *
 * Worker 输出必须形成两种表示：
 *   artifact: 完整结果，给用户展示
 *   brief:    任务摘要，给 Manager 调度使用
 *
 * 同一个 Worker 结果有两种视图：
 *   User View = artifact
 *   Manager View = brief
 *
 * 本轮不改 DB schema，不引入 LLM summary，不做 Task Contract。
 */

// ── 内容类型探测 ──────────────────────────────────────────────────────────────

export type WorkerArtifactContentType =
  | "text"
  | "markdown"
  | "code"
  | "html"
  | "tsx"
  | "json"
  | "unknown";

function detectContentType(content: string): WorkerArtifactContentType {
  const text = content || "";

  // TSX / JSX — import React 或有 TSX backtick
  if (text.includes("```tsx") || text.includes("```jsx") || text.includes("```typescript")
    || /(import\s+React|from\s+['"]react['"])/.test(text)) {
    return "tsx";
  }
  // HTML — doctype 或 html 标签
  if (text.includes("```html") || /(<!DOCTYPE|<html|<body|<div)/.test(text)) {
    return "html";
  }
  // 代码 — 有 backtick 代码块或明显的代码特征
  if (text.includes("```") || /(export default|function\s+\w+\s*\(|className=|interface\s+\w+|type\s+\w+\s*=)/.test(text)) {
    return "code";
  }
  // JSON — 纯 JSON 对象/数组
  if (text.startsWith("{") || text.startsWith("[")) {
    try { JSON.parse(text); return "json"; } catch { /* not json */ }
  }
  // Markdown — backtick 或 markdown 标题
  if (text.includes("```") || text.includes("# ") || text.includes("## ")) {
    return "markdown";
  }
  return "text";
}

// ── 据内容推断有信息量的摘要 ──────────────────────────────────────────────────

const LANGUAGE_PATTERNS: [RegExp, string][] = [
  [/import (React|useState|useEffect|useRef)/, "React"],
  [/import .* from ['"]react['"]/, "React"],
  [/function \w+\(\)/, "函数组件"],
  [/export default (function|class|const)/, "导出组件"],
  [/className=['"]/, "Tailwind/JSX样式"],
  [/<form/, "表单"],
  [/<input/, "输入框"],
  [/type\s*=|interface\s+/, "TypeScript类型定义"],
  [/<div/, "HTML结构"],
  [/<table/, "表格"],
  [/<svg/, "SVG图形"],
  [/<canvas/, "Canvas画布"],
  [/<button/, "按钮"],
  [/const \[(\w+),/, "React状态Hooks"],
  [/useState/, "React状态"],
  [/useEffect/, "副作用处理"],
  [/onClick|onChange|onSubmit/, "事件处理"],
  [/@media/, "响应式布局"],
  [/flex|grid/, "布局（Flex/Grid）"],
  [/margin|padding|border/, "样式控制"],
  [/\.env|process\.env/, "环境变量"],
  [/fetch\(|axios\./, "网络请求"],
  [/async function|await/, "异步逻辑"],
  [/for\s*\(|while\s*\(/, "循环逻辑"],
  [/docker|Dockerfile/, "Docker配置"],
  [/npm |yarn |package\.json/, "包管理"],
  [/\.css|\.scss|\.less/, "CSS样式文件"],
];

function deriveSummaryFromContent(content: string): string {
  const text = content || "";
  const contentType = detectContentType(text);

  // 收集技术特征
  const features: string[] = [];
  for (const [pattern, label] of LANGUAGE_PATTERNS) {
    if (pattern.test(text) && !features.includes(label)) {
      features.push(label);
    }
  }

  // 估算规模
  const lineCount = text.split("\n").length;
  const sizeHint = lineCount > 200 ? "较大" : lineCount > 50 ? "中等" : "较小";

  // 内容类型基础描述
  const typeLabel: Record<WorkerArtifactContentType, string> = {
    tsx: "React/TSX 组件",
    html: "HTML 页面",
    code: "代码文件",
    json: "JSON 结构化数据",
    markdown: "Markdown 文档",
    text: "文本内容",
    unknown: "项目文件",
  };

  const typeDesc = typeLabel[contentType];

  // 组装摘要
  if (features.length > 0) {
    const featureStr = features.slice(0, 5).join("、");
    return `Worker 已生成${sizeHint}的${typeDesc}，包含 ${featureStr}。完整结果已归档。`;
  }

  return `Worker 已生成${sizeHint}的${typeDesc}，完整结果已归档。`;
}

// ── 结果类型 ──────────────────────────────────────────────────────────────────

export type WorkerResultEnvelope = {
  artifact: {
    content: string;
    contentType: WorkerArtifactContentType;
    artifactId?: string;
  };
  brief: {
    summaryForManager: string;
    capabilities?: string[];
    changedFiles?: string[];
    nextSuggestedActions?: string[];
  };
  meta: {
    origin: "worker";
    contentKind: "artifact";
    taskId?: string;
    artifactId?: string;
  };
};

// ── 构造函数 ──────────────────────────────────────────────────────────────────

export function buildWorkerResultEnvelope(input: {
  content: string;
  taskId?: string;
  artifactId?: string;
  contentType?: WorkerArtifactContentType;
  summaryForManager?: string;
}): WorkerResultEnvelope {
  const { content, taskId, artifactId } = input;
  const contentType = input.contentType ?? detectContentType(content);

  // priority: 传入的 summary > 根据内容推导 > 最终兜底
  const summaryForManager =
    input.summaryForManager && input.summaryForManager.length > 0
      ? input.summaryForManager
      : deriveSummaryFromContent(content);

  return {
    artifact: {
      content,
      contentType,
      artifactId: artifactId ?? taskId,
    },
    brief: {
      summaryForManager,
    },
    meta: {
      origin: "worker",
      contentKind: "artifact",
      taskId,
      artifactId: artifactId ?? taskId,
    },
  };
}

// ── 工具：从内容派生 contentType（供外部复用） ────────────────────────────────

export { detectContentType };
