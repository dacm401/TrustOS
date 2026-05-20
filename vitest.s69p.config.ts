/**
 * Vitest config for S69P SSR E2E tests.
 * Uses setupFiles to mock pg BEFORE any module is loaded.
 *
 * Usage:
 *   npx vitest run --config vitest.s69p.config.ts
 */
import { defineConfig } from "vitest/config";
import { resolve } from "path";

const testDbUrl =
  process.env.DATABASE_URL?.replace(/\/[^/]+\?/, "/smartrouter_test?") ??
  `postgresql://postgres:postgres@localhost:5432/smartrouter_test`;

export default defineConfig({
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
  },
  test: {
    globals: true,
    environment: "node",
    pool: "forks",
    include: ["tests/services/verifier/quality-router-s69p-ssr-e2e.test.ts"],
    // setupFiles runs BEFORE any modules are loaded → pg mock is active for ALL imports
    setupFiles: ["./tests/services/verifier/quality-router-s69p-setup.ts"],
    env: {
      DATABASE_URL: testDbUrl,
      NODE_PATH: resolve("node_modules"),
    },
  },
});
