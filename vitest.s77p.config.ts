/**
 * Vitest config for S77P Human Review Queue V0 tests.
 *
 * 运行方式:
 *   npx vitest run --config vitest.s77p.config.ts
 *
 * 测试范围:
 *   tests/services/human-review/human-review-service.test.ts
 *   tests/services/human-review/human-review-boundary.test.ts
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
    include: [
      "tests/services/human-review/human-review-service.test.ts",
      "tests/services/human-review/human-review-boundary.test.ts",
      "tests/services/human-review/human-review-e2e.test.ts",
    ],
    env: {
      NODE_PATH: resolve("node_modules"),
    },
  },
});
