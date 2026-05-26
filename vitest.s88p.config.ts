import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/services/s88p-progress-visibility.test.ts",
    ],
    globals: true,
  },
});
