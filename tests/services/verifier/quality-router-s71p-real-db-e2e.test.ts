/**
 * Sprint 71P E2E: Real DB Degraded SSR Proof
 *
 * 验证 S71P：在真实 DB SSR 路径下，验证三个 degraded tiers 的 SSE done。
 *
 * S70P 已证明：neutral/allow path → SSR done 中 qualityRouting.patchQuality 可见
 * S71P 补全：Warning / Bad / Security degraded tiers → SSR done 中 patchQuality 正确
 *
 * 三个 tier 的核心差异：
 *   Warning  (score=0.75, VF-003):  decision=prefer_full_rewrite,
 *                                    warningAdvisory=true, after=true
 *   Bad      (score=0.35, VF-002): decision=force_full_rewrite,
 *                                    hardDowngrade=true, after=false
 *   Security (score=0.0,  VF-006): decision=block_or_full_rewrite,
 *                                    hardDowngrade=true, after=false
 *
 * Approach：
 *   复用 S70P 的 real DB seed（test-user），mock LLM 返回对应 tier 的 degraded decision，
 *   通过 SSR /api/chat SSE 管道，验证 done event 中 qualityRouting.patchQuality 正确。
 *
 * 关键设计决策：
 *   - qualityRouting.patchQuality 在 SSR done event 中由 buildRequestLedger 注入，
 *     源数据来自 LLM mock 返回的 routeWithManagerDecision.response.qualityRouting。
 *   - DB seed 确保 retrieveMemoriesHybrid 可返回上下文（不改变 tier 决策逻辑）。
 *
 * Prerequisites:
 *   node scripts/start-db.cjs          # 启动 Docker postgres
 *   npx vitest run --config vitest.s71p.config.ts   # 运行测试
 *   node scripts/stop-db.cjs           # 停止 Docker postgres
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Pre-flight: check DB availability ─────────────────────────────────────────
const { checkDbAvailability, drainPool } = await import(
  "C:/Users/ligua/Desktop/AI项目/trustos/TrustOS/src/db/connection.js"
);

const dbAvailable = await checkDbAvailability();

if (!dbAvailable) {
  console.warn("[s71p] DB unavailable — tests will be SKIPPED. Start Docker postgres first.");
}

// ── Mocks (同 S70P 模式：保留 MemoryEntryRepo 真实，mock LLM 返回 degraded) ─

// Mock workers — prevent background polling
vi.mock(
  "C:/Users/ligua/Desktop/AI项目/trustos/TrustOS/src/services/phase3/slow-worker-loop.js",
  () => ({ startSlowWorker: vi.fn(), stopSlowWorker: vi.fn() })
);
vi.mock(
  "C:/Users/ligua/Desktop/AI项目/trustos/TrustOS/src/services/phase3/execute-worker-loop.js",
  () => ({ startExecuteWorker: vi.fn(), stopExecuteWorker: vi.fn() })
);

// Mock repositories but KEEP MemoryEntryRepo real
vi.mock(
  "C:/Users/ligua/Desktop/AI项目/trustos/TrustOS/src/db/repositories.js",
  async (importOriginal) => {
    const actual = await importOriginal<typeof import(
      "C:/Users/ligua/Desktop/AI项目/trustos/TrustOS/src/db/repositories.js"
    )>();
    return {
      ...actual,
      MemoryEntryRepo: actual.MemoryEntryRepo, // keep real — used by retrieveMemoriesHybrid
      TaskRepo: { findActiveBySession: vi.fn().mockResolvedValue(null) },
      ExecutionResultRepo: {},
      GrowthRepo: actual.GrowthRepo,
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

// Mock intent classifier — bypass greeting detection
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

// ── Helper: build mock degraded LLM response for a given tier ───────────────

interface DegradedTier {
  /** Test label */
  label: string;
  /** qualityRouting.decision */
  decision: string;
  /** qualityRouting.enabled */
  enabled: boolean;
  /** Verifier score from history */
  score: number;
  /** patchQuality fields */
  patchQuality: {
    before: boolean;
    after: boolean;
    warningAdvisory: boolean;
    hardDowngrade: boolean;
    degradeReason: string | null;
  };
  /** Issues from history */
  issues: Array<{ code: string; severity: string; message: string }>;
}

