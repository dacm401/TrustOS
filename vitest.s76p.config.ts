/**
 * Vitest config for S76P Cycle Runtime SSE Events V0 tests.
 *
 * 运行方式:
 *   npx vitest run --config vitest.s76p.config.ts
 *
 * 测试范围: tests/services/cycle/cycle-runtime-s76p.test.ts
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
    include: ["tests/services/cycle/cycle-runtime-s76p.test.ts"],
    env: {
      NODE_PATH: resolve("node_modules"),
    },
  },
});
