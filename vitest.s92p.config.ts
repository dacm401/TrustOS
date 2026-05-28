import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/services/s92p-terminal-observability.test.ts"],
    globals: true,
    environment: "node",
  },
});
