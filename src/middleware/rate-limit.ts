/**
 * P2-2: Rate Limiting Middleware — Hono implementation
 *
 * Design:
 *   - Sliding window algorithm using an in-memory Map (keyed by ip | userId)
 *   - Each request punches a timestamp into the window; older ones are evicted.
 *   - When window is full → 429 with Retry-After header.
 *   - Runs BEFORE identity middleware so unauthenticated callers are still rate-limited.
 *
 * Config (src/config.ts → config.rateLimit):
 *   enabled        — master kill switch (default: false, opt-in)
 *   windowMs       — sliding window size in ms (default: 60 000 = 1 min)
 *   maxRequests    — max requests per window per key (default: 60)
 *   byUserId       — when true, authenticated userId is the key; falls back to IP
 */

import type { Context, Next } from "hono";
import { config } from "../config.js";
import { getContextUserId } from "./identity.js";

interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

/** Test-only: clears the in-memory rate limit store between test runs. */
export function resetRateLimitStore(): void {
  store.clear();
}

// ── Key extraction ─────────────────────────────────────────────────────────────

/**
 * Best-effort client IP, checking common proxy headers first.
 */
function getClientIp(c: Context): string {
  // Cloudflare
  const cf = c.req.header("cf-connecting-ip");
  if (cf) return cf;
  // Nginx / reverse proxy
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  // Alibaba / traditional
  const real = c.req.header("x-real-ip");
  if (real) return real;
  // Hono on Node (req.raw is the Node IncomingMessage)
  const nodeReq = c.get("req") as { socket?: { remoteAddress?: string } } | undefined;
  return nodeReq?.socket?.remoteAddress ?? "127.0.0.1";
}

/**
 * Rate-limit key:
 *   authenticated → userId (session-level)
 *   unauthenticated → IP (endpoint-level)
 */
function getRateLimitKey(c: Context): string {
  const userId = getContextUserId(c);
  if (userId) return `user:${userId}`;
  return `ip:${getClientIp(c)}`;
}

// ── Sliding window punch (exported for unit testing) ───────────────────────────

/**
 * Pure rate-limit logic: sliding window punch.
 * Exported so tests can call it without mocking Hono context.
 *
 * @param key       rate-limit bucket key (e.g. "ip:1.2.3.4" or "user:alice")
 * @param windowMs  sliding window size in milliseconds
 * @param maxRequests max requests allowed per window
 * @param getEntry  optional getter/setter for the entry map (defaults to module-level store)
 * @returns { allowed, retryAfter, remaining }
 */
export function punch(
  key: string,
  windowMs: number,
  maxRequests: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _getEntry?: (k: string) => any,
): {
  allowed: boolean;
  retryAfter: number; // seconds
  remaining: number;
} {
  const now = Date.now();
  const windowStart = now - windowMs;

  let entry = store.get(key);

  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Evict timestamps outside the sliding window
  entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

  if (entry.timestamps.length >= maxRequests) {
    // Oldest timestamp in window = earliest unexpired request
    const oldest = Math.min(...entry.timestamps);
    const retryAfter = Math.ceil((oldest + windowMs - now) / 1000);
    return { allowed: false, retryAfter: Math.max(1, retryAfter), remaining: 0 };
  }

  entry.timestamps.push(now);
  return {
    allowed: true,
    retryAfter: 0,
    remaining: maxRequests - entry.timestamps.length,
  };
}

// ── Middleware ─────────────────────────────────────────────────────────────────

export async function rateLimitMiddleware(c: Context, next: Next): Promise<Response | void> {
  if (!config.rateLimit.enabled) {
    return next();
  }

  const { windowMs, maxRequests } = config.rateLimit;
  const key = getRateLimitKey(c);

  const result = punch(key, windowMs, maxRequests);

  if (!result.allowed) {
    // Return a raw Response directly — avoids c.res.headers.set() being
    // skipped on early-return, and ensures Retry-After is always present.
    return new Response(
      JSON.stringify({
        error: "Too Many Requests",
        message: `Rate limit exceeded. Retry after ${result.retryAfter} seconds.`,
        retryAfter: result.retryAfter,
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(result.retryAfter),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Limit": String(maxRequests),
        },
      },
    );
  }

  c.res.headers.set("X-RateLimit-Remaining", String(result.remaining));
  c.res.headers.set("X-RateLimit-Limit", String(maxRequests));

  return next();
}
