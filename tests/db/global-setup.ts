// workspace: 20260416214742
/**
 * Vitest globalSetup — runs ONCE in the main process before any workers start.
 *
 * Moving setupTestDatabase() here prevents the deadlock that occurs when
 * multiple workers all call setupFiles concurrently and race to acquire
 * pg_advisory_lock + TRUNCATE/UPDATE the same tables.
 *
 * The `env.DATABASE_URL` in vitest.repo.config.ts only applies to worker
 * threads, not to globalSetup. We therefore compute the test DB URL directly
 * here using the same logic as the config.
 */

import { setupTestDatabase } from "./harness.js";

export async function setup(): Promise<void> {
  // Ensure DATABASE_URL points to the test DB before harness is used.
  process.env.DATABASE_URL =
    process.env.DATABASE_URL?.replace(/\/[^/?]+(\?|$)/, "/smartrouter_test$1") ??
    "postgresql://postgres:postgres@localhost:5432/smartrouter_test";

  await setupTestDatabase();
}
