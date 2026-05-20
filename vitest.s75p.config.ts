/**
 * Vitest config for S75P Cycle Runtime V0 tests.
 *
 * 运行方式:
 *   npx vitest run --config vitest.s75p.config.ts
 *
 * 测试范围: tests/services/cycle/cycle-runtime-s75p.test.ts
 */
import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  root: "C:\\Users\\ligua\\Desktop\\AI项目\\trustos\\TrustOS",
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
  },
  test: {
    globals: true,
    environment: "node",
    pool: "forks",
    include: ["tests/services/cycle/cycle-runtime-s75p.test.ts"],
    env: {
      NODE_PATH: resolve("node_modules"),
    },
  },
});
