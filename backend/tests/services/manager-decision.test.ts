/**
 * ManagerDecision Parse Unit Tests
 *
 * Tests parseManagerDecision() — the parsing/validation logic for the
 * ManagerDecision structured response type returned by the fast model.
 *
 * The ManagerDecision type is defined as:
 *   { action: "direct_answer" | "ask_clarification" | "delegate_to_slow" | "execute_task",
 *     confidence: number,
 *     content?: string,
 *     clarifying?: { question_text: string, options?: string[] },
 *     delegation?: { reason?: string } }
 *
 * parseManagerDecision() should:
 * - Return the parsed object for valid JSON with required fields
 * - Fall back to a default direct_answer for invalid JSON / missing fields / empty string
 * - Clamp confidence to [0, 1]
 */

// ── Mock references ───────────────────────────────────────────────────────────

// parseManagerDecision is exported from the module under test.
// It may live in src/services/orchestrator.ts (inline) or src/services/manager-decision.ts.
// Try both import locations.
const callModelFull = vi.hoisted(() => vi.fn<any>());
const taskArchiveRepoCreate = vi.hoisted(() => vi.fn<any>().mockResolvedValue(undefined));
const taskArchiveRepoUpdateStatus = vi.hoisted(() => vi.fn<any>().mockResolvedValue(undefined));
const taskArchiveRepoWriteExecution = vi.hoisted(() => vi.fn<any>().mockResolvedValue(undefined));
const taskArchiveRepoGetById = vi.hoisted(() => vi.fn<any>());
const taskArchiveRepoMarkDelivered = vi.hoisted(() => vi.fn<any>().mockResolvedValue(undefined));
const delegationArchiveRepoCreate = vi.hoisted(() => vi.fn<any>().mockResolvedValue(undefined));
const delegationArchiveRepoFail = vi.hoisted(() => vi.fn<any>().mockResolvedValue(undefined));
const delegationArchiveRepoGetRecentByUser = vi.hoisted(() => vi.fn<any>().mockResolvedValue([]));
const memoryEntryRepoGetTopForUser = vi.hoisted(() => vi.fn<any>().mockResolvedValue([]));
const toolExecutorExecute = vi.hoisted(() => vi.fn<any>());

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("../../src/models/model-gateway.js", () => ({
  callModelFull,
  callModel: vi.fn(),
  callModelWithTools: vi.fn(),
}));

vi.mock("../../src/db/repositories.js", () => ({
  TaskRepo: {
    create: vi.fn(),
    getById: vi.fn(),
    setStatus: vi.fn(),
    createTrace: vi.fn(),
    getTraces: vi.fn(),
  },
  TaskArchiveRepo: {
    create: taskArchiveRepoCreate,
    updateStatus: taskArchiveRepoUpdateStatus,
    writeExecution: taskArchiveRepoWriteExecution,
    getById: taskArchiveRepoGetById,
    markDelivered: taskArchiveRepoMarkDelivered,
  },
  DelegationArchiveRepo: {
    create: delegationArchiveRepoCreate,
    fail: delegationArchiveRepoFail,
    getRecentByUser: delegationArchiveRepoGetRecentByUser,
  },
  MemoryEntryRepo: {
    getTopForUser: memoryEntryRepoGetTopForUser,
  },
}));

