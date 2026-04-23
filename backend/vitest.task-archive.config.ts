/**
 * Vitest config for TaskArchive mock-based unit tests.
 *
 * These tests use vi.mock (not the real DB), so they don't need
 * the setup/teardown hooks from tests/db/setup.ts.
 *
 * Usage:
 *   node_modules/.bin/vitest run --config vitest.task-archive.config.ts
 */
import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
  },
  test: {
    globals: true,
    environment: "node",
    pool: "forks",
    // Only run our mock-based tests — no DB setup needed
    include: [
      "tests/repos/**/*.test.ts",
      "tests/services/**/*.test.ts",
    ],
    exclude: [
      // Skip the existing repo integration tests (they need the real DB)
      "tests/repositories/**",
      "tests/api/**",
      "tests/features/**",
    ],
    env: {
      NODE_PATH: resolve("node_modules"),
      // No DATABASE_URL needed — all DB access is mocked
    },
    // NO setupFiles — no DB connection needed
    // NO globalTeardown
    testTimeout: 30_000,
  },
});