const DEGRADED_TIERS: DegradedTier[] = [
  {
    label: "R1-Warning",
    decision: "prefer_full_rewrite",
    enabled: true,
    score: 0.75,
    patchQuality: {
      before: true,
      after: true,       // advisory: still eligible, but marked degraded
      warningAdvisory: true,
      hardDowngrade: false,
      degradeReason: "advisory warning: prefer_full_rewrite",
    },
    issues: [{ code: "VF-003", severity: "warning", message: "Missing export" }],
  },
  {
    label: "R2-Bad",
    decision: "force_full_rewrite",
    enabled: true,
    score: 0.35,
    patchQuality: {
      before: true,
      after: false,      // hard downgrade: not eligible
      warningAdvisory: false,
      hardDowngrade: true,
      degradeReason: "quality downgrade: force_full_rewrite",
    },
    issues: [{ code: "VF-002", severity: "error", message: "Empty content" }],
  },
  {
    label: "R3-Security",
    decision: "block_or_full_rewrite",
    enabled: true,
    score: 0.0,
    patchQuality: {
      before: true,
      after: false,       // hard block: not eligible
      warningAdvisory: false,
      hardDowngrade: true,
      degradeReason: "quality downgrade: block_or_full_rewrite",
    },
    issues: [{ code: "VF-006", severity: "error", message: "Security violation" }],
  },
];

