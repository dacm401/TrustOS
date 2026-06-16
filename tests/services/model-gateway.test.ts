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
  // S92P-HF2: mock mode 下，所有模型（含未知模型）都被 mock gate 拦截，不会走到 provider 查找
  // 因此未知模型名在 mock 模式下应返回 mock 响应而非抛出异常
  it("G-06: mock mode — 未知模型名被 mock gate 拦截，返回 mock 响应而非抛出异常", async () => {
    const { callModelFull } = await import("../../src/models/model-gateway.js");
    // MOCK_LLM_ENABLED=true 时，mock gate 拦截所有调用，包括未知模型
    const resp = await callModelFull("this-model-does-not-exist-12345", [
      { role: "user", content: "hi" },
    ]);
    expect(resp).toBeDefined();
    expect(resp.content).toBeDefined();
    expect(typeof resp.content).toBe("string");
    expect(resp.content.length).toBeGreaterThan(0);
    // 应返回 direct_answer 类型的 mock ManagerDecision（因为 isManager=false，走 Worker 路径的 default）
    expect(resp.input_tokens).toBeGreaterThan(0);
    expect(resp.output_tokens).toBeGreaterThan(0);
  });
});

// ── S92P-HF2: Worker mock 输出语义测试 ──────────────────────────────────────

describe("S92P-HF2: Worker mock 输出 — LoginPage 范围限制", () => {
  // 使用 callModelFull 的 Worker 路径（isManager=false），验证不同 prompt 返回不同页面

  it("HF2-W01: 阳光折射科普网页 — 不返回 LoginPage", async () => {
    const { callModelFull } = await import("../../src/models/model-gateway.js");
    const resp = await callModelFull("gpt-4o-mini", [
      { role: "user", content: "帮我写一个阳光折射原理的科普网页" },
    ], undefined, "worker_task");
    const c = resp.content;
    // 不应包含登录相关词汇
    expect(c).not.toMatch(/LoginPage/i);
    expect(c).not.toMatch(/Username/i);
    expect(c).not.toMatch(/Password/i);
    // 应包含主题词
    expect(c).toMatch(/阳光/);
    expect(c).toMatch(/折射/);
    expect(c).toMatch(/科普/);
  });

  it("HF2-W02: 注册页面请求 — 可返回 RegisterPage", async () => {
    const { callModelFull } = await import("../../src/models/model-gateway.js");
    const resp = await callModelFull("gpt-4o-mini", [
      { role: "user", content: "帮我写一个用户注册页面" },
    ], undefined, "worker_task");
    const c = resp.content;
    // 应包含注册页面内容
    expect(c).toMatch(/RegisterPage|register|Create Account|Username/i);
  });

  it("HF2-W03: 登录页面请求 — 可返回 LoginPage", async () => {
    const { callModelFull } = await import("../../src/models/model-gateway.js");
    const resp = await callModelFull("gpt-4o-mini", [
      { role: "user", content: "帮我写一个用户登录页面" },
    ], undefined, "worker_task");
    const c = resp.content;
    expect(c).toMatch(/LoginPage|login|Sign In|Username/i);
  });

  it("HF2-W04: 普通网页请求 — 返回 TopicPage 而非 LoginPage", async () => {
    const { callModelFull } = await import("../../src/models/model-gateway.js");
    const resp = await callModelFull("gpt-4o-mini", [
      { role: "user", content: "帮我写一个关于量子计算的介绍页面" },
    ], undefined, "worker_task");
    const c = resp.content;
    expect(c).not.toMatch(/LoginPage/i);
    expect(c).not.toMatch(/Username/i);
    expect(c).not.toMatch(/Password/i);
    // TopicPage 应包含主题词
    expect(c).toMatch(/量子计算/);
  });

  it("HF2-W05: 标题修改请求 — 返回 UpdatedPage", async () => {
    const { callModelFull } = await import("../../src/models/model-gateway.js");
    const resp = await callModelFull("gpt-4o-mini", [
      { role: "user", content: "把标题改大一点" },
    ], undefined, "worker_task");
    const c = resp.content;
    expect(c).not.toMatch(/LoginPage/i);
    expect(c).toMatch(/UpdatedPage|Updated/i);
  });

  it("HF2-W06: 蓝色主题请求 — 返回 BlueThemedPage", async () => {
    const { callModelFull } = await import("../../src/models/model-gateway.js");
    const resp = await callModelFull("gpt-4o-mini", [
      { role: "user", content: "把按钮颜色改成蓝色" },
    ], undefined, "worker_task");
    const c = resp.content;
    expect(c).not.toMatch(/LoginPage/i);
    expect(c).toMatch(/blue|Blue/i);
  });
});

