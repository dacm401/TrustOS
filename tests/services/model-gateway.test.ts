/**
 * model-gateway.ts — 单元测试
 *
 * T-03: 覆盖 model-gateway.ts 的核心逻辑
 *
 * 注意：callModelFull / callModel 需要真实 API key，
 * 其行为通过 integration tests（tests/api/）覆盖。
 * 本文件只测试无外部依赖的部分。
 */

import { describe, it, expect } from "vitest";
import { getAvailableModels } from "../../src/models/model-gateway.js";

describe("model-gateway: getAvailableModels", () => {
  it("G-01: 返回非空数组", () => {
    const models = getAvailableModels();
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
  });

  it("G-02: 包含 OpenAI 模型（gpt-*）", () => {
    const models = getAvailableModels();
    expect(models.some((m) => m.startsWith("gpt-"))).toBe(true);
  });

  it("G-03: 包含 Anthropic 模型（claude-*）", () => {
    const models = getAvailableModels();
    expect(models.some((m) => m.startsWith("claude-"))).toBe(true);
  });

  it("G-04: 所有模型名称都是非空字符串", () => {
    const models = getAvailableModels();
    models.forEach((m) => {
      expect(typeof m).toBe("string");
      expect(m.length).toBeGreaterThan(0);
    });
  });

  it("G-05: gpt-4o-mini 和 claude-3-5-sonnet 均在列表中", () => {
    const models = getAvailableModels();
    expect(models).toContain("gpt-4o-mini");
    expect(models).toContain("claude-3-5-sonnet-20241022");
  });
});

describe("model-gateway: callModelFull 错误路径（无真实 API）", () => {
  it("G-06: 未知模型名 → 抛出 'No provider found' Error", async () => {
    const { callModelFull } = await import("../../src/models/model-gateway.js");
    await expect(
      callModelFull("this-model-does-not-exist-12345", [
        { role: "user", content: "hi" },
      ])
    ).rejects.toThrow("No provider found for model: this-model-does-not-exist-12345");
  });
});
