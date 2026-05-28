import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/services/s91p-timeout.test.ts"],
    globals: true,
    environment: "node",
  },
});
