/**
 * Vitest config for S79P Human Review Resume Policy V0 tests.
 *
 * 运行方式:
 *   npx vitest run --config vitest.s79p.config.ts
 *
 * 测试范围:
 *   tests/services/human-review/human-review-resume.test.ts       (unit)
 *   tests/services/human-review/human-review-resume-boundary.test.ts
 *   tests/services/human-review/human-review-resume-e2e.test.ts    (real DB)
 *   S78P regression (resolution + boundary + e2e)
 *   S77P regression (service + boundary + e2e)
 *   S76P regression (cycle-runtime-s76p)
 *   S75P regression (cycle-runtime-s75p)
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
      // S79P
      "tests/services/human-review/human-review-resume.test.ts",
      "tests/services/human-review/human-review-resume-boundary.test.ts",
      "tests/services/human-review/human-review-resume-e2e.test.ts",
      // S78P regression
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
