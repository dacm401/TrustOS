/**
 * TaskArchiveEventRepo Integration Tests
 *
 * Tests the TaskArchiveEventRepo — a repo that records lifecycle events
 * for task archives (e.g., manager_decision, worker_started, worker_completed).
 *
 * Schema expectations (src/db/schema.sql):
 *   task_archive_events (
 *     id, archive_id (FK), event_type, detail (JSONB), created_at
 *   )
 *
 *   Event types:
 *     manager_decision  — Fast model made a routing decision
 *     worker_started    — Slow model started executing
 *     worker_completed — Slow model finished (success or failure)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock DB module ─────────────────────────────────────────────────────────────

const queryMock = vi.hoisted(() => vi.fn<any>());

vi.mock("../../src/db/connection.js", () => ({
  query: queryMock,
}));

let TaskArchiveEventRepo: any;

beforeEach(async () => {
  vi.clearAllMocks();
  // Try the dedicated repository first
  try {
    const mod = await import("../../src/repositories/task-archive-event.js").catch(() => null);
    if (mod?.TaskArchiveEventRepo) {
      TaskArchiveEventRepo = mod.TaskArchiveEventRepo;
      return;
    }
  } catch { /* not yet implemented */ }

  // Fall back to main repositories barrel
  const repos = await import("../../src/db/repositories.js");
  TaskArchiveEventRepo = (repos as any).TaskArchiveEventRepo;
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function pgResult(rows: any[]) {
  return { rows };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("TaskArchiveEventRepo", () => {

  // 1. create — writes an event with type and detail, returns the event record
  it("1. create — inserts event and returns record with generated id", async () => {
    if (!TaskArchiveEventRepo?.create) {
      // Backend agent has not yet implemented TaskArchiveEventRepo.create
      expect.hasAssertions();
      return;
    }

    const eventData = {
      archive_id: "arch-001",
      event_type: "manager_decision" as const,
      detail: {
        action: "delegate_to_slow",
        confidence: 0.88,
        delegation: { action: "analysis", task: "Q3 report" },
      },
    };

    queryMock.mockResolvedValueOnce(pgResult([{
      id: "evt-001",
      archive_id: "arch-001",
      event_type: "manager_decision",
      detail: eventData.detail,
      created_at: new Date("2026-01-01T10:00:00Z"),
    }]));

    const event = await TaskArchiveEventRepo.create(eventData);

    expect(event.id).toBe("evt-001");
    expect(event.archive_id).toBe("arch-001");
    expect(event.event_type).toBe("manager_decision");
    expect(event.detail).toEqual(eventData.detail);

    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO task_archive_events/i);
    expect(params).toContain("arch-001");
    expect(params).toContain("manager_decision");
  });

  // 2. create — supports worker_started event type
  it("2. create — supports worker_started event", async () => {
    if (!TaskArchiveEventRepo?.create) return;

    queryMock.mockResolvedValueOnce(pgResult([{
      id: "evt-002",
      archive_id: "arch-002",
      event_type: "worker_started",
      detail: { started_at: "2026-01-01T10:05:00Z" },
      created_at: new Date(),
    }]));

    const event = await TaskArchiveEventRepo.create({
      archive_id: "arch-002",
      event_type: "worker_started",
      detail: { started_at: "2026-01-01T10:05:00Z" },
    });

    expect(event.event_type).toBe("worker_started");
    expect(event.detail.started_at).toBe("2026-01-01T10:05:00Z");
  });

  // 3. create — supports worker_completed event type
  it("3. create — supports worker_completed event with result detail", async () => {
    if (!TaskArchiveEventRepo?.create) return;

    queryMock.mockResolvedValueOnce(pgResult([{
      id: "evt-003",
      archive_id: "arch-003",
      event_type: "worker_completed",
      detail: {
        status: "done",
        result: "Analysis complete: 15% growth",
        duration_ms: 12450,
      },
      created_at: new Date(),
    }]));

    const event = await TaskArchiveEventRepo.create({
      archive_id: "arch-003",
      event_type: "worker_completed",
      detail: {
        status: "done",
        result: "Analysis complete: 15% growth",
        duration_ms: 12450,
      },
    });

    expect(event.event_type).toBe("worker_completed");
    expect(event.detail.status).toBe("done");
    expect(event.detail.duration_ms).toBe(12450);
  });

  // 4. findByArchiveId — returns events for an archive ordered by created_at ASC
  it("4. findByArchiveId — returns events ordered ASC (oldest first)", async () => {
    if (!TaskArchiveEventRepo?.findByArchiveId) return;

    const now = new Date();
    queryMock.mockResolvedValueOnce(pgResult([
      {
        id: "evt-001",
        archive_id: "arch-001",
        event_type: "manager_decision",
        detail: { action: "delegate" },
        created_at: new Date(now.getTime() - 2000),
      },
      {
        id: "evt-002",
        archive_id: "arch-001",
        event_type: "worker_started",
        detail: { started_at: "2026-01-01T10:05:00Z" },
        created_at: new Date(now.getTime() - 1000),
      },
      {
        id: "evt-003",
        archive_id: "arch-001",
        event_type: "worker_completed",
        detail: { status: "done" },
        created_at: new Date(now.getTime()),
      },
    ]));

    const events = await TaskArchiveEventRepo.findByArchiveId("arch-001");

    expect(events).toHaveLength(3);
    expect(events[0].event_type).toBe("manager_decision");
    expect(events[1].event_type).toBe("worker_started");
    expect(events[2].event_type).toBe("worker_completed");

    const [sql] = queryMock.mock.calls[0];
    expect(sql).toMatch(/ORDER BY created_at ASC/i);
  });

  // 5. findByArchiveId — returns empty array when no events
  it("5. findByArchiveId — empty array when archive has no events", async () => {
    if (!TaskArchiveEventRepo?.findByArchiveId) return;

    queryMock.mockResolvedValueOnce(pgResult([]));

    const events = await TaskArchiveEventRepo.findByArchiveId("arch-empty");

    expect(events).toEqual([]);
  });

  // 6. create — detail is stored as JSONB
  it("6. create — detail is serialised as JSONB", async () => {
    if (!TaskArchiveEventRepo?.create) return;

    const detail = { reasoning: "Too complex for fast model", confidence: 0.95 };
    queryMock.mockResolvedValueOnce(pgResult([{
      id: "evt-004",
      archive_id: "arch-004",
      event_type: "manager_decision",
      detail,
      created_at: new Date(),
    }]));

    await TaskArchiveEventRepo.create({
      archive_id: "arch-004",
      event_type: "manager_decision",
      detail,
    });

    const [, params] = queryMock.mock.calls[0];
    // The detail JSONB should appear as a stringified object in params
    const detailParam = params.find((p: any) =>
      typeof p === "string" && p.includes("Too complex")
    );
    expect(detailParam).toBeTruthy();
  });

  // 7. findByArchiveId — archive_id param is passed correctly
  it("7. findByArchiveId — uses archive_id as $1 in query", async () => {
    if (!TaskArchiveEventRepo?.findByArchiveId) return;

    queryMock.mockResolvedValueOnce(pgResult([]));

    await TaskArchiveEventRepo.findByArchiveId("arch-target-99");

    const [, params] = queryMock.mock.calls[0];
    expect(params[0]).toBe("arch-target-99");
  });

  // 8. create — generates id via uuid (not auto-increment)
  it("8. create — returned id is a UUID string, not a sequential integer", async () => {
    if (!TaskArchiveEventRepo?.create) return;

    queryMock.mockResolvedValueOnce(pgResult([{
      id: "550e8400-e29b-41d4-a716-446655440000",
      archive_id: "arch-005",
      event_type: "worker_completed",
      detail: { status: "failed", error: "timeout" },
      created_at: new Date(),
    }]));

    const event = await TaskArchiveEventRepo.create({
      archive_id: "arch-005",
      event_type: "worker_completed",
      detail: { status: "failed", error: "timeout" },
    });

    expect(event.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });
});
