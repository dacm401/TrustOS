/**
 * TRST-4G Production Ops Baseline v0 — readiness check test.
 *
 * Validates boot-time self-check aggregates health + config + event-store
 * without throwing, degrading to ready:false on component failure.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as db from "../../src/db/connection.js";
import { readinessCheck } from "../../src/ops/readiness.js";

let spy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  spy = vi.spyOn(db, "query");
});

afterEach(() => {
  spy.mockRestore();
});

describe("4G readiness check", () => {
  it("reports ready when database responds", async () => {
    spy.mockResolvedValue({ rows: [{ "1": 1 }] } as any);
    const report = await readinessCheck();
    expect(report.ready).toBe(true);
    expect(report.checks.find((c) => c.name === "database")?.ok).toBe(true);
    expect(report.checks.find((c) => c.name === "event_store")?.ok).toBe(true);
  });

  it("degrades to ready:false when database is unreachable (no throw)", async () => {
    spy.mockRejectedValue(new Error("connection refused"));
    const report = await readinessCheck();
    expect(report.ready).toBe(false);
    expect(report.checks.find((c) => c.name === "database")?.ok).toBe(false);
  });

  it("always returns a timestamped report shape", async () => {
    spy.mockResolvedValue({ rows: [{ "1": 1 }] } as any);
    const report = await readinessCheck();
    expect(typeof report.timestamp).toBe("string");
    expect(Array.isArray(report.checks)).toBe(true);
    expect(report.checks.length).toBeGreaterThanOrEqual(3);
  });
});
