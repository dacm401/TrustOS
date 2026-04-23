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
    // Use threads pool with single-thread-per-worker (matches vitest.repo.config.ts)
    pool: "threads",
    poolOptions: {
      threads: {
        minThreads: 1,
        maxThreads: 1,
        singleThread: true,
      },
    },
    include: [
      "tests/repos/**/*.test.ts",
      "tests/services/**/*.test.ts",
    ],
    exclude: [
      "tests/repositories/**",
      "tests/api/**",
      "tests/features/**",
    ],
    env: {
      NODE_PATH: resolve("node_modules"),
    },
    testTimeout: 30_000,
  },
});
