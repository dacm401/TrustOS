// Sprint 64P: Model Tiers V0 - 单元测试
// 覆盖 MT-01~03

import { describe, it, expect } from "vitest";
import {
  findModelTier,
  findFallbackModel,
  isCheaperThan,
} from "../../src/services/budget/model-tiers.js";

describe("MT-01: 找到 fallbackModel", () => {
  it("gpt-4o (reasoning) has fallbackModel gpt-4o-mini", () => {
    const fb = findFallbackModel("gpt-4o");
    expect(fb).toBe("gpt-4o-mini");
  });

  it("deepseek-ai/DeepSeek-V3 (standard) has fallbackModel deepseek-ai/DeepSeek-V4-Flash", () => {
    const fb = findFallbackModel("deepseek-ai/DeepSeek-V3");
    expect(fb).toBe("deepseek-ai/DeepSeek-V4-Flash");
  });

  it("Qwen/Qwen2.5-72B-Instruct has fallbackModel deepseek-ai/DeepSeek-V4-Flash", () => {
    const fb = findFallbackModel("Qwen/Qwen2.5-72B-Instruct");
    expect(fb).toBe("deepseek-ai/DeepSeek-V4-Flash");
  });

  it("claude-3-5-sonnet has fallbackModel claude-3-haiku", () => {
    const fb = findFallbackModel("claude-3-5-sonnet-20241022");
    expect(fb).toBe("claude-3-haiku-20240307");
  });

  it("DeepSeek-R1 (reasoning) has fallbackModel DeepSeek-V3", () => {
    const fb = findFallbackModel("deepseek-ai/DeepSeek-R1");
    expect(fb).toBe("deepseek-ai/DeepSeek-V3");
  });
});

describe("MT-02: cheap model 不降级", () => {
  it("deepseek-ai/DeepSeek-V4-Flash (cheap) has no fallbackModel", () => {
    const fb = findFallbackModel("deepseek-ai/DeepSeek-V4-Flash");
    expect(fb).toBeUndefined();
  });

  it("gpt-3.5-turbo (cheap) has no fallbackModel", () => {
    const fb = findFallbackModel("gpt-3.5-turbo");
    expect(fb).toBeUndefined();
  });

  it("Qwen/Qwen2.5-7B-Instruct (cheap) has no fallbackModel", () => {
    const fb = findFallbackModel("Qwen/Qwen2.5-7B-Instruct");
    expect(fb).toBeUndefined();
  });
});

describe("MT-03: manager reasoning model 可降级到 cheap/standard", () => {
  it("gpt-4o tier is reasoning", () => {
    const tier = findModelTier("gpt-4o");
    expect(tier?.tier).toBe("reasoning");
    expect(tier?.role).toBe("manager");
  });

  it("gpt-4o-mini tier is standard", () => {
    const tier = findModelTier("gpt-4o-mini");
    expect(tier?.tier).toBe("standard");
  });

  it("deepseek-ai/DeepSeek-V4-Flash tier is cheap", () => {
    const tier = findModelTier("deepseek-ai/DeepSeek-V4-Flash");
    expect(tier?.tier).toBe("cheap");
  });

  it("isCheaperThan: cheap < standard", () => {
    expect(isCheaperThan("deepseek-ai/DeepSeek-V4-Flash", "deepseek-ai/DeepSeek-V3")).toBe(true);
  });

  it("isCheaperThan: standard < reasoning", () => {
    expect(isCheaperThan("deepseek-ai/DeepSeek-V3", "gpt-4o")).toBe(true);
  });

  it("isCheaperThan: cheap NOT cheaper than cheap", () => {
    expect(isCheaperThan("deepseek-ai/DeepSeek-V4-Flash", "gpt-3.5-turbo")).toBe(false);
  });
});

describe("MT-04: 未知模型返回 undefined", () => {
  it("unknown-model has no tier", () => {
    const tier = findModelTier("totally-unknown-model");
    expect(tier).toBeUndefined();
  });

  it("unknown-model has no fallback", () => {
    const fb = findFallbackModel("totally-unknown-model");
    expect(fb).toBeUndefined();
  });
});
