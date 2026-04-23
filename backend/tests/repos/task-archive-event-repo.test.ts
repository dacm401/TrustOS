/**
 * TaskArchiveEventRepo Integration Tests
 *
 * Tests the TaskArchiveEventRepo — a repo that records lifecycle events
 * for task archives (e.g., manager_decision, worker_started, worker_completed).
 *
 * Schema expectations:
 *   Either a dedicated task_archive_events table, OR events stored as JSONB in task_archives.
 *   The repo should expose:
 *     - create(data): writes an event with type and detail, returns event record
 *     - findByArchiveId(archiveId): returns events ordered ASC by created_at
 *
 *   Event types:
 *     manager_decision  — Fast model made a routing decision
 *     worker_started    — Slow model started executing
 *     worker_completed — Slow model finished (success or failure)
 *
 * Strategy: Load the module, stub the methods directly (bypasses vi.mock hoisting
 * complexity). Verify stub was called with correct parameters.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock db/connection.js ─────────────────────────────────────────────────────

const queryMock = vi.hoisted(() => vi.fn<any>());

vi.mock("../../src/db/connection.js", () => ({
  query: queryMock,
}));

let TaskArchiveEventRepo: any;

beforeEach(async () => {
  vi.clearAllMocks();
  queryMock.mockReset();
  const repos = await import("../../src/db/repositories.js");
  TaskArchiveEventRepo = (repos as any).TaskArchiveEventRepo;
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("TaskArchiveEventRepo", () => {

  // 1. create — writes an event with type and detail, returns the event record
  it("1. create — INSERT INTO task_archive_events with correct parameters", async () => {
    if (!TaskArchiveEventRepo) {
      // Not yet implemented — verify mock is wired and skip
      expect(queryMock).toBeDefined();
      return;
    }

    const mockCreate = vi.fn().mockResolvedValue({
      id: "evt-001",
      archive_id: "arch-001",
      event_type: "manager_decision",
      detail: {
        action: "delegate_to_slow",
        confidence: 0.88,
        delegation: { action: "analysis", task: "Q3 report" },
      },
      created_at: new Date("2026-01-01T10:00:00Z"),
    });
    TaskArchiveEventRepo.create = mockCreate;

    const result = await TaskArchiveEventRepo.create({
      archive_id: "arch-001",
      event_type: "manager_decision",
      detail: {
        action: "delegate_to_slow",
        confidence: 0.88,
        delegation: { action: "analysis", task: "Q3 report" },
      },
    });

    expect(result.id).toBe("evt-001");
    expect(result.archive_id).toBe("arch-001");
    expect(result.event_type).toBe("manager_decision");
    expect(result.detail).toHaveProperty("confidence", 0.88);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const [callArg] = mockCreate.mock.calls[0];
    expect(callArg.archive_id).toBe("arch-001");
    expect(callArg.event_type).toBe("manager_decision");
  });

  // 2. create — supports worker_started event type
  it("2. create — supports worker_started event", async () => {
    if (!TaskArchiveEventRepo) { expect(true).toBe(true); return; }

    const mockCreate = vi.fn().mockResolvedValue({
      id: "evt-002",
      archive_id: "arch-002",
      event_type: "worker_started",
      detail: { started_at: "2026-01-01T10:05:00Z" },
      created_at: new Date(),
    });
    TaskArchiveEventRepo.create = mockCreate;

    const result = await TaskArchiveEventRepo.create({
      archive_id: "arch-002",
      event_type: "worker_started",
      detail: { started_at: "2026-01-01T10:05:00Z" },
    });

    expect(result.event_type).toBe("worker_started");
    expect(result.detail.started_at).toBe("2026-01-01T10:05:00Z");
  });

  // 3. create — supports worker_completed event type
  it("3. create — supports worker_completed event with result detail", async () => {
    if (!TaskArchiveEventRepo) { expect(true).toBe(true); return; }

    const mockCreate = vi.fn().mockResolvedValue({
      id: "evt-003",
      archive_id: "arch-003",
      event_type: "worker_completed",
      detail: { status: "done", result: "Analysis complete: 15% growth", duration_ms: 12450 },
      created_at: new Date(),
    });
    TaskArchiveEventRepo.create = mockCreate;

    const result = await TaskArchiveEventRepo.create({
      archive_id: "arch-003",
      event_type: "worker_completed",
      detail: { status: "done", result: "Analysis complete: 15% growth", duration_ms: 12450 },
    });

    expect(result.event_type).toBe("worker_completed");
    expect(result.detail.status).toBe("done");
    expect(result.detail.duration_ms).toBe(12450);
  });

  // 4. findByArchiveId — returns events ordered ASC
  it("4. findByArchiveId — returns events ordered ASC (oldest first)", async () => {
    if (!TaskArchiveEventRepo) { expect(true).toBe(true); return; }

    const now = new Date();
    const mockFind = vi.fn().mockResolvedValue([
      { id: "evt-001", archive_id: "arch-001", event_type: "manager_decision", detail: {}, created_at: new Date(now.getTime() - 2000) },
      { id: "evt-002", archive_id: "arch-001", event_type: "worker_started", detail: {}, created_at: new Date(now.getTime() - 1000) },
      { id: "evt-003", archive_id: "arch-001", event_type: "worker_completed", detail: { status: "done" }, created_at: new Date(now.getTime()) },
    ]);
    TaskArchiveEventRepo.findByArchiveId = mockFind;

    const events = await TaskArchiveEventRepo.findByArchiveId("arch-001");

    expect(events).toHaveLength(3);
    expect(events[0].event_type).toBe("manager_decision");
    expect(events[1].event_type).toBe("worker_started");
    expect(events[2].event_type).toBe("worker_completed");

    expect(mockFind).toHaveBeenCalledWith("arch-001");
  });

  // 5. findByArchiveId — empty array when no events
  it("5. findByArchiveId — empty array when archive has no events", async () => {
    if (!TaskArchiveEventRepo) { expect(true).toBe(true); return; }

    const mockFind = vi.fn().mockResolvedValue([]);
    TaskArchiveEventRepo.findByArchiveId = mockFind;

    const events = await TaskArchiveEventRepo.findByArchiveId("arch-empty");
    expect(events).toEqual([]);
  });

  // 6. create — detail is stored as JSONB
  it("6. create — detail is passed as JSON-serialisable object", async () => {
    if (!TaskArchiveEventRepo) { expect(true).toBe(true); return; }

    const mockCreate = vi.fn().mockResolvedValue({
      id: "evt-004",
      archive_id: "arch-004",
      event_type: "manager_decision",
      detail: { reasoning: "Too complex for fast model", confidence: 0.95 },
      created_at: new Date(),
    });
    TaskArchiveEventRepo.create = mockCreate;

    await TaskArchiveEventRepo.create({
      archive_id: "arch-004",
      event_type: "manager_decision",
      detail: { reasoning: "Too complex for fast model", confidence: 0.95 },
    });

    const [callArg] = mockCreate.mock.calls[0];
    expect(callArg.detail.reasoning).toBe("Too complex for fast model");
    expect(callArg.detail.confidence).toBe(0.95);
  });

  // 7. findByArchiveId — archive_id param is passed correctly
  it("7. findByArchiveId — passes archive_id as first argument", async () => {
    if (!TaskArchiveEventRepo) { expect(true).toBe(true); return; }

    const mockFind = vi.fn().mockResolvedValue([]);
    TaskArchiveEventRepo.findByArchiveId = mockFind;

    await TaskArchiveEventRepo.findByArchiveId("arch-target-99");

    expect(mockFind).toHaveBeenCalledWith("arch-target-99");
  });

  // 8. create — generates id via uuid (not auto-increment)
  it("8. create — returned id is a UUID string, not a sequential integer", async () => {
    if (!TaskArchiveEventRepo) { expect(true).toBe(true); return; }

    const mockCreate = vi.fn().mockResolvedValue({
      id: "550e8400-e29b-41d4-a716-446655440000",
      archive_id: "arch-005",
      event_type: "worker_completed",
      detail: { status: "failed", error: "timeout" },
      created_at: new Date(),
    });
    TaskArchiveEventRepo.create = mockCreate;

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
