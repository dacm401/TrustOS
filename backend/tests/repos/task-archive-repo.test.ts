/**
 * TaskArchiveRepo Integration Tests
 *
 * Tests the TaskArchiveRepo (src/db/repositories.ts → TaskArchiveRepo).
 * Uses vi.mock to simulate the db connection so tests run without a real DB.
 *
 * Schema (src/db/schema.sql → task_archives):
 *   id, session_id, turn_id, command (JSONB), user_input, constraints,
 *   task_type, task_brief (JSONB), fast_observations (JSONB),
 *   slow_execution (JSONB), state, status, delivered, created_at, updated_at
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock DB module ─────────────────────────────────────────────────────────────

// We'll mock the entire db/connection.js so query() is intercepted.
const queryMock = vi.hoisted(() => vi.fn<any>());

vi.mock("../../src/db/connection.js", () => ({
  query: queryMock,
}));

// Re-export TaskArchiveRepo after the mock is in place.
// We import it dynamically so vitest resolves the mocked module.
let TaskArchiveRepo: typeof import("../../../src/db/repositories.js")["TaskArchiveRepo"];

beforeEach(async () => {
  vi.clearAllMocks();
  const repos = await import("../../src/db/repositories.js");
  TaskArchiveRepo = repos.TaskArchiveRepo;
});

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Returns a fake pg result object with the given rows */
function pgResult(rows: any[]) {
  return { rows };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("TaskArchiveRepo", () => {

  // 1. create — writes to task_archives and returns the full entry with id
  it("1. create — inserts a row and returns entry with generated id", async () => {
    const input = {
      task_id: "fake-task-001",
      session_id: "sess-abc",
      turn_id: 1,
      command: {
        action: "analysis",
        task: "analyze Q3 metrics",
        constraints: ["output table"],
        query_keys: ["revenue", "growth"],
      },
      user_input: "analyze our Q3 performance",
      constraints: ["be concise"],
    };

    // Simulate what postgres returns after INSERT ... RETURNING *
    queryMock.mockResolvedValueOnce(pgResult([{
      id: "arch-001",
      session_id: input.session_id,
      turn_id: input.turn_id,
      command: input.command,
      user_input: input.user_input,
      constraints: input.constraints,
      task_type: "analysis",
      task_brief: {},
      fast_observations: [],
      slow_execution: {},
      status: "pending",
      delivered: false,
      created_at: new Date("2026-01-01T00:00:00Z"),
      updated_at: new Date("2026-01-01T00:00:00Z"),
    }]));

    const entry = await TaskArchiveRepo.create(input);

    expect(entry.id).toBe("arch-001");
    expect(entry.session_id).toBe("sess-abc");
    expect(entry.command.action).toBe("analysis");
    expect(entry.status).toBe("pending");
    expect(entry.delivered).toBe(false);

    // Verify the SQL call
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("INSERT INTO task_archives");
    expect(sql).toContain("RETURNING");
    expect(params).toContain("sess-abc");
    // command is stringified JSONB — check it's a JSON string containing the action
    const cmdParam = params.find((p: any) => typeof p === "string" && p.includes('"action"'));
    expect(cmdParam).toBeTruthy();
    expect(JSON.parse(cmdParam).action).toBe("analysis");
  });

  // 2. updateStatus — changes status and/or state
  it("2. updateStatus — updates status to 'running' and calls updated_at=NOW()", async () => {
    queryMock.mockResolvedValueOnce(pgResult([]));

    await TaskArchiveRepo.updateStatus("arch-001", "running");

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("UPDATE task_archives");
    expect(sql).toContain("status=");
    expect(sql).toContain("updated_at=NOW()");
    expect(params).toContain("running");
    expect(params).toContain("arch-001");
  });

  it("2b. updateStatus — updates to 'done'", async () => {
    queryMock.mockResolvedValueOnce(pgResult([]));

    await TaskArchiveRepo.updateStatus("arch-002", "done");

    const [, params] = queryMock.mock.calls[0];
    expect(params).toContain("done");
  });

  // 3. writeExecution — writes slow_execution JSONB and sets status
  it("3. writeExecution — serialises slow_execution and sets status to 'done'", async () => {
    queryMock.mockResolvedValueOnce(pgResult([]));

    await TaskArchiveRepo.writeExecution({
      id: "arch-001",
      status: "done",
      started_at: "2026-01-01T10:00:00Z",
      deviations: ["used cached data"],
      result: "Analysis complete: +15% growth",
      errors: [],
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("UPDATE task_archives");
    expect(sql).toContain("slow_execution=");
    expect(sql).toContain("status=");
    expect(params).toContain("arch-001");
    expect(params).toContain("done");

    // The slow_execution JSONB param should be a stringified object
    const jsonbParam = params.find((p: any) =>
      typeof p === "string" && p.includes("Analysis complete")
    );
    expect(jsonbParam).toBeTruthy();
  });

  // 4. markDelivered — sets delivered=TRUE
  it("4. markDelivered — sets delivered=TRUE", async () => {
    queryMock.mockResolvedValueOnce(pgResult([]));

    await TaskArchiveRepo.markDelivered("arch-001");

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("delivered=TRUE");
    expect(params).toContain("arch-001");
  });

  // 5. getBySession — returns all archives for a session ordered by created_at DESC
  it("5. getBySession — returns archives ordered DESC", async () => {
    queryMock.mockResolvedValueOnce(pgResult([
      {
        id: "arch-002",
        session_id: "sess-abc",
        turn_id: 2,
        command: { action: "research", task: "deep dive", constraints: [], query_keys: [] },
        user_input: "do research",
        constraints: [],
        task_type: "research",
        task_brief: {},
        fast_observations: [],
        slow_execution: { result: "done" },
        status: "done",
        delivered: true,
        created_at: new Date("2026-01-01T02:00:00Z"),
        updated_at: new Date("2026-01-01T02:00:00Z"),
      },
      {
        id: "arch-001",
        session_id: "sess-abc",
        turn_id: 1,
        command: { action: "analysis", task: "quick check", constraints: [], query_keys: [] },
        user_input: "quick check",
        constraints: [],
        task_type: "analysis",
        task_brief: {},
        fast_observations: [],
        slow_execution: {},
        status: "pending",
        delivered: false,
        created_at: new Date("2026-01-01T01:00:00Z"),
        updated_at: new Date("2026-01-01T01:00:00Z"),
      },
    ]));

    const results = await TaskArchiveRepo.getBySession("sess-abc", 10);

    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("arch-002");
    expect(results[1].id).toBe("arch-001");
    expect(results[0].status).toBe("done");
    expect(results[1].status).toBe("pending");

    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("WHERE session_id=$1");
    expect(sql).toContain("ORDER BY created_at DESC");
    expect(params).toContain("sess-abc");
  });

  // 6. getById — returns entry when found
  it("6. getById — returns entry when found", async () => {
    queryMock.mockResolvedValueOnce(pgResult([{
      id: "arch-001",
      session_id: "sess-abc",
      turn_id: 1,
      command: { action: "analysis", task: "x", constraints: [], query_keys: [] },
      user_input: "x",
      constraints: [],
      task_type: "analysis",
      task_brief: {},
      fast_observations: [],
      slow_execution: {},
      status: "pending",
      delivered: false,
      created_at: new Date(),
      updated_at: new Date(),
    }]));

    const entry = await TaskArchiveRepo.getById("arch-001");

    expect(entry).not.toBeNull();
    expect(entry!.id).toBe("arch-001");
    expect(entry!.command.action).toBe("analysis");
  });

  // 7. getById — returns null when not found
  it("7. getById — returns null when not found", async () => {
    queryMock.mockResolvedValueOnce(pgResult([]));

    const entry = await TaskArchiveRepo.getById("nonexistent");

    expect(entry).toBeNull();
  });

  // 8. getBySession — empty session returns empty array
  it("8. getBySession — empty session returns empty array", async () => {
    queryMock.mockResolvedValueOnce(pgResult([]));

    const results = await TaskArchiveRepo.getBySession("no-such-session", 10);

    expect(results).toEqual([]);
  });

  // 9. appendObservation — appends a single observation to fast_observations JSONB
  it("9. appendObservation — appends observation via JSONB concat", async () => {
    queryMock.mockResolvedValueOnce(pgResult([]));

    await TaskArchiveRepo.appendObservation("arch-001", {
      timestamp: 1704067200000,
      observation: "Fast model noticed trend reversal",
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql] = queryMock.mock.calls[0];
    expect(sql).toContain("fast_observations");
    expect(sql).toContain("||"); // PostgreSQL JSONB concat operator
  });

  // 10. listPending — returns only non-terminal archives
  it("10. listPending — returns only pending/running entries", async () => {
    queryMock.mockResolvedValueOnce(pgResult([
      {
        id: "arch-003",
        session_id: "sess-abc",
        turn_id: 3,
        command: { action: "code", task: "fix bug", constraints: [], query_keys: [] },
        user_input: "fix bug",
        constraints: [],
        task_type: "code",
        task_brief: {},
        fast_observations: [],
        slow_execution: {},
        status: "running",
        delivered: false,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]));

    const pending = await TaskArchiveRepo.listPending("sess-abc");

    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe("running");
  });

  // 11. hasPending — returns true when pending entries exist
  it("11. hasPending — returns true when entries exist", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ cnt: "2" }] });

    const has = await TaskArchiveRepo.hasPending("sess-abc");

    expect(has).toBe(true);
  });

  // 12. hasPending — returns false for clean session
  it("12. hasPending — returns false for session with no pending entries", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ cnt: "0" }] });

    const has = await TaskArchiveRepo.hasPending("clean-session");

    expect(has).toBe(false);
  });
});
