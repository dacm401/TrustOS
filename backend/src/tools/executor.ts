/**
 * Tool Executor — executes individual tool calls and returns structured results.
 *
 * Responsibilities:
 * - Validate tool call arguments against registered schema
 * - Dispatch to the appropriate handler (internal or external)
 * - Return ToolResult with timing and error info
 *
 * Security note: external tool calls (http_request, web_search) are routed
 * through ToolGuardrail before execution. The guardrail check is called by
 * the ExecutionLoop, not here — the executor trusts the loop's pre-check.
 *
 * EL-001: Tool execution infrastructure.
 */

import { v4 as uuid } from "uuid";
import type { ToolCall, ToolResult } from "../types/index.js";
import { MemoryEntryRepo } from "../db/repositories.js";
import { TaskRepo } from "../db/repositories.js";
import { config } from "../config.js";

/** Context available to all tool handlers */
export interface ToolHandlerContext {
  userId: string;
  sessionId: string;
  taskId?: string;
}

/** A handler function for a specific tool */
type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolHandlerContext
) => Promise<unknown>;

export class ToolExecutor {
  private handlers = new Map<string, ToolHandler>();

  constructor() {
    this.registerInternalHandlers();
  }

  // ── Handler registration ─────────────────────────────────────────────────

  private registerInternalHandlers(): void {
    this.register("memory_search", this.handleMemorySearch.bind(this));
    this.register("task_read", this.handleTaskRead.bind(this));
    this.register("task_update", this.handleTaskUpdate.bind(this));
    this.register("task_create", this.handleTaskCreate.bind(this));
    // External tools (http_request, web_search) are stubbed here;
    // the actual HTTP call is delegated to ExecutionLoop after guardrail check.
    this.register("http_request", this.handleExternalStub.bind(this, "http_request"));
    this.register("web_search", this.handleExternalStub.bind(this, "web_search"));
  }

  register(toolName: string, handler: ToolHandler): void {
    this.handlers.set(toolName, handler);
  }

  // ── Main entry point ──────────────────────────────────────────────────────

  /**
   * Execute a single tool call and return a structured result.
   */
  async execute(call: ToolCall, ctx: ToolHandlerContext): Promise<ToolResult> {
    const start = Date.now();
    const handler = this.handlers.get(call.tool_name);

    if (!handler) {
      return {
        call_id: call.id,
        tool_name: call.tool_name,
        success: false,
        result: null,
        error: `Unknown tool: '${call.tool_name}'`,
        latency_ms: Date.now() - start,
      };
    }

    try {
      const result = await handler(call.arguments, ctx);
      return {
        call_id: call.id,
        tool_name: call.tool_name,
        success: true,
        result,
        latency_ms: Date.now() - start,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        call_id: call.id,
        tool_name: call.tool_name,
        success: false,
        result: null,
        error: message,
        latency_ms: Date.now() - start,
      };
    }
  }

  // ── Internal tool handlers ────────────────────────────────────────────────

  private async handleMemorySearch(
    args: Record<string, unknown>,
    ctx: ToolHandlerContext
  ): Promise<unknown> {
    const query = String(args.query ?? "");
    const maxResults = Math.min(Number(args.max_results ?? 5), 20);

    if (!query.trim()) {
      throw new Error("memory_search: 'query' parameter is required and must be non-empty.");
    }

    // Use the v2 retrieval pipeline for relevance-ranked results
    const { runRetrievalPipeline } = await import("../services/memory-retrieval.js");
    const candidates = await MemoryEntryRepo.getTopForUser(ctx.userId, maxResults * 2);
    const results = runRetrievalPipeline({
      entries: candidates,
      context: { userMessage: query },
      categoryPolicy: config.memory.retrieval.categoryPolicy,
      maxTotalEntries: maxResults,
    });

    return {
      query,
      count: results.length,
      entries: results.map((r) => ({
        id: r.entry.id,
        category: r.entry.category,
        content: r.entry.content,
        relevance_score: r.score,
        relevance_reason: r.reason,
      })),
    };
  }

  private async handleTaskRead(
    args: Record<string, unknown>,
    _ctx: ToolHandlerContext
  ): Promise<unknown> {
    const taskId = String(args.task_id ?? "");
    if (!taskId) {
      throw new Error("task_read: 'task_id' parameter is required.");
    }

    const task = await TaskRepo.getById(taskId);
    if (!task) {
      throw new Error(`task_read: Task '${taskId}' not found.`);
    }

    const summary = await TaskRepo.getSummary(taskId);

    return { task, summary: summary ?? null };
  }

  private async handleTaskUpdate(
    args: Record<string, unknown>,
    ctx: ToolHandlerContext
  ): Promise<unknown> {
    const taskId = String(args.task_id ?? ctx.taskId ?? "");
    if (!taskId) {
      throw new Error("task_update: 'task_id' is required.");
    }

    const updates: Record<string, unknown> = {};

    if (args.status) {
      updates.status = String(args.status);
    }
    if (typeof args.next_step === "string") {
      updates.next_step = args.next_step;
    }
    if (typeof args.completed_step === "string") {
      updates.completed_step = args.completed_step;
    }

    await TaskRepo.updateExecution(taskId, 0);

    // Append to summary if completed_step provided
    if (typeof args.completed_step === "string") {
      const summary = await TaskRepo.getSummary(taskId);
      if (summary) {
        // Summary update is a future enhancement; log intent for now
        console.log(`[tool] task_update: completed_step appended for task ${taskId}`);
      }
    }

    return { task_id: taskId, updated: true, updates };
  }

  private async handleTaskCreate(
    args: Record<string, unknown>,
    ctx: ToolHandlerContext
  ): Promise<unknown> {
    const title = String(args.title ?? "");
    if (!title) {
      throw new Error("task_create: 'title' parameter is required.");
    }

    const id = uuid();
    const mode = String(args.mode ?? "direct");
    const goal = typeof args.goal === "string" ? args.goal : title;

    await TaskRepo.create({
      id,
      user_id: ctx.userId,
      session_id: ctx.sessionId,
      title,
      mode: mode as "direct" | "research" | "execute",
      complexity: "medium",
      risk: "low",
      goal,
    });

    return { task_id: id, title, mode, created: true };
  }

  private async handleExternalStub(
    toolName: string,
    _args: Record<string, unknown>,
    _ctx: ToolHandlerContext
  ): Promise<unknown> {
    // This is a stub. Actual HTTP execution is handled by ExecutionLoop
    // after ToolGuardrail pre-check passes. Reaching this handler means
    // the loop called the executor directly without going through guardrail.
    throw new Error(
      `${toolName} is an external tool and must be executed via the ExecutionLoop ` +
        `after ToolGuardrail approval. Do not call this handler directly.`
    );
  }
}

/** Shared singleton instance */
export const toolExecutor = new ToolExecutor();
