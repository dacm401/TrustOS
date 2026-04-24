/**
 * Vitest config for R1 — E2E API Regression Pack (mock-based, no DB required).
 *
 * Runs API endpoint tests using vi.mock for all repository calls.
 * No DATABASE_URL, no test DB setup. No pool contamination.
 *
 * Usage:
 *   npm run test:r1          — run once
 *   npm run test:r1:watch   — watch mode
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "tests/api/chat.test.ts",
      "tests/api/evidence.test.ts",
      "tests/api/tasks.test.ts",
      "tests/api/chat-execute.test.ts",
      // ManagerDecision unit tests (R1 parallel track)
      "tests/services/manager-decision.test.ts",
      "tests/services/orchestrator-manager-decision.test.ts",
      // TrustPolicy Engine unit tests (Phase 3 T3-1)
      "tests/trust/policy-engine.test.ts",
    ],
    // R1 tests run in isolation — no shared state
  },
});
