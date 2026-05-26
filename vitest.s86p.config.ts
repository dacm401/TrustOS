import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/services/s86p-llm-call-counter.test.ts",
      "tests/benchmark/s86p-llm-call-benchmark.test.ts",
    ],
    testTimeout: 30000,
  },
});
