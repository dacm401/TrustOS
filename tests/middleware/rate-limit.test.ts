/**
 * P2-2: Rate Limiting — Unit Tests
 *
 * Strategy: test the pure `punch()` function directly.
 * This gives deterministic, fast tests without mocking Hono internals.
 *
 * The middleware integration is tested separately via real HTTP calls
 * in the E2E test suite.
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

let resetRateLimitStore: () => void;
let punch: (
  key: string,
  windowMs: number,
  maxRequests: number,
) => { allowed: boolean; retryAfter: number; remaining: number };

beforeAll(async () => {
  // eslint-disable-next-line @typescript-eslint/no-shadow
  const mod = await import("../../src/middleware/rate-limit.js");
  resetRateLimitStore = mod.resetRateLimitStore;
  punch = mod.punch;
});

describe("punch() — sliding window rate limiter", () => {
  beforeEach(() => {
    // Reset module store before each test so state is clean
    resetRateLimitStore();
  });

  // ── Within limit ───────────────────────────────────────────────────────────

  it("returns allowed=true on first request", () => {
    const result = punch("ip:1.2.3.4", 60_000, 60);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(59);
    expect(result.retryAfter).toBe(0);
  });

  it("decrements remaining with each request", () => {
    const key = "ip:1.2.3.4";
    const r1 = punch(key, 60_000, 3);
    const r2 = punch(key, 60_000, 3);
    const r3 = punch(key, 60_000, 3);

    expect(r1.remaining).toBe(2);
    expect(r2.remaining).toBe(1);
    expect(r3.remaining).toBe(0);
    expect(r3.allowed).toBe(true);
  });

  // ── Limit exceeded ─────────────────────────────────────────────────────────

  it("returns allowed=false when window is full", () => {
    const key = "ip:1.2.3.4";
    punch(key, 60_000, 2); // slot 1
    punch(key, 60_000, 2); // slot 2
    const result = punch(key, 60_000, 2); // over limit

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it("calculates retryAfter correctly (seconds until oldest request expires)", () => {
    const key = "ip:1.2.3.4";
    punch(key, 60_000, 1); // filled
    const result = punch(key, 60_000, 1);

    // retryAfter ≈ windowMs / 1000, clamped to [1, 60]
    expect(result.retryAfter).toBeGreaterThanOrEqual(59);
    expect(result.retryAfter).toBeLessThanOrEqual(60);
  });

  // ── Separate buckets ───────────────────────────────────────────────────────

  it("tracks different IPs in separate buckets", () => {
    // Punch B twice to fill its 2-slot bucket
    const b1 = punch("ip:10.0.0.2", 60_000, 2);
    expect(b1.remaining).toBe(1); // slot 1 filled, 1 remaining

    const b2 = punch("ip:10.0.0.2", 60_000, 2);
    expect(b2.remaining).toBe(0); // slot 2 filled, 0 remaining
    expect(b2.allowed).toBe(true); // exactly at limit, allowed

    // 3rd punch for B → over limit
    const bRejected = punch("ip:10.0.0.2", 60_000, 2);
    expect(bRejected.allowed).toBe(false); // bucket full

    // A's bucket is independent — still has room
    const a = punch("ip:10.0.0.1", 60_000, 2);
    expect(a.remaining).toBe(1); // slot 1 filled, independent from B
    expect(a.allowed).toBe(true);
  });

  it("userId buckets are independent of IP buckets", () => {
    punch("ip:1.2.3.4", 60_000, 1); // exhausted IP bucket
    const userResult = punch("user:bob", 60_000, 1); // fresh user bucket

    expect(userResult.allowed).toBe(true); // different key space
  });

  // ── Sliding window eviction ────────────────────────────────────────────────

  it("old requests expire after windowMs", async () => {
    const key = "ip:1.2.3.4";
    punch(key, 100, 2); // slot 1
    punch(key, 100, 2); // slot 2 → full

    const rejected = punch(key, 100, 2); // over limit
    expect(rejected.allowed).toBe(false);

    await new Promise((r) => setTimeout(r, 130)); // wait for window to expire

    const fresh = punch(key, 100, 2); // new window
    expect(fresh.allowed).toBe(true);
    expect(fresh.remaining).toBe(1);
  });

  // ── Edge cases ─────────────────────────────────────────────────────────────

  it("handles maxRequests=0 gracefully (always reject)", () => {
    const result = punch("ip:1.2.3.4", 60_000, 0);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfter).toBeGreaterThan(0);
  });
});

// ── Middleware smoke test ──────────────────────────────────────────────────────

describe("rateLimitMiddleware — config kill switch", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.RATE_LIMIT_ENABLED = "false";
  });

  it("passes through when RATE_LIMIT_ENABLED != 'true'", async () => {
    const { rateLimitMiddleware } = await import(
      "../../src/middleware/rate-limit.js"
    );
    const ctx = {
      req: {
        header: vi.fn().mockReturnValue("127.0.0.1"),
        path: "/api/chat",
        query: () => undefined,
      },
      set: vi.fn(),
      get: vi.fn(),
      res: { headers: { set: vi.fn(), get: vi.fn() } },
    };
    const next = vi.fn().mockResolvedValue(undefined);

    await rateLimitMiddleware(ctx as any, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
