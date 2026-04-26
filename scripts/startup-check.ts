/**
 * Sprint 69: Startup prerequisite checker
 *
 * Checks before the server starts:
 *  1. PostgreSQL connectivity (DATABASE_URL)
 *  2. Port availability (3000, 3001)
 *
 * Exit codes:
 *   0 = all checks pass
 *   1 = one or more checks failed
 */

import pg from "pg";
import net from "net";

const { Pool } = pg;

const PORTS = [3001, 3000];
const DB_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/smartrouter";
const TIMEOUT_MS = 5000;

async function checkDb(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const pool = new Pool({ connectionString: DB_URL, max: 1, connectionTimeoutMillis: TIMEOUT_MS });
  try {
    const start = Date.now();
    await pool.query("SELECT 1");
    const latency = Date.now() - start;
    await pool.end();
    return { ok: true, latencyMs: latency };
  } catch (err) {
    try { await pool.end(); } catch { /* ignore */ }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

async function checkPort(port: number): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => {
      resolve({ ok: false, error: `port ${port} is already in use` });
    });
    server.once("listening", async () => {
      server.close();
      resolve({ ok: true });
    });
    server.listen(port, "0.0.0.0");
  });
}

async function main() {
  console.log("\n🔍 SmartRouter Pro — Startup Check\n");
  console.log(`   Database: ${DB_URL.replace(/\/\/.*@/, "//***@")}`);

  const [dbResult, ...portResults] = await Promise.all([checkDb(), ...PORTS.map(checkPort)]);

  // DB
  if (dbResult.ok) {
    console.log(`   ✅ Database  connected (${dbResult.latencyMs}ms)`);
  } else {
    console.log(`   ❌ Database  FAILED — ${dbResult.error}`);
    console.log("\n   → Is PostgreSQL running? Try: pg_ctl -D /path/to/data start");
    console.log("   → Or start via Docker: docker run -d -p 5432:5432 \\\n" +
                "     -e POSTGRES_PASSWORD=postgres \\\n" +
                "     -e POSTGRES_DB=smartrouter \\\n" +
                "     postgres:16-alpine\n");
  }

  // Ports
  for (let i = 0; i < PORTS.length; i++) {
    const port = PORTS[i];
    const result = portResults[i];
    if (result.ok) {
      console.log(`   ✅ Port ${port}   available`);
    } else {
      console.log(`   ❌ Port ${port}   FAILED — ${result.error}`);
      console.log(`   → Kill the process using it, or change BACKEND_PORT / frontend port`);
    }
  }

  // Auth users
  const authUsers = process.env.AUTH_USERS;
  if (authUsers) {
    const count = authUsers.split(",").length;
    console.log(`   ✅ Auth       ${count} user(s) configured`);
  } else {
    console.log(`   ⚠️  Auth       using DEV FALLBACK (admin:changeme) — NOT for production`);
  }

  console.log("\n" + "─".repeat(50));

  const allOk = dbResult.ok && portResults.every((r) => r.ok);
  if (!allOk) {
    console.log("\n❌ Startup check FAILED. Fix the issues above and retry.\n");
    process.exit(1);
  }

  console.log("\n✅ All checks passed — ready to start\n");
  process.exit(0);
}

main();
