/**
 * Sprint 62P: Patch-first Revision V0
 *
 * Tests: patch-applier.ts — applyPatchPlan
 *
 * 覆盖：
 * PA-01 replace 唯一命中成功
 * PA-02 find 未命中失败
 * PA-03 find 多次命中失败
 * PA-04 insert_after 成功
 * PA-05 insert_before 成功
 * PA-06 patch 后 content 非空
 * PA-07 fallback reason 正确（输出稳定）
 */

import { describe, it, expect } from "vitest";
import { applyPatchPlan } from "../../src/services/patch/patch-applier.js";
import type { PatchPlan } from "../../src/services/patch/patch-types.js";

const MOCK_SOURCE = `<div>
  <h1>Login Page</h1>
  <button className="submit-btn">Submit</button>
</div>`;

function makePatchPlan(overrides: Partial<PatchPlan> = {}): PatchPlan {
  return {
    patchId: "test-patch-001",
    traceId: "trace-001",
    targetArtifactId: "artifact-001",
    revisionInstruction: "change button color to blue",
    operations: [],
    confidence: 0.85,
    fallbackToFullRewrite: false,
    ...overrides,
  };
}

describe("PA-01: replace — 唯一命中成功", () => {
  it("replace 单条命中，ok=true，appliedOperations=1", () => {
    const plan = makePatchPlan({
      operations: [
        { op: "replace", find: "Submit", replace: "Login", reason: "change text" },
      ],
    });
    const result = applyPatchPlan(MOCK_SOURCE, plan);
    expect(result.ok).toBe(true);
    expect(result.appliedOperations).toBe(1);
    expect(result.content).toContain("Login");
    expect(result.content).not.toContain("Submit");
  });

  it("replace 多条操作全部成功", () => {
    const plan = makePatchPlan({
      operations: [
        { op: "replace", find: "Login Page", replace: "Login" },
        { op: "replace", find: "submit-btn", replace: "submit-btn bg-blue-600", reason: "add blue class" },
      ],
    });
    const result = applyPatchPlan(MOCK_SOURCE, plan);
    expect(result.ok).toBe(true);
    expect(result.appliedOperations).toBe(2);
    expect(result.totalOperations).toBe(2);
    expect(result.content).toContain("bg-blue-600");
    expect(result.content).not.toContain("Login Page");
  });
});

describe("PA-02: find 未命中失败", () => {
  it("patch 全部操作 find 未命中 → ok=false", () => {
    const plan = makePatchPlan({
      operations: [
        { op: "replace", find: "NONEXISTENT_STRING", replace: "something" },
      ],
    });
    const result = applyPatchPlan(MOCK_SOURCE, plan);
    expect(result.ok).toBe(false);
    expect(result.content).toBeUndefined();
    expect(result.errors).toBeDefined();
    expect(result.errors![0]).toContain("not found");
  });

  it("部分操作 find 未命中 → ok=false，已应用的需回退", () => {
    const plan = makePatchPlan({
      operations: [
        { op: "replace", find: "Submit", replace: "Login" },
        { op: "replace", find: "NONEXISTENT", replace: "nothing" },
      ],
    });
    const result = applyPatchPlan(MOCK_SOURCE, plan);
    expect(result.ok).toBe(false);
    expect(result.appliedOperations).toBe(1); // 第一条成功
    expect(result.errors!.length).toBeGreaterThanOrEqual(1);
  });
});

describe("PA-03: find 多次命中失败", () => {
  it("find 字符串在 source 中出现 2 次 → error", () => {
    const source = "<div>test</div><span>test</span>";
    const plan = makePatchPlan({
      operations: [
        { op: "replace", find: "test", replace: "modified" },
      ],
    });
    const result = applyPatchPlan(source, plan);
    expect(result.ok).toBe(false);
    expect(result.errors![0]).toContain("matched 2 times");
  });
});

describe("PA-04: insert_after 成功", () => {
  it("在指定字符串后插入", () => {
    const plan = makePatchPlan({
      operations: [
        { op: "insert_after", find: "<h1>Login Page</h1>", insert: "\n  <p>Welcome</p>" },
      ],
    });
    const result = applyPatchPlan(MOCK_SOURCE, plan);
    expect(result.ok).toBe(true);
    expect(result.content).toContain("<p>Welcome</p>");
    expect(result.content!.indexOf("<p>Welcome</p>")).toBeGreaterThan(
      result.content!.indexOf("<h1>Login Page</h1>")
    );
  });
});

describe("PA-05: insert_before 成功", () => {
  it("在指定字符串前插入", () => {
    const plan = makePatchPlan({
      operations: [
        { op: "insert_before", find: "</div>", insert: "  <footer>Footer</footer>\n" },
      ],
    });
    const result = applyPatchPlan(MOCK_SOURCE, plan);
    expect(result.ok).toBe(true);
    expect(result.content).toContain("<footer>Footer</footer>");
    expect(result.content!.indexOf("<footer>")).toBeLessThan(
      result.content!.indexOf("</div>")
    );
  });
});

describe("PA-06: patch 后 content 非空", () => {
  it("replace 替换为空字符串 → content 非空（原有其他内容）", () => {
    const plan = makePatchPlan({
      operations: [
        { op: "replace", find: "Submit", replace: "" },
      ],
    });
    const result = applyPatchPlan(MOCK_SOURCE, plan);
    expect(result.ok).toBe(true);
    expect(result.content!.trim().length).toBeGreaterThan(0);
  });
});

describe("PA-07: metrics 正确", () => {
  it("成功 patch 返回正确的 sourceBytes/outputBytes", () => {
    const plan = makePatchPlan({
      operations: [
        { op: "replace", find: "Submit", replace: "Login" },
      ],
    });
    const result = applyPatchPlan(MOCK_SOURCE, plan);
    expect(result.sourceBytes).toBe(MOCK_SOURCE.length);
    expect(result.outputBytes).toBeGreaterThan(0);
    expect(result.outputBytes).not.toBe(MOCK_SOURCE.length); // "Login" > "Submit"? nope, same length? Let's check
  });
});
