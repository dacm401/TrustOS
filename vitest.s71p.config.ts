/**
 * Vitest config for S71P Real DB Degraded SSR E2E tests.
 *
 * 基于 vitest.s70p.config.ts：真实 Docker Postgres，不 mock pg。
 * 区别：验证三个 degraded tier（Warning/Bad/Security）的 SSR SSE done。
 *
 * Prerequisites:
 *   1. Docker running:  node scripts/start-db.cjs
 *   2. Then:             npx vitest run --config vitest.s71p.config.ts
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
  root: "C:\\Users\\ligua\\Desktop\\AI项目\\trustos\\TrustOS",
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
  },
  test: {
    globals: true,
    environment: "node",
    pool: "forks",
    include: ["tests/services/verifier/quality-router-s71p-real-db-e2e.test.ts"],
    // NO setupFiles → no pg mock → real pg connection
    env: {
      DATABASE_URL: testDbUrl,
      NODE_PATH: resolve("node_modules"),
    },
  },
});
