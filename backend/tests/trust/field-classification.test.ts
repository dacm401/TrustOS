/**
 * Field Classification — 单元测试
 */

import { describe, it, expect } from "vitest";
import {
  FIELD_CLASSIFICATION,
  getFieldClassification,
  getSensitiveFields,
  getStrictlyPrivateFields,
  buildClassificationMap,
} from "../../src/trust/field-classification.js";

describe("FIELD_CLASSIFICATION", () => {
  it("覆盖所有已知表的所有字段", () => {
    const keys = Object.keys(FIELD_CLASSIFICATION);
    expect(keys.length).toBeGreaterThan(0);

    const tables = new Set(keys.map((k) => k.split(".")[0]));
    expect(tables.has("task_archives")).toBe(true);
    expect(tables.has("task_commands")).toBe(true);
    expect(tables.has("task_worker_results")).toBe(true);
    expect(tables.has("task_archive_events")).toBe(true);
    expect(tables.has("delegation_archives")).toBe(true);
    expect(tables.has("memory_entries")).toBe(true);
    expect(tables.has("feedback_events")).toBe(true);
    expect(tables.has("decision_logs")).toBe(true);
  });

  it("没有字段被遗漏分类（每条记录都有分类值）", () => {
    const values = Object.values(FIELD_CLASSIFICATION);
    const validClasses = ["public", "internal", "confidential", "strictly_private"];
    for (const v of values) {
      expect(validClasses).toContain(v);
    }
  });
});

describe("getFieldClassification()", () => {
  it("task_commands.user_preference_summary → strictly_private", () => {
    expect(getFieldClassification("task_commands", "user_preference_summary")).toBe("strictly_private");
  });

  it("task_commands.task → confidential", () => {
    expect(getFieldClassification("task_commands", "task")).toBe("confidential");
  });

  it("task_commands.action → internal", () => {
    expect(getFieldClassification("task_commands", "action")).toBe("internal");
  });

  it("delegation_archives.user_id → strictly_private", () => {
    expect(getFieldClassification("delegation_archives", "user_id")).toBe("strictly_private");
  });

  it("delegation_archives.original_message → confidential", () => {
    expect(getFieldClassification("delegation_archives", "original_message")).toBe("confidential");
  });

  it("memory_entries.user_id → strictly_private", () => {
    expect(getFieldClassification("memory_entries", "user_id")).toBe("strictly_private");
  });

  it("memory_entries.content → confidential", () => {
    expect(getFieldClassification("memory_entries", "content")).toBe("confidential");
  });

  it("task_archives.task_id → public", () => {
    expect(getFieldClassification("task_archives", "task_id")).toBe("public");
  });

  it("task_worker_results.result → internal", () => {
    expect(getFieldClassification("task_worker_results", "result")).toBe("internal");
  });

  it("未知字段 → internal（保守默认）", () => {
    expect(getFieldClassification("task_archives", "unknown_field_xyz")).toBe("internal");
  });
});

describe("getSensitiveFields()", () => {
  it("task_commands 有 sensitive 字段", () => {
    const fields = getSensitiveFields("task_commands");
    expect(fields).toContain("task_commands.user_preference_summary");
    expect(fields).toContain("task_commands.task");
    expect(fields).toContain("task_commands.relevant_facts");
  });

  it("delegation_archives 有 sensitive 字段", () => {
    const fields = getSensitiveFields("delegation_archives");
    expect(fields).toContain("delegation_archives.user_id");
    expect(fields).toContain("delegation_archives.original_message");
  });

  it("task_worker_results 无 sensitive 字段（全为 internal/public）", () => {
    const fields = getSensitiveFields("task_worker_results");
    expect(fields).toHaveLength(0);
  });
});

describe("getStrictlyPrivateFields()", () => {
  it("返回所有 strictly_private 字段", () => {
    const fields = getStrictlyPrivateFields();
    expect(fields).toContain("delegation_archives.user_id");
    expect(fields).toContain("memory_entries.user_id");
    expect(fields).toContain("feedback_events.user_id");
    expect(fields).toContain("decision_logs.user_id");
    expect(fields).toContain("task_commands.user_preference_summary");
  });

  it("user_id 相关字段大多数是 strictly_private", () => {
    const fields = getStrictlyPrivateFields();
    const userIdFields = fields.filter((f) => f.includes("user_id"));
    expect(userIdFields.length).toBeGreaterThan(0);
  });
});

describe("buildClassificationMap()", () => {
  it("返回与 FIELD_CLASSIFICATION 等价的 Record", () => {
    const map = buildClassificationMap();
    expect(map["delegation_archives.user_id"]).toBe("strictly_private");
    expect(map["task_commands.action"]).toBe("internal");
  });

  it("返回的是副本，不影响原始常量", () => {
    const map = buildClassificationMap();
    map["custom.new_field"] = "confidential";
    expect(FIELD_CLASSIFICATION["custom.new_field"]).toBeUndefined();
  });
});
