import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/services/s100p-routing.test.ts"],
    globals: true,
    environment: "node",
  },
});
