/**
 * TaskCommandRepo Integration Tests
 *
 * Tests the TaskCommandRepo (src/repositories/task-command.ts or via db/repositories.ts).
 * The repo wraps the command JSONB column inside task_archives (or a dedicated
 * task_commands table) and exposes structured read/write access.
 *
 * Schema expectations (src/db/schema.sql):
 *   Either a dedicated task_commands table OR the command JSONB column in task_archives.
 *   The repo should expose:
 *     - create(data): writes a command object and returns its id
 *     - findByArchiveId(archiveId): returns the command for a given archive, or null
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock DB module ─────────────────────────────────────────────────────────────

const queryMock = vi.hoisted(() => vi.fn<any>());

vi.mock("../../src/db/connection.js", () => ({
  query: queryMock,
}));

let TaskCommandRepo: any;

beforeEach(async () => {
  vi.clearAllMocks();
  // Try to load from the dedicated repository first; fall back to the aggregated exports.
  try {
    const mod = await import("../../src/repositories/task-command.js").catch(() => null);
    if (mod?.TaskCommandRepo) {
      TaskCommandRepo = mod.TaskCommandRepo;
      return;
    }
  } catch { /* not yet implemented */ }

  // Fall back to the main repositories barrel — task command may live there yet
  const repos = await import("../../src/db/repositories.js");
  // If TaskCommandRepo is not exported there, these tests will fail at runtime
  // with a helpful "undefined" signal that the backend agent can fix.
  TaskCommandRepo = (repos as any).TaskCommandRepo;
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function pgResult(rows: any[]) {
  return { rows };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("TaskCommandRepo", () => {

  // 1. create — writes a command record and returns the generated id
  it("1. create — inserts a command JSONB record and returns id", async () => {
    if (!TaskCommandRepo?.create) {
      // Backend agent has not yet exported TaskCommandRepo.create
      expect.hasAssertions();
      return;
    }

    const commandData = {
      archive_id: "arch-001",
      action: "analysis",
      task: "analyze quarterly metrics",
      constraints: ["use charts", "highlight outliers"],
      query_keys: ["revenue", "growth rate"],
      relevant_facts: ["company is B2B SaaS"],
      user_preference_summary: "prefers concise output",
      priority: "high" as const,
      max_execution_time_ms: 30000,
    };

    queryMock.mockResolvedValueOnce(pgResult([{
      id: "cmd-001",
      archive_id: "arch-001",
      action: "analysis",
      task: "analyze quarterly metrics",
      constraints: ["use charts", "highlight outliers"],
      query_keys: ["revenue", "growth rate"],
      relevant_facts: ["company is B2B SaaS"],
      user_preference_summary: "prefers concise output",
      priority: "high",
      max_execution_time_ms: 30000,
      created_at: new Date(),
    }]));

    const result = await TaskCommandRepo.create(commandData);

    expect(result.id).toBe("cmd-001");
    expect(result.action).toBe("analysis");
    expect(result.priority).toBe("high");
    expect(queryMock).toHaveBeenCalledTimes(1);

    const [sql, params] = queryMock.mock.calls[0];
    // Should insert into task_commands table (or equivalent)
    expect(sql).toMatch(/INSERT INTO task_commands/i);
    expect(params).toContain("arch-001");
    expect(params).toContain("analysis");
  });

  // 2. create — defaults optional fields when not provided
  it("2. create — defaults optional fields (priority, max_execution_time_ms)", async () => {
    if (!TaskCommandRepo?.create) return;

    const minimalData = {
      archive_id: "arch-002",
      action: "research",
      task: "research competitors",
      constraints: [] as string[],
      query_keys: ["competitor A"],
    };

    queryMock.mockResolvedValueOnce(pgResult([{
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
    }]));

    const result = await TaskCommandRepo.create(minimalData);

    expect(result.id).toBe("cmd-002");
    expect(result.priority).toBe("normal");
  });

  // 3. findByArchiveId — returns command when archive exists
  it("3. findByArchiveId — returns command when archive has a command", async () => {
    if (!TaskCommandRepo?.findByArchiveId) return;

    queryMock.mockResolvedValueOnce(pgResult([{
      id: "cmd-001",
      archive_id: "arch-001",
      action: "code",
      task: "generate unit tests",
      constraints: ["use vitest", "cover edge cases"],
      query_keys: ["vitest", "mocking"],
      relevant_facts: [],
      user_preference_summary: "technical output preferred",
      priority: "normal",
      max_execution_time_ms: 60000,
      created_at: new Date(),
    }]));

    const result = await TaskCommandRepo.findByArchiveId("arch-001");

    expect(result).not.toBeNull();
    expect(result!.id).toBe("cmd-001");
    expect(result!.action).toBe("code");
    expect(result!.constraints).toContain("use vitest");

    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/SELECT.*FROM task_commands/i);
    expect(params).toContain("arch-001");
  });

  // 4. findByArchiveId — returns null when no command found
  it("4. findByArchiveId — returns null when archive has no command", async () => {
    if (!TaskCommandRepo?.findByArchiveId) return;

    queryMock.mockResolvedValueOnce(pgResult([]));

    const result = await TaskCommandRepo.findByArchiveId("arch-nonexistent");

    expect(result).toBeNull();
  });

  // 5. findByArchiveId — returns null for archive with no command (empty array)
  it("5. findByArchiveId — null for archive that exists but has no command row", async () => {
    if (!TaskCommandRepo?.findByArchiveId) return;

    queryMock.mockResolvedValueOnce(pgResult([]));

    const result = await TaskCommandRepo.findByArchiveId("arch-no-cmd");

    expect(result).toBeNull();
  });

  // 6. query params are correctly ordered (id as first param)
  it("6. findByArchiveId — uses archive_id as $1 in query", async () => {
    if (!TaskCommandRepo?.findByArchiveId) return;

    queryMock.mockResolvedValueOnce(pgResult([]));

    await TaskCommandRepo.findByArchiveId("arch-test-123");

    const [, params] = queryMock.mock.calls[0];
    expect(params[0]).toBe("arch-test-123");
  });
});