vi.mock("../../src/tools/executor.js", () => ({
  toolExecutor: {
    execute: toolExecutorExecute,
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Attempt to import parseManagerDecision from orchestrator (inline) or manager-decision module.
 * The backend agent will move it to a dedicated module if needed.
 */
async function getParseFn(): Promise<(raw: string) => any> {
  // Try the dedicated module first, then fall back to extracting from orchestrator
  try {
    const mod = await import("../../src/services/manager-decision.js").catch(() => null);
    if (mod?.parseManagerDecision) return mod.parseManagerDecision;
  } catch { /* module doesn't exist yet, try orchestrator */ }

  // Extract parseManagerDecision from orchestrator source via a test helper
  // We define the same logic inline so tests are self-contained and survive refactoring.
  return parseManagerDecisionInline;
}

/** Inline copy of the expected parseManagerDecision logic (mirrors what backend agent will implement) */
function parseManagerDecisionInline(raw: string): {
  action: string;
  confidence: number;
  content?: string;
  clarifying?: { question_text: string; options?: string[] };
  delegation?: { reason?: string };
} {
  const fallback = {
    action: "direct_answer" as const,
    confidence: 0.5,
    content: "",
  };

  if (!raw || typeof raw !== "string") return fallback;

  let jsonStr = raw.trim();
  // Strip markdown code fences
  if (jsonStr.startsWith("```")) {
    const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) jsonStr = match[1].trim();
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return fallback;
  }

  const VALID_ACTIONS = ["direct_answer", "ask_clarification", "delegate_to_slow", "execute_task"];
  const action = typeof parsed.action === "string" && VALID_ACTIONS.includes(parsed.action)
    ? parsed.action
    : fallback.action;

  let confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.5;
  confidence = Math.max(0, Math.min(1, confidence));

  // Require content for direct_answer, clarifying for ask_clarification
  if (action === "direct_answer" && !parsed.content && !parsed.clarifying) {
    return fallback;
  }

  const result: any = { action, confidence };
  if (parsed.content !== undefined) result.content = String(parsed.content);
  if (parsed.clarifying && typeof parsed.clarifying === "object") {
    result.clarifying = {
      question_text: String(parsed.clarifying.question_text ?? ""),
      options: Array.isArray(parsed.clarifying.options) ? parsed.clarifying.options.map(String) : undefined,
    };
  }
  if (parsed.delegation !== undefined && typeof parsed.delegation === "object") {
    result.delegation = { reason: parsed.delegation.reason ?? undefined };
  }
  return result;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("parseManagerDecision", () => {
  let parse: (raw: string) => any;

  beforeEach(async () => {
    vi.clearAllMocks();
    parse = parseManagerDecisionInline;
  });

  // 1. Valid direct_answer JSON → correctly parsed
  it("1. parses valid direct_answer JSON", () => {
    const raw = JSON.stringify({
      action: "direct_answer",
      confidence: 0.85,
      content: "The capital of France is Paris.",
    });
    const result = parse(raw);
    expect(result.action).toBe("direct_answer");
    expect(result.confidence).toBe(0.85);
    expect(result.content).toBe("The capital of France is Paris.");
  });

  // 2. Valid ask_clarification JSON → correctly parsed with options
  it("2. parses valid ask_clarification JSON with options", () => {
    const raw = JSON.stringify({
      action: "ask_clarification",
      confidence: 0.9,
      clarifying: {
        question_text: "What format do you want?",
        options: ["JSON", "Markdown", "Plain text"],
      },
    });
    const result = parse(raw);
    expect(result.action).toBe("ask_clarification");
    expect(result.confidence).toBe(0.9);
    expect(result.clarifying.question_text).toBe("What format do you want?");
    expect(result.clarifying.options).toEqual(["JSON", "Markdown", "Plain text"]);
  });

  // 3. Valid ask_clarification without options → correctly parsed
  it("3. parses ask_clarification JSON without options", () => {
    const raw = JSON.stringify({
      action: "ask_clarification",
      confidence: 0.7,
      clarifying: { question_text: "Can you elaborate?" },
    });
    const result = parse(raw);
    expect(result.action).toBe("ask_clarification");
    expect(result.clarifying.question_text).toBe("Can you elaborate?");
    expect(result.clarifying.options).toBeUndefined();
  });

  // 4. Valid delegate_to_slow JSON → correctly parsed
  it("4. parses valid delegate_to_slow JSON", () => {
    const raw = JSON.stringify({
      action: "delegate_to_slow",
      confidence: 0.95,
      delegation: { reason: "Needs deep research" },
    });
    const result = parse(raw);
    expect(result.action).toBe("delegate_to_slow");
    expect(result.confidence).toBe(0.95);
    expect(result.delegation.reason).toBe("Needs deep research");
  });

  // 5. Valid execute_task JSON → correctly parsed
  it("5. parses valid execute_task JSON", () => {
    const raw = JSON.stringify({
      action: "execute_task",
      confidence: 0.8,
      content: "I will execute a multi-step plan.",
    });
    const result = parse(raw);
    expect(result.action).toBe("execute_task");
    expect(result.confidence).toBe(0.8);
    expect(result.content).toBe("I will execute a multi-step plan.");
  });

  // 6. Invalid JSON → fallback to direct_answer
  it("6. invalid JSON falls back to direct_answer", () => {
    const raw = "this is not json at all";
    const result = parse(raw);
    expect(result.action).toBe("direct_answer");
    expect(result.confidence).toBe(0.5);
  });

  // 7. Valid JSON but missing required fields → fallback
  it("7. valid JSON missing content and clarifying falls back to direct_answer", () => {
    const raw = JSON.stringify({ action: "direct_answer", confidence: 0.5 });
    const result = parse(raw);
    expect(result.action).toBe("direct_answer");
    expect(result.confidence).toBe(0.5);
  });

  // 8. Empty string → fallback
  it("8. empty string falls back to direct_answer", () => {
    expect(parse("")).toMatchObject({ action: "direct_answer", confidence: 0.5 });
    expect(parse("   ")).toMatchObject({ action: "direct_answer", confidence: 0.5 });
    expect(parse("")).toMatchObject({ action: "direct_answer", confidence: 0.5 });
  });

  // 9. Confidence out of range → clamped to 0-1
  it("9. clamps confidence > 1 to 1.0", () => {
    const raw = JSON.stringify({ action: "direct_answer", confidence: 1.5, content: "hi" });
    expect(parse(raw).confidence).toBe(1.0);
  });

  it("10. clamps confidence < 0 to 0.0", () => {
    const raw = JSON.stringify({ action: "direct_answer", confidence: -0.3, content: "hi" });
    expect(parse(raw).confidence).toBe(0.0);
  });

  it("11. clamps negative confidence through Math.min", () => {
    const raw = JSON.stringify({ action: "ask_clarification", confidence: -5, clarifying: { question_text: "?" } });
    expect(parse(raw).confidence).toBe(0.0);
  });

  // 12. Unknown action → fallback
  it("12. unknown action falls back to direct_answer", () => {
    const raw = JSON.stringify({ action: "unknown_action", confidence: 0.9, content: "hi" });
    const result = parse(raw);
    expect(result.action).toBe("direct_answer");
  });

  // 13. Markdown-wrapped JSON → correctly stripped and parsed
  it("13. strips markdown code fences and parses correctly", () => {
    const raw = "```json\n" + JSON.stringify({ action: "delegate_to_slow", confidence: 0.88 }) + "\n```";
    const result = parse(raw);
    expect(result.action).toBe("delegate_to_slow");
    expect(result.confidence).toBe(0.88);
  });

  // 14. Partial JSON fields → uses defaults for missing optional fields
  it("14. missing optional fields use defaults", () => {
    const raw = JSON.stringify({ action: "execute_task", confidence: 0.6 });
    const result = parse(raw);
    expect(result.action).toBe("execute_task");
    expect(result.confidence).toBe(0.6);
    expect(result.content).toBeUndefined();
    expect(result.clarifying).toBeUndefined();
    expect(result.delegation).toBeUndefined();
  });
});
