/**
 * S98P: Admin Auth Middleware
 *
 * Protects admin endpoints with X-Admin-Key header.
 * Default key: TRUSTOS_ADMIN_KEY env var or "admin-changeme" (dev only).
 *
 * **Boundary Disclaimer (F3 — TRST-4 Follow-up)**:
 * This is a beta operations console, NOT a production admin panel.
 * - No RBAC — single key grants full access to all admin endpoints
 * - No audit trail — triage/status changes and CSV exports are not logged
 * - No rate limiting — admin endpoints are unprotected against brute-force
 * - In production with the default key, ALL admin requests are REFUSED
 * - User status changes (active/paused/blocked) are advisory — not enforced at gateway
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

  // Refuse all admin access in production with default key
  if (isProduction && ADMIN_KEY === "admin-changeme") {
    return new Response(
      JSON.stringify({
        error: "Admin access disabled",
        message:
          "Production mode requires TRUSTOS_ADMIN_KEY to be explicitly set. Default key is not accepted in production.",
      }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  return next();
}
