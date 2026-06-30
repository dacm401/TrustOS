/**
 * S98P: Admin Auth Middleware
 *
 * Protects admin endpoints with X-Admin-Key header.
 * Default key: TRUSTOS_ADMIN_KEY env var or "admin-changeme" (dev only).
 */

import type { Context, Next } from "hono";

const ADMIN_KEY = process.env.TRUSTOS_ADMIN_KEY || "admin-changeme";
const isProduction = process.env.NODE_ENV === "production";

export async function adminAuthMiddleware(
  c: Context,
  next: Next
): Promise<Response | void> {
  const key = c.req.header("X-Admin-Key");

  if (!key || key !== ADMIN_KEY) {
    return new Response(
      JSON.stringify({
        error: "Admin access denied",
        message: "A valid X-Admin-Key header is required.",
      }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // Warn if using default key in production
  if (isProduction && ADMIN_KEY === "admin-changeme") {
    console.warn(
      "[admin-auth] WARNING: Using default admin key in production. Set TRUSTOS_ADMIN_KEY."
    );
  }

  return next();
}
