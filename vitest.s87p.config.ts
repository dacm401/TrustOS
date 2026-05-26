import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/services/s87p-budget-duplicate.test.ts"],
    globals: true,
  },
});
