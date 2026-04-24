/**
 * Vitest config for Trust module unit tests.
 * No DB required — all mocks, pure unit tests.
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
    pool: "threads",
    poolOptions: {
      threads: {
        minThreads: 1,
        maxThreads: 1,
        singleThread: true,
      },
    },
    include: ["tests/trust/**/*.test.ts"],
    env: {
      NODE_PATH: resolve("node_modules"),
    },
    testTimeout: 30_000,
  },
});
