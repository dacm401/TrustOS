import pg from "pg";
import { config } from "../config.js";

const { Pool } = pg;

/** Always read DATABASE_URL fresh — safe for vitest where env is set before pool use. */
function makePool(): pg.Pool {
  const url = process.env.DATABASE_URL ?? config.databaseUrl;
  // Sprint 05 fix: 打印实际连接的 DB URL（脱敏密码）
  console.log(`[DB] Connecting to: ${url.replace(/:[^:@]+@/, ':***@')}`);
  const p = new Pool({
    connectionString: url,
    max: Number(process.env["DB_POOL_MAX"]) || 20,
    idleTimeoutMillis: Number(process.env["DB_POOL_IDLE_TIMEOUT"]) || 30000,
    connectionTimeoutMillis: Number(process.env["DB_CONN_TIMEOUT"]) || 5000,
  });
  p.on("error", (err) => {
    console.error("Unexpected database error:", err);
  });
  return p;
}

// Lazy pool — replaced by drainPool() in tests, recreated on next query().
let _pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!_pool) {
    _pool = makePool();
  }
  return _pool;
}

// Backward-compatible accessor.
export const pool = { get value() { return getPool(); } };

/**
 * End the current pool and null it.  Next query() creates a fresh pool.
 */
export async function drainPool(): Promise<void> {
  if (_pool) {
    try { await _pool.end(); } catch { /* ignore */ }
    _pool = null;
  }
}

export async function resetPool(): Promise<void> {
  await drainPool();
}

export async function query(text: string, params?: any[]) {
  const start = Date.now();
  const result = await getPool().query(text, params);
  const duration = Date.now() - start;
  if (duration > 100) {
    console.log(`Slow query (${duration}ms):`, text.substring(0, 80));
  }
  return result;
}

// ── S69P: DB availability check ────────────────────────────────────────────

/** TTL for cached availability result (ms). Avoids hammering the pool on every call. */
const DB_CHECK_TTL_MS = 5_000;

interface DbCheckCache {
  available: boolean;
  checkedAt: number;
}

let _dbCheckCache: DbCheckCache | null = null;

/**
 * S69P: Probe whether the DB pool can accept a query within 1 second.
 *
 * Uses its own short-timeout pool to avoid interfering with the main pool's
 * connectionTimeoutMillis (5000).  Results are cached for DB_CHECK_TTL_MS.
 *
 * Returns true if the probe query succeeds within 1s; false otherwise
 * (connection refused, timeout, pool not initialised, etc.).
 */
export async function checkDbAvailability(): Promise<boolean> {
  const now = Date.now();

  // Return cached result if still fresh
  if (_dbCheckCache !== null && now - _dbCheckCache.checkedAt < DB_CHECK_TTL_MS) {
    return _dbCheckCache.available;
  }

  // Force-close any stale pool so a fresh probe uses current env vars
  await drainPool();

  const url = process.env.DATABASE_URL ?? config.databaseUrl;
  const probePool = new Pool({
    connectionString: url,
    max: 1,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 1_000,   // short probe timeout — 1 s
  });

  try {
    await probePool.query("SELECT 1");
    _dbCheckCache = { available: true, checkedAt: now };
    return true;
  } catch {
    _dbCheckCache = { available: false, checkedAt: now };
    return false;
  } finally {
    try { await probePool.end(); } catch { /* ignore */ }
    // Do NOT re-create the main pool here — let it lazy-initialise on next query()
  }
}
