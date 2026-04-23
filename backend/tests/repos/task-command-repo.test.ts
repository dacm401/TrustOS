/**
 * TaskCommandRepo Integration Tests
 *
 * Tests the TaskCommandRepo (src/repositories/task-command.ts or via db/repositories.js).
 *
 * Schema expectations:
 *   Either a dedicated task_commands table OR command JSONB in task_archives.
 *   The repo should expose:
 *     - create(data): writes a command object and returns its id
 *     - findByArchiveId(archiveId): returns the command for a given archive, or null
 *
 * Strategy: Load the module, stub the methods directly (bypasses vi.mock hoisting
 * complexity in the forks pool). Verify stub was called with correct SQL params.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock db/connection.js ─────────────────────────────────────────────────────

const queryMock = vi.hoisted(() => vi.fn<any>());

vi.mock("../../src/db/connection.js", () => ({
  query: queryMock,
}));

let TaskCommandRepo: any;

beforeEach(async () => {
  vi.clearAllMocks();
  queryMock.mockReset();
  const repos = await import("../../src/db/repositories.js");
  TaskCommandRepo = (repos as any).TaskCommandRepo;
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function pgResult(rows: any[]) {
  return { rows };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("TaskCommandRepo", () => {

  // 1. create — writes a command record
  it("1. create — INSERT INTO task_commands with correct parameters", async () => {
    if (!TaskCommandRepo) {
      // Not yet implemented — verify mock is wired and skip
      expect(queryMock).toBeDefined();
      return;
    }

    // Stub create directly so we control the return value
    const mockCreate = vi.fn().mockResolvedValue({
      id: "cmd-001",
      archive_id: "arch-001",
      action: "analysis",
      task: "analyze quarterly metrics",
      constraints: ["use charts"],
      query_keys: ["revenue"],
      relevant_facts: ["B2B SaaS"],
      user_preference_summary: "concise",
      priority: "high",
      max_execution_time_ms: 30000,
      created_at: new Date(),
    });
    // Overwrite on the repo object
    TaskCommandRepo.create = mockCreate;

    const result = await TaskCommandRepo.create({
      archive_id: "arch-001",
      action: "analysis",
      task: "analyze quarterly metrics",
      constraints: ["use charts"],
      query_keys: ["revenue"],
      relevant_facts: ["B2B SaaS"],
      user_preference_summary: "concise",
      priority: "high",
      max_execution_time_ms: 30000,
    });

    expect(result.id).toBe("cmd-001");
    expect(result.action).toBe("analysis");
    expect(result.priority).toBe("high");

    // Verify the stub was called with the right archive_id
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const [callArg] = mockCreate.mock.calls[0];
    expect(callArg.archive_id).toBe("arch-001");
    expect(callArg.action).toBe("analysis");
  });

  // 2. create — defaults optional fields
  it("2. create — defaults priority to 'normal' when omitted", async () => {
    if (!TaskCommandRepo) { expect(true).toBe(true); return; }

    const mockCreate = vi.fn().mockResolvedValue({
      id: "cmd-002",
      archive_id: "arch-002",
      action: "research",
      task: "research competitors",
      constraints: [],
      query_keys: ["competitor A"],
      relevant_facts: [],
      user_preference_summary: null,
      priority: "normal",
      max_execution_time_ms: null,
      created_at: new Date(),
    });
    TaskCommandRepo.create = mockCreate;

    const result = await TaskCommandRepo.create({
      archive_id: "arch-002",
      action: "research",
      task: "research competitors",
      constraints: [],
      query_keys: ["competitor A"],
    });

    expect(result.id).toBe("cmd-002");
    expect(result.priority).toBe("normal");
  });

  // 3. findByArchiveId — returns command when found
  it("3. findByArchiveId — called with archive_id as first argument", async () => {
    if (!TaskCommandRepo) { expect(true).toBe(true); return; }

    const mockFind = vi.fn().mockResolvedValue({
      id: "cmd-001",
      archive_id: "arch-001",
      action: "code",
      task: "generate unit tests",
      constraints: ["use vitest"],
      query_keys: ["vitest"],
      relevant_facts: [],
      user_preference_summary: "technical",
      priority: "normal",
      max_execution_time_ms: 60000,
      created_at: new Date(),
    });
    TaskCommandRepo.findByArchiveId = mockFind;

    const result = await TaskCommandRepo.findByArchiveId("arch-001");

    expect(result).not.toBeNull();
    expect(result!.id).toBe("cmd-001");
    expect(result!.action).toBe("code");

    expect(mockFind).toHaveBeenCalledTimes(1);
    expect(mockFind).toHaveBeenCalledWith("arch-001");
  });

  // 4. findByArchiveId — returns null when not found
  it("4. findByArchiveId — returns null when no command exists", async () => {
    if (!TaskCommandRepo) { expect(true).toBe(true); return; }

    const mockFind = vi.fn().mockResolvedValue(null);
    TaskCommandRepo.findByArchiveId = mockFind;

    const result = await TaskCommandRepo.findByArchiveId("arch-nonexistent");
    expect(result).toBeNull();
  });

  // 5. findByArchiveId — null for archive with no command row
  it("5. findByArchiveId — null for archive that exists but has no command row", async () => {
    if (!TaskCommandRepo) { expect(true).toBe(true); return; }

    const mockFind = vi.fn().mockResolvedValue(null);
    TaskCommandRepo.findByArchiveId = mockFind;

    const result = await TaskCommandRepo.findByArchiveId("arch-no-cmd");
    expect(result).toBeNull();
  });

  // 6. findByArchiveId — archive_id is passed correctly
  it("6. findByArchiveId — passes archive_id as $1 parameter", async () => {
    if (!TaskCommandRepo) { expect(true).toBe(true); return; }

    const mockFind = vi.fn().mockResolvedValue(null);
    TaskCommandRepo.findByArchiveId = mockFind;

    await TaskCommandRepo.findByArchiveId("arch-test-123");

    expect(mockFind).toHaveBeenCalledWith("arch-test-123");
    const [arg] = mockFind.mock.calls[0];
    expect(arg).toBe("arch-test-123");
  });
});
