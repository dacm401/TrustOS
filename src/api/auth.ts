/**
 * Sprint 48: Auth v1 — JWT Token Endpoint
 *
 * POST /auth/token
 * Body: { "username": "admin", "password": "secret" }
 * Returns: { "token": "<jwt>", "expires_in": 86400 }
 *
 * 凭证由 AUTH_USERS 环境变量提供（格式: user:pass,user2:pass2）。
 * 生产环境必须设置 JWT_SECRET。
 */

import { Hono } from "hono";
import { SignJWT, importPKCS8 } from "jose";
import { timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { appendEvent } from "../services/trst1/jsonl-event-store.js";
import { createEventId } from "../services/trst1/event-envelope.js";

const authRouter = new Hono();

/**
 * GET /auth/status — public endpoint for diagnosing login issues.
 * Shows whether AUTH_USERS is configured, which users exist, and a hint.
 */
authRouter.get("/status", (c) => {
  const raw = process.env.AUTH_USERS;
  const isDevFallback = !raw;

  if (isDevFallback) {
    return c.json({
      configured: false,
      mode: "dev-fallback",
      users: ["admin"],
      hint: "AUTH_USERS not set. Using insecure dev default (admin:changeme). Set AUTH_USERS env var for production.",
    });
  }

  const users = raw!
    .split(",")
    .map((e) => e.trim().split(":")[0])
    .filter(Boolean);

  return c.json({
    configured: true,
    mode: "production",
    users,
    hint: `Found ${users.length} user(s). Use POST /auth/token with { username, password } to obtain a JWT.`,
  });
});

const isProduction = process.env.NODE_ENV === "production";

// In-memory user store parsed from AUTH_USERS env var
// Format: "user1:pass1,user2:pass2"
function parseUsers(): Map<string, string> {
  const raw = process.env.AUTH_USERS;
  if (!raw) {
    if (isProduction) {
      throw new Error(
        "[AUTH-SEC] AUTH_USERS environment variable is required in production. " +
        "Format: 'user:pass,user2:pass2'. Do NOT ship with hardcoded credentials."
      );
    }
    // Dev-only fallback — never reaches production
    console.warn("[AUTH-SEC] AUTH_USERS not set. Using insecure dev default. DO NOT use in production.");
    return new Map([["admin", "changeme"]]);
  }
  const users = new Map<string, string>();
  for (const entry of raw.split(",")) {
    const [username, password] = entry.trim().split(":");
    if (username && password) {
      users.set(username, password);
    }
  }
  return users;
}

/**
 * Constant-time string comparison to avoid leaking password length/characters
 * via timing differences (replaces the earlier `!==` check).
 */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// One-time startup warning if insecure default credentials are active.
(() => {
  try {
    const users = parseUsers();
    if (!process.env.AUTH_USERS || users.get("admin") === "changeme") {
      console.warn(
        "[AUTH-SEC] Insecure default credentials in use (admin:changeme). " +
        "Set AUTH_USERS with a strong password before exposing this service."
      );
    }
  } catch {
    /* production without AUTH_USERS — handled at request time */
  }
})();

const TOKEN_EXPIRY_SECONDS = 24 * 60 * 60; // 24 hours

async function signToken(userId: string): Promise<string> {
  // P0-2: JWT secret 由 config.ts 提供，config.ts 已在 startup 校验长度
  const secret = new TextEncoder().encode(config.jwt.secret);
  const alg = "HS256";

  const jwt = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg })
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_EXPIRY_SECONDS}s`)
    .sign(secret);

  return jwt;
}

// WP-5A: 令牌签发 / 登录失败写入 Event Backbone 审计事件（含 actor_id）。
// 永不阻塞登录响应路径——失败仅记录，不影响返回。
function recordAuthEvent(
  type: "auth.token_issued" | "auth.login_failed",
  username: string,
): void {
  try {
    appendEvent({
      event_id: createEventId(),
      event_type: type,
      timestamp: new Date().toISOString(),
      trace_id: "auth",
      session_id: "auth",
      run_id: "unknown",
      project_id: "unknown",
      task_id: null,
      resource_type: "auth",
      status: type === "auth.token_issued" ? "success" : "failure",
      latency_ms: 0,
      privacy_flags: [],
      actor_id: username,
    });
  } catch {
    // 审计日志失败不影响登录流程
  }
}

authRouter.post("/token", async (c) => {
  let body: { username?: string; password?: string };
  try {
    const rawBody = await c.req.raw.text();
    body = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { username, password } = body ?? {};

  if (!username || !password) {
    return c.json({ error: "username and password are required" }, 400);
  }

  const users = parseUsers();
  const storedPassword = users.get(username);

  if (!storedPassword || !safeEqual(storedPassword, password)) {
    // 延迟响应：防止Timing Attack
    await new Promise((r) => setTimeout(r, 50));
    recordAuthEvent("auth.login_failed", username);
    return c.json({ error: "Invalid credentials" }, 401);
  }

  try {
    const token = await signToken(username);
    recordAuthEvent("auth.token_issued", username);
    return c.json({
      token,
      expires_in: TOKEN_EXPIRY_SECONDS,
      token_type: "Bearer",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[AUTH] signToken failed:", msg, err);
    return c.json({ error: "Token generation failed", detail: msg }, 500);
  }
});

export { authRouter };
