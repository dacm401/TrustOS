import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { SignJWT } from "jose";
import "dotenv/config";

const app = new Hono();
app.use("/*", cors());

const TOKEN_EXPIRY_SECONDS = 24 * 60 * 60;

async function signToken(userId) {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET || "SmartRouterPro2026ProductionSecretKey32chars");
  const jwt = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_EXPIRY_SECONDS}s`)
    .sign(secret);
  return jwt;
}

app.post("/auth/token", async (c) => {
  let body;
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
  if (username !== "admin" || password !== "changeme") {
    await new Promise((r) => setTimeout(r, 50));
    return c.json({ error: "Invalid credentials" }, 401);
  }
  try {
    const token = await signToken(username);
    return c.json({ token, expires_in: TOKEN_EXPIRY_SECONDS, token_type: "Bearer" });
  } catch (e) {
    console.error("signToken error:", e);
    return c.json({ error: "Token generation failed: " + e.message }, 500);
  }
});

const port = 3002;
serve({ fetch: app.fetch, port });
console.log(`Test auth server on port ${port}`);
