/**
 * Vitest config for S76P debug tests.
 */
import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  root: "C:\\Users\\ligua\\Desktop\\AI项目\\trustos\\TrustOS",
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
  },
  test: {
    globals: true,
    environment: "node",
    pool: "forks",
    include: ["tests/services/cycle/debug-verify.test.ts"],
    env: {
      NODE_PATH: resolve("node_modules"),
    },
  },
});
