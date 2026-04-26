// Sprint 67 — D2: CrossSessionContext E2E Integration Tests
/**
 * D2: CrossSessionContext E2E — Sprint 67
 *
 * 覆盖端到端路径：
 *   1. SessionContextRepo — getRecentSessions / getIncompleteTasks / getRecentKeyFacts
 *   2. buildCrossSessionContext — 关键词续写检测 / currentTask 填充 / key facts 注入
 *   3. toPromptRenderContext — CrossSessionContext → PromptRenderContext 映射
 *   4. 与 PromptTemplateService 集成：跨会话上下文 → Manager system prompt
 *
 * Infrastructure: vitest.api.config.ts (独立进程)
 */

import { v4 as uuid } from "uuid";
import { query } from "../../src/db/connection.js";
import { TaskRepo, SessionContextRepo } from "../../src/db/repositories.js";
import { PromptTemplateService } from "../../src/services/prompt-template-service.js";
import { buildCrossSessionContext, toPromptRenderContext } from "../../src/services/cross-session-context.js";
import { truncateTables } from "../db/harness.js";

const TEST_USER = "d2-test-user";

beforeEach(async () => {
  await truncateTables();
  PromptTemplateService.clearCache();
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

async function insertSession(overrides: {
  userId?: string;
  sessionId?: string;
  activeTopic?: string;
  slowCount?: number;
  turnCount?: number;
}) {
  const userId = overrides.userId ?? TEST_USER;
  const sessionId = overrides.sessionId ?? `d2-session-${uuid()}`;
  const id = uuid();
  await query(
    `INSERT INTO sessions (id, user_id, title, active_topic, slow_count, total_requests, turn_count)
     VALUES ($1, $2, $3, $4, $5, 0, $6)`,
    [id, userId, `Session ${sessionId}`, overrides.activeTopic ?? null, overrides.slowCount ?? 0, overrides.turnCount ?? 0]
  );
  return { id, sessionId };
}

async function insertSessionSummary(opts: {
  sessionId: string;
  userId?: string;
  topic?: string;
  keyFacts?: string[];
  decisionsMade?: string[];
  openQuestions?: string[];
}) {
  const id = uuid();
  await query(
    `INSERT INTO session_summaries (id, session_id, user_id, topic, key_facts, decisions_made, open_questions)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      opts.sessionId,
      opts.userId ?? TEST_USER,
      opts.topic ?? null,
      opts.keyFacts ?? [],
      opts.decisionsMade ?? [],
      opts.openQuestions ?? [],
    ]
  );
  return id;
}

async function insertTask(overrides: {
  userId?: string;
  sessionId?: string;
  status?: string;
  title?: string;
  goal?: string;
}) {
  const userId = overrides.userId ?? TEST_USER;
  const sessionId = overrides.sessionId ?? `d2-session-${uuid()}`;
  const id = uuid();
  await TaskRepo.create({
    id,
    user_id: userId,
    session_id: sessionId,
    title: overrides.title ?? "Test Task",
    mode: "research",
    complexity: "low",
    risk: "low",
    status: overrides.status ?? "responding",
    goal: overrides.goal ?? null,
  });
  return { id, sessionId };
}

async function insertTaskSummary(taskId: string, opts: {
  completedSteps?: string[];
  blockedBy?: string[];
  nextStep?: string;
}) {
  await query(
    `INSERT INTO task_summaries (task_id, completed_steps, blocked_by, next_step)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (task_id) DO UPDATE
       SET completed_steps = EXCLUDED.completed_steps,
           blocked_by = EXCLUDED.blocked_by,
           next_step = EXCLUDED.next_step`,
    [taskId, opts.completedSteps ?? [], opts.blockedBy ?? [], opts.nextStep ?? null]
  );
}

// ── SessionContextRepo ────────────────────────────────────────────────────────

describe("SessionContextRepo — Queries", () => {
  it("getRecentSessions returns sessions with slow_count > 0", async () => {
    const { sessionId } = await insertSession({ slowCount: 1, activeTopic: "数据分析" });
    await insertSession({ slowCount: 0, activeTopic: "简单问答" });

    const sessions = await SessionContextRepo.getRecentSessions(TEST_USER, 5);
    expect(sessions.length).toBeGreaterThanOrEqual(1);
    expect(sessions[0].active_topic).toBe("数据分析");
  });

  it("getRecentSessions excludes sessions with slow_count = 0", async () => {
    await insertSession({ slowCount: 0 });

    const sessions = await SessionContextRepo.getRecentSessions(TEST_USER, 5);
    expect(sessions.every((s: { slow_count: number }) => s.slow_count > 0)).toBe(true);
  });

  it("getIncompleteTasks returns non-terminal tasks", async () => {
    await insertTask({ status: "responding" });
    await insertTask({ status: "paused" });
    await insertTask({ status: "completed" });
    await insertTask({ status: "failed" });

    const tasks = await SessionContextRepo.getIncompleteTasks(TEST_USER, 5);
    const statuses = tasks.map((t: { status: string }) => t.status);
    expect(statuses).not.toContain("completed");
    expect(statuses).not.toContain("failed");
    expect(statuses).toContain("responding");
    expect(statuses).toContain("paused");
  });

  it("getIncompleteTasks returns empty when all tasks are terminal", async () => {
    await insertTask({ status: "completed" });
    await insertTask({ status: "failed" });

    const tasks = await SessionContextRepo.getIncompleteTasks(TEST_USER, 5);
    expect(tasks).toHaveLength(0);
  });

  it("getRecentKeyFacts returns key_facts from session_summaries", async () => {
    const { sessionId } = await insertSession({ slowCount: 1 });
    await insertSessionSummary({
      sessionId,
      keyFacts: ["用户偏好红色", "关注金融数据"],
    });

    const facts = await SessionContextRepo.getRecentKeyFacts(TEST_USER, 3);
    expect(facts.length).toBeGreaterThan(0);
  });
});

// ── buildCrossSessionContext ─────────────────────────────────────────────────

describe("buildCrossSessionContext — Service Logic", () => {
  it("detects continuation via Chinese keywords", async () => {
    const { sessionId } = await insertSession({ slowCount: 1 });
    const { id: taskId } = await insertTask({ sessionId, status: "responding" });
    await insertTaskSummary(taskId, { completedSteps: ["第一步"], nextStep: "第二步" });

    const result = await buildCrossSessionContext({
      userId: TEST_USER,
      sessionId,
      userMessage: "继续之前的工作",
    });

    expect(result.crossSessionText).toContain("当前任务");
    expect(result.crossSessionText).toContain("第一步");
  });

  it("detects continuation via English keywords", async () => {
    const { sessionId } = await insertSession({ slowCount: 1 });
    const { id: taskId } = await insertTask({ sessionId, status: "responding" });
    await insertTaskSummary(taskId, { completedSteps: ["Step 1"] });

    const result = await buildCrossSessionContext({
      userId: TEST_USER,
      sessionId,
      userMessage: "please continue",
    });

    expect(result.crossSessionText).toContain("Step 1");
  });

  it("returns null currentTask when no active task", async () => {
    const { sessionId } = await insertSession({ slowCount: 1 });

    const result = await buildCrossSessionContext({
      userId: TEST_USER,
      sessionId,
      userMessage: "简单问答",
    });

    expect(result.currentTask).toBeNull();
  });

  it("fills currentTask when session has active task", async () => {
    const { sessionId } = await insertSession({ slowCount: 1 });
    const { id: taskId } = await insertTask({
      sessionId,
      status: "responding",
      title: "写季度报告",
      goal: "完成 Q1 报告",
    });
    await insertTaskSummary(taskId, {
      completedSteps: ["收集数据", "整理图表"],
      blockedBy: ["等财务数据"],
      nextStep: "写正文",
    });

    const result = await buildCrossSessionContext({
      userId: TEST_USER,
      sessionId,
      userMessage: "下一步怎么走",
    });

    expect(result.currentTask).not.toBeNull();
    expect(result.currentTask!.title).toBe("写季度报告");
    expect(result.currentTask!.completedSteps).toEqual(["收集数据", "整理图表"]);
    expect(result.currentTask!.blockedBy).toEqual(["等财务数据"]);
    expect(result.currentTask!.nextStep).toBe("写正文");
  });

  it("reports incompleteTaskCount in crossSessionText when not currentTask", async () => {
    const { sessionId } = await insertSession({ slowCount: 1 });
    await insertTask({ sessionId, status: "paused" });

    const result = await buildCrossSessionContext({
      userId: TEST_USER,
      sessionId,
      userMessage: "你好",
    });

    expect(result.incompleteTaskCount).toBeGreaterThan(0);
    expect(result.crossSessionText).toContain("未完成任务");
  });

  it("gracefully handles DB errors (no crash)", async () => {
    const result = await buildCrossSessionContext({
      userId: "nonexistent-user",
      sessionId: "nonexistent-session",
      userMessage: "你好",
    });

    // Should return empty context, not throw
    expect(result.currentTask).toBeNull();
    expect(result.crossSessionText).toBe("");
  });
});

// ── toPromptRenderContext ─────────────────────────────────────────────────────

describe("toPromptRenderContext — Mapping", () => {
  it("maps crossSessionText to cross_session_context", async () => {
    const { sessionId } = await insertSession({ slowCount: 1 });
    const { id: taskId } = await insertTask({ sessionId, status: "responding", title: "Test Task" });

    const cross = await buildCrossSessionContext({
      userId: TEST_USER,
      sessionId,
      userMessage: "继续",
    });

    const ctx = toPromptRenderContext(cross, "继续");

    expect(ctx.user_message).toBe("继续");
    expect(ctx.cross_session_context).toBeDefined();
  });

  it("maps currentTask fields when present", async () => {
    const { sessionId } = await insertSession({ slowCount: 1 });
    const { id: taskId } = await insertTask({ sessionId, status: "responding", title: "写报告" });
    await insertTaskSummary(taskId, {
      completedSteps: ["第一步"],
      blockedBy: ["缺数据"],
    });

    const cross = await buildCrossSessionContext({
      userId: TEST_USER,
      sessionId,
      userMessage: "继续",
    });

    const ctx = toPromptRenderContext(cross, "继续");

    expect(ctx.current_task).toBe("写报告");
    expect(ctx.completed_steps).toEqual(["第一步"]);
    expect(ctx.blocked_by).toEqual(["缺数据"]);
  });

  it("does not set optional fields when no currentTask", async () => {
    const result = await buildCrossSessionContext({
      userId: TEST_USER,
      sessionId: "empty-session",
      userMessage: "你好",
    });

    const ctx = toPromptRenderContext(result, "你好");

    expect(ctx.current_task).toBeUndefined();
    expect(ctx.completed_steps).toBeUndefined();
    expect(ctx.blocked_by).toBeUndefined();
  });
});

// ── Integration with PromptTemplateService ───────────────────────────────────

describe("CrossSessionContext → PromptTemplateService — E2E Flow", () => {
  it("cross-session context appears in Manager system prompt", async () => {
    const { sessionId } = await insertSession({ slowCount: 1 });
    const { id: taskId } = await insertTask({
      sessionId,
      status: "responding",
      title: "年度总结报告",
    });
    await insertTaskSummary(taskId, {
      completedSteps: ["收集 Q1-Q4 数据"],
      blockedBy: [],
      nextStep: "撰写报告正文",
    });

    // Build cross-session context
    const cross = await buildCrossSessionContext({
      userId: TEST_USER,
      sessionId,
      userMessage: "继续写",
    });

    // Map to PromptRenderContext
    const renderCtx = toPromptRenderContext(cross, "继续写");

    // Render via service (no active template → uses defaults)
    const prompt = await PromptTemplateService.getManagerSystemPrompt(renderCtx);

    expect(prompt).toContain("年度总结报告");
    expect(prompt).toContain("Q1-Q4");
    expect(prompt).toContain("继续写");
  });

  it("pending_permission_prompt injects permission section", async () => {
    const prompt = await PromptTemplateService.getManagerSystemPrompt({
      user_message: "查余额",
      pending_permission_prompt: "⚠️ 请确认是否允许查询余额信息",
    });

    expect(prompt).toContain("pending_permissions");
    expect(prompt).toContain("余额");
  });
});
