import { describe, it, expect } from "vitest";
import {
  classifyIntent,
  shouldSkipLLMRouting,
  generateQuickResponse,
} from "../../src/services/intent-classifier.js";

describe("intent-classifier", () => {
  describe("classifyIntent", () => {
    it("should classify greeting", () => {
      const result = classifyIntent("你好");
      expect(result.category).toBe("greeting");
      expect(result.confidence).toBeGreaterThan(0.9);
      expect(result.suggested_action).toBe("direct_answer");
    });

    it("should classify hi", () => {
      const result = classifyIntent("hi!");
      expect(result.category).toBe("greeting");
      expect(result.confidence).toBeGreaterThan(0.9);
    });

    it("should classify hello", () => {
      const result = classifyIntent("Hello there!");
      expect(result.category).toBe("greeting");
    });

    it("should classify question", () => {
      const result = classifyIntent("什么是量子计算？");
      expect(result.category).toBe("question");
    });

    it("should classify command", () => {
      const result = classifyIntent("帮我写一个排序算法");
      expect(result.category).toBe("command");
      expect(result.suggested_action).toBe("execute_task");
    });

    it("should classify clarification", () => {
      const result = classifyIntent("???");
      expect(result.category).toBe("clarification");
      expect(result.suggested_action).toBe("ask_clarification");
    });

    it("should classify feedback", () => {
      const result = classifyIntent("不对，不是我想要的");
      expect(result.category).toBe("feedback");
    });

    it("should classify chitchat", () => {
      const result = classifyIntent("谢谢");
      expect(result.category).toBe("chitchat");
    });

    it("should classify complex queries", () => {
      const result = classifyIntent("请分析一下当前AI行业的发展趋势，并生成可视化图表");
      expect(result.category).toBe("complex");
    });

    it("should handle long complex queries", () => {
      const result = classifyIntent(
        "分析一下过去三年中每一个季度的营收数据，计算同比和环比增长率，然后生成一份详细的分析报告，包括趋势图和关键洞察"
      );
      expect(result.category).toBe("complex");
    });
  });

  describe("shouldSkipLLMRouting", () => {
    it("should return true for high-confidence greeting", () => {
      const intent = classifyIntent("你好！");
      expect(shouldSkipLLMRouting(intent)).toBe(true);
    });

    it("should return false for question", () => {
      const intent = classifyIntent("什么是量子计算？");
      expect(shouldSkipLLMRouting(intent)).toBe(false);
    });

    it("should return true for high-confidence greeting in english", () => {
      const intent = classifyIntent("Hello!");
      expect(shouldSkipLLMRouting(intent)).toBe(true);
    });
  });

  describe("generateQuickResponse", () => {
    it("should generate quick response for greeting in zh", () => {
      const intent = classifyIntent("你好");
      const response = generateQuickResponse(intent, "zh");
      expect(response).toBeTruthy();
      expect(response).toContain("你好");
    });

    it("should generate quick response for greeting in en", () => {
      const intent = classifyIntent("Hello");
      const response = generateQuickResponse(intent, "en");
      expect(response).toBeTruthy();
      expect(response).toContain("Hello");
    });

    it("should return null for question", () => {
      const intent = classifyIntent("什么是量子计算？");
      const response = generateQuickResponse(intent, "zh");
      expect(response).toBeNull();
    });
  });
});
