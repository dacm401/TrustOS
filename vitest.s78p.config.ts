/**
 * Vitest config for S78P Human Review Resolution V0 tests.
 *
 * 运行方式:
 *   npx vitest run --config vitest.s78p.config.ts
 *
 * 测试范围:
 *   tests/services/human-review/human-review-resolution.test.ts       (unit + mocks)
 *   tests/services/human-review/human-review-resolution-boundary.test.ts
 *   tests/services/human-review/human-review-resolution-e2e.test.ts    (real DB)
 *   tests/services/human-review/human-review-service.test.ts           (S77P 回归)
 *   tests/services/human-review/human-review-boundary.test.ts         (S77P 回归)
 *   tests/services/human-review/human-review-e2e.test.ts               (S77P 回归)
 *   tests/services/cycle/cycle-runtime-s76p.test.ts                    (S76P 回归)
 *   tests/services/cycle/cycle-runtime-s75p.test.ts                    (S75P 回归)
 *
 * E2E tests require Docker postgres running: node scripts/start-db.cjs
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
      "tests/services/human-review/human-review-resolution.test.ts",
      "tests/services/human-review/human-review-resolution-boundary.test.ts",
      "tests/services/human-review/human-review-resolution-e2e.test.ts",
      // S77P regression
      "tests/services/human-review/human-review-service.test.ts",
      "tests/services/human-review/human-review-boundary.test.ts",
      "tests/services/human-review/human-review-e2e.test.ts",
      // S76P regression
      "tests/services/cycle/cycle-runtime-s76p.test.ts",
      // S75P regression
      "tests/services/cycle/cycle-runtime-s75p.test.ts",
    ],
    env: {
      NODE_PATH: resolve("node_modules"),
    },
  },
});
