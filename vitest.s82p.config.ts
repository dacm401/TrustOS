/**
 * Vitest config for S82P Resume Execution Audit Events V0 tests.
 *
 * 运行方式:
 *   npx vitest run --config vitest.s82p.config.ts
 *
 * 测试范围:
 *   S82P Service Event (T1-T5)
 *   S82P Event Boundary (B1-B7)
 *   S82P E2E (E1-E4, requires Docker postgres: node scripts/start-db.cjs)
 *   S81P regression (execution service + boundary + persistence + e2e)
 *   S80P regression (decision persist + boundary + e2e)
 *   S79P regression (resume + boundary + e2e)
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
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
  },
  test: {
    globals: true,
    environment: "node",
    pool: "forks",
    include: [
      // S82P
      "tests/services/human-review/human-review-execution-event.test.ts",
      "tests/services/human-review/human-review-execution-event-boundary.test.ts",
      "tests/services/human-review/human-review-execution-event-e2e.test.ts",
      // S81P regression
      "tests/services/human-review/human-review-execution.test.ts",
      "tests/services/human-review/human-review-execution-boundary.test.ts",
      "tests/services/human-review/human-review-execution-persistence.test.ts",
      "tests/services/human-review/human-review-execution-e2e.test.ts",
      // S80P regression
      "tests/services/human-review/human-review-decision-persist.test.ts",
      "tests/services/human-review/human-review-decision-persist-boundary.test.ts",
      "tests/services/human-review/human-review-decision-persist-e2e.test.ts",
      // S79P regression
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
