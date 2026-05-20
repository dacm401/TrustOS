/**
 * Vitest config for S70P Real DB SSR E2E tests.
 *
 * Key differences from vitest.s69p.config.ts:
 *   - NO pg mock / setupFiles
 *   - Connects to a REAL Docker Postgres instance
 *   - DATABASE_URL must point to a running postgres (smartrouter_test DB)
 *   - Skips if DB unavailable (doesn't fail the suite)
 *
 * Prerequisites:
 *   1. Docker running:  node scripts/start-db.cjs
 *   2. Then:             npx vitest run --config vitest.s70p.config.ts
 *   3. After tests:     node scripts/stop-db.cjs
 *
 * Exit code:
 *   0 = all tests pass OR all real-db tests skipped (Docker unavailable)
 *   1 = test failure
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
    include: ["tests/services/verifier/quality-router-s70p-real-db-e2e.test.ts"],
    // NO setupFiles → no pg mock → real pg connection
    env: {
      DATABASE_URL: testDbUrl,
      NODE_PATH: resolve("node_modules"),
    },
  },
});
