import { describe, it, expect } from "vitest";
import {
  compressConversationHistory,
  extractKeyInformation,
  createCompressedContext,
} from "../../src/services/context-compressor.js";

describe("context-compressor", () => {
  describe("compressConversationHistory", () => {
    it("should not compress short histories", () => {
      const messages = [
        { role: "user" as const, content: "你好" },
        { role: "assistant" as const, content: "你好！有什么可以帮助你的吗？" },
      ];

      const result = compressConversationHistory(messages);
      expect(result.compressed.length).toBe(2);
      expect(result.compressionRatio).toBe(1);
    });

    it("should compress long histories", () => {
      const messages = [
        { role: "user" as const, content: "你好，这是一个比较长的消息来测试压缩功能".repeat(10) },
        { role: "assistant" as const, content: "你好！".repeat(10) },
        { role: "user" as const, content: "什么是量子计算？" },
        { role: "assistant" as const, content: "量子计算是一种利用量子力学原理进行信息处理的计算方式".repeat(5) },
        { role: "user" as const, content: "请详细解释量子比特" },
        { role: "assistant" as const, content: "量子比特是量子计算的基本单位".repeat(5) },
        { role: "user" as const, content: "量子纠缠是什么？" },
        { role: "assistant" as const, content: "量子纠缠是量子力学中的一个现象".repeat(5) },
        { role: "user" as const, content: "谢谢" },
        { role: "assistant" as const, content: "不客气！" },
      ];

      const result = compressConversationHistory(messages, { maxTokens: 100 });
      expect(result.compressionRatio).toBeLessThan(1);
    });

    it("should preserve code snippets", () => {
      const messages = [
        { role: "user" as const, content: "写一个快速排序" },
        { role: "assistant" as const, content: "```python\ndef quicksort(arr):\n    return sorted(arr)\n```" },
        { role: "user" as const, content: "解释一下" },
      ];

      const result = compressConversationHistory(messages, { maxTokens: 50 });
      const hasCode = result.compressed.some((m) => m.content.includes("quicksort"));
      expect(hasCode).toBe(true);
    });

    it("should generate summary for compressed histories", () => {
      const messages = Array.from({ length: 20 }, (_, i) => ({
        role: (i % 2 === 0 ? "user" : "assistant") as const,
        content: `这是消息 ${i + 1}，包含一些内容来增加长度以便触发压缩。`.repeat(5),
      }));

      const result = compressConversationHistory(messages, { maxTokens: 500 });
      expect(result.summary).toBeTruthy();
      expect(result.compressionRatio).toBeLessThan(0.5);
    });
  });

  describe("extractKeyInformation", () => {
    it("should extract decisions", () => {
      const messages = [
        { role: "user" as const, content: "我应该用什么算法？" },
        { role: "assistant" as const, content: "我决定使用快速排序算法，因为效率更高。" },
      ];

      const info = extractKeyInformation(messages);
      expect(info.decisions.length).toBeGreaterThan(0);
    });

    it("should extract facts", () => {
      const messages = [
        { role: "assistant" as const, content: "请记住，用户喜欢简洁的回答。" },
      ];

      const info = extractKeyInformation(messages);
      expect(info.facts.length).toBeGreaterThan(0);
    });

    it("should extract pending questions", () => {
      const messages = [
        { role: "user" as const, content: "什么是量子纠缠？" },
      ];

      const info = extractKeyInformation(messages);
      expect(info.pendingQuestions.length).toBe(1);
    });

    it("should not duplicate answered questions", () => {
      const messages = [
        { role: "user" as const, content: "什么是量子纠缠？" },
        { role: "assistant" as const, content: "量子纠缠是..." },
      ];

      const info = extractKeyInformation(messages);
      expect(info.pendingQuestions.length).toBe(0);
    });
  });

  describe("createCompressedContext", () => {
    it("should return context and info", () => {
      const messages = [
        { role: "user" as const, content: "你好" },
        { role: "assistant" as const, content: "你好！" },
        { role: "user" as const, content: "什么是量子计算？" },
        { role: "assistant" as const, content: "量子计算是一种..." },
      ];

      const result = createCompressedContext(messages, { maxTokens: 100 });
      expect(result.context).toBeDefined();
      expect(result.info).toBeDefined();
      expect(result.info.originalCount).toBe(4);
      expect(result.info.compressedCount).toBeLessThanOrEqual(4);
    });
  });
});
