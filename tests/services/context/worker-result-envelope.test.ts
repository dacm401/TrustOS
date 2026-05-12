import { describe, it, expect } from "vitest";
import { buildWorkerResultEnvelope, detectContentType } from "../../../src/services/context/worker-result-envelope.js";

describe("WorkerResultEnvelope", () => {
  it("保留 artifact 完整内容", () => {
    const code = "```tsx\nexport default function App() {\n  return <div>Hello</div>;\n}\n```";
    const envelope = buildWorkerResultEnvelope({
      content: code,
      taskId: "task_1",
      artifactId: "artifact_1",
    });

    expect(envelope.artifact.content).toBe(code);
    expect(envelope.artifact.content).toContain("export default function");
    expect(envelope.meta.origin).toBe("worker");
    expect(envelope.meta.contentKind).toBe("artifact");
    expect(envelope.meta.taskId).toBe("task_1");
  });

  it("summaryForManager 非空且不含 artifact 原文", () => {
    const code = "```tsx\nexport default function App() {\n  return <div>Hello</div>;\n}\n```";
    const envelope = buildWorkerResultEnvelope({ content: code });

    expect(envelope.brief.summaryForManager.length).toBeGreaterThan(0);
    expect(envelope.brief.summaryForManager).not.toContain("export default function");
    expect(envelope.brief.summaryForManager).not.toContain("```tsx");
  });

  it("传入的 summaryForManager 优先", () => {
    const envelope = buildWorkerResultEnvelope({
      content: "large artifact content here",
      summaryForManager: "生成了登录页，包含表单校验。",
    });

    expect(envelope.brief.summaryForManager).toBe("生成了登录页，包含表单校验。");
  });

  it("tsx 内容推导出有信息量的摘要", () => {
    const tsxCode = `import React, { useState } from "react";
import { useEffect } from "react";

export default function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetch("/api/login", { method: "POST", body: JSON.stringify({ username, password }) });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col p-4">
      <input type="text" className="border rounded px-2 py-1" />
      <button type="submit" className="bg-blue-500 text-white px-4 py-2 rounded">
        登录
      </button>
    </form>
  );
}`;

    const envelope = buildWorkerResultEnvelope({ content: tsxCode });
    const summary = envelope.brief.summaryForManager;

    expect(summary).toContain("React");
    expect(summary).toContain("组件");
    expect(summary).not.toContain("export default");
    expect(summary).not.toContain("```tsx");
  });

  it("html 内容推导出 HTML 摘要", () => {
    const html = "<!DOCTYPE html><html><body><div class='container'><form><input type='text'/></form></div></body></html>";
    const envelope = buildWorkerResultEnvelope({ content: html });

    expect(envelope.brief.summaryForManager).toContain("HTML");
  });

  it("detectContentType 正确识别 tsx", () => {
    expect(detectContentType("```tsx\nconst x = 1;\n```")).toBe("tsx");
    expect(detectContentType("import React from 'react';")).toBe("tsx");
  });

  it("detectContentType 正确识别 html", () => {
    expect(detectContentType("<!DOCTYPE html><html></html>")).toBe("html");
    expect(detectContentType("<html><body>Hello</body></html>")).toBe("html");
  });

  it("detectContentType 正确识别 code", () => {
    expect(detectContentType("```\nfunction hello() {}\n```")).toBe("code");
    expect(detectContentType("const x = 1;\nfunction test() {}")).toBe("code");
  });
});
