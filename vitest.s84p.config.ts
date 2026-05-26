/**
 * Vitest config for S84P Core Runtime Performance & Usability Baseline tests.
 *
 * 运行方式:
 *   npx vitest run --config vitest.s84p.config.ts
 *
 * 测试范围:
 *   S84P RuntimeTrace types + helpers (T1-T21)
 *   S83P regression (Manual Confirmation: service + boundary + e2e)
 *   S82P regression (Resume Execution Event: service + boundary + e2e)
 *   S81P regression (Resume Execution: service + boundary + persistence + e2e)
 *   S80P regression (Decision Persist: service + boundary + e2e)
 *   S79P regression (Resume Decision: service + boundary + e2e)
 *   S78P regression (Resolution: service + boundary + e2e)
 *   S77P regression (HR Queue: service + boundary + e2e)
 *   S76P regression (Cycle SSE Events)
 *   S75P regression (Cycle Runtime V0)
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
      // S84P unit benchmarks
      "tests/benchmark/s84p-runtime-benchmark.test.ts",
      // S84P type + helper tests
      "tests/types/runtime-trace.test.ts",
      // S83P regression
      "tests/services/human-review/human-review-execution-confirmation.test.ts",
      "tests/services/human-review/human-review-execution-confirmation-boundary.test.ts",
      "tests/services/human-review/human-review-execution-confirmation-e2e.test.ts",
      // S82P regression
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