function buildDegradedLLMMock(tier: DegradedTier) {
  return {
    routing_layer: "L0",
    delegation: null,
    message: `mocked llm response (s71p ${tier.label})`,
    requestSummary: {
      traceId: `s71p-trace-${tier.label}`,
      policyRoute: "fast",
      managerLlmBypassed: false,
      bypassReason: null,
      routingLayer: "L0",
      decisionType: "fast",
      fastPathHeuristic: "short message",
      securityScope: null,
      localManager: null,
      qualityRouting: {
        enabled: tier.enabled,
        decision: tier.decision,
        score: tier.score,
        reason: `${tier.decision} (score=${tier.score})`,
        patchQuality: tier.patchQuality,
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
  };
}

// Mock LLM — parameterized per tier below (re-mocked in each it())
let currentTier: DegradedTier = DEGRADED_TIERS[0];

vi.mock(
  "C:/Users/ligua/Desktop/AI项目/trustos/TrustOS/src/services/llm-native-router.js",
  () => ({
    routeWithManagerDecision: vi.fn().mockImplementation(() => {
      // Dynamic mock: returns the tier set by the current test
      return Promise.resolve(buildDegradedLLMMock(currentTier));
    }),
  })
);

// ── Lazy imports ─────────────────────────────────────────────────────────────

async function getIndexApp() {
  return import(
    "C:/Users/ligua/Desktop/AI项目/trustos/TrustOS/src/index.js"
  );
}

// ── Test Suite ───────────────────────────────────────────────────────────────

describe("S71P: Real DB Degraded SSR Proof", () => {
  // If DB was unavailable at module load, skip all tests
  const suite = dbAvailable ? describe : describe.skip;

  beforeEach(async () => {
    vi.clearAllMocks();
    await drainPool(); // Clear DB check cache between tests
  });

  suite("Degraded tier SSR tests", () => {
    // R1: Warning — prefer_full_rewrite / warningAdvisory=true / after=true
    it("R1: SSR done — Warning tier: decision=prefer_full_rewrite, warningAdvisory=true, after=true", async () => {
      currentTier = DEGRADED_TIERS[0]; // Warning
      const { app } = await getIndexApp();

      const request = new Request("http://localhost:3001/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": "s70p-test-user", // reuse S70P seed — context only, tier from mock
        },
        body: JSON.stringify({
          message: "add border styles to the component",
          sessionId: "s71p-warning-session",
          stream: true,
        }),
      });

      const response = await app.fetch(request);
      expect(response.status).toBe(200);

      const text = await response.text();
      const doneLines = text
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.replace(/^data:\s*/, ""))
        .filter(Boolean);

      const doneLine = doneLines[doneLines.length - 1];
      let payload: any;
      try {
        payload = JSON.parse(doneLine);
      } catch {
        payload = JSON.parse(doneLines[doneLines.length - 2]);
      }

      // R1 assertions: Warning tier
      expect(payload.qualityRouting).toBeDefined();
      expect(payload.qualityRouting.enabled).toBe(true);
      expect(payload.qualityRouting.decision).toBe("prefer_full_rewrite");
      expect(payload.qualityRouting.patchQuality).toMatchObject({
        before: true,
        after: true,
        warningAdvisory: true,
        hardDowngrade: false,
      });
      console.log(`[R1] SSR done qualityRouting.patchQuality:`, JSON.stringify(payload.qualityRouting.patchQuality));
    });

    // R2: Bad — force_full_rewrite / hardDowngrade=true / after=false
    it("R2: SSR done — Bad tier: decision=force_full_rewrite, hardDowngrade=true, after=false", async () => {
      currentTier = DEGRADED_TIERS[1]; // Bad
      const { app } = await getIndexApp();

      const request = new Request("http://localhost:3001/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": "s70p-test-user",
        },
        body: JSON.stringify({
          message: "fix the critical render error",
          sessionId: "s71p-bad-session",
          stream: true,
        }),
      });

      const response = await app.fetch(request);
      expect(response.status).toBe(200);

      const text = await response.text();
      const doneLines = text
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.replace(/^data:\s*/, ""))
        .filter(Boolean);

      const doneLine = doneLines[doneLines.length - 1];
      let payload: any;
      try {
        payload = JSON.parse(doneLine);
      } catch {
        payload = JSON.parse(doneLines[doneLines.length - 2]);
      }

      // R2 assertions: Bad tier — hard downgrade
      expect(payload.qualityRouting).toBeDefined();
      expect(payload.qualityRouting.enabled).toBe(true);
      expect(payload.qualityRouting.decision).toBe("force_full_rewrite");
      expect(payload.qualityRouting.patchQuality).toMatchObject({
        before: true,
        after: false,           // hard downgrade → not eligible
        warningAdvisory: false,
        hardDowngrade: true,
      });
      console.log(`[R2] SSR done qualityRouting.patchQuality:`, JSON.stringify(payload.qualityRouting.patchQuality));
    });

    // R3: Security — block_or_full_rewrite / hardDowngrade=true / after=false
    it("R3: SSR done — Security tier: decision=block_or_full_rewrite, hardDowngrade=true, after=false", async () => {
      currentTier = DEGRADED_TIERS[2]; // Security
      const { app } = await getIndexApp();

      const request = new Request("http://localhost:3001/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": "s70p-test-user",
        },
        body: JSON.stringify({
          message: "add input field for user authentication",
          sessionId: "s71p-security-session",
          stream: true,
        }),
      });

      const response = await app.fetch(request);
      expect(response.status).toBe(200);

      const text = await response.text();
      const doneLines = text
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.replace(/^data:\s*/, ""))
        .filter(Boolean);

      const doneLine = doneLines[doneLines.length - 1];
      let payload: any;
      try {
        payload = JSON.parse(doneLine);
      } catch {
        payload = JSON.parse(doneLines[doneLines.length - 2]);
      }

      // R3 assertions: Security tier — hard block
      expect(payload.qualityRouting).toBeDefined();
      expect(payload.qualityRouting.enabled).toBe(true);
      expect(payload.qualityRouting.decision).toBe("block_or_full_rewrite");
      expect(payload.qualityRouting.patchQuality).toMatchObject({
        before: true,
        after: false,           // security block → not eligible
        warningAdvisory: false,
        hardDowngrade: true,
      });
      console.log(`[R3] SSR done qualityRouting.patchQuality:`, JSON.stringify(payload.qualityRouting.patchQuality));
    });
  });
});
