/**
 * Sprint 70P E2E: Real DB SSR Proof
 *
 * 验证 S70P 真实 DB 可用时的 SSR pipeline：
 *   1. Docker Postgres 可用（pgvector image）
 *   2. checkDbAvailability() = true（TTL 缓存，第二次调用 < 50ms）
 *   3. retrieveMemoriesHybrid() 返回 seeded 真实数据（非空）
 *   4. SSR /api/chat SSE pipeline → done event 中 qualityRouting.patchQuality 可见
 *
 * 与 S69P 的区别：
 *   S69P: pg mock → DB unavailable → graceful [] → SSR 不 hang
 *   S70P: 真实 DB → DB available → seeded data → SSR 返回真实 memory context
 *
 * Prerequisites:
 *   node scripts/start-db.cjs          # 启动 Docker postgres
 *   npx vitest run --config vitest.s70p.config.ts   # 运行测试
 *   node scripts/stop-db.cjs           # 停止 Docker postgres
 *
 * Docker 不可用时：全部测试 SKIP（而非 FAIL）
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Pre-flight: check DB availability before running any test ────────────────
// This runs at module load time. If DB is unavailable, we skip the whole suite.
const { checkDbAvailability, drainPool } = await import(
  "C:/Users/ligua/Desktop/AI项目/trustos/TrustOS/src/db/connection.js"
);

const dbAvailable = await checkDbAvailability();

// ── Seed data only if DB is available ──────────────────────────────────────
const TEST_USER_ID = "s70p-test-user";

if (dbAvailable) {
  console.log("[s70p] DB available — seeding test data...");
  const { MemoryEntryRepo } = await import(
    "C:/Users/ligua/Desktop/AI项目/trustos/TrustOS/src/db/repositories.js"
  );
  await MemoryEntryRepo.create({
    user_id: TEST_USER_ID,
    category: "instruction",
    content: "Always use simplified Chinese for responses",
    importance: 5,
    tags: ["language", "chinese"],
    source: "manual",
  });
  await MemoryEntryRepo.create({
    user_id: TEST_USER_ID,
    category: "preference",
    content: "Prefers concise answers with code examples",
    importance: 4,
    tags: ["style", "code"],
    source: "manual",
  });
  await MemoryEntryRepo.create({
    user_id: TEST_USER_ID,
    category: "fact",
    content: "User works in financial data analysis domain",
    importance: 3,
    tags: ["domain", "finance"],
    source: "auto_learn",
  });
  console.log(`[s70p] Seeded 3 memory entries for ${TEST_USER_ID}`);
} else {
  console.warn("[s70p] DB unavailable — tests will be SKIPPED. Start Docker postgres first.");
}

// ── Mocks (only for SSR HTTP tests — not for DB retrieval tests) ────────────

// Mock workers — prevent background polling
vi.mock(
  "C:/Users/ligua/Desktop/AI项目/trustos/TrustOS/src/services/phase3/slow-worker-loop.js",
  () => ({ startSlowWorker: vi.fn(), stopSlowWorker: vi.fn() })
);
vi.mock(
  "C:/Users/ligua/Desktop/AI项目/trustos/TrustOS/src/services/phase3/execute-worker-loop.js",
  () => ({ startExecuteWorker: vi.fn(), stopExecuteWorker: vi.fn() })
);

// Mock repositories but KEEP MemoryEntryRepo real (for retrieveMemoriesHybrid DB query)
vi.mock(
  "C:/Users/ligua/Desktop/AI项目/trustos/TrustOS/src/db/repositories.js",
  async (importOriginal) => {
    const actual = await importOriginal<typeof import(
      "C:/Users/ligua/Desktop/AI项目/trustos/TrustOS/src/db/repositories.js"
    )>();
    return {
      // MemoryEntryRepo: keep real — used by retrieveMemoriesHybrid
      ...actual, // spread all real exports (DecisionRepo, GrowthRepo, etc.)
      MemoryEntryRepo: actual.MemoryEntryRepo, // but override to use real one
      TaskRepo: { findActiveBySession: vi.fn().mockResolvedValue(null) },
      ExecutionResultRepo: {},
      GrowthRepo: actual.GrowthRepo, // keep real (used by growth-tracker)
      MemoryRepo: { upsertIdentity: vi.fn() },
      EvidenceRepo: {},
    };
  }
);

vi.mock(
  "C:/Users/ligua/Desktop/AI项目/trustos/TrustOS/src/db/task-archive-repo.js",
  () => ({
    TaskArchiveRepo: { findActiveBySession: vi.fn().mockResolvedValue(null) },
  })
);

// Mock intent classifier — bypass greeting detection to go through LLM path
vi.mock(
  "C:/Users/ligua/Desktop/AI项目/trustos/TrustOS/src/services/intent-classifier.js",
  () => ({
    classifyIntent: vi.fn().mockReturnValue({
      category: "analysis",
      confidence: 0.8,
      language: "en",
    }),
    shouldSkipLLMRouting: vi.fn().mockReturnValue(false),
    generateQuickResponse: vi.fn().mockReturnValue(null),
  })
);

// Mock LLM — must include full qualityRouting.patchQuality shape
vi.mock(
  "C:/Users/ligua/Desktop/AI项目/trustos/TrustOS/src/services/llm-native-router.js",
  () => ({
    routeWithManagerDecision: vi.fn().mockResolvedValue({
      routing_layer: "L0",
      delegation: null,
      message: "mocked llm response (s70p real-db)",
      requestSummary: {
        traceId: "s70p-trace",
        policyRoute: "fast",
        managerLlmBypassed: false,
        bypassReason: null,
        routingLayer: "L0",
        decisionType: "fast",
        fastPathHeuristic: "short message",
        securityScope: null,
        localManager: null,
        qualityRouting: {
          enabled: false,
          decision: "allow_patch_first",
          score: null,
          reason: "quality routing disabled",
          patchQuality: {
            before: true,
            after: true,
            warningAdvisory: false,
            hardDowngrade: false,
            degradeReason: null,
          },
        },
        totalLatencyMs: 5,
        totalModelCalls: 0,
        managerCalls: 0,
        workerCalls: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        estimatedTotalCost: 0,
        budget: null,
        routerTaxRatio: 0,
        entries: [],
        userId: "test",
        sessionId: "test",
      },
      contextPackage: null,
    }),
  })
);

// ── Lazy imports for tests (avoids premature DB connection in mock path) ───

async function getMemoryRetrieval() {
  return import(
    "C:/Users/ligua/Desktop/AI项目/trustos/TrustOS/src/services/memory-retrieval.js"
  );
}

async function getIndexApp() {
  return import(
    "C:/Users/ligua/Desktop/AI项目/trustos/TrustOS/src/index.js"
  );
}

// ── Test Suite ───────────────────────────────────────────────────────────────

describe("S70P: Real DB SSR Proof", () => {
  // If DB was unavailable at module load, skip all tests
  const suite = dbAvailable ? describe : describe.skip;

  beforeEach(async () => {
    vi.clearAllMocks();
    await drainPool(); // Clear DB check cache
  });

  suite("DB available tests", () => {
    // ── D1: Docker Postgres availability ────────────────────────────────────

    it("D1: checkDbAvailability returns true", async () => {
      const result = await checkDbAvailability();
      expect(result).toBe(true);
    });

    // ── D2: TTL cache ───────────────────────────────────────────────────────

    it("D2: TTL cache fast on second call (< 50ms)", async () => {
      const t1 = Date.now();
      await checkDbAvailability();
      const ms1 = Date.now() - t1;

      const t2 = Date.now();
      const result2 = await checkDbAvailability();
      const ms2 = Date.now() - t2;

      expect(result2).toBe(true);
      expect(ms2).toBeLessThan(50);
      console.log(`[D2] First probe: ${ms1}ms, cached: ${ms2}ms`);
    });

    // ── D3: retrieveMemoriesHybrid returns seeded data ─────────────────────

    it("D3: retrieveMemoriesHybrid returns seeded memory entries (non-empty)", async () => {
      const { retrieveMemoriesHybrid } = await getMemoryRetrieval();
      const results = await retrieveMemoriesHybrid({
        userId: TEST_USER_ID,
        context: { userMessage: "test query about finance" },
        categoryPolicy: {},
        maxTotalEntries: 10,
      });

      expect(results.length).toBeGreaterThan(0);
      console.log(`[D3] Retrieved ${results.length} memory entries from real DB`);
    });

    // ── D4–D6: SSR HTTP + SSE done event ──────────────────────────────────

    it("D4–D6: SSR /api/chat SSE pipeline produces done event with qualityRouting.patchQuality", async () => {
      const { app } = await getIndexApp();

      const request = new Request("http://localhost:3001/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": TEST_USER_ID, // identity middleware priority 2
        },
        body: JSON.stringify({
          message: "analyze the financial data for the past week",
          sessionId: "s70p-session",
          stream: true, // must be true to get SSE response
        }),
      });

      // D4: HTTP 200
      const response = await app.fetch(request);
      expect(response.status).toBe(200);

      // D5: SSE stream produces done event
      const text = await response.text();
      expect(text).toContain("data:");

      // D6: done event contains qualityRouting.patchQuality
      const doneLines = text
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.replace(/^data:\s*/, ""));

      const doneLine = doneLines[doneLines.length - 1];
      expect(doneLine).toBeTruthy();

      let payload: any;
      try {
        payload = JSON.parse(doneLine);
      } catch {
        // done may be on previous line
        payload = JSON.parse(doneLines[doneLines.length - 2]);
      }

      expect(payload.qualityRouting).toBeDefined();
      expect(payload.qualityRouting.patchQuality).toMatchObject({
        before: expect.any(Boolean),
        after: expect.any(Boolean),
        warningAdvisory: expect.any(Boolean),
        hardDowngrade: expect.any(Boolean),
      });

      console.log(`[D6] SSR done qualityRouting.patchQuality:`, JSON.stringify(payload.qualityRouting.patchQuality));
    });
  });
});
