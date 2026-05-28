import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/services/s89p-partial-result.test.ts"],
    globals: true,
    environment: "node",
  },
});
