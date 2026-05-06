/**
 * Phase 5.1 — 降级路径一致性回归
 *
 * 路径 A：协议违规（schema_version 缺失/未知）→ state=failed, errors 可诊断
 * 路径 B：JSON parse 失败（模型输出不含合法 JSON）→ state=failed, errors 可区分
 * 验收：两条路径都不会卡在 running，errors 字段可区分
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TaskArchiveRepo } from "../../../src/db/task-archive-repo.js";
import type { ManagerDecision } from "../../../src/types/index.js";

const SESSION_PREFIX = "phase51";

function makeDecision(overrides: Partial<ManagerDecision> = {}): ManagerDecision {
  return {
    schema_version: "manager_decision_v1",
    decision_type: "direct_answer",
    routing_layer: "L0",
    reason: "test",
    confidence: 0,
    needs_archive: false,
    ...overrides,
  } as any;
}

describe("Phase 5.1 — 降级路径一致性", () => {

  beforeEach(async () => {
    const { truncateTables, resetAppPool } = await import("../../db/harness.js");
    await truncateTables();
    await resetAppPool();
  });

  // ── 路径 A：协议违规（schema_version 缺失）─────────────────────

  describe("路径 A：协议违规 → state=failed + errors 可诊断", () => {

    it("SCHEMA_VERSION_MISSING → archive state=failed, errors 含协议违规信息", async () => {
      const archive = await TaskArchiveRepo.create({
        session_id: `${SESSION_PREFIX}-missing`,
        user_id: "phase51-user",
        decision: makeDecision({ reason: "PROTOCOL_VIOLATION: SCHEMA_VERSION_MISSING" }),
        user_input: "测试协议违规",
      });

      await TaskArchiveRepo.updateState(archive.id, "failed");
      await TaskArchiveRepo.setSlowExecution(archive.id, {
        errors: ["SCHEMA_VERSION_MISSING: schema_version is required in manager decision"],
        protocol_violation: true,
        matched_json_len: 0,
      });

      const retrieved = await TaskArchiveRepo.getById(archive.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.state).toBe("failed");
      expect((retrieved!.slow_execution as any).errors).toEqual(
        expect.arrayContaining([expect.stringContaining("SCHEMA_VERSION")])
      );
      expect((retrieved!.slow_execution as any).protocol_violation).toBe(true);
    });

    it("SCHEMA_VERSION_UNKNOWN → archive state=failed, errors 含未知版本信息", async () => {
      const archive = await TaskArchiveRepo.create({
        session_id: `${SESSION_PREFIX}-unknown`,
        user_id: "phase51-user",
        decision: makeDecision({ reason: "PROTOCOL_VIOLATION: SCHEMA_VERSION_UNKNOWN" }),
        user_input: "测试未知 schema 版本",
      });

      await TaskArchiveRepo.updateState(archive.id, "failed");
      await TaskArchiveRepo.setSlowExecution(archive.id, {
        errors: ['SCHEMA_VERSION_UNKNOWN: Unknown schema_version: "v99"'],
        protocol_violation: true,
        matched_json_len: 30,
      });

      const retrieved = await TaskArchiveRepo.getById(archive.id);
      expect(retrieved!.state).toBe("failed");
      expect((retrieved!.slow_execution as any).protocol_violation).toBe(true);
      expect((retrieved!.slow_execution as any).errors[0]).toMatch(/SCHEMA_VERSION/);
    });
  });

  // ── 路径 B：JSON parse 失败（模型输出不含 JSON）────────────

  describe("路径 B：JSON parse 失败 → state=failed + errors 可区分", () => {

    it("模型输出纯文本无 JSON → archive state=failed, errors 标识 parse 失败", async () => {
      const archive = await TaskArchiveRepo.create({
        session_id: `${SESSION_PREFIX}-noparse`,
        user_id: "phase51-user",
        decision: makeDecision({ reason: "MANAGER_OUTPUT_PARSE_FAILED — no JSON found" }),
        user_input: "用Python写一个快速排序",
      });

      await TaskArchiveRepo.updateState(archive.id, "failed");
      await TaskArchiveRepo.setSlowExecution(archive.id, {
        errors: ["MANAGER_OUTPUT_PARSE_FAILED: No JSON block found in manager output"],
        protocol_violation: false,
        matched_json_len: 0,
      });

      const retrieved = await TaskArchiveRepo.getById(archive.id);
      expect(retrieved!.state).toBe("failed");
      expect((retrieved!.slow_execution as any).protocol_violation).toBe(false);
      expect((retrieved!.slow_execution as any).errors[0]).toMatch(/PARSE_FAILED/);
      // 关键：路径 B 的 errors 不应包含 SCHEMA_VERSION（与路径 A 区分）
      expect((retrieved!.slow_execution as any).errors[0]).not.toMatch(/SCHEMA_VERSION/);
    });

    it("模型输出含破损 JSON → archive state=failed, errors 标识 JSON 解析错误", async () => {
      const archive = await TaskArchiveRepo.create({
        session_id: `${SESSION_PREFIX}-badjson`,
        user_id: "phase51-user",
        decision: makeDecision({ reason: "MANAGER_OUTPUT_PARSE_FAILED — JSON parse error" }),
        user_input: "测试破损 JSON",
      });

      await TaskArchiveRepo.updateState(archive.id, "failed");
      await TaskArchiveRepo.setSlowExecution(archive.id, {
        errors: ["MANAGER_OUTPUT_PARSE_FAILED: Unexpected end of JSON input"],
        protocol_violation: false,
        matched_json_len: 80,
      });

      const retrieved = await TaskArchiveRepo.getById(archive.id);
      expect(retrieved!.state).toBe("failed");
      expect((retrieved!.slow_execution as any).protocol_violation).toBe(false);
    });
  });

  // ── 路径一致性：两条路径都不会导致 archive 卡在 running ──

  describe("降级路径一致性：不会卡住 archive 状态", () => {

    it("协议违规 → 最终状态是 failed（不是 running）", async () => {
      const archive = await TaskArchiveRepo.create({
        session_id: `${SESSION_PREFIX}-consistency-1`,
        user_id: "phase51-user",
        decision: makeDecision({ reason: "protocol violation test" }),
        user_input: "test",
      });

      await TaskArchiveRepo.updateState(archive.id, "failed");
      await TaskArchiveRepo.setSlowExecution(archive.id, {
        errors: ["SCHEMA_VERSION_MISSING"],
        protocol_violation: true,
      });

      const retrieved = await TaskArchiveRepo.getById(archive.id);
      expect(retrieved!.state).toBe("failed");
      expect(retrieved!.state).not.toBe("running");
    });

    it("JSON parse 失败 → 最终状态是 failed（不是 running）", async () => {
      const archive = await TaskArchiveRepo.create({
        session_id: `${SESSION_PREFIX}-consistency-2`,
        user_id: "phase51-user",
        decision: makeDecision({ reason: "parse failed test" }),
        user_input: "test",
      });

      await TaskArchiveRepo.updateState(archive.id, "failed");
      await TaskArchiveRepo.setSlowExecution(archive.id, {
        errors: ["MANAGER_OUTPUT_PARSE_FAILED"],
        protocol_violation: false,
      });

      const retrieved = await TaskArchiveRepo.getById(archive.id);
      expect(retrieved!.state).toBe("failed");
      expect(retrieved!.state).not.toBe("running");
    });
  });

  // ── 诊断字段可区分性 ────────────────────────────────────────────

  describe("errors 字段可区分性（方便 diagnose 脚本分类）", () => {

    it("协议违规的 errors[0] 以 SCHEMA_VERSION 开头", async () => {
      const archive = await TaskArchiveRepo.create({
        session_id: `${SESSION_PREFIX}-diag-1`,
        user_id: "phase51-user",
        decision: makeDecision(),
        user_input: "test",
      });

      await TaskArchiveRepo.updateState(archive.id, "failed");
      await TaskArchiveRepo.setSlowExecution(archive.id, {
        errors: ["SCHEMA_VERSION_MISSING: schema_version is required"],
        protocol_violation: true,
      });

      const retrieved = await TaskArchiveRepo.getById(archive.id);
      const errMsg = (retrieved!.slow_execution as any).errors[0];
      expect(errMsg).toMatch(/^SCHEMA_VERSION_/);
    });

    it("JSON parse 失败的 errors[0] 以 MANAGER_OUTPUT_PARSE_FAILED 开头", async () => {
      const archive = await TaskArchiveRepo.create({
        session_id: `${SESSION_PREFIX}-diag-2`,
        user_id: "phase51-user",
        decision: makeDecision(),
        user_input: "test",
      });

      await TaskArchiveRepo.updateState(archive.id, "failed");
      await TaskArchiveRepo.setSlowExecution(archive.id, {
        errors: ["MANAGER_OUTPUT_PARSE_FAILED: No JSON found"],
        protocol_violation: false,
      });

      const retrieved = await TaskArchiveRepo.getById(archive.id);
      const errMsg = (retrieved!.slow_execution as any).errors[0];
      expect(errMsg).toMatch(/^MANAGER_OUTPUT_PARSE_FAILED/);
    });
  });
});
