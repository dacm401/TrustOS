import { describe, it, expect } from "vitest";
import { buildManagerView } from "../../../src/services/context/manager-view.js";

// ── 测试 1：Worker artifact 被替换为 brief ─────────────────────────────────

describe("buildManagerView", () => {
  it("drops worker artifact and replaces with brief", () => {
    const result = buildManagerView([
      {
        role: "assistant",
        content:
          "```tsx\nexport default function App() {}\n```",
        meta: {
          origin: "worker",
          contentKind: "artifact",
          taskId: "task_1",
          artifactId: "artifact_1",
          summaryForManager: "生成了 React 页面。",
        },
      },
    ]);

    expect(JSON.stringify(result.messages)).not.toContain(
      "export default function"
    );
    expect(JSON.stringify(result.messages)).toContain("生成了 React 页面");
    expect(result.manifest.droppedWorkerArtifacts).toBe(1);
    expect(result.manifest.replacedWorkerArtifactsWithBrief).toBe(1);
  });

  // ── 测试 2：Worker brief 保留 ─────────────────────────────────────────────

  it("keeps worker brief", () => {
    const result = buildManagerView([
      {
        role: "assistant",
        content: "Worker 已生成登录页，包含校验和 loading。",
        meta: {
          origin: "worker",
          contentKind: "brief",
        },
      },
    ]);

    expect(result.messages).toHaveLength(1);
    expect(result.manifest.keptWorkerBriefs).toBe(1);
  });

  // ── 测试 3：Manager 长回复不被误删 ───────────────────────────────────────

  it("keeps long manager chat even if it looks like code", () => {
    const longManagerReply = "这是一段 Manager 的长解释。".repeat(200);

    const result = buildManagerView([
      {
        role: "assistant",
        content: longManagerReply,
        meta: {
          origin: "manager",
          contentKind: "chat",
        },
      },
    ]);

    expect(result.messages[0].content).toBe(longManagerReply);
    expect(result.manifest.droppedWorkerArtifacts).toBe(0);
    expect(result.manifest.legacyArtifactCompressed).toBe(0);
  });

  // ── 测试 4：legacy 无 meta 代码被兜底压缩 ────────────────────────────────

  it("compresses legacy assistant message with no meta when it looks like artifact", () => {
    const result = buildManagerView([
      {
        role: "assistant",
        content:
          "```tsx\nimport React from 'react';\nexport default function App() {}\n```",
      },
    ]);

    expect(JSON.stringify(result.messages)).not.toContain("import React");
    expect(result.manifest.legacyArtifactCompressed).toBe(1);
  });

  // ── 测试 5：status/thinking 丢弃 ─────────────────────────────────────────

  it("drops status and thinking messages", () => {
    const result = buildManagerView([
      {
        role: "assistant",
        content: "Worker 已启动...",
        meta: {
          origin: "system",
          contentKind: "status",
        },
      },
      {
        role: "assistant",
        content: "分析中...",
        meta: {
          origin: "system",
          contentKind: "thinking",
        },
      },
    ]);

    expect(result.messages).toHaveLength(0);
    expect(result.manifest.droppedStatusMessages).toBe(2);
  });

  // ── 测试 6：slice 在过滤替换后执行 ───────────────────────────────────────

  it("applies slice after filtering (does not cut useful messages)", () => {
    // 10 条消息：前 5 条 user，第 6 条是 Worker artifact，后 4 条 user
    const history = [];
    for (let i = 0; i < 5; i++) {
      history.push({ role: "user" as const, content: `message ${i}` });
    }
    history.push({
      role: "assistant" as const,
      content: "```\nlong code\n```",
      meta: {
        origin: "worker",
        contentKind: "artifact",
        summaryForManager: "生成了一段代码。",
      },
    });
    for (let i = 6; i < 10; i++) {
      history.push({ role: "user" as const, content: `message ${i}` });
    }

    const result = buildManagerView(history, { maxMessages: 5 });

    // 结果不应包含 Worker artifact 原文
    expect(JSON.stringify(result.messages)).not.toContain("long code");
    // 不应超过 maxMessages
    expect(result.messages.length).toBeLessThanOrEqual(5);
    // 应该保留最近的 user 消息
    expect(result.messages.some((m) => m.content === "message 9")).toBe(true);
    // 应该包含 Worker brief 替代
    expect(
      result.messages.filter((m) => m.meta?.contentKind === "brief")
    ).toHaveLength(1);
  });

  // ── 测试 7：混合场景────────── ────────────────────────────────────────────

  it("handles mixed history correctly", () => {
    const result = buildManagerView([
      { role: "user", content: "帮我写登录页" },
      {
        role: "assistant",
        content: "我会委托 Worker 生成。",
        meta: { origin: "manager", contentKind: "chat" },
      },
      {
        role: "assistant",
        content: "执行中...",
        meta: { origin: "system", contentKind: "status" },
      },
      {
        role: "assistant",
        content: "```\nlong code output\n```",
        meta: {
          origin: "worker",
          contentKind: "artifact",
          summaryForManager: "生成了登录页。",
        },
      },
      { role: "user", content: "很好" },
    ]);

    // status 丢弃
    expect(result.manifest.droppedStatusMessages).toBe(1);
    // Worker artifact 替换
    expect(result.manifest.droppedWorkerArtifacts).toBe(1);
    expect(result.manifest.replacedWorkerArtifactsWithBrief).toBe(1);
    // 没有 legacy 压缩（有 meta）
    expect(result.manifest.legacyArtifactCompressed).toBe(0);
    // Manager chat 保留
    expect(result.manifest.keptManagerMessages).toBe(1);
    // 最终消息包含 "很好"
    expect(result.messages.some((m) => m.content === "很好")).toBe(true);
    // 最终消息不包含 "long code output"
    expect(JSON.stringify(result.messages)).not.toContain("long code output");
  });

  // ── 测试 8：manifest rawChars / safeChars ────────────────────────────────

  it("correctly reports rawChars and safeChars", () => {
    const result = buildManagerView([
      {
        role: "assistant",
        content: "x".repeat(3000),
        meta: {
          origin: "worker",
          contentKind: "artifact",
          summaryForManager: "简短摘要。",
        },
      },
      { role: "user", content: "很好" },
    ]);

    // raw 比 safe 大得多（artifact 被替换为短 brief）
    expect(result.manifest.rawChars).toBeGreaterThan(2500);
    expect(result.manifest.safeChars).toBeLessThan(300);
    expect(result.manifest.droppedWorkerArtifacts).toBe(1);
  });
});
