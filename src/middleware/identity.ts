/**
 * C3a + Sprint 48: Server Identity Context Adapter
 *
 * Unified identity extraction layer for all API handlers.
 *
 * Priority (when JWT_ENABLED=true, the default in Sprint 48):
 *   1. Authorization: Bearer <jwt>  → verified, production path (Sprint 48)
 *   2. X-User-Id header             → server-injected, trusted proxy path
 *   3. query.user_id                → dev fallback only (ALLOW_DEV_FALLBACK=true)
 *   4. None                         → 401 (in strict mode) or pass-through (dev)
 *
 * The middleware never parses JSON body (constraint: no body reading in middleware).
 */

import type { Context, Next } from "hono";
import { config } from "../config.js";
import { verifyJwt } from "./jwt.js";

// The type for the userId context variable — import this in API handlers
// to properly type `c.get("userId")`.
export type UserIdContext = { userId: string | undefined };

/**
 * Reads userId from the request context that was set by identityMiddleware.
 * Returns the trusted userId string, or undefined if not set.
 *
 * Usage in handlers:
 *   const userId = getContextUserId(c);
 *   // Handle undefined case if the endpoint doesn't require mandatory auth.
 */
export function getContextUserId(c: Context): string | undefined {
  // Hono stores context vars in a private Map via c.set/c.get
  // c.get("userId") reads from that Map; direct property access (c as any).userId does NOT work
  return c.get("userId") as string | undefined;
}

/**
 * Middleware: extracts identity from trusted sources and writes to context.
 *
 * On success:  c.set("userId", userId) → next()
 * On failure:  401 JSON response
 */
export async function identityMiddleware(c: Context, next: Next): Promise<Response | void> {
  // P2-A (TRST-5): Harden identity so JWT-enforced mode does NOT silently fall
  // through to trusting the client-supplied X-User-Id header. When jwtEnabled:
  //   - valid JWT → accept its `sub` as identity (verified).
  //   - X-User-Id present AND matches the verified JWT sub → accept (proxy trust
  //     only as a redundant alias, never as an independent identity source).
  //   - anything else → 401. No blind header trust, no query fallback.

  if (config.identity.jwtEnabled) {
    const authHeader = c.req.header("Authorization");
    const jwtUserId = await verifyJwt(authHeader);

    if (jwtUserId) {
      // Verified identity. Optionally cross-check a proxy-injected header.
      const headerUserId = c.req.header("X-User-Id");
      if (headerUserId && headerUserId !== jwtUserId) {
        // Header claims a DIFFERENT identity than the verified token → reject.
        return c.json(
          { error: "Identity mismatch: X-User-Id does not match authenticated token" },
          403,
        );
      }
      c.set("userId", jwtUserId);
      return next();
    }

    // No valid JWT. Reject — do NOT trust X-User-Id or query param as identity.
    return c.json(
      { error: "Authentication required: provide a valid JWT Bearer token" },
      401,
    );
  }

  // JWT disabled (dev / local single-user mode). Allow explicit dev fallback via
  // X-User-Id or query, but ONLY when ALLOW_DEV_FALLBACK is set. Otherwise 401.
  const headerUserId = c.req.header("X-User-Id");
  if (headerUserId) {
    c.set("userId", headerUserId);
    return next();
  }

  const queryUserId = c.req.query("user_id");
  if (queryUserId) {
    if (config.identity.allowDevFallback) {
      c.set("userId", queryUserId);
      return next();
    }
    return c.json({ error: "Authentication required: provide JWT Bearer token or X-User-Id header" }, 401);
  }

  if (!config.identity.allowDevFallback) {
    return c.json({ error: "Authentication required: provide JWT Bearer token or X-User-Id header" }, 401);
  }

  // Dev fallback enabled but no identity supplied — pass through.
  return next();
}
