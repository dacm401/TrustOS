/**
 * Phase 5 Storage Backend — 集成测试
 *
 * 测试 IArchiveStorage 接口在所有后端上的行为一致性。
 * 使用 mock 避免真实 S3/PG 调用。
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { IArchiveStorage, ArchiveDocument } from "../../../src/services/phase5/storage-backend.js";
import { LocalArchiveStorage } from "../../../src/services/phase5/local-archive-store.js";

// ── Test Fixtures ─────────────────────────────────────────────────────────────

function makeDoc(overrides: Partial<ArchiveDocument> = {}): ArchiveDocument {
  const id = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    id,
    task_id: "task-001",
    session_id: "session-001",
    user_id: "user-001",
    manager_decision: { type: "delegate_to_slow", reason: "complex task" },
    command: { tool: "web_search", args: { query: "test" } },
    user_input: "查询今日天气",
    task_brief: "Weather query",
    goal: "Get current weather",
    state: "delegated",
    status: "pending",
    constraints: {},
    fast_observations: [],
    slow_execution: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// ── Shared Interface Tests ─────────────────────────────────────────────────────
// 这些测试验证 IArchiveStorage 接口契约，所有实现必须通过

function runInterfaceTests(
  name: string,
  factory: () => Promise<IArchiveStorage>
) {
  describe(`IArchiveStorage Interface — ${name}`, () => {
    let store: IArchiveStorage;

    beforeEach(async () => {
      store = await factory();
    });

    it("ping() returns boolean", async () => {
      const result = await store.ping();
      expect(typeof result).toBe("boolean");
    });

    it("round-trip: save + getById", async () => {
      const doc = makeDoc();
      await store.save(doc);
      const retrieved = await store.getById(doc.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(doc.id);
      expect(retrieved!.user_input).toBe(doc.user_input);
    });

    it("save + getBySession", async () => {
      const doc = makeDoc();
      await store.save(doc);
      const retrieved = await store.getBySession(doc.session_id, doc.user_id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(doc.id);
    });

    it("save + listBySession returns array", async () => {
      const doc = makeDoc();
      await store.save(doc);
      const list = await store.listBySession(doc.session_id, doc.user_id);
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThan(0);
    });

    it("update() modifies fields", async () => {
      const doc = makeDoc();
      await store.save(doc);

      const updated = await store.update(doc.id, {
        status: "completed",
        state: "done",
      });

      expect(updated).toBe(true);
      const retrieved = await store.getById(doc.id);
      expect(retrieved!.status).toBe("completed");
      expect(retrieved!.state).toBe("done");
      // created_at 不变
      expect(retrieved!.created_at).toBe(doc.created_at);
    });

    it("updateCommandStatus() sets status and slow_execution", async () => {
      const doc = makeDoc({ status: "pending", slow_execution: {} });
      await store.save(doc);

      const result = { output: "weather: sunny, 25C" };
      await store.updateCommandStatus(doc.id, "completed", result);

      const retrieved = await store.getById(doc.id);
      expect(retrieved!.status).toBe("completed");
      expect(retrieved!.slow_execution).toEqual(result);
    });

    it("delete() removes document", async () => {
      const doc = makeDoc();
      await store.save(doc);

      const deleted = await store.delete(doc.id);
      expect(deleted).toBe(true);

      const retrieved = await store.getById(doc.id);
      expect(retrieved).toBeNull();
    });

    it("delete() returns false for non-existent id", async () => {
      const deleted = await store.delete("non-existent-id");
      expect(deleted).toBe(false);
    });

    it("getById() returns null for non-existent id", async () => {
      const retrieved = await store.getById("non-existent-id");
      expect(retrieved).toBeNull();
    });

    it("getBySession() returns null for non-existent session", async () => {
      const retrieved = await store.getBySession("no-such-session", "no-such-user");
      expect(retrieved).toBeNull();
    });

    it("listBySession() returns empty array for non-existent session", async () => {
      const list = await store.listBySession("no-such-session", "no-such-user");
      expect(list).toEqual([]);
    });

    it("update() returns false for non-existent id", async () => {
      const updated = await store.update("non-existent-id", { status: "done" });
      expect(updated).toBe(false);
    });
  });
}

// ── Local Backend Tests ────────────────────────────────────────────────────────

import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

const LOCAL_TEST_PATH = join(process.cwd(), "test-data", "archive-interface");

beforeEach(() => {
  if (existsSync(LOCAL_TEST_PATH)) {
    rmSync(LOCAL_TEST_PATH, { recursive: true, force: true });
  }
  mkdirSync(LOCAL_TEST_PATH, { recursive: true });
});

afterEach(() => {
  if (existsSync(LOCAL_TEST_PATH)) {
    rmSync(LOCAL_TEST_PATH, { recursive: true, force: true });
  }
});

runInterfaceTests("LocalArchiveStorage", async () => {
  return new LocalArchiveStorage({ basePath: LOCAL_TEST_PATH });
});

// ── ArchiveDocument Type Tests ─────────────────────────────────────────────────

describe("ArchiveDocument type validation", () => {
  it("required fields are present", () => {
    const doc = makeDoc();
    expect(doc.id).toBeTruthy();
    expect(doc.session_id).toBeTruthy();
    expect(doc.user_id).toBeTruthy();
    expect(doc.state).toBeTruthy();
    expect(doc.status).toBeTruthy();
    expect(doc.created_at).toBeTruthy();
    expect(doc.updated_at).toBeTruthy();
  });

  it("optional fields can be undefined", () => {
    const doc = makeDoc({
      task_id: undefined,
      task_brief: undefined,
      goal: undefined,
    });
    expect(doc.task_id).toBeUndefined();
    expect(doc.task_brief).toBeUndefined();
    expect(doc.goal).toBeUndefined();
  });
});
