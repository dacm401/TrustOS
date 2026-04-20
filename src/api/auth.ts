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
import { config } from "../config.js";

const authRouter = new Hono();

// In-memory user store parsed from AUTH_USERS env var
// Format: "user1:pass1,user2:pass2"
function parseUsers(): Map<string, string> {
  const users = new Map<string, string>();
  const raw = process.env.AUTH_USERS || "admin:changeme";
  for (const entry of raw.split(",")) {
    const [username, password] = entry.trim().split(":");
    if (username && password) {
      users.set(username, password);
    }
  }
  return users;
}

const TOKEN_EXPIRY_SECONDS = 24 * 60 * 60; // 24 hours

async function signToken(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(
    config.jwt.secret || "dev-secret-CHANGE-ME-IN-PRODUCTION"
  );
  const alg = "HS256";

  const jwt = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg })
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_EXPIRY_SECONDS}s`)
    .sign(secret);

  return jwt;
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

  if (!storedPassword || storedPassword !== password) {
    // 延迟响应：防止Timing Attack
    await new Promise((r) => setTimeout(r, 50));
    return c.json({ error: "Invalid credentials" }, 401);
  }

  const token = await signToken(username);

  return c.json({
    token,
    expires_in: TOKEN_EXPIRY_SECONDS,
    token_type: "Bearer",
  });
});

export { authRouter };
