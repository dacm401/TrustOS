/**
 * Sprint 48: Auth v1 — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Set env before importing the module under test
const TEST_SECRET = "test-secret-key-FOR-TESTING-ONLY-32chars!";

describe("verifyJwt", () => {
  beforeEach(() => {
    vi.resetModules();
    // Set env vars before importing
    process.env.JWT_SECRET = TEST_SECRET;
    process.env.JWT_ENABLED = "true";
  });

  it("returns userId for valid token", async () => {
    const { verifyJwt } = await import("../../src/middleware/jwt.js");
    const { SignJWT } = await import("jose");

    const secret = new TextEncoder().encode(TEST_SECRET);
    const token = await new SignJWT({ sub: "alice" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("24h")
      .sign(secret);

    const userId = await verifyJwt(`Bearer ${token}`);
    expect(userId).toBe("alice");
  });

  it("returns null for missing Authorization header", async () => {
    const { verifyJwt } = await import("../../src/middleware/jwt.js");
    const userId = await verifyJwt(undefined);
    expect(userId).toBeNull();
  });

  it("returns null for non-Bearer prefix", async () => {
    const { verifyJwt } = await import("../../src/middleware/jwt.js");
    const userId = await verifyJwt("Basic abc123");
    expect(userId).toBeNull();
  });

  it("returns null for invalid token", async () => {
    const { verifyJwt } = await import("../../src/middleware/jwt.js");
    const userId = await verifyJwt("Bearer invalid.token.here");
    expect(userId).toBeNull();
  });

  it("returns null for expired token", async () => {
    const { verifyJwt } = await import("../../src/middleware/jwt.js");
    const { SignJWT } = await import("jose");

    const secret = new TextEncoder().encode(TEST_SECRET);
    const token = await new SignJWT({ sub: "bob" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("0s")
      .sign(secret);

    const userId = await verifyJwt(`Bearer ${token}`);
    expect(userId).toBeNull();
  });
});

