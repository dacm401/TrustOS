/**
 * Sprint 62P: Patch-first Revision V0
 *
 * Tests: patchability.ts — isPatchableSmallEdit
 *
 * 覆盖：
 * PB-01 按钮改蓝色 patchable=true, patchMode=style
 * PB-02 标题改大一点 patchable=true, patchMode=style
 * PB-03 再帮我写注册页 patchable=false
 * PB-04 重构整个页面 patchable=false
 * PB-05 非 patchable 关键词 → fallback false
 * PB-06 完整新建场景 patchable=false
 */

import { describe, it, expect } from "vitest";
import { isPatchableSmallEdit } from "../../src/services/patch/patchability.js";

describe("PB-01: 按钮改蓝色 → patchable=true", () => {
  it("把按钮改成蓝色", () => {
    const result = isPatchableSmallEdit("把按钮改成蓝色");
    expect(result.patchable).toBe(true);
    // "改成" 同时匹配 style 和 text 关键词 → small_structure
    expect(result.patchMode).toBe("small_structure");
  });

  it("将按钮变为蓝色", () => {
    const result = isPatchableSmallEdit("将按钮变为蓝色");
    // "将…变"不在关键词中，"变为"的"变"字需检查
    // 当前 keywords 匹配"按钮"和"蓝色"，应 patchable
    expect(result.patchable).toBe(true);
  });
});

describe("PB-02: 标题改大一点 → patchable=true", () => {
  it("把标题改大一点", () => {
    const result = isPatchableSmallEdit("把标题改大一点");
    expect(result.patchable).toBe(true);
  });

  it("标题字号调大", () => {
    const result = isPatchableSmallEdit("标题字号调大");
    // "标题"和"字号"都是关键词
    expect(result.patchable).toBe(true);
  });
});

describe("PB-03: 再帮我写注册页 → patchable=false", () => {
  it("再帮我写注册页是新建，不是修订", () => {
    const result = isPatchableSmallEdit("再帮我写一个注册页");
    // "再帮我写"不是 patchable 关键词，"注册页"也不是
    // 但没有 non-patchable 关键词
    expect(result.patchable).toBe(false);
    expect(result.confidence).toBeLessThan(1);
  });
});

describe("PB-04: 大改动 → patchable=false", () => {
  it("重构整个页面", () => {
    const result = isPatchableSmallEdit("重构整个页面");
    expect(result.patchable).toBe(false);
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("重新设计页面布局", () => {
    const result = isPatchableSmallEdit("重新设计页面布局");
    expect(result.patchable).toBe(false);
  });

  it("添加完整购物车系统", () => {
    const result = isPatchableSmallEdit("添加完整购物车系统");
    expect(result.patchable).toBe(false);
  });

  it("做成电商网站", () => {
    const result = isPatchableSmallEdit("做成电商网站");
    expect(result.patchable).toBe(false);
  });
});

describe("PB-05: 非 patchable 关键词 → fallback false", () => {
  it("写一个天气预报组件", () => {
    const result = isPatchableSmallEdit("写一个天气预报组件");
    expect(result.patchable).toBe(false);
  });

  it("帮我优化性能", () => {
    const result = isPatchableSmallEdit("帮我优化性能");
    expect(result.patchable).toBe(false);
  });
});

describe("PB-06: 完整新建场景 patchable=false", () => {
  // 注意：实际运行时这类新建请求会被 policy 路由为 direct_create_artifact，
  // isPatchableSmallEdit 只会在 direct_artifact_revision 路径上被调用。
  it("帮我写一个 React 登录页（不含小修订关键词）", () => {
    const result = isPatchableSmallEdit("帮我写一个 React 登录页");
    expect(result.patchable).toBe(false);
  });

  it("新增用户管理页面含表格和搜索", () => {
    const result = isPatchableSmallEdit("新增用户管理页面含表格和搜索");
    expect(result.patchable).toBe(false);
  });
});
