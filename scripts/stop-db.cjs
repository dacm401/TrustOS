/**
 * S70P: Docker Postgres teardown script
 *
 * Usage:
 *   node scripts/stop-db.cjs           — stop and remove postgres container
 *   node scripts/stop-db.cjs --keep    — stop only (leave data volume)
 *
 * Exit codes:
 *   0 = stopped successfully (or not running)
 *   1 = failed
 */
const { execSync } = require("child_process");
const path = require("path");

const COMPOSE_FILE = path.join(__dirname, "..", "docker-compose.yml");

function run(cmd) {
  return execSync(cmd, {
    stdio: "inherit",
    cwd: path.join(__dirname, ".."),
  });
}

function main() {
  const keep = process.argv.includes("--keep");

  // 1. Check if container is running
  try {
    const out = execSync(
      `docker ps --filter "name=trastos-postgres-1" --format "{{.Names}}"`,
      { encoding: "utf8", stdio: "pipe" }
    ).trim();
    if (!out) {
      console.log("[stop-db] postgres container not running. Nothing to stop.");
      process.exit(0);
    }
  } catch {
    process.exit(0);
  }

  // 2. Stop postgres service
  console.log("[stop-db] Stopping postgres service...");
  try {
    run(`docker compose -f "${COMPOSE_FILE}" stop postgres`);
  } catch {
    console.error("[stop-db] ERROR: docker compose stop postgres failed.");
    process.exit(1);
  }

  if (keep) {
    console.log("[stop-db] --keep mode: container stopped, volume preserved.");
    process.exit(0);
  }

  // 3. Remove container (but NOT the named volume — preserves data across restarts)
  console.log("[stop-db] Removing postgres container (volume preserved)...");
  try {
    run(`docker compose -f "${COMPOSE_FILE}" rm -f postgres`);
  } catch {
    console.error("[stop-db] WARNING: docker compose rm postgres failed (non-fatal).");
    // Don't exit(1) — stop succeeded, rm failure is minor
  }

  console.log("[stop-db] Done.");
  process.exit(0);
}

main();
