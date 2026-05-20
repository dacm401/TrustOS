/**
 * S70P: Docker Postgres lifecycle script
 *
 * Usage:
 *   node scripts/start-db.cjs           — start postgres, wait for healthy
 *   node scripts/start-db.cjs --fast    — start postgres, skip health wait
 *
 * Exit codes:
 *   0 = postgres started and healthy (or already running)
 *   1 = failed to start (docker not running, pull failed, etc.)
 *   2 = postgres unhealthy after retries
 *
 * This script starts ONLY the postgres service from docker-compose.yml.
 * It does NOT start backend, frontend, redis, minio, prometheus.
 */
const { execSync } = require("child_process");
const path = require("path");

const COMPOSE_FILE = path.join(__dirname, "..", "docker-compose.yml");
const MAX_RETRIES = 15;
const RETRY_INTERVAL_MS = 2000;

function run(cmd, opts = {}) {
  return execSync(cmd, {
    stdio: "inherit",
    cwd: path.join(__dirname, ".."),
    ...opts,
  });
}

function dryRun(cmd) {
  console.log(`[start-db] $ ${cmd}`);
}

function main() {
  const fast = process.argv.includes("--fast");

  // 1. Check if Docker is running
  console.log("[start-db] Checking Docker availability...");
  try {
    run(`docker info`, { stdio: "pipe" });
  } catch {
    console.error("[start-db] ERROR: Docker is not running. Start Docker Desktop and retry.");
    process.exit(1);
  }

  // 2. Check if postgres container is already healthy
  try {
    const out = execSync(
      `docker ps --filter "name=trustos-postgres-1" --filter "status=running" --format "{{.Status}}"`,
      { cwd: path.join(__dirname, ".."), encoding: "utf8" }
    ).trim();
    if (out.startsWith("Up") && out.includes("healthy")) {
      console.log("[start-db] postgres container already healthy. Skipping start.");
      process.exit(0);
    }
  } catch {
    // Not running — continue to start
  }

  // 3. Start postgres service only
  console.log("[start-db] Starting postgres service...");
  try {
    run(`docker compose -f "${COMPOSE_FILE}" up -d postgres`);
  } catch {
    console.error("[start-db] ERROR: docker compose up -d postgres failed.");
    process.exit(1);
  }

  if (fast) {
    console.log("[start-db] --fast mode: skipping health check.");
    process.exit(0);
  }

  // 4. Wait for postgres to be healthy
  console.log(`[start-db] Waiting for postgres to be healthy (max ${MAX_RETRIES} retries @ ${RETRY_INTERVAL_MS}ms)...`);
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const out = execSync(
        `docker compose -f "${COMPOSE_FILE}" exec -T postgres pg_isready -U postgres -d smartrouter`,
        { cwd: path.join(__dirname, ".."), encoding: "utf8", stdio: "pipe" }
      ).trim();
      if (out === "smartrouter: accepting connections") {
        console.log(`[start-db] postgres healthy after ${i + 1} attempt(s).`);
        process.exit(0);
      }
    } catch {
      // Not ready yet
    }
    process.stdout.write(".");
    if (i < MAX_RETRIES - 1) {
      const start = Date.now();
      while (Date.now() - start < RETRY_INTERVAL_MS) {
        // busy wait (simple approach, no sleep dependency)
      }
    }
  }

  console.error(`\n[start-db] ERROR: postgres unhealthy after ${MAX_RETRIES} retries.`);
  process.exit(2);
}

main();
