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
  // Sprint 48 Priority 1: JWT Bearer token (production path)
  if (config.identity.jwtEnabled) {
    const authHeader = c.req.header("Authorization");
    const jwtUserId = await verifyJwt(authHeader);
    if (jwtUserId) {
      c.set("userId", jwtUserId);
      return next();
    }
  }

  // Priority 2: server-injected header (trusted, e.g. behind a proxy)
  const headerUserId = c.req.header("X-User-Id");
  if (headerUserId) {
    c.set("userId", headerUserId);
    return next();
  }

  // Priority 3: query.user_id (dev fallback only)
  const queryUserId = c.req.query("user_id");
  if (queryUserId) {
    if (config.identity.allowDevFallback) {
      c.set("userId", queryUserId);
      return next();
    }
    // Dev fallback disabled → treat as unauthenticated
    return c.json({ error: "Authentication required: provide JWT Bearer token or X-User-Id header" }, 401);
  }

  // No identity found.
  // Reject immediately in production mode (JWT enabled, no fallback)
  if (!config.identity.allowDevFallback) {
    return c.json({ error: "Authentication required: provide JWT Bearer token or X-User-Id header" }, 401);
  }

  // Dev fallback enabled but no identity in header/query.
  // Pass through — handlers that need identity will use their own dev shim.
  return next();
}