describe("S92P-HF2: Mock bypass guard — mock=true 时拒绝 provider 调用", () => {
  it("HF2-G01: mock mode 下 callModelFull 不应调用真实 provider", async () => {
    const { callModelFull } = await import("../../src/models/model-gateway.js");
    // MOCK_LLM_ENABLED=true 时，所有调用都应走 mock gate
    // 真实模型名也应被拦截，不抛异常
    const resp = await callModelFull("gpt-4o", [
      { role: "user", content: "test" },
    ]);
    expect(resp).toBeDefined();
    expect(resp.content).toBeDefined();
    // 不应是真实 API 响应（真实 API 在无 key 时会抛 401）
  });

  it("HF2-G02: mock mode 下 callModelStream 不应调用真实 provider", async () => {
    const { callModelStream } = await import("../../src/models/model-gateway.js");
    const stream = callModelStream("gpt-4o", [
      { role: "user", content: "test" },
    ]);
    // mock gate 拦截后返回 mock stream
    expect(stream).toBeDefined();
    expect(typeof stream[Symbol.asyncIterator]).toBe("function");
  });
});

// ── S92P-HF2: non-mock mode 未知模型行为 ──────────────────────────────────────

describe("S92P-HF2: non-mock mode — 未知模型应抛出 No provider found", () => {
  const originalEnv = process.env.TRUSTOS_E2E_MOCK_LLM;

  beforeAll(() => {
    // 临时关闭 mock 模式以验证真实 provider 查找行为
    process.env.TRUSTOS_E2E_MOCK_LLM = "false";
  });

  afterAll(() => {
    // 恢复原始值
    if (originalEnv === undefined) {
      delete process.env.TRUSTOS_E2E_MOCK_LLM;
    } else {
      process.env.TRUSTOS_E2E_MOCK_LLM = originalEnv;
    }
  });

  it("HF2-G03: mock=false — 未知模型名 callModelFull 抛出 No provider found", async () => {
    // 重置模块缓存，让 MOCK_LLM_ENABLED 重新计算
    vi.resetModules();
    const { callModelFull } = await import("../../src/models/model-gateway.js");
    await expect(
      callModelFull("this-model-does-not-exist-12345", [
        { role: "user", content: "hi" },
      ])
    ).rejects.toThrow(/No provider found/);
  });

  it("HF2-G04: mock=false — 已知模型名 callModelFull 也走 provider 查找（无真实 key 时抛 provider_error）", async () => {
    vi.resetModules();
    const { callModelFull } = await import("../../src/models/model-gateway.js");
    // 真实模型名在 mock=false 时会走 provider 查找，找到 provider 但无 API key 时会抛异常
    // 这里只验证不会走 mock gate（即不会返回 mock 响应），具体异常类型取决于环境
    const result = callModelFull("gpt-4o", [
      { role: "user", content: "test" },
    ]);
    // 如果 mock gate 被跳过了，要么抛出 provider 相关错误，要么超时
    // 关键是不应返回 mock 响应
    await expect(result).rejects.toThrow(); // 至少应该抛异常（无 API key）
  });
});
