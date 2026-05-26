import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/services/simple-task-classifier.test.ts",
      "tests/services/s85p-fast-path-boundary.test.ts",
      "tests/benchmark/s85p-fast-path-benchmark.test.ts",
    ],
    testTimeout: 30000,
  },
});
