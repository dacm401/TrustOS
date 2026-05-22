import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/services/human-review/human-review-execution.test.ts",
      "tests/services/human-review/human-review-execution-boundary.test.ts",
      "tests/services/human-review/human-review-execution-persistence.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
    },
  },
});
