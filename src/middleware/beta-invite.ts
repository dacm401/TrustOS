/**
 * S98P: Beta Invite Code Access Control Middleware
 *
 * When TRUSTOS_BETA_INVITE_REQUIRED=true, requires a valid invite code
 * via X-Beta-Invite header, ?invite= query, or beta_invite cookie.
 *
 * Design:
 *   - Valid codes stored in TRUSTOS_BETA_INVITE_CODES (comma-separated)
 *   - Once validated, sets a session cookie (beta_invite) to avoid re-entry
 *   - Without valid code: returns 403 + invite prompt page hint
 */

import type { Context, Next } from "hono";

const INVITE_REQUIRED = process.env.TRUSTOS_BETA_INVITE_REQUIRED === "true";
const VALID_CODES = (process.env.TRUSTOS_BETA_INVITE_CODES || "")
  .split(",")
  .map((c) => c.trim())
  .filter(Boolean);

function getInviteCode(c: Context): string | undefined {
  // Priority 1: X-Beta-Invite header
  const header = c.req.header("X-Beta-Invite");
  if (header) return header.trim();

  // Priority 2: ?invite= query param
  const query = c.req.query("invite");
  if (query) return query.trim();

  // Priority 3: beta_invite cookie
  const cookieHeader = c.req.header("Cookie") || "";
  const match = cookieHeader.match(/(?:^|;\s*)beta_invite=([^;]+)/);
  if (match) return decodeURIComponent(match[1]).trim();

  return undefined;
}

export async function betaInviteMiddleware(
  c: Context,
  next: Next
): Promise<Response | void> {
  if (!INVITE_REQUIRED) {
    return next();
  }

  // S98P: Skip invite check for public/admin/internal endpoints
  // - /health, /auth: public
  // - /api/admin, /v1/admin: protected by admin-auth middleware
  // - /metrics: Prometheus, internal
  const path = c.req.path;
  if (
    path.startsWith("/health") ||
    path.startsWith("/auth") ||
    path.startsWith("/api/admin") ||
    path.startsWith("/v1/admin") ||
    path.startsWith("/metrics")
  ) {
    return next();
  }

  const code = getInviteCode(c);

  if (!code || !VALID_CODES.includes(code)) {
    return new Response(
      JSON.stringify({
        error: "Beta Access Required",
        message: "TrustOS is currently in Private Beta. A valid invite code is required to access this service.",
        hint: "Provide invite code via X-Beta-Invite header, ?invite= query parameter, or contact the team for access.",
      }),
      {
        status: 403,
        headers: {
          "Content-Type": "application/json",
          "X-Beta-Access": "denied",
        },
      }
    );
  }

  // Set cookie for subsequent requests (24h)
  c.res.headers.set(
    "Set-Cookie",
    `beta_invite=${encodeURIComponent(code)}; Path=/; Max-Age=86400; SameSite=Lax`
  );
  c.res.headers.set("X-Beta-Access", "granted");
  return next();
}
