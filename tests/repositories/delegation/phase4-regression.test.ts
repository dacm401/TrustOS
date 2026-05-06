/**
 * Phase 4 Regression Tests — Delegation Chain
 *
 * 测试委托链路 4 个核心回归用例（NEXT_STEPS.md Phase 4）：
 *   4.1 archive_id 一致性：创建→路由→worker写入 三步 archive_id 完全一致
 *   4.2 DB migration 探针：task_archives + task_commands 插入不报 FK 错误
 *   4.3 状态机终态：worker 成功路径后 archive.state='completed'
 *   4.4 完整性校验：done without result 时 updateStateWithIntegrity 正确拦截
 *
 * 用真实 DB（smartrouter_test），每次测试前 TRUNCATE 隔离。
 * 需要 DATABASE_URL 指向 smartrouter_test。
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  TaskArchiveRepo,
  TaskCommandRepo,
  TaskWorkerResultRepo,
  TaskArchiveEventRepo,
} from "../../../src/db/task-archive-repo.js";
import { ManagerDecision } from "../../../src/types/index.js";

// ── Fixture helpers ────────────────────────────────────────────────────────

const SESSION_ID = "phase4-session";
const USER_ID = "phase4-user";

function makeDecision(overrides: Partial<ManagerDecision> = {}): ManagerDecision {
  return {
    selected_role: "slow_analyst",
    decision_type: "delegate_to_slow",
    confidence: 0.92,
    reasoning: "需要深度分析",
    command: {
      task_type: "analysis",
      prompt: "分析这段代码",
      constraints: [],
    },
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Phase 4 — Delegation Chain Regression", () => {

  beforeEach(async () => {
    const { truncateTables, resetAppPool } = await import("../../db/harness.js");
    await truncateTables();
    await resetAppPool();
  });

  // ════════════════════════════════════════════════════════════════════════════
  describe("4.1 archive_id 一致性", () => {

    it("TaskArchiveRepo.create → archive.id 是表主键，与 command/archive_event 中的 archive_id 一致", async () => {
      // Step 1: Manager 创建 archive
      const archive = await TaskArchiveRepo.create({
        session_id: SESSION_ID,
        user_id: USER_ID,
        decision: makeDecision(),
        user_input: "分析一下这个代码",
      });

      expect(archive.id).toBeDefined();
      expect(typeof archive.id).toBe("string");
      expect(archive.id.length).toBeGreaterThan(0);

      // Step 2: Router 创建 command，archive_id 必须等于 archive.id（不是 task_id！）
      const command = await TaskCommandRepo.create({
        task_id: archive.id,          // ← 这里必须用 archive.id，不是新的 UUID
        archive_id: archive.id,        // ← 关键断言点：archive_id === archive.id
        user_id: USER_ID,
        command_type: "analysis",
        payload: { prompt: "分析一下这个代码" },
        idempotency_key: `4.1-${archive.id}`,
      });

      expect(command.id).toBeDefined();
      expect(command.status).toBe("queued");

      // Step 3: Worker 完成写 worker_result，archive_id 必须一致
      const workerResult = await TaskWorkerResultRepo.create({
        task_id: archive.id,
        archive_id: archive.id,        // ← 同样必须用 archive.id
        command_id: command.id,
        user_id: USER_ID,
        worker_role: "slow_analyst",
        result: {
          status: "success",
          summary: "分析完成",
          structured_result: { analysis: { findings: ["测试"] } },
        },
      });

      expect(workerResult.id).toBeDefined();

      // Step 4: SSE poller 写 archive_event，archive_id 必须一致
      const event = await TaskArchiveEventRepo.create({
        archive_id: archive.id,       // ← 全链路 archive_id 统一为 archive.id
        task_id: archive.id,
        event_type: "worker_started",
        payload: { worker_role: "slow_analyst" },
      });

      expect(event.id).toBeDefined();

      // 最终验证：三处写入的 archive_id 完全相同
      const cmd = await TaskCommandRepo.getLatestQueued(archive.id);
      expect(cmd).not.toBeNull();
      expect(cmd!.archive_id).toBe(archive.id);    // ✅ command.archive_id === archive.id

      const wr = await TaskWorkerResultRepo.getByArchiveId(archive.id);
      expect(wr).not.toBeNull();
      expect(wr!.archive_id).toBe(archive.id);     // ✅ worker_result.archive_id === archive.id

      const evts = await TaskArchiveEventRepo.listByArchive(archive.id);
      expect(evts.length).toBe(1);
      expect(evts[0].archive_id).toBe(archive.id); // ✅ event.archive_id === archive.id
    });

    it("Worker 用 taskId（而非 archiveId）写 command 时，getLatestQueued(archiveId) 查不到", async () => {
      // 创建 archive
      const archive = await TaskArchiveRepo.create({
        session_id: SESSION_ID,
        user_id: USER_ID,
        decision: makeDecision(),
        user_input: "测试",
      });

      // 错误模式：command 的 archive_id 用了一个不同的 UUID
      const wrongArchiveId = "00000000-0000-0000-0000-000000000001";
      const command = await TaskCommandRepo.create({
        task_id: wrongArchiveId,
        archive_id: wrongArchiveId,
        user_id: USER_ID,
        command_type: "analysis",
        payload: { prompt: "测试" },
      });

      // 用正确的 archiveId 去轮询：应该查不到
      const found = await TaskCommandRepo.getLatestQueued(archive.id);
      expect(found).toBeNull();   // ← 如果这里是 null，说明 Bug 已修复

      // 用错误的 archiveId 轮询：才能查到
      const wrongFound = await TaskCommandRepo.getLatestQueued(wrongArchiveId);
      expect(wrongFound).not.toBeNull();  // ← 这就是 Bug 的表现
      expect(wrongFound!.archive_id).toBe(wrongArchiveId); // 错误归档
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  describe("4.2 DB migration 探针（FK 不报错）", () => {

    it("直接 INSERT task_commands（带 archive_id FK）不报 constraint 错误", async () => {
      // 依赖 TaskCommandRepo.create 内部构建 INSERT
      // 只需验证 INSERT 能成功（不抛异常）
      const archive = await TaskArchiveRepo.create({
        session_id: SESSION_ID,
        user_id: USER_ID,
        decision: makeDecision(),
        user_input: "FK 探针测试",
      });

      // 这一步如果 FK 报错（archive_id references task_archives(id) 不存在），测试失败
      const command = await TaskCommandRepo.create({
        task_id: archive.id,
        archive_id: archive.id,
        user_id: USER_ID,
        command_type: "analysis",
        payload: { prompt: "FK 探针" },
      });

      expect(command.id).toBeDefined();
      expect(command.status).toBe("queued");
    });

    it("task_worker_results INSERT（带 archive_id FK）不报错", async () => {
      const archive = await TaskArchiveRepo.create({
        session_id: SESSION_ID,
        user_id: USER_ID,
        decision: makeDecision(),
        user_input: "FK 探针 2",
      });

      const command = await TaskCommandRepo.create({
        task_id: archive.id,
        archive_id: archive.id,
        user_id: USER_ID,
        command_type: "analysis",
        payload: { prompt: "FK 探针 2" },
      });

      // 如果 archive_id FK 不存在，这里会抛数据库约束错误
      const result = await TaskWorkerResultRepo.create({
        task_id: archive.id,
        archive_id: archive.id,
        command_id: command.id,
        user_id: USER_ID,
        worker_role: "slow_analyst",
        result: { status: "success", summary: "OK" },
      });

      expect(result.id).toBeDefined();
    });

    it("task_archive_events INSERT（带 archive_id FK）不报错", async () => {
      const archive = await TaskArchiveRepo.create({
        session_id: SESSION_ID,
        user_id: USER_ID,
        decision: makeDecision(),
        user_input: "FK 探针 3",
      });

      // 如果 archive_id FK 不存在，这里会抛数据库约束错误
      const event = await TaskArchiveEventRepo.create({
        archive_id: archive.id,
        event_type: "archive_created",
        payload: { source: "phase4-probe" },
      });

      expect(event.id).toBeDefined();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  describe("4.3 状态机终态（worker 成功路径）", () => {

    it("worker 成功路径：slow_execution.result 已写入 → updateStateWithIntegrity('completed') 成功", async () => {
      const archive = await TaskArchiveRepo.create({
        session_id: SESSION_ID,
        user_id: USER_ID,
        decision: makeDecision(),
        user_input: "终态测试",
      });

      // Worker 执行：先写 slow_execution.result（Phase 3.3 规则要求）
      await TaskArchiveRepo.setSlowExecution(archive.id, {
        result: "分析结果：代码质量良好",
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });

      // 状态机推进：updateStateWithIntegrity 写 completed（带完整性校验）
      await TaskArchiveRepo.updateStateWithIntegrity(archive.id, "completed");

      // 验证 archive 已推进到 completed
      const updated = await TaskArchiveRepo.getById(archive.id);
      expect(updated).not.toBeNull();
      expect(updated!.state).toBe("completed");  // ✅ 状态正确推进
    });

    it("worker 成功路径：task_worker_results 已写入 → updateStateWithIntegrity('completed') 成功", async () => {
      const archive = await TaskArchiveRepo.create({
        session_id: SESSION_ID,
        user_id: USER_ID,
        decision: makeDecision(),
        user_input: "终态测试 2",
      });

      const command = await TaskCommandRepo.create({
        task_id: archive.id,
        archive_id: archive.id,
        user_id: USER_ID,
        command_type: "analysis",
        payload: { prompt: "终态测试 2" },
      });

      // Worker 执行：先写 worker_results（不带 slow_execution.result）
      await TaskWorkerResultRepo.create({
        task_id: archive.id,
        archive_id: archive.id,
        command_id: command.id,
        user_id: USER_ID,
        worker_role: "slow_analyst",
        result: { status: "success", summary: "worker result 方式完成" },
      });

      // 即使 slow_execution.result 为空，有 worker_results 也能写 completed
      await TaskArchiveRepo.updateStateWithIntegrity(archive.id, "completed");

      const updated = await TaskArchiveRepo.getById(archive.id);
      expect(updated!.state).toBe("completed");  // ✅ 有 worker_results 即可
    });

    it("worker 成功路径：archive 事件时间线完整（archive_created → worker_started）", async () => {
      const archive = await TaskArchiveRepo.create({
        session_id: SESSION_ID,
        user_id: USER_ID,
        decision: makeDecision(),
        user_input: "事件时间线测试",
      });

      await TaskArchiveEventRepo.create({
        archive_id: archive.id,
        event_type: "archive_created",
        payload: { source: "phase4" },
      });

      await TaskArchiveEventRepo.create({
        archive_id: archive.id,
        task_id: archive.id,
        event_type: "worker_started",
        payload: { worker_role: "slow_analyst" },
      });

      const timeline = await TaskArchiveEventRepo.listByArchive(archive.id);

      expect(timeline.length).toBe(2);
      expect(timeline[0].event_type).toBe("archive_created");
      expect(timeline[1].event_type).toBe("worker_started"); // ✅ 时序正确
      expect(timeline[1].archive_id).toBe(archive.id);       // ✅ archive_id 不变
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  describe("4.4 完整性校验（done without result）", () => {

    it("slow_execution.result 为空且无 worker_results → updateStateWithIntegrity('completed') 抛出 INTEGRITY_VIOLATION", async () => {
      const archive = await TaskArchiveRepo.create({
        session_id: SESSION_ID,
        user_id: USER_ID,
        decision: makeDecision(),
        user_input: "完整性校验测试",
      });

      // archive 存在，但没有 result
      await expect(
        TaskArchiveRepo.updateStateWithIntegrity(archive.id, "completed")
      ).rejects.toThrow();

      // 验证 archive 未被错误推进（仍为 delegated）
      const state = await TaskArchiveRepo.getById(archive.id);
      expect(state!.state).not.toBe("completed");  // ✅ 错误推进被拦住
    });

    it("不存在的 archiveId → updateStateWithIntegrity 抛出 INTEGRITY_VIOLATION（archive 不存在）", async () => {
      const fakeId = "11111111-1111-1111-1111-111111111111";

      await expect(
        TaskArchiveRepo.updateStateWithIntegrity(fakeId, "completed")
      ).rejects.toThrow();

      // 验证错误码
      try {
        await TaskArchiveRepo.updateStateWithIntegrity(fakeId, "completed");
      } catch (e: any) {
        expect(e.code).toBe("INTEGRITY_VIOLATION");  // ✅ 错误码正确
      }
    });

    it("Phase 3.2 场景：archive_id 一致但 schema_version 缺失 → worker 完成时不依赖 updateStateWithIntegrity（仅作回归保证）", async () => {
      // 这个测试验证：即使 archive_id 一致，如果 worker 没有写 result，
      // updateStateWithIntegrity 依然能拦住 completed 状态推进
      const archive = await TaskArchiveRepo.create({
        session_id: SESSION_ID,
        user_id: USER_ID,
        decision: makeDecision({ selected_role: "slow_analyst" }),
        user_input: "schema_version 缺失场景回归",
      });

      // Worker 执行路径 1：有 slow_execution.result（正常）
      await TaskArchiveRepo.setSlowExecution(archive.id, {
        result: "正常完成",
        errors: null,
      });

      await expect(
        TaskArchiveRepo.updateStateWithIntegrity(archive.id, "completed")
      ).resolves.not.toThrow();  // ✅ 有 result 可以写 completed

      // Worker 执行路径 2：无 result（Phase 3.2 协议错误场景）
      const archive2 = await TaskArchiveRepo.create({
        session_id: SESSION_ID,
        user_id: USER_ID,
        decision: makeDecision(),
        user_input: "协议错误场景",
      });

      // 不写任何 result，直接尝试推进 completed
      await expect(
        TaskArchiveRepo.updateStateWithIntegrity(archive2.id, "completed")
      ).rejects.toThrow();  // ✅ 拦住
    });

    it("updateState（无完整性校验）可以绕过校验 → 仅在特殊路径使用（如 worker catch 分支写 failed）", async () => {
      const archive = await TaskArchiveRepo.create({
        session_id: SESSION_ID,
        user_id: USER_ID,
        decision: makeDecision(),
        user_input: "updateState bypass 测试",
      });

      // updateState（不带校验）可以直接写 completed，即使没有 result
      await TaskArchiveRepo.updateState(archive.id, "completed");

      const updated = await TaskArchiveRepo.getById(archive.id);
      expect(updated!.state).toBe("completed"); // ← updateState 可以绕过
      // 这是设计预期：updateState 用于 failed/cancelled 等不需要 result 完整性的场景
    });
  });
});
